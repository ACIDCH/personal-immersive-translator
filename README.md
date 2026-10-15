# Personal Immersive Translator

Open-source browser extension project for bilingual webpages, site-visible video subtitles, opt-in local speech transcription, image OCR and academic PDF workflows.

**Version under development:** 0.3.1 — release candidate preparation, **not production or real-account verified**.

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
