# PIT · Personal Immersive Translator｜沉浸式翻译开发版

PIT is a Chrome Manifest V3 / WXT + React browser extension in development for bilingual webpages, subtitles, Office/EPUB, image OCR and PDF workflows. It is **not** the commercial Immersive Translate source or a complete KISS/FluentRead fork.

> **Current audit (2026-10-21, PIT 0.4.6):** [Canonical product/content status and acceptance matrix](docs/CONTENT_SYSTEM_AUDIT_2026-10-21.md). Historical documents below describe their original dates and may contain superseded defaults, release assumptions and pre-integration module states. **Draft PR #55; no Stable release or authenticated Windows L3 signoff.**

**Current development architecture:** WXT + React controls package the existing `src/` translation runtime into the installed Chrome MV3 extension. This is **one runtime**, not a separate UI translation engine. The optional Cloudflare Pages portal remains a separate preview. See [core engineering readiness](docs/PIT_CORE_ENGINEERING_READINESS_20261019.md). The branch remains an unmerged Draft PR.

The original GitHub repository slug is intentionally unchanged until GitHub Actions and pending PRs are migrated. Production-grade KISS integration, archived Immersive Translate reuse and live cloud deployments require separate licensing/quality gates.


**Version under development:** 0.4.6 (matches `apps/wxt-ui/wxt.config.ts`) — functional development/UAT build, **not production or real-account verified**.

## Isolation

- Code and PRs: https://github.com/ACIDCH/personal-immersive-translator
- Project-only Supabase: `personal-immersive-translator` (`ap-southeast-2`), reserved for future optional synchronization; no runtime requirement or database tables.
- YUNPAN independent Drive folder: https://drive.google.com/drive/folders/1EddQ28j6XRMAknfe0lcEfuSlQwdkoO05
- Do not modify `ACIDCH/ACIDCH`, `ACIDCH/ACIDCH.github.io` or the user's independent learning system.

## Real upstream integration, not just references

- **Mozilla PDF.js 6.4.299 (Apache-2.0)**: actual official npm-distributed JS + Worker copied locally into the **CI-built extension** with LICENSE and SOURCE.json. Used to preview and inspect selected PDF first pages, no CDN.
- **whisper.cpp (MIT)**: separately installed executable/model, called through the optional local Python speech service. Neither Whisper binaries nor models are inside the extension ZIP.
- **BabelDOC (AGPL-3.0)**: separately installed executable, called from the local PDF/OCR bridge. It is not shipped in the extension ZIP.
- **Tesseract (Apache-2.0)**: independently installed OCR executable, used through OCRmyPDF / the local image endpoint.
- **KISS Translator (GPL-3.0)**: design research only. No GPL source is transplanted into this standalone MIT implementation.
- **Tesseract.js (Apache-2.0):** actually packaged as a WXT-local WASM OCR worker with browser image/document flows; real-world multilingual photographs and arbitrary image inpainting remain unaccepted. PaddleOCR remains an unintegrated candidate.
- **faster-whisper (MIT):** independently runnable CPU ASR container/API source and synthetic-audio model CI; real Railway deployment, authenticated video sessions, latency and budget remain unverified.

Read [upstream provenance and license audit](docs/UPSTREAM_LICENSE_AUDIT_zh-CN.md).

## Source-base status and upstream reuse gate

**Upstream verification (2026-10-16):** Our browser extension is **not a fork of a highly starred browser translator**. Mature upstream engines are integrated for PDF rendering, optional ASR, OCR, document processing and CI, but the page translation and caption controller are primarily project-authored code. We must not mislabel them as transplanted KISS / Read Frog / Immersive Translate source. A license-screened fork-versus-component comparison is required before claiming a high-star core base. See [audited repository evidence and decision gate](docs/UPSTREAM_BASELINE_DECISION_zh-CN.md).

## Modes

