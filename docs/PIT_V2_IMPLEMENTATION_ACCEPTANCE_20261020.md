# PIT V2 实施与验收记录 — 2026-10-20

本轮入口：用户附件 `04_CODEX_EXECUTION_PROMPT.md`，已读取 V2 规格、契约、验收矩阵及六张原始参考图。附件作为产品要求来源；提交范围与发布限制以用户请求为准。开始时 GitHub PR #55 HEAD 为 `9ac8d34fe7103ccf1cda7b751cf6dbcd6efeb478`，保留该提交全部成果。分支继续使用 `feat/chrome-native-no-key-translation-20261018`；PR 保持 Draft、堆叠基线不变，没有合并 main 或发布 stable。

## 实施与复用

| 参考图 | 实际落地 | 主要文件 |
|---|---|---|
| 01 Popup | 语言/交换、服务与诊断深链、AI 专家、同步状态、文档/文本/悬停/选区入口，原翻译/恢复/继续流程保留 | `apps/wxt-ui/entrypoints/popup/{QuickPreferences,NativeWebControls}.tsx` |
| 02 基础设置 | 分类导航、搜索、深链、原设置保留、差量自动保存、独立界面语言 | `src/options{,-v2}.js`, `src/options.html` |
| 03 服务 | 九个内置服务及已有自定义 profiles 独立测试；显示、启用、默认分离；选中免 Key 比较 | `src/lib/provider-catalog.js`, `src/background.js` |
| 04 专家 | 七种原创策略；安装/卸载/选择/克隆/编辑/删除/JSON 导入；仅 AI 请求使用 | `src/lib/product-settings.js`, `src/lib/providers.js` |
| 05 视频 | 全局/平台开关、CC 自动启动、播放器按钮、人工轨元数据优先、对话过滤、基础断句、视频服务/语言/样式、诊断 | `src/subtitles.js`, `src/background.js` |
| 06 高级 | 段落阈值、首 N 字符/可见区调度、底部/侧栏/标题、同语种跳过、临时自动、菜单、样式顺序即时映射 | `src/content.js`, `src/lib/product-settings.js` |

WXT/React、已有 Provider adapters、MV3 Offscreen、caption-core、平台可见字幕读取、字幕 parser、PDF.js、Tesseract、Whisper/文件工具继续复用。没有引入第二翻译内核，也没有抓取或复制参考产品资产。新增依赖仅官方 `@supabase/supabase-js@2.118.0`，本地捆绑官方浏览器 UMD 与 MIT 许可证；密码学直接采用浏览器 WebCrypto，无自制加密算法。现有 PDF.js、Tesseract、Mammoth、JSZip、pdf-lib 均沿用，不重造文档/OCR 解析器。

设计采用原创蓝青色 tokens、侧栏与说明行、卡片服务目录、深浅主题、焦点样式和 reduced-motion。File Lab 继续原流程与公共 Shell。英文界面目前覆盖标题及 Popup 的快捷偏好标签，仍有中文说明与旧工作台文字，不能宣称完整英文版本。

设置仍使用 `pit_settings_v1`，schemaVersion=2 归一化。写入通过可信扩展页面 PATCH_SETTINGS 串行处理；旧密钥/Profiles 不被重置。公共网页偏好消息不包含密钥或专家 Prompt。任务快照保存在可信 `storage.session`，上限 50 项/1 小时；新默认用于新任务，显式禁用和站点黑名单立即生效。

## 免费服务与独立测试

