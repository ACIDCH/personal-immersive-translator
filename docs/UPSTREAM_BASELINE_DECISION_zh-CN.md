# 上游成熟项目复用基线审计与 Fork 选型门槛

审计日：2026-10-16；工作分支基线：`fix/native-caption-track-rebinding-v044`（v0.4.4，commit `01587cee`）。
用途：功能继续扩建前的**客观代码血缘检查**。不触发 API 调用、不变更浏览器运行时、不自动合并 PR。

## 1. 核心结论（请勿省略）

**本扩展并非以某个高 Star 翻译浏览器插件为 Fork 基础。** GitHub API 中 `ACIDCH/personal-immersive-translator` 的 `fork=false`；现有主要浏览器代码 `src/content.js`、`src/subtitles.js`、`src/lib/platform-captions.js`、`src/lib/frame-route.js`、`src/lib/providers.js` 是本项目自身实现。不能称其“基于 KISS / Read Frog / Immersive Translate 源码修改”。

与此同时，**底层能力并非全部从零实现**：PDF 渲染、语音识别、OCR、复杂 PDF 翻译以及浏览器测试使用了成熟开源项目。要区分 ①真正打包依赖；②可选本机独立引擎；③仅设计参考；④待集成候选。

## 2. 实际依赖（按代码和构建文件核查）