| Mode | Current behavior | Requirements |
| --- | --- | --- |
| Web bilingual | **Fresh-install default: Google public keyless MT (`google-free`)**, online and uploads requested text; Chrome native and MyMemory are alternatives, official BYOK/AI are separately configured. Reusable webpage DOM/restore core | Internet and working public HTTP endpoint (rate limits, no Google Cloud SLA); Chrome built-in requires an optional language pack. Real-site layout remains L3 pending |
| HTML5/video subtitles | Native timed cues, user-visible platform CC, imported SRT/VTT/ASS; ASR opt-in when CC unavailable | Authorized accessible captions or explicitly configured Whisper; simulated players do not prove live-site access |
| Speech/ASR captions | Explicit tab capture → configured local Whisper or independent cloud faster-whisper ASR → selected ordinary text MT | ASR model service must be installed/deployed with credentials; a working CI model is not an active HTTPS service. No DRM bypass |
| Image/OCR | WXT-local Tesseract.js WASM and spatial OCR text boxes; optional Gemini vision, local OCRmyPDF, conservative flat-background PNG replacement | Actual model/language-pack availability and live image quality; in-place overlay is **not** semantic inpainting |
| PDF and Office | Browser PDF.js raster bilingual fallback with OCR + positioned line reconstruction; DOCX/PPTX/XLSX/EPUB/TXT/MD/HTML workbench; optional independent BabelDOC jobs | Real high-fidelity BabelDOC API, credentials, compute/volume and actual document content quality require independent acceptance; raster PDF is not editable layout-preserved PDF |

**Language selection:** zh / en / ja / ko / fr / de / es. Supported selection does **not** guarantee equal quality/compatibility across providers, platforms, BabelDOC and OCR models.

## Install a CI-built package

1. Open PR #55's latest successful **Multimodal Platform UI & BYOK validation** GitHub Actions workflow and download the **`multimodal-wxt-web-integration-test`** artifact. `personal-immersive-translator-alpha` is a different older native ZIP, not the WXT/React integrated build.
2. Extract the WXT artifact and find its root `manifest.json`. The WXT output layout is different from the older native ZIP; do not mix files from the two builds.
3. Open `chrome://extensions` or `edge://extensions`, enable Developer Mode and choose **Load unpacked**. Native Chrome Translator requires an eligible Chrome 138+ build and available language packs; other features have their own runtime requirements.
4. Open Options → **翻译服务中心**, review the new-install `Google 免费公共翻译` option, and send a **public test sentence** with its per-service test button. This unofficial public endpoint can fail/limit requests and transmits requested text online. If it fails, manually choose another Provider; optional Chrome native translation requires supported language packs. AI remains opt-in. Do not commit Keys to GitHub or Drive.
5. WXT can run Tesseract.js OCR in the browser. Optional local Whisper and high-fidelity BabelDOC still require their own model/service setup. See [cloud deployment](docs/P0_CLOUD_DEPLOYMENT.md) and [engineering readiness](docs/PIT_CORE_ENGINEERING_READINESS_20261019.md).

For development from source, use Node.js 22+:

```sh
npm install --ignore-scripts
npm run verify
```

This installs the exactly pinned upstream PDF.js and regenerates the locally packaged vendor assets. No remote executable code is loaded by the extension. Release artifacts contain generated vendor files that are intentionally not committed.

## Validation and limitations

GitHub Actions checks Node tests, native Chromium MV3 installation, popup/settings, DOM fixtures, subtitle fixtures, and PDF/OCR bridge tests. Vendor PDF.js rendering is tested using a real generated PDF.

**Not yet passed on real authenticated protected platforms:** Netflix, Panopto and all YouTube UI variants; real-user 30-minute ASR performance, real **deployed** Railway BabelDOC/faster-whisper and complex academic PDF output, paid official API integration, or statistically valid superiority over Immersive Translate. A separate CI using real Whisper tiny on synthetic speech and offline BabelDOC layout is not remote-service L3 signoff.

[Release matrix](docs/INITIAL_MULTIMODAL_ACCEPTANCE.md) · [Player latency criteria](docs/PLAYER_LATENCY_VALIDATION_zh-CN.md) · [Security](docs/SECURITY.md) · [Benchmark methodology](benchmarks/README.md).

Codex is reserved for final independent review; no unapproved merge to main.

## Stability update v0.3.1

Long-article continuation beyond 250 paragraphs; SPA and open Shadow DOM source mutation refresh; no recursive bilingual feedback in lists/tables; correct unsupported-video SRT import messaging; stale video subtitle session isolation; local engine readiness diagnostics; WebP/JPEG/PNG normalization with EXIF orientation and pixel limits; serialized BabelDOC jobs. Tested through real Chromium fixtures and offline FastAPI/real Tesseract OCR. See [hardening acceptance](docs/CORE_HARDENING_ACCEPTANCE_zh-CN.md). The release remains a **development build**, not a final stable product.

## Stability update v0.3.2

