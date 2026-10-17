# 多模态翻译 — KISS 与旧版沉浸式翻译内核复用评估

更新：2026-10-18。用途：第二阶段**技术与许可准入记录**，不是已完成的源码移植或性能比较。

## 1. 核实过的真实上游版本

| 备选内核 | 已核对的 Git 提交 | 许可证 | 浏览器扩展架构 | 直接取代现有 WXT？ |
| --- | --- | --- | --- | --- |
| KISS Translator（fishjar/kiss-translator） | `7a7e2957ce2084d374f802b3537f2e0ca87cd7b8`，2026-10-16 | GNU GPL-3.0 | 现行 manifest_version=3，ESM service worker，React 18、react-scripts 与多类本地 OCR/AI 依赖 | **不可直接复制即用**；需单独编译、审计全链路依赖及双端 MV3 控制逻辑 |
| Old Immersive Translate（immersive-translate/old-immersive-translate） | `6df13da22664bea2f51efe5db64c63aca59c4e79`，2023-01-16 | Mozilla Public License 2.0 | manifest_version=2，persistent background scripts、gulp 构建，面向 Chrome 70 / Firefox 63 | **不能直接作为当代 Chrome MV3 正式内核**；需要服务 Worker/权限/脚本重写 |
| 现有 PIT 原生内核（当前开发分支） | 跟随 PR #48 head | 自有项目原许可，复用第三方依赖须单独保留许可证 | Chrome MV3，React/WXT 功能弹窗 + 原生后台/正文处理 | **已经进入测试**：Chromium DOM 注入、恢复及缓存测试 |

验证路径：上述两份仓库的 GitHub API 项目、`LICENSE`、`package.json`、`public/manifest.json` / `src/manifest.json`。源地址：
- https://github.com/fishjar/kiss-translator/tree/7a7e2957ce2084d374f802b3537f2e0ca87cd7b8
- https://github.com/immersive-translate/old-immersive-translate/tree/6df13da22664bea2f51efe5db64c63aca59c4e79

不能把现在官方发布的闭源 Immersive Translate 包逆向提取并冒称开源。旧仓库 MPL-2.0 **仅能代表旧源码及对应版本**。

## 2. 实际采用策略（按用户指示，允许 KISS 真正参与）

**维持 PIT 作为暂时可用的独立基线，并准备 KISS 真正执行的 GPL 专项版本。**

- 优先制作一个**与当前 PIT 发布包隔离的 KISS GPL fork/构建变体**：保留原始许可、上游版权及源码可获得性，不将第三方 GPL 代码悄悄塞进原 MIT 发行包。
- 对 KISS 重点验证网页 DOM 规则、动态网页、字幕分流、Shadow DOM、文本块控制及服务商适配能力；确认其内容脚本和 background 是否能在我们 WXT 的宿主中按真实 API 运行。
- 可以把 KISS 作为实际内核，而不是只能“参考算法”。但在实际 build、加载、翻译及许可证核验前，不能在功能面板标记其为可选可用内核。
- 若未来把 KISS 源码**同一程序**与 PIT 组件组合分发，需要评估 GPL 对整个衍生发行作品及所用依赖的影响，履行对应源码分发义务。个人开发、公开 GitHub 仓库和向浏览器发布是不同环节，不能仅以“个人项目”为由免除再分发条款。
- 对旧版沉浸式翻译优先评估**具备独立使用价值的 MPL 源文件**和 CSS/DOM 规则，文件级保留 MPL 版权与修改通知；不采用整套已经过时的 MV2 后台作为生产架构。

## 3. 统一引擎门禁（不做空壳开关）

一个候选内核只有完成以下五个独立证据才会被放进插件的“运行内核”选择列表：

1. 源码版本固定、许可证和下游依赖通过审计；
2. 能构建为受浏览器接受的 MV3 测试产物；
3. 与测试用 HTTP 级模拟机器翻译接口真正交互，写回真实 HTML DOM；
4. 通过静态长文、动态 SPA、开放 Shadow DOM、空段落、表单/导航排除、HTTP 429 后手动恢复的统一用例；
5. 用自己的真实 API 配额或明确免费的服务在真实网页做一次质量和成本评估。不能用模拟中文前缀替代真实翻译质量实测。

记录相同页面的 **eligible/translated**、覆盖率、首次结果时间、总耗时、重复译文数、失败批次、恢复成功率和页面渲染错误。只有可比的实测结果才能决定最优默认内核，不能用 GitHub Stars 或“高分项目”推导性能胜出。

## 4. 为降低反复重装，下一阶段要做的实际工作

- 先让 PR #48 新增的 WXT 覆盖矩阵测试保持稳定；
- 另建 KISS 固定版本隔离分支，**保持上游目录和许可证原样**，通过真实 Chromium MV3 Smoke 加载，生成独立构建制品；在 GPL 可分发方案确认前不混入现有 MIT 包；
- 做统一接口适配层，保证 UI 可以显示**实测可用**的核心，而非仅根据是否存在源码显示“已可用”；
- 旧版沉浸式源码单独作为 MV2→MV3 移植可行性试验，不阻塞前两套内核；
- 分别在 Chrome、Edge 上由用户最终验证，之后再确定合并及发布路径。

当前 CI 的“86/87 段覆盖率”使用的是**真实浏览器 + 模拟 MT 回包 + 本地测试页面**，只证明引擎运行链路和覆盖计数，不等于真实网站/供应商的准确率或支持率。
