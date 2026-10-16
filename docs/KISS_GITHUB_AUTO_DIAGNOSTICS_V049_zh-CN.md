# v0.4.9：点击一次生成诊断并自动上传 GitHub Issue

本模块在实验分支 `feat/kiss-github-oneclick-diagnostics-v049` / Draft PR #34，继承已验证的 v0.4.8 KISS GPL + PIT MIT 浏览器功能侧车。`main` 不变，完整 GPL 组合构建仅存在个人本地临时目录，不作为 CI artifact 发行。

## 为什么选择 GitHub Issues

目标仓库 `ACIDCH/personal-immersive-translator` 已启用 Issues，当前是**公开仓库**。GitHub 的 `POST /repos/{owner}/{repo}/issues` 可通过细粒度个人访问 Token 的 **Issues: Read and write** 权限创建 Issue，无需 Contents、Pull requests、Administration 等代码修改权限。报告 JSON 存在 Issue 正文中，每次测试生成新的 Issue 编号，供后续通过 GitHub 连接直接读取。**公开仓库的 Issue 正文对所有访问者可见**，虽然报告做了白名单过滤，也不应提交涉及个人隐私的自由文本。GitHub 官方文档：https://docs.github.com/en/rest/issues/issues 和 https://docs.github.com/en/rest/about-the-rest-api/api-versions 。

## 首次设置（只需要一次）

1. 在 GitHub 的 `Settings → Developer settings → Personal access tokens → Fine-grained tokens` 创建一个专门用于自动诊断的 Token。Resource owner 选择本人 `ACIDCH`；Repository access 选择 **Only select repositories → personal-immersive-translator**；Repository permissions 仅设 **Issues → Read and write**，其他权限保持最低级（自动 Metadata Read 可保留）。建议设置合适有效期。
2. **不要把 Token 发到聊天、GitHub Issue、源代码、控制台截图或任何网页。** 在本地组合版插件 KISS 弹窗进入“视频字幕 / Whisper”控制台，找到“GitHub 自动报告”，将 Token 填到专用密码输入框，点击“保存 GitHub 授权”。Token 保存在本浏览器扩展的 `chrome.storage.local`，不会写入仓库或自动上传。可以随时从控制台清除本地保存的 Token，或者在 GitHub 直接撤销该 Token。
3. 在已获准访问的网站（例如 YouTube、Bilibili、Miss AV、Panopto、Netflix 等）打开实际页面，在控制台选择平台并填写已测试的功能：原视频、原文字幕、双语字幕、全屏、Whisper、整页双语翻译、图片 OCR、PDF 预览、PDF 布局保持。
4. 点击 **“一键诊断当前网页并上传 GitHub”**。插件会重新检查当前绑定的标签页中的 HTML5 视频、字幕轨、字幕候选节点和 iframe，并自动通过 HTTPS `api.github.com` 创建一条 `[PIT 兼容性诊断] <平台> · <日期>` 的 GitHub Issue。页面立即显示该 Issue 的编号和可打开链接。后续仅需把编号例如 `Issue #123` 告诉 ChatGPT。

## 报告边界与故障处理

- 仅允许预定义的平台枚举、固定检查项 pass/fail/not-tested、聚合元素数量、无页面路径的时间戳和扫描类型。上传前二次构建固定 JSON 白名单。**不包含用户浏览的精确 URL、标题、字幕、DOM 文字、音视频、账号、Cookie、Token、密钥或任意备注。** Miss AV 等站点仅上报你在插件里选择的平台名称；不自动上传视频标题或来源链接。
- 若有非公开调试材料，需要另行明确决定分享；本功能绝不自动抓取/上传截图、日志、完整请求或网络响应。网页翻译及 OCR/PDF 的结果项目前由用户人工填写，并不因视频 DOM 检查而自动宣称功能已通过。
- GitHub Token 不存在、401/403、仓库无写入权限、网络不可用都会提示原因；创建 Issue 失败时仍可执行“检查当前网页播放器 → 导出诊断 JSON”作本地备用，不会默默重试而造成重复 Issue。每次明确点击上传会创建新 Issue。
- 由于当前仓库是公开的，Issue 也公开。如果需要完全私有的诊断历史，应在将来把目标改为独立的私有仓库并重新配置权限，不能因为本项目仅个人使用就假定公开仓库是私密存储。

## 自动化验收

- Node 单元测试：验证固定仓库地址、权限头、预期 201 返回 Issue 编号；不可控 URL/字幕/令牌字段被丢弃；无效 Token、401/403 和网络错误均明确处理。
- Playwright 使用真实 Chromium MV3 安装版执行一键诊断、读取浏览器本地 Token、模拟 GitHub REST POST（明确阻断真实网络），检查报告不含网页内容并且返回可点击 Issue 链接；**测试不会创建真实 GitHub Issue**，真实上传最终需用户在本人电脑设置 Token 后确认。
- 原有 KISS 网页翻译、Whisper 预检查、WebVTT 翻译显示、PDF.js 和单独 PIT 回归测试持续运行。

## Windows 本地组合包安装

从本 Draft 分支源代码在 PowerShell 执行：

    powershell -ExecutionPolicy Bypass -File .\scripts\build-kiss-personal-poc.ps1

将 `.local-kiss-poc/kiss-upstream/build/chrome` 加载为 Chrome/Edge 开发者扩展；具体查看 `docs/KISS_REAL_PLATFORM_ACCEPTANCE_zh-CN.md`。如果已有旧实验目录，脚本默认拒绝覆盖，请自行备份检查后再删除。不要把整包 GPL 衍生文件误上传到公开 MIT 仓库。