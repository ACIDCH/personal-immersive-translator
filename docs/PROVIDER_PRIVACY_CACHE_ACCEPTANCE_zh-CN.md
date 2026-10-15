# v0.3.2 翻译服务凭据保护、缓存管理与请求预算验收

日期：2026-10-16。本报告仅涉及独立的 personal-immersive-translator 仓库，属于开发版而非正式发布。

## 修复范围和可核验证据

| 领域 | 已实施的行为 | 回归验证 |
| --- | --- | --- |
| Google Cloud Translation API | Google Cloud Translation Basic v2 的 Key 只经 `x-goog-api-key` HTTPS 请求头发送，**不再进入 URL 查询参数** | Node 模拟 HTTP 严格断言 URL 不含 Key，Header 包含 Key |
| 自定义 LibreTranslate | 保存设置时，向用户申请所填 HTTPS 服务的单站点访问权限。拒绝授权则保存失败，且不发起翻译；此行为在此前版本已存在，本轮仅复核。 | 代码静态审计；生产站点及企业代理环境仍待实测 |
| 翻译缓存 | Chrome 本地缓存只保留最多 300 个文本翻译项、最多 30 天；保留匿名哈希键索引；首次写入可迁移无索引旧版缓存，清理过期记录 | Node 大量缓存、并发写入、旧缓存迁移测试 |
| 长文章成本边界 | 每次手动开始标准网页翻译最多自动处理 600 段；需要更多时用户可点击“继续翻译后续段落”额外增加 600 段预算，不会自动开启 AI | 真实 Chrome 中 615 段页面测试：首次 600，继续后 615 |
| AI 费用与选项 | 标准模式持续不自动切换至 Gemini/DeepSeek；AI 模式仍必须用户主动选择和确认。 | 原有单位测试、扩展 UI 模拟 |
| 缓存存储故障 | 即使本地缓存读取失败或配额写满，远端翻译已成功的结果仍立即返回，不把缓存故障作为翻译失败 | 完整 Service Worker 模拟存储错误集成测试 |
| 配置损坏恢复 | 本地存储意外变为 null、数字、字符串或数组时恢复安全默认设置，永不自动开启 AI | 新增 malformed settings 单元测试 |

## 设计和安全边界

- 文本缓存 `chrome.storage.local` 不构成端到端加密，不能代替用户密钥保管系统；在共用设备不建议保存高权限生产 API Key。
- 600 段是请求处理数量上限，并非精确计费额度。各翻译商按实际字符量、模型 Token 和计费规则收费；**尚未实现可保证金额的费用硬上限**。
- LibreTranslate 的 HTTPS 服务器由用户自行选择；本插件不保证第三方服务是否开放免费额度、准确性或保留政策，且不通过不受信任的中转地址自动传输文件。
- Google 官方说明应优先使用 `x-goog-api-key` 请求头；URL 参数会让密钥暴露在日志或扫描器里：https://docs.cloud.google.com/docs/authentication/api-keys-use 。
- 所有回归测试的网络提供商通过 Mock；即使四项 CI 都通过，依然不意味着真实 Key、企业网络代理或 API 限额测试完成。
- 这轮没有复制或新增 GPL/AGPL 源码；PDF.js 仍是官方 npm 发行代码，BabelDOC、whisper.cpp、Tesseract 仍是各自独立可安装的引擎。

## 后续生产验收

仍需要用户在有权访问的浏览器/设备上验证 YouTube、Netflix 和 Panopto 平台、所选翻译服务真实帐号/额度、Whisper 连续语音延迟及复杂 PDF 的 BabelDOC 版面效果。正式稳定版须满足这些真实数据、修复阻断问题并接受最终独立 Codex 审查。
