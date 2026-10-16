# v0.4.7：本机 Whisper 就绪检查与字幕真实显示验收

日期：2026-10-17。基础：已通过 Chromium MV3 集成验收的 v0.4.6 Draft PR #31；本阶段对应 Draft PR #32。

## 实际代码变更

- 新增 `src/kiss/whisper-readiness.js`：通过原有本机 FastAPI bridge `http://127.0.0.1:8765/health`（要求 X-PIT-Token）检查语音识别引擎的 `speech_asr`、`speech_asr_backend` 与 `engine=local-only`。明确**不使用 PDF/BabelDOC 的 `ready` 值判定 Whisper 就绪**。无法连接、令牌错误、模型缺失、JSON 版本错误分别给出明确错误。设置 6 秒超时，不存储令牌。
- Whisper 控制台新增“检查本机 Whisper 服务与模型”按钮。`PIT_ASR_PREFLIGHT` 仅接受来自控制台的现有专用 Port 请求；用户点击“开始识别”也将再次检查。本机服务未准备好时在停止旧会话之前直接失败，避免误停一个仍在工作的录音会话。
- 保留 KISS 的浏览器网页翻译引擎，继续只把 Whisper 录音和字幕的独立模块作为临时 GPL 组合扩展中的侧车。普通字幕默认标准 MT，付费 AI 字幕需要明确选择和确认。

## 可重复的浏览器级验收

`.github/workflows/kiss-sidecar-integration.yml` 每次从固定 Git SHA 构建上游 KISS，再装配 PIT 模块并在真实 Playwright Chromium MV3 运行测试。除了原有 KISS Service Worker、KISS content script 注入、PDF.js Worker 和设置保存测试外，**本轮新增：**

1. 在已加载组合扩展的控制台里，以虚拟的本地 `/health` 响应验证已授权的 Whisper readiness。
2. 在真实 HTML5 `video` 页面中由控制台导入用户 VTT 测试字幕。
3. 通过专用 Port 调用项目实际标准翻译 `translateBatch` 实现，将模拟翻译回复绘制到网页字幕覆盖层。
4. 点击“停止字幕”，验证覆盖层被正确销毁；测试会明确拒绝非预期 HTTP 请求，不连接商业翻译服务，也不消耗 API Token。

提交 `1ebcea416a759c8ec6def967ca690e88ab01f6f9` 的 Chromium CI：<https://github.com/ACIDCH/personal-immersive-translator/actions/runs/38976632315> —— **成功**。原 PIT 四个现有测试任务：<https://github.com/ACIDCH/personal-immersive-translator/actions/runs/38976632391> —— **全部成功**。

## 未经验证的项目（不得误报完成）

本轮健康检查使用测试替身模拟 HTTP JSON，VTT 的翻译结果也使用拦截器合成；它们证明了**真实浏览器中的消息传输、前端与翻译适配器联通**，没有使用实体音频输入或真实语音模型。

尚需在使用者 Windows/Chrome 或 Edge 环境执行本人授权的 `tabCapture`，以安装好的 `whisper.cpp` 或 `faster-whisper` 模型完成 PCM16 音频录制、有效语音识别与标准翻译字幕完整链路；此外，Netflix/Panopto 账号登录页、OCR/BabelDOC 真实大文档、KISS 及 PIT 服务配置统一和最终 UI 重设计均没有通过最终实机验收。

任何完整 KISS 衍生扩展分发时仍须履行 GPL-3.0；本次 CI 不发布或上传复合浏览器安装包，PR 保持 Draft，`main` 不变。
