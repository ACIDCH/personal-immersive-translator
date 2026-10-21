# Roadmap

> **历史版本材料（2026-10-16）**：保留当时的设计、术语和验收结论，用于追溯；此处的默认引擎、版本号及“已实现/计划”标签已不代表当前 PIT 0.4.6。现行模块状态、统一入口和真实验收依据请阅读 [2026-10-21 内容体系审计](CONTENT_SYSTEM_AUDIT_2026-10-21.md)。

| Step | Module | State | Acceptance |
| --- | --- | --- | --- |
| M0 | Independent GitHub, Supabase, YUNPAN | Done | Three dedicated resources; no existing site repository changes |
| M1 | Chrome/Edge MV3 extension | Alpha | Load unpacked and verify real webpage rendering |
| M2 | Four standard translation providers | Mock-tested | Live official API tests and quota feedback |
| M3 | Gemini / DeepSeek on-demand mode | Mock-tested | Manual consent, cost estimate, response validation |
| M4 | Dynamic pages, domain rules, selection UI | Initial | Cross-site regression tests |
| M4a | Presentation/SPA/open Shadow DOM extraction | Experimental | Regression across interactive slides, Shadow DOM and iframe boundaries |
| M4b | Native HTML5 video subtitles with timing/prefetch | Experimental | Seek/2x/playback tests, no duplicate/stale captions |
| M4c | YouTube/platform video subtitle adapters | Planned | Capture source legitimately and tolerate A/B format changes |
| M4d | Opt-in real-time audio ASR fallback | Experimental | Explicit capture consent, cost ceiling, p50/p95 latency and Stop control |
| M5 | PDF and academic bilingual translation | Planned | Formula/table preservation |
| M6 | Video captions, OCR, terminology UI | Planned | Subtitle alignment and safe permissions |
| M7 | Optional data sync / accounts | Planned | Supabase RLS and privacy opt-in |
| M8 | Codex final independent review | Planned | Security, licensing, usability and release review |

Rules: Do not modify `ACIDCH/ACIDCH`, `ACIDCH/ACIDCH.github.io`, or `ACIDCH/language-learning-hub`. Do not commit or upload keys. Do not automatically invoke paid AI.
