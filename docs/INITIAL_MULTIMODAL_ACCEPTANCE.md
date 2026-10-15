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


## 2026-10-16 hardening milestone

### Verified automatically (not commercial API integration)

- Real Manifest V3 extension loads in an isolated Playwright Chromium profile. Popup, options persistence, image/PDF tools are opened with real extension APIs.
- Browser DOM and subtitle fixtures pass in real Chrome with mocked translation API.
- Captured tab audio is explicitly resampled to 16 kHz regardless of hardware input rate. The Python bridge rejects mislabeled/invalid PCM WAV headers and tests a mocked Whisper CLI execution.
- Mixed native/scanned PDF pages trigger OCR preprocessing. Temporary BabelDOC credentials are created using mode 0600 from creation, and output is validated as a parseable PDF.
- Real Tesseract English OCR CI smoke remains active. CI does not download a speech model, invoke paid translation services or bypass protected video sources.

### Still blocking a stable release

- Full real whisper.cpp multilingual model run of continuous video, stop/seek/offline handling and measured p50/p95 delay.
- Authorized YouTube, Netflix and Panopto player test fixtures, cross-origin iframe restrictions and evolving subtitle DOM.
- Actual BabelDOC CLI run on complex documents with user-owned translation credentials. BabelDOC supports the configuration and file options but its upstream CLI is primarily a debugging interface. AGPL license compliance remains mandatory.
- Independent quantitative performance and translation accuracy comparison against Immersive Translate. No superiority claim until validated.
