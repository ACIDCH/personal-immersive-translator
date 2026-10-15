# Security policy — Alpha

## Trust boundaries
The untrusted webpage is accessed only by an on-demand isolated content script. Credentials are read by the service worker and settings page, not by the content script. Provider responses are rendered via `textContent`.

## Key risks
- `chrome.storage.local` is not encrypted at rest by this extension. Local OS profile compromise can expose credentials.
- Sent page text is disclosed to the configured remote translation service; do not use on banking, private messages or sensitive materials.
- AI output can be shaped by prompt injection. Validate structure and don't execute or inject returned HTML.
- AI requests may incur charges; this Alpha has no robust per-account budget cap.
- Cache has a 30-day TTL but no full eviction engine or encryption.
- LibreTranslate must be a server you control or have permission to use, over HTTPS.
- Public browser extensions must not embed shared service-role credentials or personal AI keys.
- The dedicated Supabase project is intentionally unused by the Alpha runtime. Future shared tables require row-level security, user ownership and least-privilege permissions.

## Before production
Live browser tests, browser-extension permissions audit, rate-limit handling, strict input guards, external API provider-terms check, third-party license audit, PR review and independent Codex security review.
