# v0.3.5 核心运行链：持久 Whisper 与 PDF 排版结构验收

更新：2026-10-16。仅针对既定功能链。**不重设计项目名称、控制面板或 UI，也不向用户交付中间安装包。**

## 1. 多语言实时字幕：两种本机引擎

| 模式 | 对接方式 | 当前状态 |
| --- | --- | --- |
| `cli`（默认） | 3 秒 PCM 音频 → 本机受令牌保护 FastAPI → 每次运行 `whisper-cli` | 已有真实 HTTP 契约模拟和 WAV 格式验证；每片段重新启动模型造成延迟 |
| `server`（手动选用） | 3 秒 PCM 音频 → 受令牌保护 FastAPI → 固定 `http://127.0.0.1:PORT/inference` → **独立常驻** whisper.cpp `whisper-server` | 实际接入上游标准 multipart API 的代码完成；CI 利用 MockTransport 检查输入、输出、不可重定向、错误响应、端口白名单；真实大型模型未做性能测量 |

官方来源：https://github.com/ggml-org/whisper.cpp/tree/master/examples/server

持久模型服务的作用是避免每段音频都重新加载模型，**不保证 p95 ≤8 秒**。端到端延迟仍包含音频分段、模型识别、网络翻译、页面渲染。真实设备需要记录 30 分钟播放、CPU/内存、识别错误率、不同语种和超时回退。

### 开发人员本机配置示例（Windows PowerShell）

安装 whisper.cpp 的合规 MIT 发行版本、正确的多语言 GGML 模型后，由用户主动运行：

```powershell
whisper-server -m "C:\Models\ggml-small.bin" --host 127.0.0.1 --port 8080
$env:PIT_ASR_BACKEND = "server"
$env:PIT_WHISPER_SERVER_PORT = "8080"
$env:PIT_BRIDGE_TOKEN = "<本机生成的强随机令牌>"
$env:DEEPSEEK_API_KEY = "<用户私有密钥>"
python services/babeldoc_bridge.py
```

以上命令不意味着本项目已经替用户安装模型或服务器。不同 whisper.cpp 发行版本可执行文件的位置可能不同，具体以官方构建为准；PowerShell 示例中的尖括号内容是占位符，严禁提交到 GitHub。

**安全限制：** 官方 whisper-server 示例默认监听 127.0.0.1，部分版本对跨站请求设有宽松 CORS，且不提供等价于本项目桥接令牌的鉴权。因此该选项目前属于**开发试用功能**，不能直接暴露在公网、共享局域网或反向代理上；浏览不受信任网页时不应长期运行。生产版需要进一步验证本机服务端口隔离或受认证的 IPC 方案。项目桥接仅允许连接字面量 127.0.0.1，拒绝代理环境变量和 HTTP 重定向。默认 `cli` 路径不会启动未鉴权的持久服务。

本机 `/health` 不再把“填了端口”误认为服务可用：需要本地 server 正常回应，才显示已就绪。这仍不等于模型在每种语言都通过识别质量测试。

## 2. PDF：OCR 已真实跑通，增加译文结构质量门槛

- 预处理实际使用独立安装的 OCRmyPDF / Tesseract / Ghostscript，在 CI 中扫描图片组成的 PDF，再检验文字可提取。
- 调用 BabelDOC 后，新增 `services/pdf_quality.py` 对**真实生成的文件**逐页检查：页数有无缺失、输出是否完全无法提取文字、文本对象是否超出页面边界。明显损坏的输出直接拒绝；疑似裁切只记录匿名数量提醒人工检查。
- 附加命令 `python -m benchmarks.pdf_quality_audit original.pdf bilingual.pdf` 可对用户**已经合法取得**的翻译文件做离线验收，不记录或传输 PDF 文字、截图、API 密钥。
- 这些检查无法检测所有公式、图片、色彩、行距、语义错误。最终必须由真实 BabelDOC 处理双栏论文、复杂公式/图表，并作逐页视觉比对。
- 官方 BabelDOC 为 AGPL-3.0，本插件仅调独立工具，不将其直接复制到浏览器 MIT 源码；上游具体 CLI 参数已对照 https://github.com/funstory-ai/BabelDOC 。

## 3. 当前实际验收证据

- `tests/test_persistent_asr_pdf_quality.py`：whisper-server 协议、端口、重定向拒绝、本机 ASR 入口、双语 PDF 页数和提取性；MockTransport 非真实推理。
- `tests/test_bridge_runtime.py`：英语和法语真实 Tesseract 识别、真实 OCRmyPDF 光栅 PDF 转可检索文本、模拟 BabelDOC CLI 参数/私有临时配置文件。
- 其余：真实 Chrome 安装、网页动态翻译、YouTube/Netflix/Panopto 可见字幕仿真、SRT/VTT、语音缓冲等继续保持四项 CI 门槛。

**剩余阻断项目：** 真实授权 Netflix/Panopto/YouTube 播放、持久 whisper-server 多语言 30 分钟测量、BabelDOC 真实 API/复杂 PDF 保真对照、日语和韩语 OCR 统计、翻译服务账单与质量基准，以及 Codex 最终审查。

本阶段禁止合并 main、发布稳定版和交付安装包；整体 UI、品牌命名和视觉规范留到核心功能全部完成后统一重新设计。
