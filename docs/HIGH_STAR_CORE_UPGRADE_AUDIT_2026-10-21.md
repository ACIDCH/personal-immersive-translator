# PIT｜高星开源核心组件比选与分模块落地报告（2026-10-21）

仓库：`ACIDCH/personal-immersive-translator` · 工作分支：`feat/chrome-native-no-key-translation-20261018` · Draft PR #55。  
Stars 为 2026-10-21 GitHub API 观察值（随时变化），不是功能优劣评级。选型基于 **MIT 兼容性 + 实际用户链路 + 近期维护 + 测试可复现**。上游具体源码和在线服务的许可证分别审查。

## 1. 可审计候选仓库

| 项目 / 上游地址 | 约 Stars | 许可证 | PIT 适配价值 | 使用方式 |
| --- | ---: | --- | --- | --- |
| [KISS Translator](https://github.com/fishjar/kiss-translator) | 12,940 | GPL-3.0 | 富文本 DOM/图片/PDF/YouTube、服务插件、字幕断句、跨设备配置 | **只参考与隔离对标**。禁止源码直接混入 MIT PIT |
| [FluentRead](https://github.com/FluentRead/FluentRead) | 8,528 | GPL-3.0 | WXT 翻译管理、网页动态更新、视频字幕/文档整合 | 架构与行为对标；Vue 与 PIT React 不能直接合并 |
| [当前官方 Immersive Translate](https://github.com/immersive-translate/immersive-translate) | 约 19k | 非完整开源内核 | 对比真实使用体验和显示效果 | 不复制发行包；正式仓库仅发布 Releases/Issues |
| [Mozilla PDF.js](https://github.com/mozilla/pdf.js) | 54,029 | Apache-2.0 | PDF 提取、文本项坐标与阅读层、页面渲染 | 已集成；本轮新增加 `pdfTextLines` 阅读流重组 |
| [pdf2zh / PDFMathTranslate](https://github.com/PDFMathTranslate/PDFMathTranslate) | 37,713 | AGPL-3.0 | 学术 PDF 双语保排版、公式/图表布局 | 单独 Python/容器任务服务，不在 MV3 假装具备 |
| [BabelDOC](https://github.com/funstory-ai/BabelDOC) | 9,735 | AGPL-3.0 | PDF 结构化翻译与精细重排 | 通过自有已定义远程 job API 集成；尚未部署算力 |
| [Tesseract.js](https://github.com/naptha/tesseract.js) | 38,777 | Apache-2.0 | Chrome/WASM 本机多语 OCR + 坐标与置信度 | 已集成；本轮加 OCR 矩形可靠性前置检查 |
| [manga-image-translator](https://github.com/zyddnys/manga-image-translator) | 10,519 | GPL-3.0 | 区域检测/修复/文字贴合、复杂图像独立处理 | 只对标识别与重绘流程；未复制 GPL 模块 |
| [Tesseract OCR](https://github.com/tesseract-ocr/tesseract) | 77,088 | Apache-2.0 | 多语言 OCR 后端 | 现有 Tesseract.js 的技术路线；非直接新依赖 |
| [Mammoth.js](https://github.com/mwilliamson/mammoth.js) | 6,330 | BSD-2-Clause | DOCX → 语义 HTML/预览，不等于 OOXML 保排版回写 | 视具体预览需要引入；PIT 现有 DOCX Zip 翻译继续保留 |
| [EPUB.js](https://github.com/futurepress/epub.js) | 6,969 | GitHub NOASSERTION（需核对 npm 包） | EPUB 阅读器/章节浏览 | 先锁版本+逐包许可审计，再决定是否引入 |
| [Microsoft MarkItDown](https://github.com/microsoft/markitdown) | 191,336 | MIT | PDF/Office/HTML 文本解析的可选服务端导入 | **不是**页面样式保真导出；暂只作为独立解析备选 |
| [faster-whisper](https://github.com/SYSTRAN/faster-whisper) | 26,002 | MIT | 独立 Whisper 推理加速/句段时间戳 | 本轮增加返回段落与语言元数据的兼容层；未部署 GPU/CPU 模型 |
| [OpenAI Whisper](https://github.com/openai/whisper) | 110,962 | MIT | 高质量 ASR 参考模型 | 可作为独立 ASR 服务；**不是**浏览器原生插件引擎 |
| [pyVideoTrans](https://github.com/jianchang512/pyvideotrans) | 19,480 | GPL-3.0 | 语音字幕识别、翻译、视频后处理 | 独立实验/架构参考；不可当作现成 MV3 字幕抓取内核 |
| [PDFCraft](https://github.com/oomol-lab/pdf-craft) | 6,413 | MIT | 扫描 PDF 识别/转换服务 | 未来有算力时择优作为独立 OCR/PDF worker |

所有许可证以当前仓库 LICENSE/项目元数据为参照；依赖包、模型权重、样式与云端 API 服务条款须单独核验。GPL/AGPL 服务分离不能自动消除对应义务，发行前需看实际耦合方式。

## 2. 本轮已修改的 PIT 真实生产路径（非原型按钮）

| 生产入口 | 改动路径 | 实现与边界 | 回归依据 |
| --- | --- | --- | --- |
| 网页与所有标准 Provider | `src/lib/providers.js` | `google-free` 支持最多 3 个并行公网小请求、同批重复源段落去重、整批错误不承诺成功；不自动升级付费 AI | `tests/google-free-provider.test.js` |
| 实时字幕 | `src/lib/caption-core.js` | 同一字幕会话按原文去重，重复说话不重复调用 HTTP；保留不同 cue 的原时间和标识；各会话仍独立 | `tests/caption-core.test.js` |
| PDF 文本层 | `src/lib/pdf-text-layout.js`、`apps/shared-ui/pdfBilingual.ts` | 利用 PDF.js `transform`、`hasEOL` 和字体几何重新合并同一行文字，避免每个 OCR/PDF 字形片段单独请求 | `tests/pdf-text-layout.test.js`、已装 WXT PDF 测试 |
| 图片原位译文 | `src/lib/ocr-geometry.js`、`apps/shared-ui/imageTranslate.ts` | 不可靠 OCR 置信度、严重重叠、越界区域禁止擦原图；双栏无损导出不受影响 | `tests/ocr-geometry.test.js`、WXT 图片 OCR 测试 |
| 视频语音字幕 | `src/lib/asr-response.js`、`src/offscreen.js` | Whisper/faster-whisper 网关返回 `text` 或 `segments[]` 均能适配，限定长度，弱语言概率不覆盖用户语言 | `tests/asr-response.test.js`、原 offscreen/ASR 回归 |
| 先前 PIT 0.4.5 已有 | `src/content.js`、`src/content.css`、`src/subtitles.js`、Popup/File Lab | Philips 搜索和标题布局、导航/CTA、10 种受控字幕场景、已试译 Google 免费服务 | PR #55 既有 Chromium fixture，不等于用户 Windows L3 |

注：本报告列出的“本轮修改”只在最终 HEAD 与工作流通过后才能标为已验收；GitHub 模拟 HTTP 路径属于 L1/L2。公网短句则必须单独看网络探测日志。许可证参照仅表明可以按具体条件复用，不代表已经集成该项目完整功能。

## 3. 后续必须逐项通过的真实验收（尚未完成）

**网页：** 在 Philips Careers、真实长文章、JS SPA 和 Shadow DOM 网页，以 PIT 与沉浸式翻译并排截图比较。检查覆盖率、DOM 一致性、导航按钮可用性、字体/行距/卡片宽度、回复到原文、HTTP 429 和 5 分钟稳定性。无实际译文不算通过。

**视频：** 官方 CC → 可编辑平台字幕 DOM → 当前授予录音权限的独立 Whisper ASR。分别检查真实 YouTube / Bilibili / Netflix 登录态 / Panopto，正常播放、寻址、倍速、双说话人、断续字幕、停止时恢复、缓存复用及缓存限额。严格原位模式如果确实不支持不得暗降到外置悬浮层；不支持必须显示原因。

**图片：** Tesseract 对比真实英/法/日/韩/简中，测试图片拍摄倾斜、文字框越界、低置信度、复杂照片背景、中文字体装载、不同缩放。复杂图像的擦字填充和内容感知重绘未启用，不能宣称已实现。

**PDF：** 浏览器端先做 PDF.js 阅读及栅格双栏；需要原格式 PDF、公式、图表重排时必须调用已部署并获得健康检查的 BabelDOC/pdf2zh 单独服务，验证 100+ 页、字体嵌入、下载与作业重启可恢复。浏览器 300 页/48MB 是保护上限，**不是**对用户所有 PDF 的永久上限；不可在 UI 把栅格导出表述为“排版完整保真”。

**文件：** DOCX、PPTX、XLSX、EPUB、TXT、Markdown、HTML 的顺序、元数据、表格结构、图片/媒体无损保存，非文本公式和代码维持原样，输出可以重新打开。不能以“ZIP 可解压”替代文件语义校验。

**后台：** 真实速度/并发/持久缓存/503、429、断网与重试，订阅或免费供应商的明确可用性。前端服务中心、Popup、视频和文件工作台统一同一 `pit_settings_v1`，防止设置和显示能力分裂。

## 4. 禁止虚假完成

- **没有**将 KISS、FluentRead 或正式沉浸式翻译完整内核复制到 PIT。
- **没有**声称已部署 BabelDOC、faster-whisper、Manga 高级抹字修补云服务器。
- **没有**声称播放受 DRM 保护的真实流媒体时已完成 Windows 用户验收。
- **没有**默认调用付费 AI、绕过播放器访问控制、取得未明确允许的字幕数据。
- Release 只在 Owner L3 验收后推进；PR 保持 Draft，main/stable 均不动。
