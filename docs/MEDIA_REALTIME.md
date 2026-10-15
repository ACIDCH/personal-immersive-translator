# Media, presentations and real-time translation — engineering specification

Status: implementation baseline, 2026-10-16. This is **not** a claim of full website coverage.

## Mandatory acceptance tracks

### A. Video subtitles: do not assume there is one universal subtitle API

Pipeline (use only sources accessible with permission):

1. Native browser `HTMLVideoElement.textTracks` (TextTrack.cues / cuechange). Implemented as an **Alpha proof of concept** in `src/subtitles.js`.
2. Licensed, documented platform subtitle APIs or site-specific adapters only after per-platform verification (YouTube/Bilibili/Vimeo/etc.).
3. User-provided SRT/VTT, including offline or private course materials.
4. Explicitly enabled opt-in **audio capture → local/cloud ASR → text translation** only when subtitles are absent or inaccessible. Do not bypass DRM, logins, origin restrictions, CAPTCHA, platform access controls, or publisher terms.

Native TextTrack mode `hidden` loads cues without presenting duplicate native captions. Preserve original track state on stop. Browser closed shadow roots, inaccessible cross-origin iframes and canvas-rendered captions require a different authorized mechanism.

Diagnostics should distinguish: no video; no track; track empty/disabled; auth or access denied; provider timeout/429; parsing; synchronization; and DRM-limited.

### B. Webpage, slides and demonstration pages

- Text DOM extraction, **open ShadowRoot scanning** and dynamic mutation observation are initial steps.
- Detect slide frameworks and presentation page transitions; never translate invisible or already-processed text.
- Support safe, user-granted access to eligible iframes only after testing site permissions; default injection covers top frame only.
- Canvas-rendered pages, scanned PDF, screenshots or diagram text require user-initiated OCR. Never pretend these are regular DOM nodes.
- Rich text protection: equations, code blocks, editable fields, banking forms, buttons and protected domains.
- Prefer content-specific adapters with unit tests over a “scan every node” global override.
- Test DOM mutation, SPA route changes, interactive slides, open/closed Shadow DOM, accessibility labels, large pages, Unicode, frame restrictions and RTL layouts.

### C. Real-time translation

```
source recognition → normalized timed cues → dedupe and segmentation
→ bounded translation queue → prefetch → time-synced output → monitoring/recovery
```

- Prioritize complete subtitle tracks: translate ahead of playback rather than sending one new API request per displayed subtitle.
- For live-only speech: ASR/VAD output in provisional/final segments. Only final segments are cached as permanent captions; partial text may be updated rather than appended repeatedly.
- Playback-rate-aware prefetch for 1x/2x/4x. A seek invalidates the *display state* and immediately recomputes active cue; old completed translations may still be cached but must never be displayed at the wrong time.
- Translate text in bounded batches (current Alpha provider limit: 10 strings, 12,000 chars, 45s timeout). Prevent duplicate in-flight translation. Limit memory and cache retention.
- Explicit performance acceptance **targets, not achieved metrics**: median subtitle visibility delay ≤1.5s when cues are supplied ahead of time on a healthy official API; no accumulating timeline drift after 20 seeks or 2x playback for a 30-minute test; no uncontrolled request storm after 429 or provider outage. Log p50/p95 latency, queue depth, dropped cue rate and sync error, respecting privacy.
- If delay exceeds the remaining cue duration, do not flash stale subtitles. Better to skip/replace a late cue than permanently misalign the track.
- AI mode remains opt-in with an explicit ongoing-usage warning and a Stop control; default is standard translation. Add usage ceilings before claiming support for continuous AI streaming.

## High-profile repositories to study — *technical references, not copied code*

| Repo | How it helps | Licensing implications |
| --- | --- | --- |
| [fishjar/kiss-translator](https://github.com/fishjar/kiss-translator) | YouTube caption track selection, chunk splitting, timeline fixes and site rules | GPL-3.0; **do not transplant into MIT project** |
| [ggml-org/whisper.cpp](https://github.com/ggml-org/whisper.cpp) | MIT local ASR, VAD, streaming capture; assess CPU/memory load before adopting | MIT; proper attribution needed |
| [openai/whisper](https://github.com/openai/whisper) | Speech recognition model and multi-language baseline | MIT; backend feasibility and model deployment needed |
| [yt-dlp/yt-dlp](https://github.com/yt-dlp/yt-dlp) | Media subtitle extractor architecture for lawful offline tests; not a drop-in browser extension | Unlicense at source level, distributions may contain GPL dependencies; review and service terms |
| [microsoft/playwright](https://github.com/microsoft/playwright) | Browser E2E and regression matrix for public test fixtures | Apache-2.0; testing tool only |

References: KISS issues #387, #168, #877 show retrieval failure, subtitle delay, A/B test timing drift. The `TextTrack` and `cuechange` interfaces are documented by MDN.

## Cross-platform acceptance matrix

| Scenario | Pass condition | Initial state |
| --- | --- | --- |
| HTML5 video with native VTT and captions enabled | Bilingual overlay synchronized after seek, pause, resume and 2x | Core adapter + unit tests; browser E2E pending |
| YouTube manual CC / automatic CC | Adapt to actual track, don't rely on undocumented hacks | Research/adapter needed |
| Video with no captions | Explicit “no source” state; optional consent-based ASR in future | Detect & explain only |
| Streaming lecture / livestream | Optional ASR with p50/p95 measurements and stopping/cleanup | Not implemented |
| Slide/PPT-like SPA | Find visible slide text after navigation without duplicating | Open Shadow DOM + mutation first pass |
| Cross-origin iframe slides | Request only necessary host permissions with explicit user grant | Not implemented |
| Canvas/diagram/scanned PDF | OCR opt-in, distinguish low-confidence text | Not implemented |

## CI gates

Current GitHub Actions tests validate parsing, cue de-duplication, seeks, playback rate, queue retry and bounded cache. Real-browser tests using Playwright and real API credentials (securely supplied) are still required before a stable release.

## Security

Never commit API credentials, capture protected streaming content without permission, or promise automatic access to DRM content. Speech capture must require an explicit user gesture and visible recording indicator; stop should disconnect tracks and dispose resources. Live text/voice may be sensitive; retain locally and disable remote sharing unless chosen by the user.