- **MyMemory：真实 L2**。通过现有生产 adapter，对公开英文样句做一次匿名 HTTP 请求，`en|zh-CN`，45 字符，返回有效中文；本地记录 2,091 ms。CI run `39337690896` 的独立记录为 `LIVE_TRANSLATION_RETURNED`、883 ms。没有 Key、没有拦截。此结果不是持续可用性保证。
- **Chrome Translator：真实推理仍 BLOCKED-EXTERNAL**。保留并复用生产 Offscreen 的语言对检查、主动下载与实际试译按钮。CI 中接口/诊断可运行，不代表模型已下载或实际推理成功；未以 `typeof Translator` 代替验收。本机测试 Chromium 启动受 Windows side-by-side 环境错误阻断，未接管用户日常浏览器安装模型。
- 独立按钮以固定公开样句调用指定 `providerId/profileId` 的现有 adapter，绕过缓存，不改默认。九个内置按钮都在安装版测试中触发；Microsoft/MyMemory 网络为明确的 fixture，其他未配置服务应返回 `not-configured`，本地模型返回实际诊断。自定义 profile 协议由已有 AI adapter 合约测试覆盖，未冒称逐个用户模型已实付验证。
- Microsoft、Google、DeepL、Gemini、DeepSeek 与自托管服务均不标“免 Key”。缺凭据先返回，不发 HTTP；可能计费的测试要求逐次确认。真实收费凭据未提供，因此 401/403/429/超时等属于受控契约验证，非真实账号验证。
- MyMemory 有每日字符预算、错误分类、显式选用；服务卡一分钟测试冷却，不自动切换收费服务。批量比较只测试用户勾选的免 Key 项。
- 覆盖顺序：域名规则 > 视频平台服务 > 视频专用服务 > 全局；文件专用 > 全局。AI 仍只由明确用户动作调用。

## 视频运行时边界

| 控件 | 实际行为与边界 |
|---|---|
| 全局/平台启用 | 停止 overlay 与会话；全局禁用优先 |
| 自动启动 | 只在 TextTrack/已显示 CC 可读时启动；晚到 CC 用现有观察机制发现，不替用户启用站点 CC |
| 播放器按钮 | 单实例，显示/停止真实会话，全屏时跟随挂载点 |
| YouTube PIT 翻译 | 关闭后保留平台 CC，PIT 不请求字幕翻译 |
| 基础断句 | 按标点调整译文换行，原 cue 时间戳不变 |
| AI 分句 Beta | **NOT-DONE**：无专用可验收实现，控件禁用并解释，不收费 |
| 人工字幕优先 | 仅比较发布方明确提供的人/自动元数据；不能可靠识别的来源显示未知，不猜测 |
| 对话过滤 | 可选过滤明确音效标注；关闭时保留，原生 CC 不变 |
| 服务/语言 | 复用统一 adapter；手动源语 > 视频设置 > TextTrack 语言；无可靠来源不猜英文 |
| 样式/顺序 | 实时映射字号、颜色、背景、顶部/底部及双语顺序；修复旧 !important 样式压过设置的问题 |
| seek/视频切换 | 继续使用 generation 防止旧响应覆盖；录像 URL/媒体变更停止 |
| 导入/ASR | 复用 SRT/VTT/ASS parser 与用户主动 ASR；无部署不声称识别成功 |
| 会议平台 | **NOT-DONE / BLOCKED-EXTERNAL**：不宣布 Teams/Zoom/Meet 可用，自动会议模式禁用 |

YouTube/Bilibili/Netflix/Panopto 的受控 DOM fixture 只证明可读字幕到 overlay 的接线；登录、版权限制、网站变动与真正的视频内容均不能由 fixture 代替。

## PIT 专用 Supabase

仅操作 `ligamejpnracymxfbbff`（`personal-immersive-translator`，ap-southeast-2）。没有修改 language-learning-hub。迁移：`supabase/migrations/20261019123938_pit_v2_sync.sql`，已经应用到 PIT 项目。

`pit_user_preferences` 和 `pit_user_vault` 启用 RLS，authenticated 的 USING/WITH CHECK 均限定 auth.uid()；anon 无权访问。真实数据库事务验证了偏好表本人写入、跨账号拒绝及 revision CAS，并独立验证密文表跨账号读/插入/更新均被拒绝，事务回滚，未保留测试账号/偏好。安全 advisor 返回空 lints。此为真实数据库验证，不是完整 OAuth 端到端验收。

