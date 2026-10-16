"""Reproducible Unicode OCR accuracy metrics, no document retention.

Exact character error rate = Levenshtein(reference, prediction) /
Unicode character length after NFKC normalization and whitespace collapse.
Use with user-owned samples, not copyrighted benchmark text.
"""
import unicodedata

def normalized(text: str, *, ignore_whitespace=False) -> str:
    clean=unicodedata.normalize("NFKC",text or "")
    clean=" ".join(clean.split())
    if ignore_whitespace:
        clean="".join(clean.split())
    return clean

def edit_distance(left: str,right: str) -> int:
    if len(left)>len(right):
        left,right=right,left
    previous=list(range(len(left)+1))
    for i,r in enumerate(right,1):
        current=[i]
        for j,l in enumerate(left,1):
            current.append(min(current[-1]+1,previous[j]+1,
                               previous[j-1]+(l!=r)))
        previous=current
    return previous[-1]

def char_error_rate(reference: str,predicted: str,*,ignore_whitespace=False):
    expected=normalized(reference,ignore_whitespace=ignore_whitespace)
    actual=normalized(predicted,ignore_whitespace=ignore_whitespace)
    if not expected:
        raise ValueError("OCR reference cannot be empty")
    return edit_distance(expected,actual)/len(expected)
