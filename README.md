# Personal Immersive Translator

An independently implemented, privacy-conscious, Manifest V3 Chrome/Edge bilingual-translation extension.

**Status:** 0.1.0 Alpha — not production verified. Ordinary translation uses user-configured Microsoft Translator, Google Cloud Translation, DeepL, or permitted LibreTranslate services. Optional Gemini / DeepSeek translations require explicit confirmation; AI is never the automatic fallback.

## Project isolation

- This is the **only GitHub repository** used for the translation extension.
- Its Supabase project is `personal-immersive-translator` (Sydney / `ap-southeast-2`), dedicated to this project and not required for the local extension.
- YUNPAN has a dedicated `Personal-Immersive-Translator` folder for documents, releases and backups.
- Never commit API keys or credentials.

## Local installation

1. Download the source archive from the [YUNPAN Alpha release](https://drive.google.com/file/d/1N27Jjvi2rxZrvfHAncU_TsVHkRwEEDOp/view?usp=drivesdk) and extract it.
2. In Chrome or Edge visit `chrome://extensions` / `edge://extensions`.
3. Enable Developer mode, choose **Load unpacked**, select the extracted directory with `manifest.json`.
4. Open extension Options, configure the selected translation provider's **own official API key**, then visit an ordinary webpage and choose Translate.
5. AI mode is optional and should be used only with your own Gemini / DeepSeek API key and attention to possible costs.

**Note:** A public browser extension must never embed developer-owned API secrets. Microsoft, Google and DeepL are commercial services with quotas/terms; they are not open-source translation servers.

## Development

Requires Node.js 20+. Run `npm run verify` after downloading the complete project files. Tests mock external API calls and do not yet establish real-browser or live-API compatibility.

## Architecture

Core modules: webpage text detection, rendering, translation router, standard provider adapters, AI provider adapters, extension settings and local cache. Supabase is reserved for opt-in cross-device sync; it is not a mandatory online translation gateway.

Inspired by public documentation of KISS Translator, Read Frog, FluentRead and Translate Web Pages. **No GPL project code is copied into this MIT-licensed implementation.**

## Roadmap

- [x] Project isolation and dedicated cloud storage
- [x] First Alpha source package saved in YUNPAN
- [x] Dedicated Supabase project
- [ ] Complete source mirror and automated verification in GitHub
- [ ] Real-browser acceptance and API tests
- [ ] Dynamic websites, captions and PDF enhancement
- [ ] Final independent Codex review


## 0.2.0 experimental multimodal branch

The initial release scope now includes video captions, multilingual website translation, image OCR, experimental real-time speech captions, and an optional high-fidelity PDF reconstruction service.

- Web translation: existing standard translation providers are the default; Gemini/DeepSeek are explicitly selected.
- Video captions: TextTrack, visible YouTube/Netflix/Panopto subtitle DOM, and user-supplied SRT/VTT. Live-video selectors and institutional iframe permission are **not guaranteed**.
- Image OCR: user-selected files or an explicitly captured visible-tab screenshot; Gemini image recognition or local Tesseract OCR, followed by standard translation.
- PDF OCR/layout preservation: separate local OCRmyPDF + BabelDOC workflow for user-supplied PDF files. The installed browser extension alone **cannot** run BabelDOC; see [setup](docs/PDF_OCR_SETUP.md).
- Experimental tab audio: opt-in, localhost-only short WAV chunks and whisper.cpp ASR, then translated text via the selected standard translation API; no guarantee of realtime performance or capture of DRM material.

Full functionality requires the separate local bridge, the relevant OCR/ASR models and user-owned API credentials. Preview branch is not a production release. No testing yet establishes that its speed or accuracy exceeds the commercial Immersive Translate extension.

[Initial acceptance matrix](docs/INITIAL_MULTIMODAL_ACCEPTANCE.md) · [Video/live engineering plan](docs/MEDIA_REALTIME.md) · [OCR/PDF local setup](docs/PDF_OCR_SETUP.md).