- Google Cloud Translation credentials are transmitted via official `x-goog-api-key` header, never URL parameters.
- Device-only translation cache has 300-entry limit, 30-day TTL and legacy data pruning; cache failures no longer suppress already-successful translation responses.
- Standard webpage translation caps automatic requests at 600 paragraphs per activation and offers a user-initiated Continue button for the next 600. AI remains opt-in.
- Invalid settings recover safely to defaults without activating AI.
- Reproducible tests and evidence: [provider privacy and cache acceptance](docs/PROVIDER_PRIVACY_CACHE_ACCEPTANCE_zh-CN.md).

This is **not** a guaranteed money-spending limit and does not imply real authenticated video services or real PDF/ASR model acceptance.

## v0.3.3 development hardening

- Native video captions can temporarily fall back to already-visible YouTube/Netflix/Panopto-style DOM captions when a text track exists but contains no usable cues. If the native timeline loads later it takes priority again; hidden captions and stale async responses no longer reappear.
- Opt-in local audio recognition cleans the extension's capture session when Chrome unexpectedly ends the tab audio track, rather than showing a false recording state.
- Local Tesseract image OCR optionally supplies **bounded line coordinates**. Users can enable experimental positional image translation preview. It is off by default because segmented machine translation can cost more API requests and may reduce text coherence.
- Official Mozilla PDF.js viewer checks a bounded sample of pages (up to 20) so mixed scanned appendices are not missed by first-page-only inspection.
- Tests use Chrome with simulated platform DOM, a real Tesseract engine and actual PDF.js; **no actual streaming DRM services, real Whisper model or full BabelDOC reconstruction is certified**.

[Module acceptance and remaining blockers](docs/MULTIMODAL_HARDENING_ACCEPTANCE_033_zh-CN.md).

## v0.3.4 core integration (no UI redesign yet)

- **Embedded course players:** when the top-level page lacks readable captions, a visible YouTube or Panopto iframe can be offered for exact-origin, opt-in host permission; script injection targets the selected frameId. Both the LMS domain and iframe domain remain subject to the user's translation denylist. No DRM or login bypass.
- **Whisper capture:** prefer 250ms-batch AudioWorklet on an active audio render thread, but fall back after 3 seconds to legacy ScriptProcessor for browsers/drivers where the Worklet module cannot start. AudioContext itself can use native device sampling rates, followed by actual 16kHz resampling. Repeated local ASR failures back off, then automatically stop.
- **PDF real OCR:** CI now creates a raster-only PDF and **actually runs OCRmyPDF/Tesseract/Ghostscript**, verifying searchable output. BabelDOC translation is still external and not yet validated with real user-owned API credentials or complex academic layouts.
- **Multilingual OCR readiness:** the local diagnostic response identifies which of the seven Tesseract language packs are installed, instead of assuming every language is ready.
- **Real hardware metrics:** a separate local whisper.cpp benchmark script records p50/p95/overdue clips, but no real-device measurements are included in CI. Headless Chrome may explicitly SKIP AudioWorklet loading if no active audio device is available; compatibility is preserved by the tested ScriptProcessor fallback.

[Detailed implemented-versus-unverified scope](docs/CORE_IMPLEMENTATION_034_zh-CN.md).

Per user request, this phase **does not finalize project naming, UI identity or dashboard design, and does not deliver interim ZIP packages**. Those are reserved for the complete system after runtime acceptance and final independent Codex review.

## v0.3.5 — persistent local ASR and PDF quality validation

- Optional **persistent official whisper.cpp server** inference via authorized local Python bridge, fixed IPv4 loopback and response-format checking, with `whisper-cli` retained as the default. Model is loaded once in the separately started server instead of per audio chunk. This may reduce startup overhead but **has not been benchmarked on the user's Windows hardware**.
- Health check distinguishes a real responding local Whisper server from an unverified port configuration. **Caution:** upstream example whisper-server has permissive CORS and no equivalent token authentication; leave this experimental option disabled on untrusted browser sessions and never expose it to a public interface.
- **BabelDOC translated PDF post-check** now rejects dropped pages or a completely unsearchable output. Offline CLI reports pages and text outside page edges without including document content. This is structural screening, not full visual layout or translation-quality acceptance.
- CI additionally executes **real French Tesseract OCR** beside existing English OCR and OCRmyPDF scanned-PDF tests; no Korean/Japanese/CJK CER benchmark yet.
- [Runtime configuration, tests, security limits and release gates](docs/WHISPER_PDF_ACCEPTANCE_035_zh-CN.md).

The entire project remains in stacked Draft PRs. UI/name redesign and the user-facing installer package are deferred until actual core-engine tests, final independent Codex review and release acceptance.

