# v0.3.7 核心运行可靠性与七语言 OCR 回归验收

日期：2026-10-16。开发分支 `fix/bridge-cli-ocr-multilingual-037`，基于 v0.3.6。**未进入最终版本；不重设计 UI/项目名称、不交付安装包，也不合并主分支。**

## 本轮修复

| 问题 | 修复 | 证据及边界 |
| --- | --- | --- |
| 本机启动的导入异常 | 在直接执行 `python services/babeldoc_bridge.py` 时补全 `server_is_ready` 兜底导入；此前只在模块导入测试场景正常 | Python 子进程从 `services/` 目录执行桥接代码的真实回归；未替用户配置启动环境 |
| BabelDOC `--help` 参数误判 | 对 `--openai`、`--config` 等使用正则完整参数名匹配，拒绝 `--openai-model` 与 `--config-legacy` 冒充 | Mock CLI --help 回归；不等于真实 BabelDOC 模型或翻译成功 |
| 德语及西班牙语 OCR | CI 实际安装 `deu` 与 `spa` 语言包，对字体生成的 PNG 图像通过真实 Tesseract/FastAPI 识别 | 清晰、无透视/压缩的测试文本 CER=0%；**单一样本不能代表现实准确率** |
| 七语言基础覆盖 | 继此前中/英/法/日/韩后，初期七种目标语言均有基础引擎运行测试 | 尚缺真实手机图片、视频压缩字幕、公式、低对比度及复杂布局的 CER/WER 对照 |
| Whisper 常驻服务隔离 | 上游示例 `whisper-server` 目前返回 `Access-Control-Allow-Origin: *`，还可公开接收文件。新增 `PIT_ACK_UNAUTH_WHISPER_SERVER=1` 明确实验风险确认；未确认时 `server` 模式主动拒绝，健康状态不冒充就绪。默认 `cli` 不受影响。 | FastAPI 自动化测试；这项确认**不是**鉴权、不替代操作系统防火墙和沙盒，仍不应在不可信浏览环境启用 |

## 语音模式具体要求

默认 `PIT_ASR_BACKEND=cli`，由本机桥接服务以受令牌保护的 HTTP 请求调用独立安装的 `whisper-cli`。

如果为了降低模型重复加载成本需要常驻 `whisper-server`，必须同时满足：只在 `127.0.0.1` 监听、用户明确了解上游服务器没有与本项目等价的鉴权、仅在可信环境使用，并在**服务端本机进程的环境变量**设置 `PIT_ASR_BACKEND=server` 和 `PIT_ACK_UNAUTH_WHISPER_SERVER=1`。该环境变量属于实验风险确认，不会强制向上游添加认证，也不是允许公网或局域网访问的许可。

官方上游源码：https://github.com/ggml-org/whisper.cpp/blob/master/examples/server/server.cpp

## BabelDOC 严格界限

目前 `BabelDOC`（AGPL-3.0）仍是独立 CLI，通过临时 `0600` 权限的 TOML 文件传递用户自有 API Key；源项目官方把 CLI 定位为调试用途，且以英译中为主要优化场景。我们的参数兼容性预检已增强，但**未实际运行完整 BabelDOC 复杂论文翻译**，也未取得双栏/公式/表格排版保真度实测证据。

官方来源：https://github.com/funstory-ai/BabelDOC

## 正式版阻断项（仍未验收）

1. 真实 Netflix、Panopto、YouTube 的授权播放器与跨域 iframe 测试。
2. 用户设备上多语言 Whisper 模型连续 30 分钟延迟、失败率、内存与 CPU/GPU 使用率。
3. 安全的长期运行本机 ASR 进程隔离，不能仅凭实验风险确认发布常驻服务。
4. BabelDOC 真正进行论文全文翻译，并以页、公式、表格、裁切等指标进行视觉复核。
5. 七语种照片/压缩截图/混排的准确率和覆盖层定位度量。
6. 最终统一项目名称、控制面板、UI、前端视觉系统和内容完善度；完整 UAT、许可安全审计及 Codex 最终独立审核后一次性交付安装包。

测试保留在 GitHub Actions，且**仅允许把真实合成样本测试称为引擎能力通过**，不宣称性能/准确率全面领先现有插件。
