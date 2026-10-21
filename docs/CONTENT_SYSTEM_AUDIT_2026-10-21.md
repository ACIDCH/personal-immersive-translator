# PIT｜内容体系、功能入口与真实能力审计（2026-10-21）

> **适用对象：** `ACIDCH/personal-immersive-translator` 当前 WXT/MV3 开发分支、Draft PR #55。
>
> **审计层级：** ①实际代码与同版本构建清单 ②明确的真实请求/模型证据 ③受控浏览器/单元测试 ④用户真实 Windows/登录站点验收。任何文档、按钮、Star、GitHub CI 的总绿色状态**不能替代**其上层证据。
>
> **此文件是 2026-10-21 起产品能力与内容用语的当前准绳。** 2026-10-16 的 `PRD_zh-CN.md`、`ARCHITECTURE.md`、`ROADMAP.md`、`MODULE_STATUS_UI_zh-CN.md`、`RELEASE_READINESS_zh-CN.md` 为历史阶段记录，不得单独拿来判断现行默认设置或已集成模块。状态随 HEAD/CI 实时变化，禁止复制前一版本的绿色结论。

## 一、产品定位与内容主线

**产品定义：** PIT 是以单个 `WXT + React + Chrome MV3` 扩展承载自有 `src/` 翻译运行时的多场景双语翻译工具，并非官方沉浸式翻译的开源代码重新发布，也非整个 KISS/FluentRead 的移植产品。

**主要用户流程：** 选择来源/目标语言 → 配置及实际试译可用 Provider → 开始网页/字幕/文件/图片任务 → 显示实际翻译进度与失效原因 → 校验原位回填或文件导出 → 显式恢复、停止或重新配置。不应将“进入某个功能页面”与“引擎可用、译文正确”混为一谈。

**信息层级（唯一责任）：**

| 一级栏目 | 负责的用户任务 | 入口与信息原则 |
| --- | --- | --- |
| **Popup｜翻译控制** | 网页开启/恢复、字幕启停和诊断、跳转文件与设置 | **操作优先**，简短状态，不克隆一套翻译服务设置 |
| **服务中心｜Provider** | 管理免费/本机/BYOK/AI、逐服务试译、默认选择、使用限制 | 配置成功 != 试译成功；网络试译 != 全文品质；显示数据发送方及可能费用 |
| **网页｜阅读与规则** | 双语/仅译文、字体色彩、正文/整页、悬停/划词、站点规则 | 内容范围、样式与服务配置分开；保留可操作的导航、输入框和原 DOM |
| **视频｜字幕** | 字幕源语言、轨道/可见 CC、原位/兼容模式、服务覆盖、ASR 授权 | 显示 `waiting-for-CC`、缓存数量、当前真实渲染路径和失败原因 |
| **文件工作台｜多格式** | Office/EPUB/文本、图片/OCR、字幕文件、PDF/BabelDOC | 任务入口与导出集中；任务失败不输出虚假完整结果；可恢复记录有限 |
| **账号与同步｜可选** | Google OAuth / Supabase、加密备份、跨设备恢复 | 单独配置，不构成默认翻译链依赖；无云端授权时如实显示未配置 |
| **诊断/帮助｜证据** | 服务测试、模型下载、导出/安全限制、问题复现、版本与验收状态 | 报告实际供应商、错误码、版本和运行路线，不宣称模拟即真实可用 |

**统一配置：** `src/lib/settings.js` 定义 `pit_settings_v1`；`src/lib/product-settings.js` 扩展同一份配置。文件/视频专用覆盖和网站规则不应建立独立第二份 Provider Store。覆盖优先级以 `src/background.js` 运行代码为准：**当前站点规则 > 视频专用或文件专用服务 > 全局普通服务**，AI 须显式启动。

## 二、当前模块逐项真实能力审计

