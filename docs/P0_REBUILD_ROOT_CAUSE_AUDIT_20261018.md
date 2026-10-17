# PIT P0 全面重审：旧版本不合格，禁止发布

日期 2026-10-18。证据来自用户真实安装体验与 GitHub 生产代码和 CI 工作流直接核查。即使 GitHub 自动化通过，用户端失败依旧应判断为功能未通过。新代码进入隔离开发分支，主分支不变。

## 1. 打包内容：不是成熟翻译器的完整核心

实际 WXT 插件使用 React 控制面板，但 apps/wxt-ui/scripts/prepare-native.mjs 直接从项目 src/ 复制 content.js / subtitles.js / background.js；wxt.config.ts 把服务工作线程指定为 pit-background.js。网页和字幕主逻辑仍是有限的项目自写代码。此前构建过 KISS 和 FluentRead 独立测试产物，但**没有在新安装的 WXT 主运行链中集成成熟的开源网页翻译核心**。因此不能声称已在自研应用中复用了高星源码并具备其成熟度。

## 2. 功能、根因、严重性与正确目标

| 级别 | 模块 | 经核验的旧代码事实 | 实际后果/改造标准 |
| --- | --- | --- | --- |
| P0 | 默认翻译 | settings.js 默认 microsoft，但 providers.js 强制 Microsoft Key。CI 事先注入假 Key 并拦截翻译 HTTP。 | 真实新用户默认不可翻译；必须提供真正可用的在线翻译服务或明确提示配置。 |
| P0 | 云端 | cloudflare/multimodal-api 的翻译、ASR、OCR 原是 501 未实现。 | 用户不得不安装 Python、本机模型。本次将真正实现 MT+Whisper，OCR/PDF 独立高算力容器。 |
| P0 | PDF | pdfBilingual.ts 硬限 8 页、16 MiB、累计像素 13MP，后端本机服务需 BabelDOC。 | 大多数真实课程资料失败。浏览器应分卷处理并能导出，复杂公式双栏应走真正云端 BabelDOC。 |
| P0 | 视频 | 依赖网站可见的字幕 DOM selector 和原生 TextTrack，视频网站回归页面由测试合成。 | 真正的 YouTube/Bilibili/Netflix/Panopto 动态播放器可能抓不到。必须做已授权实时网站测试和无字幕 ASR。 |
| P0 | 自动语言 | 普通 MT 对 auto 是转发至提供商；PDF 与图片 OCR 原先默认 eng。 | 中日韩/法语等扫描件错误或无响应。需检测文本层、按脚本识别和多语言 OCR，返回低置信度警告。 |
| P1 | 网页抓取 | 原 content.js 排除短于 12 字符的正文，固定 p/li/h 选择器，且忽略 header/footer。 | 页内短句、卡片和很多 DIV 内容漏译。修复后仍须真实 10 个不同网站的定量覆盖测试。 |
| P1 | Office | DOCX/PPTX/XLSX 最大 12MiB 且只按字符比例分配译文到原有富文本 run。 | 结构能打开并不代表富文本语义正确。需对比页码、表格、字体、公式、媒体、样式。 |
| P1 | 文字文件 | portableDocumentTranslate 只接受严格 UTF-8，拒绝 UTF-16 文本。 | 用户正常 UTF-16 TXT/Markdown 失败。应检测 BOM 并保留编码和 CRLF。 |
| P1 | 图片原位置 | imageTranslate.ts 只能覆盖简单平色背景，复杂图案或照片刻意拒绝。 | 不能宣称实现智能照片擦除/补绘，需要独立 OCR 布局分析及真正图像修复引擎。 |
| P0 | 验收 | 真实公开视频探测中 YouTube HTTP 200 但未暴露 CC，Bilibili HTTP 412；mock 站点全部通过。 | 外部实测为 0/2，不能把 12/12 CI 当作功能完成。 |

## 3. 新体系应该有怎样的独立服务

