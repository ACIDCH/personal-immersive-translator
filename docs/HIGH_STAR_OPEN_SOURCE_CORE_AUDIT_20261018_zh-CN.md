# 多模态翻译：高 Star GitHub 开源代码库审计与复用决策

**核查日期：2026-10-18。** 项目：`ACIDCH/personal-immersive-translator`，关联草稿 PR #48。仓库 Star 数为核查时 GitHub REST 项目元数据，持续浮动。每个 commit 均已由 GitHub commits API 验证，供复现对比。**项目拥有大量 Star 不是代码可合法直接复制的许可凭据，也不是质量验收结果**。

本阶段交付是上游尽调和可实施的模块优先级；除项目原有的 `pdfjs-dist` 外，以下候选仓库的源文件**均未在本次工作中复制到 PIT 或作为可用运行核心**。需要实际跑通独立构建并完成许可检查才能正式启用。

## 一、候选矩阵（GitHub 实际仓库）

| 项目、固定版本短 SHA | 核查时 Stars | 许可证核实 | 架构/真正适合的复用模块 | 决策 |
| --- | ---: | --- | --- | --- |
| [fishjar/kiss-translator](https://github.com/fishjar/kiss-translator) `7a7e2957ce20` | 12,888 | **GPL-3.0** | MV3，React、字幕和网页 DOM 处理，多翻译引擎、可扩展自定义接口；上游可作为完整**实际网页/字幕核心** | **P0：独立 GPL fork 构建与同场实测**。分发时遵守 GPL，不悄悄复制进现有 MIT 发行包 |
| [FluentRead/FluentRead](https://github.com/FluentRead/FluentRead) `877ee77b5e3c` | 8,495 | **GPL-3.0** | WXT + Vue + TypeScript，已有 PDF.js、Tesseract 等，拥有动态网页和翻译覆盖测试；与现有 WXT 工具链很接近，但**前端 Vue≠当前 React** | **P0 对照、P1 择优移植**；不要直接合并 Vue UI 与 React UI |
| [immersive-translate/old-immersive-translate](https://github.com/immersive-translate/old-immersive-translate) `6df13da22664` | 921 | **MPL-2.0** | 归档 MV2 版本，旧网页 DOM 分段、规则及翻译缓存可针对具体文件研究 | **P2：文件级核查，MV3 移植实验**；当前官方正式版并非该开源内核 |
| [mozilla/pdf.js](https://github.com/mozilla/pdf.js) `19bdcbeab3de` | 54,013 | **Apache-2.0** | 浏览器 PDF 页面渲染及文本提取 | **已集成**：PIT 根 `package.json` 已锁定 `pdfjs-dist:6.4.299`，继续维护供应链 |
| [naptha/tesseract.js](https://github.com/naptha/tesseract.js) `a1ca80d9e31c` | 38,765 | **Apache-2.0** | 浏览器 WASM OCR，支持用户主动加载语言包、可做截图/图像文字检测 | **P1：可作为直接 npm 依赖**；先在独立 WXT OCR 原型测延迟、内存、离线包大小，保留许可证及语言数据许可 |
| [mwilliamson/mammoth.js](https://github.com/mwilliamson/mammoth.js) `5171a9072f8b` | 6,324 | **BSD-2-Clause** | DOCX→语义 HTML/文本，适合获取内容，不提供完整 Office 原样排版导出 | **P1：可作为直接 npm 依赖**，在文件预览界面接入；保存原许可证 |
| [futurepress/epub.js](https://github.com/futurepress/epub.js) `eee359d07900` | 6,966 | 包 `package.json` 标注 **BSD-2-Clause**；GitHub API 未识别 | EPUB 渲染、章节分页、章节文本读取 | **P2：选定 npm 版本再核对包内 LICENSE/声明**，Web 阅读模块复用 |
| [oomol-lab/pdf-craft](https://github.com/oomol-lab/pdf-craft) `54e982788cd4` | 6,390 | **MIT** | Python 服务：扫描版 PDF 转换/重排与格式处理 | **P2：许可友好，但不是浏览器 JS 内核**，适用于未来本机处理服务 |
| [funstory-ai/BabelDOC](https://github.com/funstory-ai/BabelDOC) `38d3896dcde9` | 9,723 | **AGPL-3.0** | Python 重排引擎、PDF 页面模型、段落版面、公式位置的处理 | **P1：独立 PDF 处理进程/服务**；网络部署及修改有 AGPL 源码义务，不能简单上免费 CPU 受限 Workers |
| [PDFMathTranslate/PDFMathTranslate](https://github.com/PDFMathTranslate/PDFMathTranslate) `c570ae9e3208` | 37,616 | **AGPL-3.0** | Python `pdf2zh` 项目，已有 BabelDOC、PDF 版面翻译、CLI/GUI/HTTP API 思路 | **P1：优先评估命令/API 集成**；不把整套 Python/ONNX 程序塞进浏览器扩展 |
| [zyddnys/manga-image-translator](https://github.com/zyddnys/manga-image-translator) `d6de6ab62a7b` | 10,510 | **GPL-3.0** | 图像文字检测、OCR、修补、重绘等 Python 流水线 | **P2：单独图像处理引擎**，图片精修不作为每页网页翻译默认依赖 |
| [jianchang512/pyvideotrans](https://github.com/jianchang512/pyvideotrans) `f9f35d102a2b` | 19,425 | **GPL-3.0** | 视频字幕生成、ASR、机器翻译与本地语音处理 | **P2：可借鉴或独立运行字幕任务**；其 Python 视频处理流程不适合免费 Worker 原地推理 |
| [opendatalab/MinerU](https://github.com/opendatalab/MinerU) `b7f3dd0c5f6e` | 81,902 | **定制条款**（仓库 `LICENSE.md`：Apache-2.0 加附加商用/在线服务署名条件，GitHub API `NOASSERTION`） | 大型 PDF/Office 解析、Markdown 和 JSON 化，依赖模型 | **P3：先专项审查附加条款及模型权重**，不能仅以高 Star 为依据嵌入 |
| [pot-app/pot-desktop](https://github.com/pot-app/pot-desktop) `594d32ede96a` | 19,371 | **GPL-3.0**，**已归档** | 桌面划词 OCR、插件式 Provider 设计可分析 | **参考架构**，不是持续更新的浏览器基础内核 |

补充说明：旧版沉浸式翻译与现在的官方 Immersive Translate 并不等同，绝不把正式版发行包当作开源实现。上游项目内第三方字体、模型权重、在线 API 与源码的许可证还须分别确认。

## 二、构建自有多模态翻译的复用原则

### 层一：优先使用允许直接嵌入的成熟模块

在现有 `WXT + React + TypeScript` 架构内：

- PDF：沿用已经存在的 `pdfjs-dist`（Apache 2.0）页面读取和渲染。
- 图片/OCR：独立页面/worker 试接入 Tesseract.js；语言资源按需下载缓存而不是随插件强行打包全部语言。
- DOCX：独立文档读取器导入 Mammoth.js；不向用户宣称 DOCX 内容读取等于 DOCX 格式精确回写。
- EPUB：待确认选择的 npm tarball 带许可文本后接入 ePub.js。
- 所有模块都保留上游版权/许可证文本，并检查依赖许可及安全更新。

### 层二：可作为“实际核心”的开源项目

- **KISS 与 FluentRead 均需真实对照**；优先先构建 KISS fork（现行 MV3 + React 更贴近 PIT），FluentRead 作为 WXT 架构强候选（但 Vue 与 React UI 不可直接粘合）。
- 两个 GPL 代码库都能依法 fork、修改、适当条件下再发布，但不能一边把源码深度集成，一边继续把同一整体发行包错误地宣称为全 MIT。
- 真实复用可采取：**（A）依法整合并按兼容的 GPL 方式发行相关衍生代码**，或 **（B）保持独立可安装/运行的 GPL 分支**；使用所谓“插件接口”或“独立文件夹”本身不必然规避 GPL 的衍生作品判定。
- 优先建立运行测试：manifest/MV3 校验、适配器调用、同网站真实 DOM、缓存/接口超时、字幕、稳定性。未测试的候选不能出现在正式 UI 的“可用内核”选项中。

### 层三：独立的高保真 PDF、视频、图像任务处理

- BabelDOC / PDFMathTranslate 是 Python/本地模型组合：插件可做上传入口、进度 UI 和结果预览；真正的版面分析通常在用户本机或另一个具有足够 CPU/RAM 的后台运行。
- Cloudflare Workers 只用于轻量 API、任务状态和请求路由，免费 Workers **不是**运行 ONNX/ASR/大型 PDF 推理的合适运行时。
- 独立进程或 HTTP API 接入 AGPL/GPL 引擎时，仍需视具体分发、修改、网络提供服务及耦合方式履行许可义务；不能宣称“拆成服务就一定没有开源义务”。
- 翻译 AI 采用已有的用户可配置模型档案：常规 MT 优先；AI 不自动启用付费路由。OpenAI-compatible、Anthropic、Gemini 等协议分别适配。

## 三、实际代码位置与验收要求

| 现有路径 | 首批准备复用的上游 | 实施内容 | 验收证据 |
| --- | --- | --- | --- |
| `src/content.js`、`src/lib/providers.js`、`apps/wxt-ui/` | KISS、FluentRead | 不立即覆盖已有实现；创建隔离可构建 fork，对同一网页逐段翻译结果对照 | WXT Chromium 对照报告，失败/恢复和许可证 |
| `src/pdf-preview.js`、`scripts/vendor-pdfjs.mjs` | PDF.js（已集成） | 核对固定依赖、worker/字体、页面读取、PDF 二次布局处理接口 | 已有 pdf-bridge 与真实 PDF 测试 |
| `apps/wxt-ui/` 新 OCR 页面、文件拖入 UI | Tesseract.js | 本地异步识别，仅下载必要语言；不采集用户私有截图 | 样本识别率、冷启动时间、体积 |
| 新 DOCX 解析模块（尚未创建） | Mammoth.js | docx→HTML 语义提取，再调用翻译核心 | 真实 DOCX 输入/段落映射，声明格式限制 |
| 独立 PDF worker/本地工具 | BabelDOC / PDFMathTranslate | 通过受控任务接口转发、查看状态及取回文件 | 扫描件、学术公式、表格和布局对照 |
| 视频字幕模块 | KISS 字幕实现及 pyVideoTrans 思路 | 优先视频平台可读取的字幕轨；无轨再选 ASR | YouTube/Panopto 真实字幕事件和同步 |

**性能/可靠性门槛**：优先对相同版本的测试页面测覆盖率、时间、重复译文、页面错误；有数据后才能定默认核心。翻译质量还需真实已授权 MT 或 BYOK AI 进行评估，不能以模拟译文计分。

## 四、执行顺序和本轮完成边界

1. **现在**：保留 PIT 的 WXT + React 已通过真实 Chromium 测试的版本，维护上游版本和许可证清单（本文件）。
2. **下一组分支**：隔离编译并运行 KISS GPL fork，在相同测试用例下与 PIT 测功能/耗时；再测试 FluentRead WXT+Vue 运行版。
3. **第一批低风险依赖**：把现有 PDF.js 实现稳定下来，并为 Tesseract.js / Mammoth.js 建设独立可运行的实验模块；不改变生产文件解析逻辑直到真实文件样本通过。
4. **后续**：Python BabelDOC / PDFMathTranslate 任务执行集成，视频字幕与 OCR 双语回填、真实文件导出。
5. **最终**：按照许可证/版本安全核查、真实浏览器联调、公开可用源码条件，通过 PR 合并，并进行 Chrome/Edge 个人实际验收。

本文件不是法律意见；对模糊的源码整合/衍生作品边界，发行前应单独审查许可证兼容性。

