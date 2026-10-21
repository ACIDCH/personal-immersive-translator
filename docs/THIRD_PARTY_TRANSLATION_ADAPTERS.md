# Third-party translation adapter attribution

PIT remains MIT licensed. The Google public translation HTTP adapter in
`src/lib/providers.js` is an adaptation of the `GoogleService` interface
and response parsing logic from:

- **Upstream:** [ymcwiki/open-immersive-translate](https://github.com/ymcwiki/open-immersive-translate)
- **Source:** `src/background/services/google.ts`
- **Copyright:** © 2026 ymcwiki
- **License:** MIT — https://github.com/ymcwiki/open-immersive-translate/blob/main/LICENSE

The upstream's license grant and copyright notice are preserved here. The
implementation is adapted for PIT's existing `translateBatch` adapter rather
than embedding an unrelated extension or introducing a second provider store.

> MIT License
>
> Copyright (c) 2026 ymcwiki
>
> Permission is hereby granted, free of charge, to any person obtaining a copy
> of this software and associated documentation files (the "Software"), to deal
> in the Software without restriction, including without limitation the rights
> to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
> copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in
> all copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
> IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
> FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
> AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
> LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
> OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
> THE SOFTWARE.

**Not copied:** current proprietary Immersive Translate extension internals,
or KISS Translator's GPL-3.0 source. KISS remains independently audited as an
upstream architecture reference until a separate license-compatible migration
is intentionally authorized.

**Service limitation:** `translate.googleapis.com/translate_a/single` with
`client=gtx` is an undocumented, unauthenticated Google public translation
endpoint; it is **not** the official Google Cloud Translation API. It requires
internet access and uploads the requested text to Google. Google may change
or rate-limit it without notice. The `google` service entry continues to
represent the official API-key authenticated Google Cloud Translation product.