## v0.3.6 — actual Chinese/Japanese/Korean OCR and BabelDOC CLI preflight

- CI now installs **real Tesseract Chinese, Japanese and Korean packs** and open-source Noto CJK fonts; it invokes the local image OCR API with three actual raster images and records normalized character error rates. Each clean short-form synthetic fixture achieved 0% CER; real photographic and academic-layout accuracy is still **unverified**.
- Device diagnostics execute installed BabelDOC `--help` within a 12s limit and reject versions that lack the required `--config`, `--files`, languages/output and API compatibility flags. The tools page reports missing flags; this is NOT proof of successful model downloading or real PDF translation.
- `benchmarks/ocr_accuracy.py` supplies a Unicode-normalized Levenshtein CER metric for later permitted real-world fixtures. Read [development acceptance](docs/CJK_OCR_BABELDOC_PREFLIGHT_036_zh-CN.md).

The repository remains in stacked Draft PRs. No intermediate user-facing ZIP; defer project naming, full control panel visual redesign and branding until all core functions and release blockers are resolved.

## v0.3.7 — direct-launch reliability, stricter BabelDOC checks, seven-language OCR

- Fixes an actual direct-entrypoint import failure in the local PDF/ASR bridge; the direct script path now receives the required Whisper health probe too, and is regression-tested in a separate Python process.
- Requires **whole option-name matching** in BabelDOC CLI compatibility inspection to avoid treating similar flags as equivalent.
- Adds **actual German and Spanish** Tesseract language-pack image recognition to existing Simplified Chinese, English, Japanese, Korean and French coverage. The clean single-line synthetic samples all achieve 0% character error; **no real-world photo accuracy guarantee**.
- The optional persistent whisper.cpp server has permissive CORS in its upstream example and no token-bound interface. For security, server mode requires `PIT_ACK_UNAUTH_WHISPER_SERVER=1` explicitly in the **local service environment**. Without it, the server pathway fails closed; the default `cli` mode remains available. This is a development safety interlock, **not an authentication layer**.
- [v0.3.7 runtime and release-gate audit](docs/CORE_RUNTIME_HARDENING_037_zh-CN.md).

As requested, do not distribute an intermediate installer, merge Draft PRs or redesign the UI until the remaining real-device and document quality gates are satisfied.

## v0.3.8 — authenticated in-process persistent ASR option

- Add third optional `PIT_ASR_BACKEND=faster` using the actual **SYSTRAN/faster-whisper (MIT)** API inside the existing authenticated Python local bridge. A single CTranslate2 model is loaded from a user-provided local directory and reused across audio chunks; no extra unauthenticated HTTP listening endpoint. This does **not** download models or send raw audio to a cloud service.
- The optional dependency is separate in `services/requirements-faster-whisper.txt`, preserving lightweight default `whisper-cli` and the disabled-by-default experimental `whisper-server` path. Requires real local `model.bin`, `config.json` and `tokenizer.json` and strictly `local_files_only=True`.
- Unit/integration tests use real NumPy WAV PCM decoding and the **real installed upstream Python API signatures**; a test fake model validates one-time loading and authorized FastAPI request routing. No real downloaded model is inferred in CI; no 30-minute real-device p95 is claimed.
- [Security, Windows preparation, exact config and remaining real acceptance](docs/INPROCESS_ASR_SECURITY_038_zh-CN.md).

As requested, no intermediate user-facing installer, main merge or overall UI/brand redesign until all core tests and final independent Codex review.

## v0.3.9 — scanned PDF classification and real subprocess acceptance

- Avoid mistakenly running OCR on empty separator pages, short searchable covers and small logos; identify **substantial raster-only pages throughout the document**, including late scanned appendices. Detection is a heuristic, not a guarantee for all vector and image-only PDF styles.
- New acceptance tests run genuine **OCRmyPDF/Tesseract/Ghostscript** followed by an actual separately launched BabelDOC-compatible CLI fixture, verifying the full PDF handoff, real generated output, credential-private TOML and error cleanup. The fixture is **not official BabelDOC**, so this is not a paid-service translation quality certification.
- Added **opt-in actual BabelDOC acceptance command** `python -m benchmarks.babeldoc_real_acceptance`. It cannot call the real translation service without explicit `--acknowledge-billed-translation` and the user's own `DEEPSEEK_API_KEY` environment variable; it refuses to overwrite source/output files and reports only structural metrics. **No paid translator invocation has been performed automatically.**
- [v0.3.9 runtime verification details](docs/REAL_PDF_RUNTIME_GATE_039_zh-CN.md).

