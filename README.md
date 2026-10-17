# Personal Immersive Translator

An independently implemented, privacy-conscious, Manifest V3 Chrome/Edge bilingual-translation extension.

**Status:** 0.1.0 Alpha — not production verified. Ordinary translation uses user-configured Microsoft Translator, Google Cloud Translation, DeepL, or permitted LibreTranslate services. Optional Gemini / DeepSeek translations require explicit confirmation; AI is never the automatic fallback.

## Project isolation

- This is the **only GitHub repository** used for the translation extension.
- Its Supabase project is `personal-immersive-translator` (Sydney / `ap-southeast-2`), dedicated to this project and not required for the local extension.
- YUNPAN has a dedicated `Personal-Immersive-Translator` folder for documents, releases and backups.
- Never commit API keys or credentials.

## Optional OpenRouter AI channel
The Options page supports **OpenRouter** as a manually selected AI provider alongside Gemini and DeepSeek. Enter your own API key and an exact model ID (for example a provider/model ending in `:free`). Availability, quotas and pricing are controlled by OpenRouter and can change; this is **not** an unlimited free translation service. AI calls always require an explicit confirmation, and failures never invoke another model automatically. No OpenRouter key is packaged in the extension.

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
