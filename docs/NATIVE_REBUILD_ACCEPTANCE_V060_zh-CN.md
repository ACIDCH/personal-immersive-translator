# 原生 PIT 重建计划与当前验收事实 — 2026-10-17

关联 P0：[#45](https://github.com/ACIDCH/personal-immersive-translator/issues/45)。

## 公开结论

**PIT v0.5.0（KISS 组合外壳）经实际用户使用验收失败，停止作为可用版本展示/发包。**
不应将先前的 CI 虚拟视频字幕、模拟 HTTP Provider、PDF.js 首页预览和 Manifest/弹窗 UI 加载等同于 YouTube / Bilibili 等真实环境中的准确翻译、真实 OCR / BabelDOC 文档处理。

## 源码级原因（查证过的，不是用户环境推测）

1. 组合包 `src/kiss/home.js` 的网页按钮把 `toggle_translate` 传给 KISS 内容脚本，网页核心实际还是 KISS，而不是自有处理管线。主界面设计不改变这一点。
2. 原生 `src/content.js` 才有自有 DOM/ShadowRoot/SPA 翻译逻辑，但默认标准翻译单次限额是 **600 段**，AI 最多 30 段；页面可能超过预算，旧控制台只报告指令已发送，实际完成率不可见。
3. `src/tools.html` 只有 PNG/JPEG/WebP 与 PDF 两类文件的输入，`BabelDOC` 是本机另装服务，OCRmyPDF / Tesseract 依赖同样独立安装。浏览器 ZIP 没有提供即装即用的完整 OCR/排版翻译。
4. `src/lib/platform-captions.js` 自有字幕可见节点规则实际只有 YouTube/Netflix/Panopto，尚未为 Bilibili/Miss AV 建成实测的独立适配器；没有字幕轨时的本机 Whisper 音频需要另装模型。
5. `src/lib/settings.js` 默认常规 Microsoft MT、独立 AI Gemini/DeepSeek；翻译质量不等于接口连通。视频字幕缺乏跨行上下文、术语一致性、屏幕同步等真实验收基准。

## 新路线

- 本分支 `rebuild/pit-native-core-v060` **基于最后一个完整原生 PIT v0.4.4 的 `spike/kiss-v211-compat` 代码**；不继承组合包的 KISS 后台和独立外壳。该基线和当前远端 `main`（仍是较早的 0.1.0）不同，所以 Draft PR 以原生 v0.4.4 分支为 base。
- 首个可验证修复是让 `src/content.js` 提供 `PIT_GET_PROGRESS`：DOM 实测 eligible / translated / remaining / coveragePercent / succeededBatches / failedBatches / lastError；原生弹窗周期读取，不再把后台操作成功当作全文成功；通过 320 段+SPA 和 615 段限额测试证明度量正确。
- 之后严格按功能先后推进：① 原生网页翻译的覆盖、滚动加载、失败重试/可选择优质服务；② 原生在线视频捕获与高质量字幕输出（基于合法字幕轨+可选 Whisper ASR/上下文 AI）；③ 多文件解析（从 txt/md/html/docx/epub/图片/ PDF 开始，再逐步 pptx/xlsx），实际 OCR 与 BabelDOC 布局比对；④ 最后统一设置、前端品牌与多平台诊断。
- 提供真实翻译 API 的次数、成功率、句子品质与计费状态；AI 高精度不能默默消耗付费 API，未验证的功能不提供“已就绪”假象。
- 任何“全部功能可用”的包必须经过真人授权场景+真实处理文件验证；CI 模拟不自动成为通过。

## 当前实现状态

截至本文件创建，**只实现了网页翻译覆盖度可观测性和长文章回归断言**。不存在已经修好视频翻译、已经适配 Bilibili 或已经多格式识别排版的声明。

## 下一阶段用户验收输入

选择有权限公开测试的 YouTube/Bilibili 视频与普通网页，提供失败/完成率摘要，不要求提供视频内容、账号或 Cookie；图像/PDF/Office 使用没有私人信息的合成或公开样本。
