# 多模态翻译 (Multimodal Translate) — 统一技术基线

状态：开发分支中的实际增量，**尚未发布或通过真实环境验收**。

## 一、产品身份

- 中文展示名：**多模态翻译**；英文展示名：**Multimodal Translate**。
- 当前代码仓库仍为 `ACIDCH/personal-immersive-translator`，避免立即更改 Git remote、已存在 PR 和自动化。正式重命名仓库需要另行审批。
- 插件运行在 Chrome/Edge MV3；Cloudflare Pages 网页控制台不是浏览器插件的运行替代品。
- 最小可用功能先确保网页翻译覆盖率、逐段显示、恢复、动态站点、错误统计。其余功能必须独立验收。

## 二、前端技术栈

- **浏览器界面**：WXT + React + TypeScript + Vite，原生 Chrome/Edge 扩展 API，后续迁入弹窗/设置/文件处理/字幕控制。
- **Cloudflare Pages 控制台**：React + TypeScript + Vite，分享 `apps/shared-ui/` 中的设计组件和 token。
- `apps/portal/` 仍是 Cloudflare Pages **设计预览**；`apps/wxt-ui/` 已进入**网页功能整合测试**：React 弹窗通过 Chrome MV3 API 调用打包进扩展的 PIT 原生 `pit-background.js`、`pit-native.js`，执行网页翻译、恢复和进度读取。视频、OCR、PDF 功能在 WXT 版仍未迁移；完整浏览器 CI 通过前不得声称可用。
- WXT 构建使用 `apps/wxt-ui/scripts/prepare-native.mjs` 原样复制 `src/` 的网页处理、缓存、服务适配器与设置文件；没有创建独立的第二套翻译算法。构建测试要求原生文件与输出字节相同，避免修改 UI 意外覆盖引擎。
- WXT 运行时独立使用 `pit-options.html` 作为正式设置入口，未把仅供展示的 React Dashboard 当作已工作的设置页面。
- 不把 API Key 写进 Pages 静态构建产物；云端密钥只配置为 Workers Secrets。用户自带模型的 Key 目前仅保存在用户的 `chrome.storage.local`（不是加密保险箱）。

## 三、多引擎体系

`TranslationEngine` 抽象接口：
- `capabilities(): {web:boolean,subtitle:boolean,ocr:boolean,document:boolean}`
- `translateBatch(input, context, provider): Promise<TranslationResult>`
- `healthcheck(): Promise<EngineHealth>`
- `cancel(jobId): Promise<void>`

引擎候选：
1. 现有原生 PIT：已经有可用源码、网页覆盖数据和回归测试，优先作为兼容基线。
2. KISS Translator：GPL-3.0，可实际引入**经合规打包、可追溯的 GPL fork**作为一个引擎，不能把其源码悄悄粘贴进仍声明整体 MIT 的发行包。用户此前 v0.5.0 实测不合格，须另设真实能力验收门槛。
3. 沉浸式翻译旧版开源源码（`old-immersive-translate`）：确有归档源码；先检查精确 commit 的许可证、第三方来源和现代 MV3 兼容性。**当前官方正式版闭源，不复制其发布包充当源代码**。

可以将两个引擎作为可选真实内核进行同场测试，但**许可证审核、性能基准及兼容性尚未结束**，因此本分支没有偷偷导入第三方 GPL/闭源代码。

## 四、AI 即插即用模型配置（BYOK）

第一批真正实现：
- 原有 `Gemini`、`DeepSeek` 独立适配器；
- **OpenAI-compatible Chat Completions**：适用于用户选择的 OpenAI、OpenRouter、DeepSeek 兼容接口、Groq、Qwen、GLM、Moonshot 等提供兼容协议的服务。
- **Anthropic Messages**：支持 Anthropic 原生 Messages 接口。
- 每个配置独立保存：名称、协议、HTTPS Base URL、模型 ID、API Key，最多 20 个档案；手动选择当前档案。
- 自定义 URL 需要通过域名权限授权才能由浏览器访问。服务提供商实际调用成功、速率限制和账单以该平台实际服务为准。
- API 请求仅来自扩展可信上下文；内容脚本不应获得 Key。翻译返回 JSON 数组，响应数目必须与请求分段数量相符。

