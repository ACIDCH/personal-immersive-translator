# 安装说明 — Alpha v0.1.0

## 安装
1. 从 GitHub 下载源码 ZIP，或从 [YUNPAN releases](https://drive.google.com/file/d/1N27Jjvi2rxZrvfHAncU_TsVHkRwEEDOp/view?usp=drivesdk) 下载 Alpha 包并解压。
2. Chrome 打开 `chrome://extensions`（Edge：`edge://extensions`）。
3. 启用开发者模式 → 加载已解压的扩展程序 → 选择含 `manifest.json` 的文件夹。
4. 打开扩展“设置”，选择服务并填写**自己的**官方 API Key，点击“保存设置”。
5. 在普通网站点击插件图标 → “翻译当前网页”。
6. Gemini/DeepSeek 需先填 Key，再选择 AI 增强并确认本次请求可能计费。

## 已完成
网页双语段落、选中文字翻译、恢复原文、本地缓存、域名禁止名单、六个服务适配器。

## 尚未完成
真实浏览器和真实 API 验收，视频字幕、PDF 版面重建、OCR、跨设备同步。Google、DeepL、微软均是商业服务，不存在无条件无限免费官方 API。不要在敏感网站发起远端翻译。

## 本地质量检查
Node >=20，运行 `npm run verify`；无第三方 npm 依赖。测试使用模拟 API 响应。
