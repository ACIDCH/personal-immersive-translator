-- PIT project ligamejpnracymxfbbff only. Ciphertext is produced in the browser.
create table public.pit_user_preferences (
 user_id uuid primary key references auth.users(id) on delete cascade,
 schema_version integer not null default 2 check (schema_version = 2),
 revision bigint not null default 1 check (revision > 0),
 device_id text,
 payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 131072),
 updated_at timestamptz not null default now()
);
create table public.pit_user_vault (
 user_id uuid primary key references auth.users(id) on delete cascade,
 vault_version integer not null default 1 check(vault_version = 1),
 revision bigint not null default 1 check(revision > 0),
 kdf jsonb not null check(kdf = '{"name":"PBKDF2","hash":"SHA-256","iterations":600000}'::jsonb),
 salt text not null check(length(salt) = 24),
 nonce text not null check(length(nonce) = 16),
 ciphertext text not null check(length(ciphertext) between 24 and 262144),
 updated_at timestamptz not null default now()
);
alter table public.pit_user_preferences enable row level security;
alter table public.pit_user_vault enable row level security;
revoke all on public.pit_user_preferences, public.pit_user_vault from anon;
grant select,insert,update,delete on public.pit_user_preferences, public.pit_user_vault to authenticated;
create policy preferences_owner on public.pit_user_preferences for all to authenticated
 using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy vault_owner on public.pit_user_vault for all to authenticated
 using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
comment on table public.pit_user_preferences is 'PIT non-secret preferences; client allowlist; CAS update must filter current revision.';
comment on table public.pit_user_vault is 'PIT client-encrypted AES-256-GCM envelope; no password, key material or plaintext credentials.';
