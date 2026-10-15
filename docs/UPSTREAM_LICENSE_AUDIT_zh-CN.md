# 上游开源代码复用与许可审计

审计日期：2026-10-16。项目：ACIDCH/personal-immersive-translator。

**审计原则：GitHub Stars 只能作为成熟度线索，不能证明本产品性能或翻译准确度。必须区分真正的依赖/执行、外部独立工具、仅参考架构和从未使用的源码。**

| 项目 / 上游 | Stars 规模（2026-10 约） | 许可证 | 实际复用方式 | 结论 |
| --- | --- | --- | --- | --- |
| Mozilla PDF.js (mozilla/pdf.js, pdfjs-dist) | 5万+ | Apache-2.0 | **真正集成**。从官方 npm 固定 pdfjs-dist 6.4.299，构建时复制官方浏览器库及 Web Worker，保留上游许可证、版本来源。用于扩展内真实 PDF 渲染、数字文本读取。 | 通过构建及浏览器 smoke 才认可集成 |
| whisper.cpp (ggml-org/whisper.cpp) | 5万+ | MIT | **独立进程接入**。扩展将音频经本机 localhost 服务器发送给单独安装的 whisper-cli；插件源码和安装包本身不含引擎或模型。 | 需要用户另外安装模型、实机测速 |
| BabelDOC (funstory-ai/BabelDOC) | 约1万 | AGPL-3.0 | **独立进程接入**。本机 PDF 服务通过配置文件调用单独安装的 BabelDOC；未嵌入 AGPL 源码或打包。 | CLI、模型与复杂 PDF 还需实测，遵守 AGPL |
| Tesseract (tesseract-ocr/tesseract) | 7万+ | Apache-2.0 | **独立进程接入**。图片和扫描 PDF 可调用用户本机独立安装的 Tesseract / OCRmyPDF。英文 OCR 已在真实 CI 运行。 | 其他语言语言包与 OCR 精度未达标 |
| Tesseract.js (naptha/tesseract.js) | 约3.9万 | Apache-2.0 | **目前没有真正集成**。作为后续浏览器内无服务 OCR 选型，不得宣传为已经部署。 | 待模型大小、许可、Chrome MV3 Worker 验证 |
| PaddleOCR (PaddlePaddle/PaddleOCR) | 约9万 | Apache-2.0 | **目前没有真正集成**。仅作为后续复杂图表 OCR 候选。 | 不得声称本版本使用该引擎 |
| KISS Translator (fishjar/kiss-translator) | 约1万+ | GPL-3.0 | **仅参考功能和公开设计**；网页字幕、动态 DOM 与接入桥均为独立代码。 | 不得在 MIT 仓库直接复制 GPL 实现而不处理许可证 |
| Playwright (microsoft/playwright) | 多万 | Apache-2.0 | **实际 CI 测试工具**，运行真实 Chromium 扩展加载、模拟视频 DOM、PDF.js 渲染与字幕检查。 | 测试工具不等于翻译基础引擎 |

## 为什么不是简单 Fork 星级最多的沉浸式翻译仓库

当前 Immersive Translate 发布仓库不等于完整开源代码；不能以“高 Star”为由擅自复用不可获得或限制授权的专有部分。KISS 等 GPL 实现虽功能丰富，但把其源码复制进当前以 MIT 授权的项目会产生许可证兼容与履约问题。当前网页注入、同步、路由为独立实现，并不会被虚假描述为上游 Fork。

## 供应链与版本管理

- PDF.js 固定 npm 包版本 6.4.299，CI 仅从 npm 正式分发包读取，并一同打包 Apache-2.0 许可文件和来源元数据。Chrome MV3 不通过 CDN 加载远程执行代码。
- whisper.cpp、BabelDOC、Tesseract 未包含在 ZIP；所有本地依赖及语音/PDF 模型需要另行安装，使用固定版本并按项目 LICENSE 履约。
- 不可把第三方 API（Google Cloud Translation、DeepL、Microsoft）误称为开源服务器或永久无限免费翻译。
- Supabase、YUNPAN 均不是本机 PDF/ASR 引擎运行服务器。

## 后续上游复用标准

只有同时具备有效开源许可、长期维护、可重现版本、无需绕过网站/DRM、真实浏览器测试、足够的准确率及性能对比，才允许增加依赖。许可证冲突或上游过时应记录并提供独立替代方案。强制通过四项 CI：基础测试、浏览器播放模拟、扩展加载、OCR/PDF 服务契约；对生产账号和真实模型测试单独出具结果，不能以模拟通过代替。

上游：
- https://github.com/mozilla/pdf.js
- https://github.com/naptha/tesseract.js
- https://github.com/ggml-org/whisper.cpp
- https://github.com/funstory-ai/BabelDOC
- https://github.com/tesseract-ocr/tesseract
- https://github.com/fishjar/kiss-translator
