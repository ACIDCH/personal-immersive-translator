# PIT 云优先核心：实际部署与资源界限（P0）

开发分支仅提供完整可部署实现；**当前尚无 Worker 或 PDF 容器正式上线**，安装插件本身不会创造免费的后端。请勿再把 CI mock 译文当作可用翻译结果。

## 1. 轻量云端翻译 / 云端实时语音（Cloudflare Workers AI）

实现：cloudflare/multimodal-api/src/index.mjs，服务：
- POST /v1/translate：真实 Workers AI @cf/meta/m2m100-1.2b 多语言机器翻译；JSON texts/source/target。
- POST /v1/asr：真实 Workers AI @cf/openai/whisper-large-v3-turbo 分段识别，音频需要用户确认后上传。服务仅接受 16 kHz / 单声道 / PCM16 且 RIFF 长度与 data 字节数一致的标准 WAV；若 Whisper 返回可用的 `transcription_info.language`（置信度至少 0.65 或模型没有提供数值概率），将支持的英法德西中日韩语码连同文本返回。离屏音频→后台→实时字幕→机器翻译现能传播该语码；用户明确指定的源语言优先级仍高于自动检测。**这些都是模拟 Worker/音频浏览器的 L0/L1 回归，未验证实际远程 Whisper 推理。**
- GET /v1/capabilities：仅在绑定 AI、设置访问令牌后报告就绪。
- **OCR、高保真 PDF 不是 Workers 能运行的功能，不再返回假成功。**

配置：在 Cloudflare 自有账户的 Worker 设置中启用绑定 AI，并通过 Secret 配置 PIT_ACCESS_TOKEN，必须至少 16 字符。src/options.html 设置“PIT 云端翻译”并填 HTTPS Worker 地址和相同随机令牌。具体 Worker 免费额度和用量按 Cloudflare 账户实时显示的条件计算，**不能承诺永久免费或无限额度**。

此代码尚未连接账户部署。未配置时显示错误，不回退为伪译文。拉丁字母纯文本自动识别只能做英文保守回退，会标记不确定；中文、韩文、日文脚本可辨，法/德/西自动检测仍需补完整可靠模型。

## 2. 高保真云端 PDF（独立有状态容器）

实现：services/cloud_pdf_api.py；容器：services/cloud-pdf/Dockerfile。实际运行原 BabelDOC 0.6.4、OCRmyPDF/Tesseract、PyMuPDF 和授权 API，而不是栅格拼接 PDF。

- 兼容旧版本的 POST /v1/pdf/translate 表单 pdf/source(auto 或 en/fr/zh/ja/ko/de/es)/target/ocr，通过 HTTP Authorization Bearer <PIT_CLOUD_PDF_TOKEN>。
- **新增长文档异步任务**：POST /v1/pdf/jobs 提交并接收 202 + 随机 jobId；GET /v1/pdf/jobs/{jobId} 查询 queued/running/completed/failed；GET /v1/pdf/jobs/{jobId}/result 在完成后下载，未完成返回 HTTP 409。浏览器通过 /health 的 async_jobs 字段自动选择异步路径，旧版云容器继续使用同步回退。
- 默认仍是单实例、单并发、内存暂存，结果保存约 15 分钟。可选设置环境变量 `PIT_PDF_JOB_DIR` 指向**实际挂载的持久磁盘卷**（例如 `/var/lib/pit/jobs`），服务器以原子写入保存带随机任务号的元数据及 PDF 结果。容器进程重启后，**已完成**的 PDF 在有效期内可继续通过原任务 ID 下载；提交后仍在运行的 BabelDOC 子进程**不会跨进程重启继续执行**，恢复查询会显示 `failed`，需要重新上传。无实际持久卷时不能宣称重启恢复。
- 磁盘结果单文件最多 100 MiB，最多保留最近 4 个任务记录；15 分钟后在定时或后续访问/提交触发清理。不存在数据库协调、多副本一致性或真正断点续翻。关闭浏览器/取消等待不保证停止模型调用或费用。
- 文件上限 25MiB / 300 页，单实例同时最多 1 个高资源任务。输出不持久保存文件，无需用户本机 Python。
- 自动语言识别：文本层采用本机统计语言分类（langdetect），中日韩优先按文字脚本；扫描文件第一页由 Tesseract 多语种 OCR 估计。短 Latin 文本无法保证正确，必须保留人工覆盖。
- 服务器需要安全环境变量 PIT_CLOUD_PDF_TOKEN 与 PIT_PDF_API_KEY/PIT_PDF_MODEL/PIT_PDF_BASE_URL。**真实翻译仍可能产生 AI API 费用**，不能存储凭据在客户端公共仓库。
- 容器运行在支持 Python、外部二进制、足够 CPU/RAM、任务运行时间的云平台上；Cloudflare Worker/Supabase Edge Function 不等同于这种算力环境。需按目标平台配置 HTTPS、私有访问与费用限制。

**仅在拥有真实持久卷的单个 Python 容器实例上**，例如使用卷挂载 `/srv/pit-pdf-jobs:/var/lib/pit/jobs`，才可设置 `PIT_PDF_JOB_DIR=/var/lib/pit/jobs`。确保运行用户 UID 10001 可写该目录；`--workers 1` 不变。实例之间不得共享此目录充当多工作者队列。结果只存单机卷、不自动同步 Supabase/Google Drive；宿主云平台临时卷、Docker 镜像内路径和 CI runner 的磁盘不构成重启后持久数据。后端健康检查的 `job_storage` 只报告“配置了存储目录”，不会验证云平台是否真正挂载持久卷。

浏览器 WXT 文件工作台现已连接 `/v1/pdf/jobs` 异步任务接口，并兼容旧容器的 `/v1/pdf/translate` 同步接口；可选择自动检测或明确指定 7 种源语言，短文本/扫描件判断不准时可人工覆盖；上传前通过 `GET /health` 检查服务就绪状态，下载前检查真实 PDF 文件头，并显示服务器报告的源语言检测依据；该连接行为已在安装版 Chromium 中使用**模拟 HTTPS 容器**通过 L1 测试。**PDF 容器尚未实际部署，没有云端 BabelDOC 真实推理或付费学术论文排版质量验收**；200 响应及文件下载成功不能作为高保真质量证据。浏览器内“300 页 PDF”仍是分卷栅格的回退方式，不能混淆为 BabelDOC。

## 3. 发布硬门槛

1. 已部署且从真实电脑连通云端 MT 与 Whisper（非注入 mock 的测试）。
2. 全网站翻译必须默认有可用服务；无凭据应首先显示诊断，不应错误承诺可用。
3. 实际 PDF 10/50/100+ 页含复杂公式、双栏、表格和扫描附录；对文件有效性、分页、文字层、保真与收费分别验收。
4. 实际 YouTube/Bilibili/Netflix/Panopto 原字幕、倍速、暂停、seek 与无字幕 ASR，记录丢句、延迟 p50/p95、资源消耗；受限网站的真实验证必须保留 BLOCKED。
5. UTF-8 BOM、UTF-16LE/BE、DOCX/PPTX/XLSX、EPUB/HTML/Markdown，不能以 ZIP 能打开就称为高保真。
6. 独立 Codex review、许可证（GPL/AGPL 不复制进 MIT 插件）和真实构建检查后才考虑稳定版。