| 能力 | 真实上游 | 实际接入方式与证据 | 是否是当前浏览器翻译主框架 |
|---|---|---|---|
| PDF 解析/预览 | [Mozilla PDF.js](https://github.com/mozilla/pdf.js)，Apache-2.0 | `package.json` 将 `pdfjs-dist` 固定为 6.4.299；`scripts/vendor-pdfjs.mjs` 复制原版模块、Worker、许可证和来源标记；实际扩展加载测试 | 否，仅 PDF 组件 |
| 可选本机 ASR | [whisper.cpp](https://github.com/ggml-org/whisper.cpp)，MIT | `services/babeldoc_bridge.py` 调用另装的 whisper-cli / 可选 server；没有内嵌模型或二进制 | 否，外部可选服务 |
| 可选另一 ASR 后端 | [faster-whisper](https://github.com/SYSTRAN/faster-whisper)，MIT | `services/requirements-faster-whisper.txt` 声明 pip 依赖；`services/faster_whisper_backend.py` 实际导入 WhisperModel | 否，单独 Python 后端 |
| 扫描件与图片识别 | [Tesseract](https://github.com/tesseract-ocr/tesseract)，Apache-2.0 + [OCRmyPDF](https://github.com/ocrmypdf/OCRmyPDF)，MPL-2.0 | 在 Python 桥中通过 `subprocess` 调用本机 `tesseract`、`ocrmypdf`；非扩展内置 | 否，外部可选引擎 |
| PDF 版式重建 | [BabelDOC](https://github.com/funstory-ai/BabelDOC)，AGPL-3.0 | `services/babeldoc_bridge.py` 通过外部 CLI 执行，非直接移植或打包 AGPL 源码 | 否，独立安装/许可需复核 |
| 浏览器端测试 | [Playwright](https://github.com/microsoft/playwright)，Apache-2.0 | Actions + `tests/*.py` 调用真实 Chrome/Chromium 的模拟网页、插件运行环境 | 否，开发验证工具 |

**不能算作已集成**：KISS Translator、Read Frog、FluentRead、Linguist、PaddleOCR、Tesseract.js。既有关于这些项目的设计引用不等于运行源码来源。Google / Microsoft / DeepL 等服务接入属于自写官方 API adapter，不是开源核心引擎移植。

## 3. 高 Star 主体候选（GitHub REST API 现场读取）

Stars 和维护状态仅为 **2026-10-16 的快照**，并非使用量、漏洞安全或运行兼容性证明。

| 候选 | Stars（快照） | 许可证验证 | 是否适合作为完整扩展代码基础 |
|---|---:|---|---|
| [KISS Translator](https://github.com/fishjar/kiss-translator) | 12,879 | GPL-3.0；公开源文件、React/JS、Chrome/Edge 构建及多个翻译服务 | **优先评估 Fork**，但 Fork/改动的分发与源码许可必须遵守 GPL，不可作为 MIT 代码直接拷贝 |
| [Read Frog](https://github.com/mengxi-ream/read-frog) | 10,087 | GPL-3.0 + 另行商业授权；需确认具体版本授权 | **备选完整 Fork**，需评估功能范围和额外成本 |
| [FluentRead](https://github.com/FluentRead/FluentRead) | 8,482 | GPL-3.0 | **备选 Fork**，同样涉及许可证变更与架构迁移 |
| [Linguist](https://github.com/translate-tools/linguist) | 1,075 | 仓库顶层 LICENSE 是 BSD-3-Clause，但同仓当前 `package.json` 的 license 值为 GPL-3.0，标记不一致 | **暂缓移植**；先确定目标版本和具体文件许可证，不能直接当作 BSD 代码复制 |
| [domtranslator](https://github.com/translate-tools/domtranslator) | 16 | Apache-2.0（仓库 LICENSE、package.json 一致）；Linguist 的实际 DOM 翻译依赖 | **小型可复用组件候选**；成熟度不能用高星主项目的 stars 代替 |
| [Immersive Translate](https://github.com/immersive-translate/immersive-translate) | 19,339 | 其仓库明示正式翻译插件**不开源，不含完整源码** | **不可作为可 Fork 的完整产品源码** |

另外：PDF.js ~54,009★、whisper.cpp ~54,429★、faster-whisper ~25,887★、Tesseract ~77,023★、OCRmyPDF ~35,045★、BabelDOC ~9,718★ 均为成熟功能引擎，而不是浏览器沉浸式翻译完整架构。

## 4. 调整下一阶段开发方法

从现在开始坚持 **上游优先 + 差异化开发**，禁止把成熟能力再从零实现后声称“开源复用”。对每一个拟新增功能建立：

1. 上游项目、精确 tag/commit、对应文件、许可证/NOTICE、维护状态、可复现构建与 Chrome MV3 兼容性。
2. 已有可用实现与我们现有函数的功能映射：优先用稳定公共 API 接口，不为复制 UI 而复制整仓库。
3. 在隔离分支做小规模 PoC，不泄露登录视频、API Key 或私有字幕。不绕过 DRM、访问控制。
4. 用统一场景比较**原版本、开源候选、适配 PoC**：SPA、Shadow DOM、网页混合结构、双语原文保留、SRT/VTT、浏览器权限、字幕/ASR 延迟、请求次数、内存与停止清理。
5. 只有真正减少维护/代码量、保持标准翻译优先、收费 AI 需明确确认、完成源代码授权与回归验证，才允许替换目前实现。
6. 所有复制或修改过的上游代码应保留源码出处、版本、变更清单、版权与许可文本；外部服务需审查 AGPL/MPL 等使用和分发义务。

### 提议的双轨技术验证（尚未开始）

**轨道 A / 可完整 Fork：** 单独克隆 KISS Translator 固定 commit，不触碰现有仓库的 `main`；验证实际 Chrome MV3 构建和标准服务、AI 用户确认，评估迁移我们已有 PDF/ASR/OCR/嵌入字幕功能的改造量。若分发衍生作品，要依 GPL-3.0 履行相应义务，不继续把整个 Fork 误标成 MIT。

**轨道 B / 保留 MIT：** 继续保留当前架构，仅引入已明确允许、真正有适配收益的 Apache/MIT/BSD 等依赖（如 PDF.js 方式，或评估 Apache-2.0 的 domtranslator），补齐开源出处记录与真实对比。此方案**不等于**“全项目基于高 Star 浏览器扩展 Fork”。

在两轨 PoC 的许可证、构建、性能及维护成本报告出现之前，**不宣布完成“基于高 Star 完整翻译扩展重构”**，不立即替换已验证的稳定功能。

## 5. 当前验收结论

- **底层复用：真实、有据可查。**
- **完整高星浏览器扩展 Fork：未采用，不符合该条件。**
- **核心网页/字幕逻辑：主要是自主实现，已有模拟 Chrome CI，但真实网站适配性仍需验收。**
- **下一步：先完成 Fork/组件 PoC 的真实成本与许可评估，再决定是否迁移架构；不启动全面 UI 重设计或合并 main。**

此审计为工程事实核验，不构成法律意见。应按实际分发方式逐项审阅许可证、依赖、模型权利与第三方服务条款。

## 2026-10-16 权限偏好更新

所有者说明该浏览器插件为**个人使用**，愿意在 Chrome/Edge 中授予全站访问权限。因而后续优先沿用成熟 Fork 的网站注入与权限模型，**不将 `<all_urls>` 或广泛主机授权作为否决条件**；无需为了降低逐站点提示次数而重复造轮子。当前版本 Manifest 未变，后续迁移应让用户通过浏览器原生权限提示或设置明确授权。权限与实际数据外传分离：继续确保 API 密钥不会泄露、不隐式开启商业 AI 请求、不绕过网站登录/DRM，也不违反 GPL 等授权条件。
