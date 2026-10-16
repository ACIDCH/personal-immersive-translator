# KISS 2.1.1 正式构建 + 个人 PDF/OCR 功能侧车

开发分支：spike/kiss-v211-multimodal-sidecar-v045。日期：2026-10-16。

## 已实施

1. 在独立 CI 临时目录检出 GPL-3.0 的 KISS 2.1.1，固定上游 SHA a1279f2517bd478ef1dd93b941f9177094486cd4，运行上游官方 Chrome 构建，保留其网页翻译引擎、规则、React 控制面板、后台服务。
2. 在**构建产物中**将本项目已有的图片/PDF 页面、OCR 和翻译 provider、设置、缓存、Mozilla PDF.js 6.4.299 和 Web Worker 作为侧车集成。核心处理来自已真正接入的 Mozilla PDF.js、Tesseract/OCRmyPDF、BabelDOC，而不是重新开发解析器。
3. 在 KISS 原有 popup 中加入 PDF/图片 OCR 与独立文件工具设置两个入口，不重构整套界面；避免注册第二个 background 消息路由来干扰上游 KISS。
4. 图片 Gemini OCR 需要明确点击和确认；Tesseract 与 BabelDOC 本机服务需要单独部署。文件工具使用独立的本机设置储存键，与 KISS 网页翻译设置尚未统一；工具页服务测试直接从可信扩展页面使用原有 provider adapter，按原有 UI 用户操作启动。
5. 保留用户同意的 KISS 全站访问权限，并允许文件工具通过浏览器正常流程申请本机 127.0.0.1 服务权限。保留原有主动付费确认和本机服务令牌要求。

## 测试

- Node 合成构建契约：版本不一致立即拒绝、原 KISS background 和全站内容脚本不替换、文件及许可证齐备、重复装配拒绝。
- Chromium MV3 真实加载测试：KISS popup 导航入口，实际 PDF.js Worker 绘制本地测试 PDF，文件工具设置保存与重载。该测试不调用在线服务、不消耗 AI Token。
- 不在 CI 上传复合包：KISS 上游 GPL-3.0，个人模块 MIT，PDF.js Apache-2.0。未来若分发完整组合版本，需按 GPL 义务发布相应源码和许可证。

## 仍未完成

- 统一 KISS 网页翻译服务和个人 PDF/OCR 的 API 配置与界面；
- Whisper 录音/实时字幕及自绘字幕特殊处理模块的整合；
- 真正安装 Windows 本地 OCR、BabelDOC 模型以及真实复杂 PDF 的端到端验收；
- Netflix/Panopto 登录播放器与页面跨度的实测；
- 生产安装包、名称和最终前端可视化设计。

保持 Draft PR；不修改 main，不宣称上游浏览器运行成功即代表本项目全部功能通过。

## v0.4.5 组合版运行修复（2026-10-16）

已发现 Google 正式品牌版 Chrome 自 137 起移除命令行 `--load-extension` 支持，先前用它在 GitHub Actions 加载临时扩展无法正确证明代码兼容性。使用 Playwright 自带的非品牌 Chromium 执行自动化，普通用户仍可通过 Chrome 扩展管理界面“加载已解压的扩展”安装。

修复装配器：删除在 KISS `manifest.json` 中新增的无效 `permissions` API 权限以及与其已必需 `<all_urls>` 重叠的 localhost 可选权限；本机工具的权限检查改为 `chrome.permissions.contains`，不再对必需权限重复申请；PDF.js Worker 引用从原独立项目 `src/vendor/pdf.worker.mjs` 调整为组合包实际路径 `pit/vendor/pdf.worker.mjs`。新增 Node 回归断言以避免此类迁移路径和权限错误。

上述更改以重新运行真实 Chromium MV3 测试为准，不把修复代码提交当作已完成浏览器验收。
