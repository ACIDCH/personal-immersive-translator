# Architecture (ADR-0001)

> **历史版本材料（2026-10-16）**：保留当时的设计、术语和验收结论，用于追溯；此处的默认引擎、版本号及“已实现/计划”标签已不代表当前 PIT 0.4.6。现行模块状态、统一入口和真实验收依据请阅读 [2026-10-21 内容体系审计](CONTENT_SYSTEM_AUDIT_2026-10-21.md)。

Status: v0.1.0 Alpha, 2026-10-16.

## Independent resources

| Resource | Role |
| --- | --- |
| [ACIDCH/personal-immersive-translator](https://github.com/ACIDCH/personal-immersive-translator) | Exclusive source code, tests, PRs, CI and version control |
| [YUNPAN project folder](https://drive.google.com/drive/folders/1EddQ28j6XRMAknfe0lcEfuSlQwdkoO05) | Docs, zipped Alpha releases, backup data |
| Supabase project `ligamejpnracymxfbbff` | Opt-in future authentication/sync; isolated from language-learning-hub |
| Chrome/Edge local extension | All Alpha runtime and saved settings; works without Supabase/Drive |

## Runtime data flow

Popup explicit action → Chrome `activeTab` injection → content script extracts ordinary visible text → background service worker validates request and settings → local cache → one provider adapter → configured remote HTTPS API → text-only translated DOM nodes.

Standard providers: Microsoft Translator, Google Cloud Translation Basic, DeepL, permitted HTTPS LibreTranslate. AI providers: Gemini and DeepSeek, **always explicitly activated**. A standard provider failure must not silently invoke AI.

Keys live only in trusted Chrome `storage.local` contexts, never in content scripts, GitHub, YUNPAN or Supabase. Text sent to an external service is subject to that provider's policies. `storage.local` is not a cryptographic vault.

## Source layout

- `src/background.js` — request gate, translation routing and cache.
- `src/content.js`, `src/content.css` — DOM selection and bilingual rendering.
- `src/lib/providers.js` — six remote-service adapters.
- `src/lib/settings.js`, `src/lib/cache.js` — configuration and SHA-256 cache.
- `src/popup.*`, `src/options.*` — user-facing controls.
- `tests/` — offline mock API integration tests.

## Alpha limitations

No built-in unlimited Google Translate access; commercial vendors require registered official API credentials. Chrome built-in Translator, video captions, PDF layout reconstruction, OCR, local speech transcription, browser E2E and quota-enforced server proxy remain separate modules.

## Security and size limits

Per batch: <=10 segments, <=5000 UTF-16 code units per segment, <=12000 in total, 45s network timeout. External provider translations are inserted with `textContent`, not raw HTML. Content script cannot access provider credentials through messages.
