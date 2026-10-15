# 个性化沉浸式翻译插件 — 产品需求基线

版本：0.1.0 Alpha（2026-10-16）。

## 目标
个人使用优先，采用 Manifest V3，默认使用可授权的常规机器翻译，Gemini/DeepSeek 仅在用户手动启用后调用。保留原文，在其附近以纯文本形式展示译文。

## 项目隔离
- GitHub: `ACIDCH/personal-immersive-translator`，独立公开仓库。
- Supabase: `personal-immersive-translator`，独立项目；首版不需要数据库。
- YUNPAN: `Personal-Immersive-Translator` 独立主目录及 `docs`/`releases`/`backups`。

## 首版验收
1. Chrome/Edge 可通过“加载已解压的扩展程序”安装。
2. 仅在用户点击后提取页面文本，并允许一键恢复原文。
3. Microsoft、Google Cloud、DeepL、LibreTranslate 适配器通过模拟响应测试。
4. Gemini、DeepSeek 需要明确的 AI 选择与用户确认；不会自动回退到 AI。
5. API Key 只保存在扩展可信上下文，不向网页、GitHub 和云盘发送。
6. 域名禁止名单、缓存、划词翻译、错误提示可用。
7. 浏览器及真实 API 联调与自动测试分开验收，不允许以 Mock 测试代替。

## 后续
视频字幕、AI 上下文增强、学术 PDF、公式保护、同步、预算上限、本地离线引擎和 Codex 独立最终审查。
