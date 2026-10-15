# Initial multimodal scope and required acceptance

Priority order: resolve video site compatibility, difficult DOM extraction and real-time translation stability; then image OCR and PDF layout-preserving translation.

| Requirement | Current implementation | Outstanding before stable |
| --- | --- | --- |
| Bilingual webpage | DOM and open Shadow DOM, reactive updates | Browser E2E, iframe permissions, canvas OCR |
| YouTube | Visible caption DOM adapter, native text tracks | Live CC A/B testing, caption quality and sync |
| Netflix | Viewer-visible player-timedtext adapter, no protected requests | Authorized-player tests; changing private selectors |
| Panopto | Viewer-visible caption selectors or imported SRT/VTT | Institutional iframe permissions, official caption API where authorized |
| Generic HTML5 video | TextTrack, prefetch, seek tests | Continuous timing measurement, stress tests |
| No subtitles / live audio | Subtitle import and **experimental, user-initiated tab audio → local whisper.cpp CLI → standard translation**; still lacks browser E2E, VAD optimization and validated latency | Consent-based tab capture, whisper.cpp processing, VAD, queue metrics |
| Image / screenshot | Gemini cloud OCR, local Tesseract bridge + standard translation | Image-region selection, PaddleOCR enhancement, accuracy suite |
| Scanned PDF | OCRmyPDF + Tesseract, then BabelDOC local bridge | Test on real scanned files, layout QA and model install |
| Layout-preserved PDF | BabelDOC CLI integration on local Python service | Production packaging, larger-file performance, full language coverage |
| Languages | zh/en/ja/ko/fr/de/es | Per-language OCR, subtitle and PDF acceptance |
| AI providers | Gemini/DeepSeek explicit opt-in; normal providers default | Hard cost budgets and detailed quota reporting |

## Comparative goals (not yet achieved or claimed)

Benchmarks must run on identical source documents, video segments, model/provider selection, network conditions and hardware. Report semantic correctness, terminology consistency, p50/p95 caption latency, captions missed or misaligned, image OCR character error rate, PDF clipping/overlap and layout fidelity. Test against Immersive Translate with the same fixtures. GitHub stars indicate ecosystem maturity, not proven performance.

## Licensing and responsible access

whisper.cpp: MIT. Tesseract.js and PaddleOCR: Apache-2.0. PDF.js: Apache-2.0. BabelDOC: AGPL-3.0. KISS Translator: GPL-3.0; study as reference, no GPL code copied into the independent MIT extension. Respect website access controls, DRM, authentication and classroom content permissions. Never upload captured audio, protected captions or academic files without explicit user consent.

## Status

A user-facing initial module does not mean the feature has passed real Chrome/Edge tests, model accuracy testing or cross-platform acceptance. Draft branches are not stable releases. Codex is reserved for independent final review.
