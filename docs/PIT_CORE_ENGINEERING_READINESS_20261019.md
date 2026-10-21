# PIT 核心工程就绪审计｜2026-10-19

**范围：** Draft PR #55 工作树；依赖链：PR #55 → PR #52 → PR #51 → PR #50。均为分层 Draft，未将本分支代码合并到 main。本报告审查工程可调用性与失败语义，**不是用户验收或沉浸式翻译产品功能等价认证**。

## 1. 开源优先复用决策（2026-10-19 公开上游与本仓构建清单核查）

| 上游 | 许可/核查材料 | PIT 实际方式 | 后续决策 |
| --- | --- | --- | --- |
| [Mozilla PDF.js](https://github.com/mozilla/pdf.js) / pdfjs-dist **6.4.299** | Apache-2.0；`package.json`、`apps/wxt-ui/package.json`、`scripts/vendor-pdfjs.mjs` | **浏览器端已集成**解析、渲染和 Worker；不另外自研 PDF 阅读器 | 保留，无需重写 |
| [Tesseract.js](https://github.com/naptha/tesseract.js) **^6.0.1** | Apache-2.0；WXT package manifest | **已实际集成** WXT 文件/图片 OCR（不同于 2026-10-16 的旧审计“未集成”） | 继续复用，复杂背景不冒充语义修复 |
| [Tesseract](https://github.com/tesseract-ocr/tesseract) + [OCRmyPDF](https://github.com/ocrmypdf/OCRmyPDF) | Apache-2.0 / MPL-2.0；`services/cloud-pdf/Dockerfile`、本机桥接 | 外部 CLI 做扫描 OCR，和 Tesseract.js 在不同运行环境承担 OCR；不是相互竞争的网页翻译引擎 | 继续 CLI/API 调用，不移植其代码 |
| [BabelDOC](https://github.com/funstory-ai/BabelDOC) **0.6.4** | AGPL-3.0；`services/requirements-babeldoc.txt` 锁版本和 bitstring<5 | 独立 Python 容器/本机 CLI，任务状态与持久 PDF 结果交给现有 FastAPI，**未嵌入浏览器 MIT 包** | 维持独立服务与原许可、验证真正复杂论文输出才开放保真宣称 |
| [whisper.cpp](https://github.com/ggml-org/whisper.cpp) | MIT；可选本地 whisper-cli/独立推理服务 | 复用原 ASR 桥接/音频 16kHz PCM16 规约；云端有独立 Workers AI Whisper 可选接口，未重新训练模型 | 保持用户手动启用语音识别；不包装模型进浏览器 |
| [WXT](https://github.com/wxt-dev/wxt) **^0.20.0** + React **^19** | 公开项目；`apps/wxt-ui/package.json` | MV3 工具链+控制面板，`scripts/prepare-native.mjs` 将现有 `src/` 翻译运行时装入同一个扩展包 | **单一内核**，不另造 React 翻译器 |
| [KISS Translator](https://github.com/fishjar/kiss-translator) | GPL-3.0 | 已做行为基线与 24 段同夹具对比；**未复制 GPL 实现** | 只参考公开 API/交互；完整 Fork 需许可证策略与架构替换批准，当前维护成本高于收益 |
| [Read Frog](https://github.com/mengxi-ream/read-frog) | GPL-3.0 与商业双授权；上游 WXT 技术栈 | 借鉴字幕、批次与 Provider 配置方式；**未移植源代码** | 保留候选；不另起并行翻译运行时 |
| [FluentRead](https://github.com/FluentRead/FluentRead) | GPL-3.0 | 参考全文、阅读卡、文件与字幕能力；**未移植源代码** | 不为视觉或“高 Star”而 Fork 后覆盖已工作的 WXT/原生核心 |

**决策：暂不 Fork KISS/Read Frog/FluentRead，不拷贝 GPL 源文件。** 本轮真正复用的上游是已经通过构建/运行路径验证的 PDF.js、Tesseract.js、OCRmyPDF/Tesseract、BabelDOC CLI、Whisper 桥接和 WXT。引用官方仓库不是声称移植；已落地与候选明确区分。受 GPL/AGPL 约束的代码/服务按原许可管理。星数不是质量证据。

## 2. 单内核与运行调用路径

1. **网页**：WXT React popup/Options → MV3 Service Worker `src/background.js` → `src/content.js`（DOM/Shadow/SPA、正文/整页选择、分片）→ `src/lib/providers.js` 的标准 MT；Chrome 内建 Translator API 通过既有 Offscreen `src/offscreen.js` 调用。AI 通过现有用户设置和 `mode='ai'` 才会启用。
2. **视频**：WXT 控制面板 → `src/subtitles.js` + `src/lib/platform-captions.js` + `src/lib/caption-core.js` → 现有同一后台文本翻译接口；用户文件字幕支持 SRT/VTT/ASS。音频只有用户主动开启时，经 `src/offscreen.js` → 独立 Whisper/Workers AI → `src/live-captions.js`，不声称隐式捕获 DRM 网站。
3. **文件**：WXT File Lab → `apps/shared-ui/` 的已有 Office/EPUB/PDF/字幕/OCR 适配 → 共享的 `translationRecovery.ts` → 原 MV3 后台 Provider；低保真 PDF.js 是浏览器回退，并非高保真 BabelDOC。
4. **复杂 PDF**：`apps/shared-ui/PdfBilingualLab.tsx` → 健康检查 → `POST /v1/pdf/jobs` → `services/cloud_pdf_api.py` → `services/babeldoc_bridge.py`/BabelDOC CLI → 任务状态和 PDF 取回；旧同步 API 保持兼容。没有装好的容器明确报未就绪。

## 3. 本轮修复的明确故障

- **网页部分请求失败**：原来单个长段落/多个段落的全部分片都返回后才插入译文，第二批失败会抛弃第一批结果并可能重复付费。现在按**完整段落**逐个提交译文，保留失败统计；每个分片经数量/非空验证，恢复后只继续未完成段落，恢复原文不遗留旧节点。
- **文件分批的失败/取消**：`translationRecovery.ts` 对 MV3 消息等待设 60 秒上限，支持 AbortSignal 主动解除等待；每次成功分片就建立任务内短期缓存。终止等待**不等于取消远端模型执行/费用**。
- **可计费 AI 自动重试**：PDF、批量文件、字幕和图片 AI 模式设置 `maxRetries=0`；常规 MT 仍在 429/503 等明确可重试错误下小幅退避。视频字幕 AI 调用出错后停止自动重试，保持醒目错误提示，用户重新启动才调用。字幕消息单次等待上限 25 秒，非远端取消。
- **字幕模型假成功**：`CaptionCache.prefetch` 不缓存空译文，允许后续可控重试；手工导入的字幕时间轴拒绝超范围的分/秒。
- **离线 SRT/VTT/ASS**：统一沿用既有内容脚本和文件实验室提供的导入/导出路径，字幕文件批量 ZIP 的译文仍是 SRT，而非原生 ASS 特效保存。
- **PDF 持久结果**：已有 `PIT_PDF_JOB_DIR` 的真实文件恢复增加 SHA-256 校验和 PDF 文件头校验，发现输出损坏拒绝 HTTP 200；单工作者 admission gate 防同步/异步任务抢占。仅**完成后、在实际持久磁盘上**才可跨服务重启恢复，运行中失败需重新提交。
- **自动网络探测成本**：已知频繁出现 HTTP 412/429 的公网 YouTube/Bilibili 探测改为 **仅 `workflow_dispatch` 显式运行**；Pull Request 常规 CI 仍保留安装版 WXT、字幕 DOM、PDF/OCR 和 Provider 合约测试。

## 4. 统一语义

| 路径 | 标识/状态 | 失败与重试 | 取消/恢复 |
|---|---|---|---|
| Web Content | `currentId` + `busySession`，`PIT_GET_PROGRESS` 有 eligible/translated/remaining/failedBatches | 标准 MT 有界自动延续；AI 需显式启动；空译文失败 | `PIT_RESTORE` 清理 DOM；已进入 Provider 的请求可能最终才结束，但过期结果不再绑定新会话 |
| TextTrack / DOM Captions | `generation` + 当前视频/录制 URL/字幕轨 | 空结果不能伪装成功；AI 错误锁定至用户重启；标准 MT 保守重试 | STOP 清理 Overlay；异步老翻译不得覆盖新媒体字幕 |
| Whisper Live Captions | `sessionId` + `epoch` + 字幕序号 | 有界音频队列、ASR 失败退避、语言概率过滤、翻译上下文只属于有效会话 | 明确用户启动/停止；中断后不假显示录音继续 |
| Browser File Job | 当前页面 AbortController + 仅任务内的字符串缓存 | 单条 4500 字符/批次 8 项，Provider 调用 60 秒上限；AI 不隐式重试 | 停止等待而不是远程交易撤销，不导出不完整的文件/ZIP |
| Cloud PDF | 随机 `jobId` + `queued/running/completed/failed` | 严格单-worker，HTTP 429/409/404/422；15 分钟 TTL，最大 100MiB PDF | 用户关闭/取消轮询不取消 BabelDOC；真实持久卷中仅**完成结果**可跨重启恢复，运行中重启恢复为 failed |

## 5. 验证与阻断（仅以 HEAD 对应 CI 结果为准）

- 运行 `npm run verify`、现有 Chromium DOM/字幕 fixture、原 Python PDF/OCR/ASR bridge、WXT/React TypeScript 构建和安装版文件实验室；原测试中仅增加与故障直接相关的断言（失败段落保留、拒绝空字幕、AI 失败不自重试、持久 PDF 数据校验）。
- 不自动再次抓取此前已证实受 HTTP 412/429 限制的公网播放器。CI green **不等于**受限平台实时字幕 L2 通过；历史公开播放器有效证据 0/2。
- 尚无实际 Cloudflare Workers AI 部署或 Whisper 真用户语音质量指标；尚无真实云算力下 BabelDOC 100+ 页扫描/学术长文质量报告；照片/漫画语义补绘及会议捕获仍非完整实用功能；跨浏览器长时间 L4 UAT 未完成。
- **发版决定：继续 Draft，不合并 main，不宣布与沉浸式翻译完整功能对等或 L3/L4 验收通过。**

*资料：仓库文件与 GitHub PR #55/#52/#51；上游主页和 LICENSE 链接见第 1 节。若未来移植 GPL/AGPL 代码，需要记录精确 commit、LICENSE/NOTICE、修改清单及分发方式。*
