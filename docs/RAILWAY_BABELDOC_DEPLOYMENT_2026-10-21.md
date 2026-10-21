# PIT · Railway Cloud BabelDOC 预部署交接 (2026-10-21)

**状态：代码已准备、Railway 未实际部署。** 已安装 Railway 插件不等于本会话已获得可调用的项目/部署管理接口，也不等于任何云端模型在线。禁止把部署计划当成在线服务地址。

## 1. 已实现的生产接口

- 源码：`services/cloud_pdf_api.py`；构建：`services/cloud-pdf/Dockerfile`；基础服务 `uvicorn services.cloud_pdf_api:app`。
- Railway 基础设施计划：`.railway/railway.ts`。使用独立服务 `pit-babeldoc-preview`，仅 1 副本，从 PIT 的 **Draft 开发分支**构建。当前配置**没有创建持久卷**，异步作业重启后不会恢复。
- `GET /livez`：只证明 FastAPI 进程运行，返回 `{\"status\":\"alive\"}`；供 Railway 的无授权启动健康检查使用。**不证明** BabelDOC 或真实翻译供应商可用。
- `GET /health`：必须携带 `Authorization: Bearer ...`，返回当前 BabelDOC CLI、翻译模型和服务功能状态。未通过此检查禁止在 PIT UI 显示“高保真 PDF 已就绪”。
- `POST /v1/pdf/jobs`、`GET /v1/pdf/jobs/{jobId}`、`GET /v1/pdf/jobs/{jobId}/result`：实际异步翻译；高保真模型是否成功由独立真实作业及输出验收决定。
- Cloud API 最大输入 25MiB/300 页，任务单实例串行；云端 PDF 的 OCR/BabelDOC 和自有翻译 API 消耗**不是**无限免费的。

## 2. 部署步骤 (Railway 提供项目操作接口后执行)

1. 在 Railway 中建立新的测试 Project `pit-translation-services`（不要绑定或更改个人网站/学习系统服务），连接 GitHub 仓库 `ACIDCH/personal-immersive-translator` 和分支 `feat/chrome-native-no-key-translation-20261018`。
2. 采用最新 **Infrastructure as Code** `.railway/railway.ts`；旧 `railway.json` Config as Code 已被 Railway 弃用，2026 年新项目不再推荐。先 `railway config plan` 检查资源、权限及预计成本，明确确认后再 apply。
3. Docker build context **必须为仓库根目录**，Dockerfile 选择 `services/cloud-pdf/Dockerfile`。代码在文件内 `COPY services services`，把 rootDirectory 改为 `services/cloud-pdf` 将导致构建失败。
4. Railway Service Variables 中独立配置高熵随机 `PIT_CLOUD_PDF_TOKEN`（至少 16 字符），并按实际服务配置 `PIT_PDF_API_KEY`、`PIT_PDF_MODEL` 与 `PIT_PDF_BASE_URL`；**不要写进 GitHub、PR 评论或任何聊天交接文档**。IaC `preserve()` 仅保留 Railway 已配置的值，不会自动创建或猜测密钥。
5. Railway Service 启动端口使用自动注入的 `PORT`，`/livez` 为启动检查。真正提供用户访问需启用 HTTPS Public Domain，取回实际域名并经用户确认；目前 **没有域名可填写**。
6. 若要保留已完成 PDF 作业，在单一副本下附加真正的持久 Volume，配置 `PIT_PDF_JOB_DIR` 指向已挂载且可写的路径。Railway 默认以 root 挂载 Volume，但当前 PDF 容器以 UID 10001 运行；必须先处理 Volume 实际写入权限并进行实机重启恢复测试。不要只填写存储路径就宣称数据持久化。
7. 执行三层验收：
   - 未授权 `/health` 返回 401，`/livez` 200（只证明启动）。
   - 带 Bearer 的 `/health` 返回 `ready:true`，且报告真实兼容的 BabelDOC CLI 和凭据。
   - 提交合法真实 PDF：轮询 `completed`，下载可打开的双语 PDF，比较原始公式/版面/图片/文字层与译文，再决定可发布。测试账户的 API 用量和实际费用须可见。
8. 在 PIT 文件工作台填入真实 HTTPS 域名和凭据，执行单页→13 页→多栏扫描 PDF，验证后台重启、长轮询、HTTP 429、OCR、取消、超时、文本保真。未经 L3 真实测试不得合并 stable。

## 3. Whisper 与其他服务边界

- `services/faster_whisper_backend.py` / `services/babeldoc_bridge.py` 的语言置信度与分段接口已集成并单测；目前并没有一个实际部署、公开可访问且有付费预算保证的 ASR 服务。把 faster-whisper 模型包装为 Railway 独立实例会产生模型镜像、CPU/RAM 持续费用和播放链路延迟，需要针对实时 p95 延迟单独验收。
- `cloudflare/multimodal-api` 仍是可部署 Worker 代码，不是已经在线的稳定端点。没有 Workers AI Binding/Token 时不能用假翻译替代结果。
- KISS Translator、FluentRead 等 GPL 项目的源码和 BabelDOC AGPL 条款必须按各自许可证处理；独立部署并非自动免责。

## 4. 对接时需要的 Railway 操作接口

安装 ChatGPT 内 Railway 应用后，还必须在当前会话中实际暴露可访问的 Railway 项目查询/部署操作才可以替用户验证服务列表、项目、环境变量设置与运行日志。**目前只确认应用 installed=true，未返回 Railway 项目资源，也未触发任何云端部署。** 在能够使用的会话/Work 模式中重新检查连接与授权，再继续上面第 2 节部署流程。

参考：
- https://docs.railway.com/infrastructure-as-code/reference
- https://docs.railway.com/builds/dockerfiles
- https://docs.railway.com/deployments/healthchecks
- https://docs.railway.com/volumes
