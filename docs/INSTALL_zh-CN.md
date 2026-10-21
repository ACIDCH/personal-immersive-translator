# PIT 0.4.6｜Chrome / Edge 测试版安装与初次使用

> 本文适用于仓库 `ACIDCH/personal-immersive-translator` 的 Draft PR #55 测试分支。使用前以 PR 最新 HEAD 与对应 Actions 工件为准。此版本是 **Alpha 开发测试版**，不是已完成 Windows 实机验收的正式发行版。

## 一、安装准备

1. 打开 [PR #55](https://github.com/ACIDCH/personal-immersive-translator/pull/55)，选择最新的 **Validate and package extension** 成功工作流。
2. 下载其中的 **personal-immersive-translator-alpha** 工件 ZIP，解压到一个固定目录。不要把 GitHub 仓库源码 ZIP 当作已构建扩展安装。
3. Chrome 打开 `chrome://extensions`（Edge：`edge://extensions`），启用“开发者模式”，点击“加载已解压的扩展程序”，选择**实际包含 `manifest.json` 的目录**。
4. 旧 PIT 测试版及会同时翻译网页的其他扩展建议先停用，避免旧构建冲突与双重字幕。
5. 查看扩展版本及 PR Commit，打开 Popup、设置中心和文件工作台，确认界面与设置一致。

## 二、第一次使用：优先零付费网页翻译

1. Popup 中将“原文”设为**自动检测**，将“译为”设为目标语言，默认普通翻译服务为 **Google 公共免费翻译**。
2. 点击“测试当前翻译服务”，确认真实短句返回译文；`google-free` 属非官方免 Key 接口，可能限流，并会向服务端发送待翻译原文。Chrome 本机 Translator 需实际语言包且不保证所有浏览器支持；MyMemory 为限额在线备用。
3. 在允许翻译的外语网页点击“翻译当前网页”。查看分母/成功/未处理段落，再测试“恢复原文”和“继续翻译”。**没有实际译文的部分不得计入完成率**。
4. AI 翻译、Gemini、DeepSeek 及自定义模型仅在你显式选择 AI 并配置 Key 后可用，不会因普通翻译失败而自动收费。

## 三、视频字幕的两种明确模式

- **严格原位替换（默认）**：优先修改播放器已有的字幕轨或当前可见 CC 的文字，禁止浮动覆盖层；未开放字幕内容时报告限制，而非“假成功”。可先开启网站 CC，再点击“翻译视频字幕”和“检查字幕状态”。
- **兼容显示**：适用于导入本人 SRT/VTT/ASS 字幕文件，允许非原生叠加显示；用户须主动切换此模式。它不等于网站原始字幕原位替换。
- YouTube / Bilibili / Netflix / Panopto 目前仍需要用户 Windows、真实视频与授权播放环境验收。**公开原生 HTML5/WebVTT 测试通过不代表所有网站都通过**。
- Whisper ASR 为**可选独立服务**；云端或本机未部署时不得将其状态显示为已就绪。

## 四、文件、图片和高保真 PDF

点击“文件与图片”进入统一文件工作台，选择文档 OCR、批量文件、字幕文件或 PDF 工作区。DOCX/PPTX/XLSX/EPUB/TXT/Markdown 和图片 OCR 的格式覆盖由当前模块与实际解析测试决定；原有处理能力不能替代真实大文件验收。

内置 PDF.js 和 Tesseract.js 有基础预览/文字识别链路；高保真 BabelDOC 以及云端 Whisper 需要**独立可用的服务器**。没有部署时不能宣称已提供完整高保真 PDF / 实时语音翻译。扫描件、复杂排版、图片语义修补的质量需要逐份检查。

## 五、预交付验收与问题记录

遵循 [Windows 实机验收清单](PIT_V2_REAL_DEVICE_UAT_20261020.md) 逐项执行 WEB、VID、FILE、OCR、UI、MT，记录 `Commit / Chrome 版本 / 功能 / 步骤 / 预期 / 实际 / 错误 / 截图`；截图应移除私密内容和 Key。

**发布门槛：** GitHub CI 全绿是 Alpha 安装测试的必要但非充分条件。真实网页质量、主流视频字幕回填和 Windows L3 未通过前不解除 Draft，不合并 `main`，不发布 Stable。
