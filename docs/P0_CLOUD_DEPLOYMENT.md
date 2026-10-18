# PIT 云优先核心：实际部署与资源界限（P0）

开发分支仅提供完整可部署实现；**当前尚无 Worker 或 PDF 容器正式上线**，安装插件本身不会创造免费的后端。请勿再把 CI mock 译文当作可用翻译结果。

## 1. 轻量云端翻译 / 云端实时语音（Cloudflare Workers AI）

实现：cloudflare/multimodal-api/src/index.mjs，服务：
- POST /v1/translate：真实 Workers AI @cf/meta/m2m100-1.2b 多语言机器翻译；JSON texts/source/target。
- POST /v1/asr：真实 Workers AI @cf/openai/whisper-large-v3-turbo 分段识别，音频需要用户确认后上传；自动语言识别由 Whisper 执行。
- GET /v1/capabilities：仅在绑定 AI、设置访问令牌后报告就绪。
- **OCR、高保真 PDF 不是 Workers 能运行的功能，不再返回假成功。**

配置：在 Cloudflare 自有账户的 Worker 设置中启用绑定 AI，并通过 Secret 配置 PIT_ACCESS_TOKEN，必须至少 16 字符。src/options.html 设置“PIT 云端翻译”并填 HTTPS Worker 地址和相同随机令牌。具体 Worker 免费额度和用量按 Cloudflare 账户实时显示的条件计算，**不能承诺永久免费或无限额度**。

此代码尚未连接账户部署。未配置时显示错误，不回退为伪译文。拉丁字母纯文本自动识别只能做英文保守回退，会标记不确定；中文、韩文、日文脚本可辨，法/德/西自动检测仍需补完整可靠模型。

## 2. 高保真云端 PDF（独立有状态容器）

实现：services/cloud_pdf_api.py；容器：services/cloud-pdf/Dockerfile。实际运行原 BabelDOC 0.6.4、OCRmyPDF/Tesseract、PyMuPDF 和授权 API，而不是栅格拼接 PDF。

- POST /v1/pdf/translate 表单 pdf/source(auto 或 en/fr/zh/ja/ko/de/es)/target/ocr，通过 HTTP Authorization Bearer <PIT_CLOUD_PDF_TOKEN>。
- 文件上限 25MiB / 300 页，单实例同时最多 1 个高资源任务。输出不持久保存文件，无需用户本机 Python。
- 自动语言识别：文本层采用本机统计语言分类（langdetect），中日韩优先按文字脚本；扫描文件第一页由 Tesseract 多语种 OCR 估计。短 Latin 文本无法保证正确，必须保留人工覆盖。
- 服务器需要安全环境变量 PIT_CLOUD_PDF_TOKEN 与 PIT_PDF_API_KEY/PIT_PDF_MODEL/PIT_PDF_BASE_URL。**真实翻译仍可能产生 AI API 费用**，不能存储凭据在客户端公共仓库。
- 容器运行在支持 Python、外部二进制、足够 CPU/RAM、任务运行时间的云平台上；Cloudflare Worker/Supabase Edge Function 不等同于这种算力环境。需按目标平台配置 HTTPS、私有访问与费用限制。

浏览器 WXT 文件工作台现已连接 `/v1/pdf/translate` 上传与下载接口，并在上传前通过 `GET /health` 检查服务就绪状态，下载前检查真实 PDF 文件头；该连接行为已在安装版 Chromium 中使用**模拟 HTTPS 容器**通过 L1 测试。**PDF 容器尚未实际部署，没有云端 BabelDOC 真实推理或付费学术论文排版质量验收**；200 响应及文件下载成功不能作为高保真质量证据。浏览器内“300 页 PDF”仍是分卷栅格的回退方式，不能混淆为 BabelDOC。

## 3. 发布硬门槛

1. 已部署且从真实电脑连通云端 MT 与 Whisper（非注入 mock 的测试）。
2. 全网站翻译必须默认有可用服务；无凭据应首先显示诊断，不应错误承诺可用。
3. 实际 PDF 10/50/100+ 页含复杂公式、双栏、表格和扫描附录；对文件有效性、分页、文字层、保真与收费分别验收。
4. 实际 YouTube/Bilibili/Netflix/Panopto 原字幕、倍速、暂停、seek 与无字幕 ASR，记录丢句、延迟 p50/p95、资源消耗；受限网站的真实验证必须保留 BLOCKED。
5. UTF-8 BOM、UTF-16LE/BE、DOCX/PPTX/XLSX、EPUB/HTML/Markdown，不能以 ZIP 能打开就称为高保真。
6. 独立 Codex review、许可证（GPL/AGPL 不复制进 MIT 插件）和真实构建检查后才考虑稳定版。
