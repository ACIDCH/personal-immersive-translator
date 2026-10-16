# Personal Immersive Translator

Open-source browser extension project for bilingual webpages, site-visible video subtitles, opt-in local speech transcription, image OCR and academic PDF workflows.

**Version under development:** 0.3.7 — release candidate preparation, **not production or real-account verified**.

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
- PaddleOCR and browser Tesseract.js: candidates, **not presently integrated**.

Read [upstream provenance and license audit](docs/UPSTREAM_LICENSE_AUDIT_zh-CN.md).

## Modes

| Mode | Current behavior | Requirements |
| --- | --- | --- |
| Web bilingual | Standard provider by default; original and translated text coexist | Your own official provider API Key and quota |
| HTML5/video subtitles | Native timed cues, visible YouTube/Netflix/Panopto DOM fallback, imported SRT/VTT | Captions must be available and permitted |
| Local speech captions | Explicit tab audio capture → optional localhost Whisper → ordinary translation service | Manually installed multilingual whisper.cpp, model and bridge; no DRM bypass |
| Image/OCR | User-selected image or deliberately captured screenshot via Gemini OCR or local Tesseract | Own API Key or installed local OCR bridge |
| PDF | Official PDF.js previews and scanned-page hints; separate OCRmyPDF → BabelDOC PDF reconstruction | Local Python service, system OCR packages, BabelDOC install, model and own API Key |

**Language selection:** zh / en / ja / ko / fr / de / es. Supported selection does **not** guarantee equal quality/compatibility across providers, platforms, BabelDOC and OCR models.

## Install a CI-built package

1. Open this branch's latest successful GitHub Actions and download `personal-immersive-translator-alpha` artifact. Extract the inner ZIP if the Actions artifact wraps it.
2. Unzip the actual browser package into a folder containing `manifest.json`, `src/` and `assets/`; `src/vendor/pdf.mjs`, `pdf.worker.mjs` and the Apache license should be present.
3. Use Chrome/Edge **125 or later**. Visit `chrome://extensions` or `edge://extensions`, enable Developer Mode and choose **Load unpacked**.
4. Open Options and enter your **own** official translation API Key; never place credentials in GitHub or Drive.
5. For OCR, local ASR or layout-preserved PDFs, complete [local prerequisites](docs/PDF_OCR_SETUP.md) separately. The browser ZIP alone is insufficient for those workflows.

For development from source, use Node.js 22+:

```sh
npm install --ignore-scripts
npm run verify
```

This installs the exactly pinned upstream PDF.js and regenerates the locally packaged vendor assets. No remote executable code is loaded by the extension. Release artifacts contain generated vendor files that are intentionally not committed.

## Validation and limitations

GitHub Actions checks Node tests, native Chromium MV3 installation, popup/settings, DOM fixtures, subtitle fixtures, and PDF/OCR bridge tests. Vendor PDF.js rendering is tested using a real generated PDF.

**Not yet passed on real authenticated protected platforms:** Netflix, Panopto and all YouTube UI variants; real whisper.cpp multilingual 30-minute performance, real BabelDOC output on complex academic PDF, paid official API integration, or statistically valid superiority over Immersive Translate.

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