**边界**：并非任意协议无需适配就能用。流式 Responses、Gemini/Anthropic 的全部多模态消息、Azure 专有头、Cloudflare Gateway 的额外认证头、本地 Ollama HTTP、图片/音频输入协议等，将通过后续 adapter 实现。不要将“支持兼容接口”宣传成“所有 AI 自动兼容”。

## 五、后端与存储

- Cloudflare Pages：产品门户/操作说明/设置预览。当前预览不进行真实模型调用，也不采集用户 API Key。
- Cloudflare Workers：统一翻译网关、合法 Provider 代理、认证与额度控制及轻任务；不在免费 Worker CPU 配额内执行大型 ASR/OCR/BabelDOC 推理。
- Supabase：原项目数据与可选同步，现阶段不迁移；Neon 暂作替代测试候选。
- Google Drive YUNPAN：项目资料、发布包、备份，避免拿它作为实时处理队列。
- 普通翻译与自选 AI 模型分开：日常优先普通机器翻译，AI 精译需用户主动开启，绝不自动回退至收费模型。

## 六、验收与下一轮

1. 本分支：项目名称、多 AI 配置档案与协议测试；WXT/Pages React 可构建性；WXT 弹窗与 PIT 原生网页翻译真实代码集成，以及 Playwright Chromium 端到端回归（外部服务使用模拟响应）。
2. 下一轮：在真实 Chrome/Edge 使用**自有合法 API 凭据**逐一测试自选模型的翻译输出；合并 PR #46 网页覆盖率修复和当前配置系统后进行真实站点验收。
3. 第二轮：评估 KISS GPL fork 和旧版沉浸式源码的许可证、性能与模拟/真机对比，明确采用哪一种方式复用，保留原始版权声明。
4. 再后：视频字幕、OCR、批量 Office/PDF 和 BabelDOC 高保真处理分别设置真实测试门槛。
5. 最后：Cloudflare Pages / Workers Git 自动部署，启用后台鉴权/成本上限，真实浏览器功能联调。

## 七、框架测试命令

```bash
# 原生翻译核心
npm run check
node --test tests/ai-profiles.test.js

# WXT 网页功能集成测试版（包含原生 PIT Web 核心）
cd apps
npm install
npm run check --workspace wxt-ui
npm run build --workspace wxt-ui

# Cloudflare Pages React 设计预览
npm run check --workspace portal
npm run build --workspace portal
```

Cloudflare Pages Git 项目未来配置：**Root directory=`apps`**，Build command=`npm run build --workspace portal`，Build output directory=`portal/dist`（均相对于 `apps`）。不能把 Root 设为 `apps/portal`，否则共享 `apps/shared-ui` 的 React 依赖无法从工作区正确安装。尚未创建项目或域名。生产版前端接口授权和 CSP 仍待复验。

Cloudflare Workers Git 项目未来配置：Root directory=`cloudflare/multimodal-api`，配置文件 `wrangler.jsonc`，Deploy command=`npx wrangler deploy`。当前仅健康检查和能力状态，没有实际 AI 代理或公网应用访问地址。

## 八、真实功能门禁与部署边界

- GitHub PR 自动化检查新增 `tests/wxt_native_web_e2e.py`：加载实际 Chrome MV3，操作 React 弹窗，在测试环境中模拟翻译提供商网络响应，验证原生后台、译文 DOM 和覆盖率/恢复操作。**模拟翻译内容不是翻译质量的实测结果**。
- 通过 GitHub Actions `multimodal-ui.yml` 的 WXT job 可获取 `multimodal-wxt-web-integration-test` 实验构建。该包与 `main` 分支旧 Alpha 严格区分。
- 仍必须在用户实际访问的网站使用已授权 API 进行网页准确率、覆盖率测试，之后才能合并/宣布成熟版本。
- Cloudflare Worker 当前提供 `/health` 和 `/v1/capabilities`，没有开放付费模型代理端点。Cloudflare Pages 仍是静态前端预览，不采集用户模型 API Key。
