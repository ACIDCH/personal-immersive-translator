# PIT P0-A browser translation and keyless fallback acceptance

Date: 2026-10-18. Work branch: `feat/chrome-native-no-key-translation-20261018`, Draft PR #55.

## Implementation changes
- Model-pack creation initiated synchronously from a Settings download click, rather than awaiting availability and losing Chrome transient activation.
- Progress reporting from the browser download monitor and shared pending-session initialization.
- No-key MyMemory public external standard MT is an explicitly selected fallback, **not** an automatic native failure redirect. Default remains on-device Chrome Translator.
- Public MT is constrained to <=450 UTF-8 bytes per request, <=3 simultaneous segments, a local 4,500-character/day reservation and clear source-language uncertainty / provider quota errors.
- A fixed public English sample is reserved for non-secret external real-service CI probing. It is not personal data.

## Evidence categories
- L0: `npm run verify` / complete WXT build and native/provider test units from the exact HEAD. CI must be read separately after commit.
- L1: installed Chromium MV3 and WXT mocked supplier route tests. These DO NOT prove Chrome downloaded model inference.
- L2: the `Real keyless standard translation` workflow performs **one genuine external MyMemory HTTP transaction** without a provider mock; read its machine-readable artifact. The workflow is intentionally non-gating on transient third-party network outages, and **success of the workflow does not by itself mean LIVE_TRANSLATION_RETURNED**.
- L3: a Windows Chrome user click, actual downloaded language pack, returned on-device translation in PIT's offscreen context, genuine multi-page websites, licensed video, complex PDFs and photos remain unverified.
- L4: NOT READY.

## User verification still required
1. On Chrome desktop, open PIT Settings; select actual source language and target; click download language pack and read the per-execution-context result.
2. Test an authorized real public page with no key, including longer paragraphs, translated-only mode and restore; record coverage/errors.
3. If Chrome cannot provide the model, explicitly select MyMemory as an opt-in low-volume public fallback; never use it for confidential or large files.
4. Do not merge Draft PR #55 or publish a stable installer based solely on CI.

Source comparisons: Issue #45, Issue #53, `docs/IMMERSIVE_PARITY_MATRIX_2026.md`.
