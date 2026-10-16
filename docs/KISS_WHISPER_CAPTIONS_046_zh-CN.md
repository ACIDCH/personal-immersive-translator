# KISS 原生网页翻译 + 增强字幕 + Whisper 本机听译整合（v0.4.6 开发）

2026-10-16；分支 `feat/kiss-whisper-captions-sidecar-v046`，基于已通过 Chromium MV3 集成测试的 v0.4.5 Draft PR #30。

## 实现

以成熟 GPL-3.0 [KISS Translator v2.1.1](https://github.com/fishjar/kiss-translator)（固定提交 `a1279f2517bd478ef1dd93b941f9177094486cd4`）的**原版源码与正式 Chrome 构建**作为浏览器网页双语翻译基础。不复制 GPL 上游源码进当前 MIT 仓库；实验 CI 中临时拼装，未来如分发 KISS 衍生包须按 GPL-3.0 要求处理。

1. `scripts/assemble-kiss-sidecar.mjs` 将原项目已经回归验证的 PCM 音频编码/限长队列、AudioWorklet、offscreen Whisper 客户端、实时双语字幕、原生 TextTrack/已显示字幕识别、SRT/VTT 解析和缓存、会话切换校验，复制到 KISS 构建产物的 `pit/` 独立功能目录。
2. 不重写或直接修改上游编译后的 `background.js`；改用轻量 `pit/background-entry.js` 将原 KISS 后台和个人独立模块 **同时导入**。侧车消息只响应 `PIT_ASR_*` 与 `PIT_SIDECAR_TRANSLATE` 命名空间，防止混入 KISS 普通翻译路由。
3. 使用 KISS 允许的个人全站访问权限；只增加 `activeTab`、`offscreen`、`tabCapture`、`webNavigation` 四项明确 MV3 权限。启动时通过独立控制台确认目标标签页和当前 URL，用户点击后才注入字幕/语音脚本。
4. KISS 弹窗新增“视频字幕 / Whisper”入口，控制台绑定打开弹窗时已选的网页标签页。控制台使用单独标准翻译服务设置；**不会自动将实时语音发送至付费 AI**。用户主动选择并确认后才可以为视频字幕打开 Gemini/DeepSeek。
5. ASR 会话用 UUID 和串行 START/STOP 控制；后端 offscreen 调用本机 `http://127.0.0.1:8765/asr`，使用用户输入的本机令牌。停止/页面导航/标签页关闭时销毁媒体流，不保存原始音频，翻译中的过期结果不会覆盖新会话。
6. 视频字幕优先 HTML5 原生 TextTrack，其次已有可见 DOM 字幕，可选择用户自己提供的 SRT/VTT。支持用户明确确认的单一嵌入 YouTube/Panopto Frame；不抓取专有网络 API、不绕过 DRM。

## 验收分层

- Node 组件装配契约：验证原版 KISS worker 以模块方式被导入、必要的原始 PIT 组件完整打包、权限正确、PDF.js Worker 路径正确且不重复装配。
- Playwright Chromium MV3：真实加载 KISS 和个人模块后，验证原 KISS 服务与内容脚本、PDF.js 渲染、独立设置、控制台对目标网页的绑定、独立 ASR 消息响应、用户触发的字幕脚本注入。构造测试不调用商业翻译 API/本机模型。
- 原有独立 PIT 四组回归：确保升级没有更改 `main`、破坏原独立插件的已验证功能。
- **不将自动化模拟测试当作真实 Netflix/Panopto 授权账号、Windows 设备音频或本机 Whisper 模型验证**。

## 仍待补齐

真实 Windows+Chrome/Edge 的用户授权音频采集、Whisper 模型推理端到端；复杂视频和字幕逐网站验证；视频与音频页面的 UI/翻译服务配置统一；完整 GPL Fork 维护及最终发行准备。验收未达成前 PR 保持 Draft，不上传实验复合包。
