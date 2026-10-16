# KISS Translator 上游代码基础：第一轮真实可执行 PoC

启动时间：2026-10-16；隔离分支：`spike/kiss-v211-compat`；基线 PR #28。

## 复用目标与权限边界

为了避免从零重写网页双语 DOM、动态页面、视频字幕适配、翻译服务调度，优先验证成熟 GPL 项目 [fishjar/kiss-translator](https://github.com/fishjar/kiss-translator)。
固定 **v2.1.1**，对应上游 Git commit `a1279f2517bd478ef1dd93b941f9177094486cd4`，避免直接构建无固定版本的 dev 分支。
KISS 仓库有 GPL-3.0 源码许可证，能取得完整项目源码；但**我们当前独立仓库保持 MIT**，并未 Fork、拷贝或将 GPL 代码打入插件。
若最终完整 Fork KISS，就需明确作为 GPL 衍生版本遵守相关分发及源码义务，不能继续把派生整体错误标为 MIT。

## 已创建的可运行验证

- `scripts/upstream-kiss-audit.mjs`：实际读取另行检出的上游 package、LICENSE、Manifest、组件路径，对比 PIT 主体是否仍遵守最小权限，严格拒绝不匹配的版本或许可证。
- `tests/upstream-kiss-audit.test.js`：对许可证错误、版本更换、扩展权限意外扩大建立失败回归。
- `.github/workflows/kiss-upstream-spike.yml`：在无业务凭据、`contents:read` 的 GitHub runner 中**按 SHA 独立检出 GPL 项目**，先校验许可/权限，再用 pnpm 锁定依赖进行真实 Chrome MV3 webpack 构建，最后检查实际构建产物。不会上传 KISS 打包文件或将其作为我们自己的发行产品。构建仅证明上游项目可复现构建，**不证明我们的定制适配已经完成**。

## 可复用功能映射与需要更改之处

| 原 KISS 能力 | 我们的现有能力 | 推荐迁移方式 | 关键约束 |
|---|---|---|---|
| 网页双语 DOM、动态网页和规则 | `src/content.js` | 如 Fork 路线成立，优先保留上游网页翻译引擎和规则系统，仅扩展个人功能 | 明确不翻译表单、密码、隐私敏感区；不断回退到标准翻译 |
| 多服务平台、翻译路由与配额策略 | `src/lib/providers.js` + `background.js` | 对 KISS 服务配置封装一层个人适配及预算限制 | 默认标准机器翻译、AI 必须用户明确开启，不以失败为由自动转付费 |
| YouTube 可见字幕 + 源字幕处理 | `src/subtitles.js`、`platform-captions.js` | 上游字幕引擎和我们的原生 TextTrack/授权逻辑逐场景 A/B 比较 | 不越权抓私人 API、登录内容或绕过 DRM；精确绑定录制 URL |
| HTML5 音轨与本机 Whisper | `offscreen.js` + 本机 Python bridge | 保留当前明确授权的 TabCapture 与可选识别引擎为隔离模块 | 本机模型和服务令牌，停止清理/会话 UUID 校验 |
| PDF OCR & BabelDOC | `tools.js` + Python bridge | 维持已真实接入的 PDF.js/OCRmyPDF/Tesseract/BabelDOC 后端，评估与 KISS 文件工作流接口衔接 | BabelDOC 为外部 AGPL CLI，须单独处理分发义务 |
| 图片 OCR | Tesseract + Gemini 按需 | 优先接上游可复用 OCR / 版面逻辑，不重复写新识别引擎 | 不能自动上传图片到商业模型 |
| Chrome MV3 最小权限 | 当前仅 activeTab + 按需 host grant | **不能直接照搬** KISS 的 `<all_urls>` 站点默认授权和自动注入策略 | 对每个站点的授权必须经用户确认 |

## 继续开发之前的验收闸门

1. 核对上游官方分支与确切 tag / commit / GPL LICENSE / 构建结果。
2. 隔离 PoC 在相同 Chrome MV3 浏览器下比较我们的网页双语翻译与 KISS 翻译对原文保留、SPA、Shadow DOM、长页面、访问权限及内存的效果，不能用 Stars 替代真实数据。
3. 决定 `完整 GPL Fork` 或 `保留 MIT 仅集成宽松许可库`。此分歧是**产品代码许可证和长期上游维护策略**的实质性选择。
4. 迁移成功且通过人工授权、联网成本、视频字幕场景及设备测试之前，现有 v0.4.4 代码不得被覆盖。
5. 在达成真实兼容性与质量验收前，不修改主分支、不发布中间安装包、不重设计整套 UI。

## 可行性判断

KISS 为 GPL-3.0、MV3、拥有网页/视频/本地 AI/文件翻译功能的大体量 React 扩展。**不宜在当前 MIT 仓库里直接粘贴 KISS 网页翻译实现**。本次动作是实际运行“获取成熟源代码 + 固定版本验证 + 尝试真实构建”的第一步，尚未完成最终 Fork 或功能移植；后续以 CI 结果为据评估。

发行版与 dev 路径存在版本差异：此 PoC 固定发行标签，结构检查使用 **v2.1.1 实际存在** 的 `src/background.js`、`src/apis/trans.js`、`src/libs/batchQueue.js`、`src/config/api.js`，不得把 dev 的 `src/providers/background.js`、`src/config/defaultServices.js` 当作 v2.1.1 目录。