| 功能层 | 已经存在的真实代码 | 已有受控/单项证据 | 目前绝不应宣称 |
| --- | --- | --- | --- |
| 网页翻译 | `src/content.js` 文本节点筛选、动态 DOM、恢复、阅读显示；`src/background.js` Provider 调用 | Chromium/WXT 构造页面、Philips 风格标题/导航/搜索区；Google 公共短句公网请求 | 所有真实复杂站点排版保真、实际用户机器无故障、速度优于商业产品 |
| 免费/官方 Provider | `google-free`、`browser`、`mymemory`、Microsoft、Google Cloud、DeepL、Libre、Worker | 内核契约测试；公开 Google/MyMemory 短句测试，取决于地点/时间 | 免 Key 公共接口有官方 SLA、永久免费、不限频；官方 BYOK Key 可自动获取 |
| 视频字幕 | `src/subtitles.js`、`caption-core.js`、`platform-captions.js`、`subtitle-import.js` | HTML5 TextTrack 和 YouTube/Bilibili/Netflix/Panopto **受控 DOM** 场景、停止恢复 | 所有账号登录流媒体/DRM/动态 A/B 页面真实稳定，烙印字幕能原位无损替换 |
| Whisper/ASR | `src/offscreen.js` + 本机/独立 faster-whisper 云 ASR 服务源文件 | 实际 Whisper tiny CPU 对合成音频识别；FastAPI 合约 | 模型已在用户本机/真实 Railway 公网持续运行、长时延和成本满足需求 |
| 图片 OCR | WXT `Tesseract.js` 本机 WASM，置信度/几何约束，双栏和有限背景覆盖 | OCR CJK+拉丁清晰样本、导出 PNG/测试 | 复杂照片/漫画可语义擦字补绘、任意斜拍 OCR 完整正确 |
| PDF | 浏览器 `PDF.js` 栅格双栏、文本行重组；独立 `BabelDOC`/OCRmyPDF bridge 和任务 API | 数字/扫描 PDF 回归、BabelDOC **离线布局** 引擎测试 | 浏览器栅格双栏具备完整可编辑文字层/高保真学术排版；BabelDOC 已在公共云上线 |
| Office/EPUB/批量 | `apps/shared-ui` DOCX/PPTX/XLSX/EPUB/文本、字幕处理器，File Lab | 实际 WXT 导出结构及混合批次夹具 | 任意大型/带特殊嵌入对象的文件结构百分百保真 |
| 同步和 AI | 服务中心、AI 档案/专家、可选 Google/Supabase 同步 | UI 存储/模拟云端合同、AI 适配测试 | 未配置 OAuth 的账户能登录；API 能自动获得额度；用户未开启也调用付费 AI |

**Provider 实际默认：** `src/lib/settings.js` `standardProvider:'google-free'`，即**在线非官方公共接口**。其原文被发送至 Google，受网络与第三方限流影响。Chrome 本地 `browser` 需要实际语言包；MyMemory 是另一个公开服务，具有额度限制；Google Cloud 官方 API **另设** `google`，需要 Key。旧版已明确选择 `browser` 的用户不会因为更新文档而被强制改动偏好。

**视频渲染含义：** `replace-track` 尝试修改合法可写 `VTTCue.text` 或支持的网站 CC DOM；`in-player` 的兼容显示不能简单称为原生字幕替换。严格模式遇不可写节点应报告不支持，而不是虚报“成功嵌入”。

**PDF 分级：** (a) 浏览器 PDF.js + OCR + 双栏栅格导出，(b) 独立高保真 BabelDOC 任务 API 与异步结果，(c) 真正在线容器且具备模型凭据/计算资源/真实排版验收。三者必须在 UI 和文档保持区分。

## 三、文档与界面内容问题登记

| 级别 | 发现 | 文件/位置 | 审核决定 |
| --- | --- | --- | --- |
| P0（真实误导） | README 仍使用 `0.4.4`、称 Chrome 原生为新装默认，与 WXT 0.4.6 + `google-free` 相冲突 | `README.md`, `src/lib/settings.js`, `apps/wxt-ui/wxt.config.ts` | **本轮修复** README 主摘要、服务路线、安装指南和跳转审计 |
| P1（产品理解） | README 称 Tesseract.js 只是候选，然而已在 WXT OCR 中实际安装和调用 | `README.md`, `apps/shared-ui/imageTranslate.ts` | **本轮修复**，并说明实拍质量边界 |
| P1（用户感知） | Dashboard 使用“已接入”“需要本机服务”等容易误导的状态，且没有区分预览网站与安装版 | `apps/shared-ui/Shell.tsx` | **本轮修复**：受控测试与独立服务单独表达 |
| P1（上传提示） | 文件工作台选 MyMemory 有发送第三方提示，但选 Google 公共翻译时缺同等明确说明 | `apps/wxt-ui/entrypoints/file-lab/main.tsx` | **本轮修复**：显式切换提示，说明全局范围及在线文本传输 |
| P1（结构割裂） | 同一能力在 Popup、旧版 options form、动态服务中心、File Lab、Dashboard 中重复说明，存在旧词 | `src/options.html`、`src/options-v2.js`、`apps/wxt-ui` | **本轮修复**原始凭据面板文案；保留单一 Provider 设置，视觉/布局统一仍待人工审查 |
| P2（历史污染） | 2026-10-16 PRD/架构/ROADMAP 说视频/OCR/PDF 尚未开发，但后来已有代码与 CI | `docs/PRD_zh-CN.md`, `docs/ARCHITECTURE.md`, `docs/ROADMAP.md` | 保留历史原文并加“非现行能力清单”提示，当前进度只读本审计 |
| P0（验收缺失） | 真实 Philips 页面和授权视频的 Windows L3 证据不存在，不应使用 11/11 或 13/13 CI 宣称产品可用 | `docs/PIT_V2_REAL_DEVICE_UAT_20261020.md` | **保持阻断**，绝不改为绿色状态 |
| P0（部署缺失） | Railway 上没有已核验的真实公开 PDF/ASR 服务，无法宣称 BabelDOC/Whisper 已上线 | `docs/RAILWAY_BABELDOC_DEPLOYMENT_2026-10-21.md` | 服务源码及离线模型测试与真正部署分开 |

