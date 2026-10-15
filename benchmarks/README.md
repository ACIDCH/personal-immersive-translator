# Comparable performance and quality benchmark

The user's target is better translation accuracy, faster response and better PDF preservation than the current Immersive Translate extension. **This is not yet demonstrated.** High GitHub star counts are never substitutes for comparative measurements.

1. Prepare at least 30 representative fixtures per category (news, academic papers, finance, slides, YouTube captions, Netflix captions, Panopto lectures, image OCR, born-digital PDF, scanned PDF), with correct usage permissions.
2. Use matched language pairs zh/en/ja/ko/fr/de/es, network/hardware conditions, and equivalent free/API model/quality settings. Record exact versions and dates.
3. Ask blind independent reviewers to rate semantic adequacy, technical terminology and readability on a 1–5 scale. For OCR, use corrected text to compute CER; for PDF, compare rendered pages for clipping/overlap, formula and table fidelity.
4. Record per task p50 and p95 latency, dropped caption percentage, drift after 20 seeks and 2x playback, OCR misrecognition and PDF output success.
5. Run python benchmarks/compare.py path-to-measured-pairs.json to calculate descriptive deltas. The script intentionally avoids claiming statistical superiority by itself.
6. Keep all real baselines, issue reproductions, and test evidence in the dedicated project only. Do not capture private university course content without permission.

Example input (SYNTHETIC SCHEMA ONLY, not a performance claim):

    [
      {
        "fixture": "en-zh-caption-001",
        "ours": {"human_quality_1to5": 4, "latency_ms": 1200},
        "baseline": {"human_quality_1to5": 3, "latency_ms": 1400}
      }
    ]

Do not mark the plugin better than Immersive Translate until independent results and regression tests on real devices are complete.
