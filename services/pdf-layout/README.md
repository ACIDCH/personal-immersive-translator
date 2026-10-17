# Optional high-fidelity PDF processing sidecar (experimental)

The browser extension does not include BabelDOC/PDFMathTranslate Python/ONNX weights. Cloudflare Workers should only coordinate requests; actual PDF layout reconstruction needs a local computer or appropriately provisioned server.

The first executable adapter `pdf2zh_adapter.py` calls the **real upstream `pdf2zh` binary** with input/output paths and explicit source/target languages; it is not a replacement implementation. Upstream: https://github.com/PDFMathTranslate/PDFMathTranslate (AGPL-3.0). Install separately following their instructions (for example `uv tool install --python 3.12 pdf2zh` and `pip install 'pdf2zh[ultrafast]'` where the optional package is available). Its model/runtime downloads and service configuration are managed by the upstream software.

Example, on your own computer, with a local PDF:
```bash
python services/pdf-layout/pdf2zh_adapter.py paper.pdf --output translated --source-lang en --target-lang zh --service google
```
If the upstream tool and its ultrafast option are installed:
```bash
python services/pdf-layout/pdf2zh_adapter.py paper.pdf --output translated --ultrafast
```

The adapter validates the input PDF header/size, uses a shell-free subprocess with a timeout, never appends API keys to CLI args, checks resulting files and emits a SHA-256 manifest. **These checks are not a layout or translation quality test**. Test against real academic PDFs with fonts, two-column layouts, formulas, embedded images, scanned pages, and compare rendered pages before declaring production readiness.

Current limitations: standalone local CLI only, no browser file upload or Workers dispatch yet; runtime and translator provider must be installed/configured separately. BabelDOC offers its own CLI and is an AGPL project too; its direct Python APIs are explicitly unsupported by its maintainers, so use the upstream CLI integration route rather than importing private internals.
