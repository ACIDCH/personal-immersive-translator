# PDF and Image OCR — local setup

## Current workflow

- Image: select local PNG/JPEG/WebP or capture the visible browser tab. Use either Gemini multimodal OCR + translation (cloud) or Tesseract OCR running on the local bridge, then translate with the configured standard provider.
- PDF: send a user-selected file to the separate localhost bridge. Scanned PDF pages use OCRmyPDF + Tesseract; BabelDOC attempts to retain layout and produce a bilingual translated PDF.
- None of these external services start or receive documents without user action.

## Setup

1. Install Python 3.12, Tesseract language models (eng, chi_sim, jpn, kor, fra, deu, spa), and OCRmyPDF. Check with tesseract --list-langs.
2. Install the upstream BabelDOC CLI using: uv tool install --python 3.12 BabelDOC. Verify babeldoc --help works.
3. Install the local bridge Python dependencies in a separate environment: python -m pip install -r services/requirements.txt.
4. Set environment variables PIT_BRIDGE_TOKEN (at least 16 characters, random secret) and DEEPSEEK_API_KEY (your own). Do not store either in public GitHub or ordinary Drive files. Start the bridge with: python services/babeldoc_bridge.py.
5. Open the extension's Image/PDF tools, enter the same local bridge token and choose a local file.
6. Confirm that PDF output visually preserves equations, tables and multi-column text before relying on it.

The bridge listens only on 127.0.0.1:8765 and enforces a token. It cannot be exposed to the internet. BabelDOC is AGPL-3.0; installing and operating it requires compliance with its upstream license. Its author focuses primarily on English to Chinese. Other target languages are experimental until benchmarked.

BabelDOC uses a temporary private TOML file for provider credentials and deletes the temporary workdir after each response. The browser never sends its own Gemini or DeepSeek keys to this server. Supabase Edge Functions cannot be assumed to run high-memory OCR and layout reconstruction workloads. A separately deployed service would need independent infrastructure and security controls.

PDF cap: 25MB / 300 pages. Image cap: 4.4MB for Gemini OCR, 8MB for local OCR. Unsupported languages and image formats fail explicitly. The output quality and cross-language capability of this pipeline have not yet been validated with real PDF fixtures.


## Experimental locally captured live speech

The same Python bridge exposes POST /asr for local whisper.cpp recognition. This is not a fully validated low-latency subtitle service.

1. Build whisper.cpp from its official MIT-licensed repository and download a **multilingual** model, not a model ending in .en if you need French/Japanese/Korean/Chinese.
2. Set PIT_WHISPER_MODEL to the absolute model path and ensure whisper-cli is in PATH. You can optionally specify PIT_WHISPER_BIN as an absolute executable path.
3. Start the bridge on 127.0.0.1. In Chrome/Edge >=116, open a normal video page and click the explicit Start live speech button; enter the same bridge token.
4. The browser captures only the active tab after user action, keeps tab sound playing, sends transient 5.5-second PCM WAV chunks **to localhost only**, and discards audio samples. Transcribed **text** is translated using the selected standard translation provider, which may send it to that provider's external API.
5. Stop immediately when finished. Tab navigation or close should stop the capture. This mode cannot bypass DRM or cross-origin authorization; a webpage/player may prevent capture. Translation latency includes buffering, ASR inference and translation service response, so it is not yet guaranteed to be near-real-time.

The upstream whisper.cpp examples include a microphone streaming tool but our bridge uses their separate whisper-cli command. Additional browser E2E, memory and latency testing remains mandatory before release.