- 浏览器内：原文识别、双语渲染、字幕计时、站点恢复、文件选择/导出；无需本机 Python 才能使用日常功能。
- 轻量云端：Cloudflare Workers AI 标准翻译与 Whisper 分段语音识别。Cloudflare 免费额度有限；必须绑定 AI、配置 Token 和服务端，并接受可能的运行费用。未部署时不是可用服务。
- 文档云端：独立 Python 容器真实运行 BabelDOC、OCRmyPDF/Tesseract 和翻译模型；单次 25MiB/300 页和严格鉴权。不应把原页栅格拼接叫高保真。不同云平台可能需要按分钟付费。
- OCR 识别：源文本与语言检测、扫描页自动多语种模型，以及低置信度场景人工选择覆盖。
- 无字幕视频：可读原字幕优先，用户允许后短时音频转云端 Whisper；本机 Whisper 改为可选，不再是唯一实现。
- 页面级翻译：引入成熟的开源翻译核心或实证对等的 DOM 分块、可见性/滚动检测、动态页面规则、文本合并和批次错误恢复。

## 4. 可合法参考的成熟开源底座

- KISS Translator，fishjar/kiss-translator：GPL-3.0，成熟的网页翻译和免费服务适配，可做功能与代码基线。
- Read Frog，mengxi-ream/read-frog：GPL-3.0 / 商业双许可，网页翻译及免费服务、AI 模型、翻译阅读组件成熟，建议优先评估作为真正可运行的 GPL 基座。
- FluentRead，FluentRead/FluentRead：GPL-3.0，覆盖网页、图片、文档、字幕等，可作为第二条独立基线。
- Immersive Translate 官方当前仓库说明并未开放现代版核心源代码，不能直接当作可复制的开源项目。
- BabelDOC：AGPL-3.0，应用服务与许可必须单独处理。

**不能简单把 GPL/AGPL 核心复制进当前 MIT 标示的代码后继续声称代码全部为 MIT。** 选择真正的 GPL 分支/仓库之前，需要做许可证和来源保留，绝不再拿开源项目的网页截图当作 PIT 的完成度证据。

## 5. 本次真实实施与局限

- 新 cloudflare Worker MT 路由从 501 变为 AI.run M2M100 实际调用，并新增 Cloudflare Whisper Turbo ASR 的 WAV 转录路由；附鉴权、传输及错误检测。云账户未绑定/部署时不可用。
- WXT 的标准模式可选云端服务；云端 Whisper ASR 不需用户本地模型，音频上传必须明确确认。旧本机路线仅保留可选。
- PDF 浏览器路径改为最高 300 页、48MiB，并每 12 页独立成卷输出 PDF/ZIP；这是低保真栅格方案，不等于高保真。大文件仍要做真实内存验收。
- OCR 可选择多语种模式（资源较重）；短 Latin 文本仍可能错误猜成英文，不得宣称专业级全语种检测。
- TXT / Markdown 可识别 UTF-8 BOM、UTF-16LE/BE BOM 并保留输出编码及换行；EPUB 等扩大可用输入范围，但 Office 原有限制尚未根治。
- 新增独立云 PDF 服务 Python API 和容器源码，高保真上传接口可调用已配置的服务；**目前未部署，未实测用户付费 API 或真实复杂论文质量**。
- 页面 DOM 选取放宽短段/叶子 DIV 限制，但视频真实兼容和多站点漏译率尚未通过。

## 6. 阻断发布的正确检查等级

L0：源码语法、TypeScript、包构建和单元测试——仅证明软件结构可运行。

L1：真实 Chrome MV3 + 测试 HTML/Mock 翻译响应——证明模拟环境调用和导出链，不证明真实供应商/视频网站可用。

L2：真实公开网页和真实云端翻译/语音供应商返回文字，测量错误、延迟、费用、实际漏译率。反爬/登录阻断必须记为 BLOCKED 而非 PASS。

L3：所有核心路径与至少三类真实文件、复杂论文、被授权实际 YouTube/Bilibili/Netflix/Panopto 录像及真实扫描照片人工评判。

L4：L0–L3 核心路径达标、依赖许可证审查、Codex 独立检查后方可发布最终可安装产品。

**目前判定：NOT READY。用户此前安装版不合格，本次 P0 分支也未获用户验收、未部署生产云服务；不合并、不发正式安装包、不转入面板与网站设计。**