密钥/Cloud Tokens/完整 AI Profiles/专家内容使用 AES-256-GCM，PBKDF2-SHA256 600,000 次，随机 salt16 与 nonce12；AAD 绑定账号与版本。密码和解密 key 不上传。解锁会话 key 仅留 `storage.session`。普通偏好白名单与密文表分开；站点规则、术语、保险库分别 opt-in。文件、视频、音频原始内容不在同步模型中。

离线保留本地设置并排队重试；CAS 冲突要求选择本地/云端，不静默覆盖。远端保险库变更会锁定且要求重新解锁。密码错误不覆盖本地；提供加密备份导出/恢复。锁定的是云保险库，本机已有 Key 仍可用；新设备无 Key 时服务卡提示配置/解锁。退出/暂停/删除云副本均保留本机设置，删除云副本暂停同步。

两套真实 Chromium 扩展 profile + 受控 Supabase REST/Auth fixture 已验证跨设备偏好、冲突、错误密码、多 Key 恢复、离线保留和网络无明文。**等级 L1，不能称为两台真实用户设备上线成功。** 实际 PIT Auth settings 显示 Google provider 未开启，因此真实登录和真实双设备恢复为 BLOCKED-EXTERNAL。

最少外部配置：
1. 在 PIT 项目的 Auth / Google 中配置自己的 Google OAuth client ID/secret；Google callback 使用该 Supabase 项目的 `/auth/v1/callback`。
2. 将 Options「账号与同步」显示的 `https://<extension-id>.chromiumapp.org/supabase` 加入 Supabase Redirect URLs；两设备应使用同一固定扩展 ID，若不同则分别加入。
3. 两设备安装 Draft 工件，用同一 Google 账号登录；开启所需同步类别。旧设备创建保险库，新设备一次输入同一密码恢复。保留加密备份；密码无后台强制找回。
4. Chrome 本地模型需在支持的 Chrome/设备/语言对中主动安装并运行「实际试译」。收费服务、私有视频、ASR/PDF 云服务按现有配置输入自己的合法凭据/部署地址。

## 验收矩阵

等级：L0=代码/编译/单元，L1=安装 Chromium + 受控网络，L2=真实远端免 Key 翻译；BLOCKED 为外部条件；NOT-DONE 不算完成。未逐项做浏览器场景的控件保守标 L0。

