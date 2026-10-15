"""Reproducible paired evaluation. This tool never invents test measurements.

Input JSON array; records have `ours` and `baseline` sections with measured
human_quality_1to5, latency_ms, and optionally OCR CER or PDF overlap fractions.
To avoid spurious "better" claims, this only emits descriptive deltas.
"""
import json, statistics, sys

def summarize(rows):
    if not isinstance(rows,list) or not rows:
        raise ValueError("至少需要一条来自真实对照实验的记录")
    def values(name,key):
        samples=[]
        for row in rows:
            value=row.get(name,{}).get(key)
            if isinstance(value,(int,float)) and not isinstance(value,bool):
                samples.append(float(value))
        return samples
    report={"n":len(rows),"status":"descriptive_only_no_superiority_claim"}
    for metric in ("human_quality_1to5","latency_ms","ocr_cer","pdf_overlap"):
        own=values("ours",metric)
        base=values("baseline",metric)
        if not own or len(own)!=len(base) or len(own)!=len(rows):
            report[metric]={"status":"insufficient_paired_data"}
            continue
        paired=[x-y for x,y in zip(own,base)]
        report[metric]={
            "ours_mean":round(statistics.mean(own),4),
            "baseline_mean":round(statistics.mean(base),4),
            "mean_delta_ours_minus_baseline":round(statistics.mean(paired),4),
            "n":len(paired)
        }
    if len(rows)<30:
        report["warning"]="样本量不足 30，仅用于调试；不能宣称整体优于对手"
    return report

if __name__=="__main__":
    if len(sys.argv)!=2:
        raise SystemExit("Usage: python benchmarks/compare.py measured_pairs.json")
    with open(sys.argv[1],encoding="utf8") as f: data=json.load(f)
    print(json.dumps(summarize(data),ensure_ascii=False,indent=2))
