# v0.3.6 多语言 OCR 实际引擎验收与 BabelDOC 安装兼容性

日期：2026-10-16。仍为开发候选分支；**本阶段不做整体 UI 重设计、不提供中间插件安装包、不合并主分支。**

## 本轮已完成

| 模块 | 实际执行内容 | 结果及严格边界 |
| --- | --- | --- |
| 简体中文图片 OCR | CI 安装官方 Tesseract `chi_sim` 语言包与 Noto CJK 字体，生成有真实像素的中文短文本并通过本机 HTTP OCR API 调用识别 | 在一份清晰合成测试样本中 CER = 0%；**不是任何真实照片上的精度保证** |
| 日语图片 OCR | CI 实际使用 `jpn` 引擎识别平面图 | 当前合成样本 CER = 0%；未测试竖排、注音、小字或混合文字 |
| 韩语图片 OCR | CI 实际使用 `kor` 引擎识别平面图 | 当前合成样本 CER = 0%；未测试低照度或印刷变形 |
| CER 评测算法 | Unicode NFKC + Levenshtein 编辑距离，计算字符错误率，识别文本仅在测试执行上下文中存在 | `benchmarks/ocr_accuracy.py`；待接入人工标注的用户许可现实样本库 |
| BabelDOC 安装诊断 | 本机调用独立 BabelDOC `--help`，解析所需 CLI 参数，检查 `--config`、`--files`、语种、输出、OpenAI 兼容 API 选项，最长 12 秒，拒绝缺参数的旧版本 | `services/babeldoc_preflight.py` 和 FastAPI `/health`；只证明安装/CLI 能力，不证明模型及完整翻译 |
| OCR/PDF 工具界面 | 本机 BabelDOC 依赖检查失败时显示具体缺少的参数；检测结果明确区分实际引擎可调用和最终真实文档成功 | 用户须主动点击“检查本机引擎”，且需要本机访问令牌 |

## 上游来源与许可证

- OCR：<https://github.com/tesseract-ocr/tesseract>（Apache-2.0）及 Noto CJK 开源字体，均为 CI 独立安装的真实运行依赖；用户正式安装时应另行下载相应官方语言包。
- PDF：<https://github.com/funstory-ai/BabelDOC>（AGPL-3.0），通过独立本地可执行程序调用；不将其源文件复制到独立 MIT 浏览器仓库。
- PDF 预览仍使用官方 Mozilla PDF.js（Apache-2.0）；语音识别仍由独立安装的 whisper.cpp（MIT）执行。

## 已通过自动化的内容和未通过的现实验收

- Node 单元测试、真实 Chrome MV3/网页及视频字幕仿真、Tesseract 多语种及 OCRmyPDF、FastAPI 桥接契约、BabelDOC CLI 预检模拟行为均需通过 CI。
- **没有**在本轮的 CI 中真正安装完整 BabelDOC 模型资产或执行真实付费翻译。因此不能宣称 BabelDOC 的版面还原质量已达标；模型资源、字库兼容、CLI 实际版本和双栏/公式/表格依然需要实机验证。
- OCR 的 0% CER 来自每种语言一份清晰合成字图，不表示已达到市场上最好的图片翻译准确率。进一步需要至少常见屏幕截图、压缩图片、双语混排、旋转照片、日语竖排及公式图片，计算各语种 CER、覆盖偏差与成功率。
- 在线视频播放器仍须以有权访问的 YouTube、Netflix、Panopto 实际页面测试，不能绕过权限或 DRM；Whisper 仍需 30 分钟有声音的真实设备基准测试。

## 待整体功能完成后再执行

统一进行：项目正式名称、控制面板信息架构、前端可视化、状态诊断 UI、配色字体与多语言内容完整性；完成全功能 UAT、依赖安全检查及 Codex 最终独立审计后，再一次性交付安装包和完整源码。
