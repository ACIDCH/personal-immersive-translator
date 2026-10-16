# v0.3.8 安全的进程内常驻多语言 ASR 后端

日期：2026-10-16。仍处于开发分支：**先实现核心链路，暂缓项目命名、前端可视化、UI 重排与安装包交付**。

## 解决的问题

先前的 `whisper-cli` 后端每个约 3 秒的音频片段都启动一次程序/读取模型，增加启动开销。先前实验性 `whisper-server` 虽能长期加载模型，但官方示例服务具有宽松的跨域响应头，缺乏与插件等效的 API 令牌校验，不能安全地作为普通用户默认方案。

本阶段引入 **SYSTRAN/faster-whisper（MIT）** 作为**第三种可选后端**。该项目采用高性能 CTranslate2 推理，Python 模型对象只在本机受令牌保护的 FastAPI 进程中加载一次并复用；无需启动额外公开的未经鉴权 HTTP 服务。上游：https://github.com/SYSTRAN/faster-whisper

## 代码实际行为

| 模式 | 配置 | 安全性质和当前证据 |
| --- | --- | --- |
| `cli` 默认 | `PIT_ASR_BACKEND=cli`、`PIT_WHISPER_MODEL`、本机 `whisper-cli` | 原有稳妥模式，不额外启服务，但有逐片段加载成本 |
| `faster` 新增 | `PIT_ASR_BACKEND=faster`、`PIT_FASTER_WHISPER_MODEL_DIR` 指向已转换好的本地 CTranslate2 模型目录 | 模型仅从本机目录加载、缓存一个实例、单线程锁串行处理片段；受现有 `X-PIT-Token` 的 FastAPI /asr 保护，不另开放推理监听端口 |
| `server` 旧实验 | `PIT_ASR_BACKEND=server` 并显式确认上游服务器风险 | 仍非正式推荐，默认禁止；确认风险不是身份认证 |

## 本地安装与准备

1. 在专用 Python 3.12 环境安装 `services/requirements.txt`。选用新 `faster` 模式时额外安装 `services/requirements-faster-whisper.txt`。
2. 用户自行合法获取 CTranslate2 格式的 Whisper 多语言模型目录。目录中必须包含 `model.bin`、`config.json`、`tokenizer.json`。这和 whisper.cpp 的单独 GGML `ggml-*.bin` 文件**不是同一格式**；不能混用。必须使用本机完整路径而非模型名称：本模块禁止运行时访问 Hugging Face 下载缺失模型。
3. Windows PowerShell 环境（占位值，不要保存到仓库）：

```powershell
$env:PIT_ASR_BACKEND="faster"
$env:PIT_FASTER_WHISPER_MODEL_DIR="C:\\Models\\whisper-small-ct2"
$env:PIT_BRIDGE_TOKEN="<本地强随机令牌>"
python services/babeldoc_bridge.py
```

4. Chrome 扩展工具页使用相同本地令牌启动识别。音频仍经用户主动授权的 tabCapture 和本机 `127.0.0.1:8765`。**识别后的文字若启用字幕翻译，将发送至用户选择的第三方翻译服务**；并非所有数据均始终离线。

## 验收情况

- **真实安装的上游库 API 兼容性**：CI 使用额外依赖环境安装真正 `faster-whisper`，校验其 `WhisperModel` 构造参数及 `transcribe` 调用参数。
- **真实生产模块 + 模拟模型**：测试用实际 PCM WAV 和 NumPy 解码，通过替身模型验证初始化一次、再次复用、音频格式拒绝、翻译文本不会进入模型路径、需用户令牌的 FastAPI 转发以及 `/health` 对模型加载状态的区分。
- **模型推理尚未完成真实实测**：CI 不下载超大语音模型，不使用任何受版权/账号限制的音频，也不宣称自动识别准确率、30 分钟延迟、用户设备 CPU/内存/GPU 已经达标。
- **线程隔离局限**：用互斥锁防止取消 HTTP 请求后原生推理线程与下一请求重叠；但 Python 线程中运行的原生模型推理不能安全强制终止。压力/资源/超时问题需实机验证。

## 保留给最终综合验收

完整 YouTube/Netflix/Panopto 已授权平台测试；实际 CTranslate2 模型推理吞吐、WER/CER 与 30 分钟运行；BabelDOC 真正付费 API/本地翻译后的复杂排版视觉对比；真实多语言 OCR 照片与视频截图 CER；数据泄露与内存占用审查；最后统一项目名称、控制面板、设置 UI 和内容体验设计，Codex 最终独立代码审查后才生成一次可用安装包。
