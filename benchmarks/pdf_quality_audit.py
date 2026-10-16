"""Offline metrics-only PDF layout and page retention acceptance.

Usage: python -m benchmarks.pdf_quality_audit original.pdf translated.pdf
"""
import argparse
import json
from pathlib import Path
from services.pdf_quality import inspect_pair

if __name__=="__main__":
    parser=argparse.ArgumentParser(description="Audit structural quality of translated PDF")
    parser.add_argument("source",type=Path)
    parser.add_argument("translated",type=Path)
    args=parser.parse_args()
    print(json.dumps(inspect_pair(args.source,args.translated),ensure_ascii=False,indent=2))
