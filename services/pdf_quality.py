"""Structural PDF acceptance checks independent from OCR/BabelDOC engine.

Metrics never contain original or translated text, API keys, page images,
file paths, or third-party content. Layout heuristics are NOT quality scores.
"""
import math
import fitz


def summarize_pdf(path):
    with fitz.open(path) as doc:
        if doc.needs_pass:
            raise ValueError("密码保护的 PDF 无法直接验收")
        if not 1 <= len(doc) <= 600:
            raise ValueError("PDF 页数超出结构验收范围")
        pages=[]
        for page in doc:
            text=page.get_text()
            out_of_bounds=0
            span_count=0
            for block in page.get_text("dict").get("blocks",[]):
                for line in block.get("lines",[]):
                    for span in line.get("spans",[]):
                        if not span.get("text","").strip():continue
                        span_count+=1
                        try:
                            rect=fitz.Rect(span["bbox"])
                            if any(not math.isfinite(n) for n in rect):
                                out_of_bounds+=1
                            elif (rect.x0<page.rect.x0-3 or rect.y0<page.rect.y0-3 or
                                  rect.x1>page.rect.x1+3 or rect.y1>page.rect.y1+3):
                                out_of_bounds+=1
                        except (KeyError,TypeError,ValueError):
                            out_of_bounds+=1
            pages.append({"chars":len(text.strip()),"spans":span_count,
                          "outside_spans":out_of_bounds,
                          "replacement_chars":text.count("\uFFFD"),
                          "width":round(page.rect.width,2),
                          "height":round(page.rect.height,2)})
    return {"pages":len(pages),"text_pages":sum(p["chars"]>10 for p in pages),
            "outside_spans":sum(p["outside_spans"] for p in pages),
            "total_spans":sum(p["spans"] for p in pages),
            "replacement_chars":sum(p["replacement_chars"] for p in pages),
            "page_samples":pages[:30]}


def inspect_pair(original,translated):
    source=summarize_pdf(original)
    target=summarize_pdf(translated)
    warnings=[]
    # A dual/bilingual document may be side-by-side or contain extra pages,
    # but should not lose physical pages.
    if target["pages"] < source["pages"]:
        raise ValueError("翻译后的 PDF 页数少于原文")
    if not target["text_pages"]:
        raise ValueError("翻译后 PDF 没有可提取文字；可能是 OCR 或字体渲染失败")
    if target["outside_spans"]:
        warnings.append("译文含页面边界之外的文字；需要人工检查裁切")
    if target["pages"] > source["pages"]*4:
        warnings.append("译文页数显著增多；建议对照源文档检查分页")
    return {"input_pages":source["pages"],"output_pages":target["pages"],
            "output_text_pages":target["text_pages"],
            "outside_text_spans":target["outside_spans"],
            "total_text_spans":target["total_spans"],
            "warnings":warnings,
            "status":"structural-pass" if not warnings else "review-needed"}