## 四、对标上游的信息架构但不复制不兼容源码

- [KISS Translator](https://github.com/fishjar/kiss-translator) 提供“配置服务 → 分配场景 → 测试 → 使用”的清晰路径，网页翻译、字幕、字典和文件有各自子功能；GPL-3.0，PIT 仅参考产品信息组织和测试方法。
- [FluentRead](https://github.com/FluentRead/FluentRead) 的“网页 / AI 阅读 / 学习 / 图片 / 文件 / 视频”分类强调具体场景；GPL-3.0，并不等于 PIT 已移植其功能。
- [BabelDOC](https://github.com/funstory-ai/BabelDOC) 将 PDF 解析中间层、翻译/排版与最终 PDF 输出明确分离；AGPL-3.0，需要独立部署/许可与实际输出质量验收。
- [官方 Immersive Translate](https://github.com/immersive-translate/immersive-translate) 的正式产品仓库并未提供完整内核源码，不能直接复制其可执行发行包冒充开源源码。

## 五、不能靠文案解决的真实 P0/P1 工程阻断

1. **WEB-P0** — 未在真实 Philips Careers 页面用当前 PIT 安装版 + 指定真实 Provider 完成逐段双语截图/DOM 操作/导航搜索框前后对照。涉及实际页版本、字体、语言、浏览器缩放，仍需 L3。
2. **VID-P0** — 未在获授权真实 YouTube、Netflix、Panopto 播放器和有 CC 的账号完成原文轨、翻译请求、回填 route、停止恢复全链路。受控 HTML 字幕样例 ≠ 平台实战。
3. **PDF-P1** — BabelDOC 独立 Python/Railway 服务尚无公网 `health.ready:true`、凭据、真实 10/50/100 页文件和 PDF 输出截图比对。
4. **ASR-P1** — faster-whisper tiny 合成音频能跑不等于实时字幕。需要 15/30 分钟 CPU p50/p95、网络/峰值、真实外语口音、播放器跳播与停止恢复。
5. **IMG-P1** — 复杂纹理、照片/漫画的语义补绘未实现；当前原位覆盖仅在有限背景安全区域工作。
6. **OPS-P1** — 真实多网站和多文件的 429/503/断网/短时错误恢复、翻译质量与延迟比较，无可复核 L3 样本矩阵。

**优先顺序：** 真实无 Key 翻译服务可用性与完整回填 > 网页可交互内容保真 > 真实播放器字幕原位显示 > 大文件与图片导出保真 > 统一界面/品牌精修 > 稳定发行。

## 六、审计和验收状态标注规范

对任何模块只准使用下列证据级别：

- `CODE`：存在可追溯生产调用代码，不代表可用。
- `FIXTURE`：安装版 Chromium/真实解析器 + 受控页面/Mock MT 通过；**必须说明替代了哪些网络/平台**。
- `LIVE-PROBE`：真实外网短句或真实模型推理成功，范围仅限那一个语对/音频/环境。
- `L3-PENDING`：用户的真实机器/账户/页面/复杂文件尚无合格证据。
- `DEPLOY-BLOCKED`：远端服务未部署、未验证健康检查或模型不就绪。
- `RELEASE-APPROVED`：经真实 L3，CI、许可、Code Review 和用户确认后才能标注；当前全部模块**不得**标为此状态。

新的文档、UI、测试报告**不得**把 `CODE` 或 `FIXTURE` 直接称为 `RELEASE-APPROVED`，不得把 HTTP 200 当作译文质量验收，不得把离线布局/ASR 模型 CI 当作有公网可用服务器。

## 七、交付与后续验收

源码当前分支依然是 Draft PR #55，不合并 main、不发布 Stable。CI 结果以 **最终 HEAD** 对应运行和构建工件为准，不能复用旧版 ZIP 或用旧 CI 断言新 HEAD 已通过。

**建议 L3 回传记录：** `版本/commit/浏览器/目标网址(公开时)/目标语言/Provider/操作路径/期望/实际/错误码/是否复现/无隐私截图`；遵循 `docs/PIT_V2_REAL_DEVICE_UAT_20261020.md` 的原版步骤，并补加 Google 公共在线免 Key 测试。真实失败优先修复 P0，再决定是否推进其它高星内核迁移。
