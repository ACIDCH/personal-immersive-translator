# v0.3.x 核心功能稳定性审计与验收

日期：2026-10-16；分支：`fix/core-web-video-ocr-hardening`。

## 目标与范围

本轮聚焦**现有功能的完整性、安全性与可重复验证**。不新增未审计的视频下载器或高风险网络抓取功能，不混入个人网站、语言学习系统和 Supabase 表结构。本轮仍为开发候选版，**不宣称真实 Netflix/Panopto/YouTube 播放、BabelDOC 真实翻译或 whisper.cpp 连续模型推理已验收**。

## 核心问题与修复

| 模块 | 检出的实际问题 | 修正方式 | 自动化门槛 |
| --- | --- | --- | --- |
| 网页双语 | 只处理前 250 个段落，长文剩余内容可能永远不翻译 | 用每轮有界批处理继续消费长文章段落，不无限同步阻塞网页 | 真实 Chrome 320 段回归 |
| 动态网页/SPA | 已处理元素原文变化后，可能保留旧译文 | 记录原文快照；监听文本节点、结构与可见性变化；移除失效译文重新翻译 | 真实 Chrome SPA 与 Shadow DOM 文本变化 |
| 列表及表格 | 译文追加到 li / td 后，直接读取 textContent 会重新读入旧译文 | TreeWalker 仅提取来源文字，排除自身注入的翻译块 | 重复扫描无译文循环增生 |
| 视频文件字幕 | 播放器无可访问 video 时导入 SRT/VTT 有空引用风险 | 优先识别导入需求，明确提示缺少可访问时间轴 | 模拟播放器无 video 兼容用例 |
| 视频实时字幕 | 旧会话异步回包可写入新会话缓存，干扰状态 | 通过 generation 检查阻止过时完成修改新会话的缓存、等待与失败状态 | 现有平台 DOM、seek 与停止测试 |
| 本机高保真 PDF | 多个 BabelDOC/OCR 作业可同时占用大量内存 | 在 Python 本机桥串行化 PDF 翻译任务，后续请求遇繁忙返回 429 | PDF 服务契约及并发防护 |
| 图片 OCR | WebP 数据用 .jpg 文件名交给 Tesseract，手机 EXIF 方向未校正、压缩炸弹风险 | Pillow 解码并统一为 PNG，纠正 EXIF 旋转，限 2000 万像素 | 真实 Tesseract WebP OCR 与损坏图片拒绝 |
| 安装诊断 | 用户难以分清 PDF/图片/Whisper 缺失哪一个依赖 | 本机服务令牌验证后的只读健康检查：分别报告 BabelDOC、OCRmyPDF/Tesseract 和 Whisper 就绪情况 | FastAPI 健康接口和真实 MV3 工具页测试 |
| 浏览器兼容 | 固定 PDF.js 官方 legacy 版本要求 Chrome 125+，旧的 116 下限不准确 | Manifest 最低支持版本提升到 125 | 官方 PDF.js 兼容性说明及插件安装 CI |

## Open-source provenance

本轮没有复制新的第三方代码。仍以实际已集成的 **Mozilla PDF.js**（Apache-2.0）为 PDF 解析与预览引擎；另外通过本机服务按需调用**独立安装**的 Tesseract / OCRmyPDF、BabelDOC（AGPL-3.0）和 whisper.cpp（MIT）。KISS Translator（GPL-3.0）目前只是功能参考，**未复制 GPL 源码**。详见 `UPSTREAM_LICENSE_AUDIT_zh-CN.md`。

## 严格区分模拟测试与生产验证

- 真实 Chrome DOM 和 MV3 测试用于核验代码路径、字幕控件、批次控制和恢复逻辑；测试翻译返回为 mock，并不意味着正式翻译 API 的额度、延迟和术语精度已经达标。
- WebP OCR 验收使用 GitHub CI 的真实 Tesseract 英文模型；中文、法语、日语、韩语的 OCR 准确率必须之后单独测试。
- 本机 PDF 服务契约检查不能代替复杂学术 PDF 的真实 BabelDOC 输出与视觉排版检测。
- whisper.cpp 音频处理已验证缓存边界及 16 kHz 转换，但完整实机语音流的 30 分钟 p50/p95 延迟及 CPU 占用尚无可靠实测。
- DRM、登录授权、跨域 iframe 等边界不通过规避机制突破。

## 发布门槛

CI 四项全部成功（verify、browser-dom、extension-smoke、pdf-bridge），构建文件清单 SHA-256 验证一致后，允许生成下一份**开发测试包**并归档 YUNPAN。真实平台/模型验收、完整许可检查和最终 Codex Review 均通过后，才能进入正式发布审批。禁止提前合并到 main、声称支持全部付费平台或优于沉浸式翻译。
