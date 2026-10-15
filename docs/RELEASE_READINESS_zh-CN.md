# 插件总验收与发布准备报告

日期：2026-10-16。目标：整体验收文件、开源来源、构建复现和现实因素覆盖。**当前不得宣布正式版通过。**

## 资源隔离与文件来源

| 资源 | 项目专属位置 | 发布用途 |
| --- | --- | --- |
| GitHub | ACIDCH/personal-immersive-translator | 完整源码、测试、Docs、CI 构建、Draft PR；主分支未合并 |
| Supabase | personal-immersive-translator, ap-southeast-2 | 预留跨设备设置同步；插件本地运行和 PDF/ASR 不依赖数据库 |
| YUNPAN | Personal-Immersive-Translator / docs、releases、backups | 可安装开发包、文档备份与后续验收数据，不存储 API Key |

不修改个人网站和语言学习系统。源代码由 GitHub 独立仓库存档。Chrome/Edge 扩展包只包含浏览器所需的 Manifest、界面、模块、已打包 PDF.js Worker、LICENSE 等。BabelDOC/whisper.cpp/OCRmyPDF/Tesseract 依赖须另行安装，不能把没有这些二进制和语言模型的浏览器 ZIP 宣称为全功能自包含安装包。

## 可靠的上游基础代码

- PDF.js（官方 npm 发行包，Apache-2.0）：**实际打包运行**。固定版本 6.4.299，复制官方 legacy 浏览器发行文件（保证较旧 Chrome 的必要 JS Polyfill），附官方 LICENSE 与元数据。网页选定 PDF 的首页由真实 PDF.js 处理，排版翻译仍委托独立 BabelDOC 引擎。
- whisper.cpp（MIT）：**可运行的外部原生语音引擎接口**，音频经用户授权的本机接口调用，下载及安装模型不属于浏览器 ZIP；性能实测尚未完成。
- Tesseract 与 OCRmyPDF：**外部系统程序**，英语 OCR 有真实 GitHub CI 测试。
- BabelDOC（AGPL-3.0）：**独立程序接口**，采用 CLI；用户必须遵守许可约束，尚未完成实际复杂 PDF 翻译渲染实测。
- KISS Translator（GPL-3.0）、PaddleOCR、Tesseract.js：目前只是技术对照或未来候选，不能宣称其底层代码已经被本插件复用。

详见 [上游来源审计](UPSTREAM_LICENSE_AUDIT_zh-CN.md)。

## 自动化验证已覆盖

- JS 核心翻译路由、AI/标准服务、语言设置、缓存隔离、字幕去重/seek、流式音频缓冲和采样率重映射。
- 真实 Chrome 网页模拟：动态页面、Shadow DOM、幻灯片、YouTube/Netflix/Panopto 可见字幕结构、跨域提示、长期字幕文件 seek。
- 真实 Chrome Manifest V3 安装：Service Worker、弹窗、选项持久化、文件工具页及 PDF.js Worker 渲染测试。
- 本机 API 桥 FastAPI/OCR：格式安全、测试权限、真实 Tesseract 英语 OCR、扫描页检测、BabelDOC 输出和临时密钥文件的契约测试（BabelDOC 本体在 CI 模拟）。
- 模拟半小时慢速 ASR 音频输入：内存边界与过期字幕丢弃。此数据不是用户设备真实性能。

## 必须等待实机或已授权环境的门槛

| 验收项目 | 未经允许不得视为通过的现实因素 |
| --- | --- |
| YouTube 全场景 | 官方字幕变化、自动字幕分句、倍速、无字幕直播、广告插入、网页 A/B、关闭字幕 |
| Netflix | 订阅账号权限、地域差异、平台布局改动、DRM 导致的捕获限制、无原生 video |
| Panopto | 大学 LMS 登录、跨域 iframe、管理员字幕下载权限、课程私人数据许可 |
| 实时 ASR | 真正的 whisper.cpp 多语种模型、Windows CPU/GPU 占用、30 分钟连续播放、停止后资源释放、p50/p95 延迟 |
| PDF 高保真 | BabelDOC 独立程序真实 CLI、语言配置、OCRmyPDF、论文双栏、表格、公式、扫描混页、图题不裁切及可读性 |
| 图片 OCR | 中文、日文、韩文、法文等实际误差，扫描质量、字号、倾斜、低对比度 |
| API 安全与费用 | 真实用户自有 Key、服务条款、额度/429、费用硬上限、脱敏与数据保留 |
| 性能优于沉浸式翻译 | 匹配模型/网络/语言/样本的独立盲评和真实延迟统计；没有证据就不能宣称优于对方 |

## 发布等级

- **开发版 / Alpha**：所有自动测试通过，但存在未完成真实平台、引擎、准确率检查，可供个人在明确风险情况下测试。
- **Release Candidate**：所有必要模块实际运行，有安装指引、可复现依赖、无隐藏高危问题，并通过各项现实兼容性矩阵。
- **正式版**：RC 由用户的实际环境验收后确认，并完成独立 Codex 安全/代码审查、版本标记、License/Source Notice、Release notes。

现在只允许达到开发版。不要将 CI 通过或 GitHub Stars 误当成完整功能或优于商业插件的证明。