| ID | 最终等级 | 证据或限制 |
|---|---|---|
| A01 | DONE-L0 | Popup PATCH 语言，auto 禁止交换；编译通过 |
| A02 | DONE-L0 | 任务快照与新任务切换单元回归；禁用优先 |
| A03 | DONE-L0 | services/provider 深链与卡片定位 |
| A04 | DONE-L1 | 现有显式 AI 授权路径；MT 不使用专家 |
| A05 | DONE-L1 | 安装版网页翻译、状态、恢复；网络为 fixture |
| A06 | DONE-L0 | 四入口接实际工具/开关/选区消息；文本复用内核 |
| A07 | DONE-L1 | 分类路由参与安装版测试；搜索与 hash 实现 |
| A08 | DONE-L0 | 说明行、label、ARIA、焦点；125/150% 未单独验收 |
| A09 | DONE-L0 | tokens、主题媒体查询、reduced-motion；不等于全视觉验收 |
| A10 | DONE-L0 | 迁移保留 Keys/Profiles 单元测试 |
| A11 | DONE-L1 | WXT prepare 打包 src 共享内核与官方 SDK |
| B01 | DONE-L1 | 九类卡片元数据/真实性质标签 |
| B02 | DONE-L0 | 独立偏好；运行时禁用校验 |
| B03 | DONE-L1 | 九个按钮真实点击，指定 adapter；自定义协议 L0 |
| B04 | DONE-L1 | 所有按钮后默认仍 Microsoft 的断言 |
| B05 | BLOCKED-EXTERNAL | 无已装模型的真实推理证据 |
| B06 | DONE-L1 | 生产 Offscreen 检查与主动下载入口；设备下载待实测 |
| B07 | DONE-L2 | 实际 MyMemory 45 字符返回有效中文 |
| B08 | DONE-L0 | 配额/HTTP/无效响应分类与冷却测试 |
| B09 | DONE-L1 | 未配置卡片不请求 HTTP，显示解锁/凭据路径 |
| B10 | DONE-L0 | 既有 provider 错误合约；真实错误 Key 未实测 |
| B11 | BLOCKED-EXTERNAL | 确认门禁已实现，无用户收费模型实测 |
| B12 | DONE-L0 | 仅选中免 Key 项顺序测试；收费项不批量调用 |
| B13 | DONE-L0 | profile 目录动态生成、保存后重绘、现有 adapter 测试 |
| B14 | DONE-L0 | 无未授权消费者接口；不编造新免费通道 |
| B15 | DONE-L0 | 统一内核按站点/视频/文件覆盖；实站服务未逐项验证 |
| C01 | DONE-L0 | 原创专家与 AI prompt/cache identity 接线 |
| C02 | DONE-L0 | 自定义/克隆/编辑/JSON 导入，版本/长度/空值校验 |
| C03 | DONE-L0 | 常规 MT 禁用专家选择，不构造 AI Prompt |
| C04 | DONE-L0（部分） | UI 语言独立保存生效；完整英文翻译 NOT-DONE |
| C05 | DONE-L1 | 安装版真实 DOM 字号与即时样式检查；共享映射 |
| C06 | DONE-L1 | 原文 DOM 保留、顺序实时切换与恢复断言 |
| C07 | DONE-L0 | 站点规则最长后缀优先、编辑/删除，黑名单优先 |
| C08 | DONE-L0 | 值域/阈值/首 N+可见区过滤，保留 provider 预算 |
| C09 | DONE-L0 | 底部/侧栏/标题/同语种路径已消费，组合未逐个实测 |
| C10 | DONE-L0 | loading/换行实际映射，遵守 reduced-motion |
| C11 | DONE-L0 | 域名 TTL 检查；过期不再自动启动 |
| C12 | DONE-L1 | 既有 DOM 交互回归；新增菜单开关 L0 |
| C13 | DONE-L0 | 仅明确源语/lang 同语种跳过；可靠检测沿用原实现 |
| D01 | DONE-L0 | 全局关闭 stop()，平台禁用覆盖 |
| D02 | DONE-L0 | 可读字幕后自动启动与平台覆盖 |
| D03 | DONE-L0 | 单按钮/播放器定位/全屏挂载；真实播放器待验 |
| D04 | DONE-L0 | 观察晚到 CC，缺失不宣称 ready |
| D05 | DONE-L1 | 既有 YouTube 可见字幕 fixture → adapter → overlay |
| D06 | DONE-L0 | 展示断句，时间戳不变 |
| D07 | NOT-DONE | AI 分句控件禁用并说明 |
| D08 | DONE-L0 | 仅明确轨道元数据；未知不猜 |
| D09 | DONE-L0 | 显式音效过滤 opt-in，原 CC 保留 |
| D10 | DONE-L0 | 视频专用服务/平台覆盖复用统一内核 |
| D11 | DONE-L0 | 手动/配置/轨道语言与样式映射；新增样式待实站验收 |
| D12 | DONE-L1 | 原有 seek/切换/generation 受控回归 |
| D13 | DONE-L1 | 既有字幕 parser、导入/双语导出链路 |
| D14 | BLOCKED-EXTERNAL | 复用显式 ASR，云端部署与真实识别不冒称通过 |
| D15 | NOT-DONE | 会议自动模式禁用，无真实登录平台验收 |
| D16 | DONE-L0 | 从页面视频/轨道/会话读状态；实际 provider 可能显示 inherit |
| E01 | DONE-L2（数据库） | PIT 专用项目实际迁移；未动学习系统 |
| E02 | BLOCKED-EXTERNAL | Google provider 未开启；PKCE/回跳代码就绪 |
| E03 | DONE-L0 | 本地优先，迁移保留凭据 |
| E04 | DONE-L1 | 两 Chrome profile + fixture；真实账号 BLOCKED |
| E05 | DONE-L1 | WebCrypto 及网络密文检查；非服务端代加密 |
| E06 | DONE-L1 | 新 profile 一次密码恢复多个 Key；真实账号 BLOCKED |
| E07 | DONE-L1 | 错误密码不覆盖；备份恢复实现 L0 |
| E08 | DONE-L1 | CAS 冲突测试与显式版本选择 |
| E09 | DONE-L1 | 断网保留本地并排队 |
| E10 | DONE-L2（数据库） | 实际 RLS 拒绝跨账户、事务回滚；密文表亦实际验证跨账号读/插入/更新被拒绝 |
| E11 | DONE-L0 | 退出/暂停/删除路径保留本机数据 |
| E12 | DONE-L0 | 白名单数据分类，无文档/音视频内容 |
| E13 | DONE-L0 | 本机已有 Key 可用；新设备缺 Key 提示解锁，无伪就绪 |
| F01 | DONE-L1 | WXT MV3 构建及实际安装到 Chromium |
| F02 | DONE-L1 | 实际打开 pit-options.html 与分类导航 |
| F03 | DONE-L1 | 根回归 104/104；文件/视频/PDF/OCR/字幕完整现有安装版回归通过 |
| F04 | DONE-L0 | Key/模型/服务/字幕/网络独立错误；不承诺浏览器区分所有 CORS 原因 |
| F05 | DONE-L0 | 本报告明确区分 fixture、外部服务与未完成 |
| F06 | DONE-L0 | 现有 Draft #55，无 main/stable 操作 |
| F07 | DONE-L0 | 本报告、迁移、测试、工件链接与剩余配置 |