No UI/brand redesign, intermediate installer or main merge. Final real-model testing and independent Codex audit are still required.

## v0.4.0 — strict visible-iframe video caption routing

- A cross-origin Panopto/YouTube embedded frame is selected by the **exact visible player URL**, not merely by hostname, so unrelated recordings on the same LMS host cannot be mixed up. Multiple indistinguishable matches fail closed.
- The user must explicitly authorize the specific HTTPS player origin. Immediately before and after cross-origin script injection, the extension rechecks the live frame selection to detect navigation races; the top LMS and child frame each honor the user's blocked-host rules. Restarting subtitle translation stops any prior child session in the same tab.
- A new headless Chromium **real Manifest V3 multi-frame test** creates synthetic LMS/Panopto-shaped URLs, uses only test-only pregranted fixture origins in a throwaway Manifest (headless Chrome cannot approve permission dialogs), enumerates real cross-origin frames and validates isolated subtitle injection, start and stop. The production Manifest retains per-site optional host permission prompts, which require real-user UAT. This tests browser security APIs on synthetic pages, **not actual authorized Panopto/Netflix or DRM streams**.
- [v0.4.0 engineering evidence and remaining requirements](docs/EMBEDDED_CAPTION_FRAME_ACCEPTANCE_040_zh-CN.md).

Per user preference, this stage does **not** deliver an interim installer ZIP and does **not** initiate the later combined UI/project naming/visual redesign. Main stays unchanged pending real-device UAT and final independent Codex audit.

## v0.4.1 — bind embedded captions to the exact recording

- Subtitle permission routing now compares full canonical HTTPS recording URLs (including query parameters, excluding the fragment), not only a reused `frameId` and origin.
- The selected URL is kept in extension memory only, never logged, displayed or persisted. The target frame validates that URL before starting, and stops its translation session if SPA history changes to another recording.
- Browser MV3 fixture coverage rejects wrong-recording start and validates same-origin route changes; **this does not claim authenticated real Panopto/Netflix testing**.
- See [recording-bound acceptance](docs/RECORDING_BOUND_SESSION_041_zh-CN.md). All stacked PRs remain drafts. No interim installer or main-branch merge.

## v0.4.2 — isolate opt-in ASR sessions and cleanly end capture

- Every capture has a per-start UUID; background ignores delayed offscreen messages from previous sessions, including the same tab.
- Session identity is registered before starting audio and invalidated before teardown; an early stream end cannot leave a false recording state.
- At the 1,440-request safety ceiling, capture now emits the same completion notification as an unexpectedly ended track. This counts dispatched requests, **not a guaranteed 72-minute clock timer**.
- See [v0.4.2 acceptance](docs/ASR_SESSION_LIFECYCLE_042_zh-CN.md). Real multilingual Windows/Whisper soak testing remains open. No main merge or intermediate installer.

## v0.4.3 — serialized capture control and session-aware overlay

- Serializes START/STOP/stream-ended/tab-navigation actions in the MV3 worker. A second user click can no longer concurrently tear down a newer audio capture.
- Forwards ASR session IDs all the way to the page overlay and requires exact matching for START/STOP, text, errors and metrics; a stale end banner is ignored for a new capture.
- A freshly started session can translate immediately even if the previous session's standard-provider call is still pending. Old in-flight results cannot repaint the new session.
- Before transient ASR-caption translation, background validates the current tab and session ID; past recordings cannot initiate a new external translation request after stop.
- Added independent worker race tests and real Chromium delayed-response UI regression. See [v0.4.3 acceptance](docs/ASR_RACE_CONTROL_043_zh-CN.md). No authenticated player or live Whisper hardware certification, no main merge, no interim installer.

## v0.4.4 — native caption track switching and player replacement

- Observe changes in a video's preferred native TextTrack so users can switch language while subtitles are already active.
- Invalidate old cue cache and outstanding translations upon track changes; only restore a track mode if the extension changed it.
- Hide translations when cues disappear, and stop caption sessions when the original <video> is disconnected or its nonempty media source is replaced.
- Bind standalone player sessions to their initial fragment-free document URL, so a same-tab YouTube/Panopto SPA recording change cannot reuse older captions.
- Added Chrome fixture tests for delayed cross-language responses, player DOM replacement and top-level SPA changes. See [acceptance notes](docs/PLAYER_TRACK_SWITCH_044_zh-CN.md). Real authenticated platforms remain unverified.