## 构建与证据

功能逻辑验收基线 HEAD：`3d94835`（上一功能提交 `ce42798509f10fa808a224c5667801a29194f0bc`）。报告与 Popup 浅色对比度修正随附提交；最终完整 HEAD、最新检查与工件由 PR #55 的 Checks/提交记录提供。

- 本地 `npm run verify`：104/104；WXT TypeScript 通过。
- [根回归与扩展打包](https://github.com/ACIDCH/personal-immersive-translator/actions/runs/39367700182)
- [WXT 安装版 / 同步 fixture / 文件视频回归与工件](https://github.com/ACIDCH/personal-immersive-translator/actions/runs/39367700176)
- [真实免 Key 证据](https://github.com/ACIDCH/personal-immersive-translator/actions/runs/39337690896)：`real-keyless-mt-provider-verdict`，已读取 JSON 的实际 verdict，而非只看绿色 workflow。

上述基线 CI 全部通过，包括 verify、browser-dom、extension-smoke、pdf-bridge、WXT/portal 构建、custom-ai、真实 OCR、安装版 WXT 全流程。已读取实际 JSON 报告：网页 86/86，动态后 87/87；429 可见且无隐式 fallback；DOCX/PPTX/XLSX/批量 ZIP/13 页 PDF/字幕导入及取消恢复均通过；TextTrack、图片 PNG、数字/扫描 PDF、七类平台/导入字幕 fixture 通过。Options/Popup 截图已人工查看；浅色文字对比不足已随附修正。

安装工件：[multimodal-wxt-web-integration-test](https://github.com/ACIDCH/personal-immersive-translator/actions/runs/39367700176/artifacts/12239993072)，解压后在 Chrome 开发者模式加载包含 manifest.json 的目录。截图和机器报告：[multimodal-web-coverage-matrix](https://github.com/ACIDCH/personal-immersive-translator/actions/runs/39367700176/artifacts/12240340907)。工件保留期 7 天；这些是 Draft 测试工件，没有 stable 发布。

此前失败的新增样式验收暴露旧 CSS !important 覆盖设置，已修复；没有删掉断言掩盖问题。Windows 测试 Chromium 无法启动时转用 Linux CI 实际安装，不称本机 Chrome 通过。
