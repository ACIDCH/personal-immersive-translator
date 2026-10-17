"""Local process adapter for upstream PDFMathTranslate CLI (AGPL-3.0).

This invokes the INSTALLED upstream pdf2zh executable; it is not an original
layout translation engine and it does not run inside Cloudflare Workers.
Never sends an API key on the command line. Provider credentials, if any, must
be configured on the local machine by the upstream tool itself.
"""
import argparse
import hashlib
import json
import os
import shutil
import subprocess
import time
from pathlib import Path

MAX_PDF_BYTES=40*1024*1024
VALID_LANG={"en","zh","fr","ja","ko","de","es","it","pt"}
VALID_SERVICES={"google","deepl","microsoft","deeplx"}

def run_pdf_layout(source,output,*,source_lang="en",target_lang="zh",service="google",
                   ultrafast=False,timeout_seconds=900,executable=None):
    source=Path(source).expanduser().resolve()
    output=Path(output).expanduser().resolve()
    if source.suffix.lower()!='.pdf' or not source.is_file():
        raise ValueError('Input must be an existing local .pdf file')
    size=source.stat().st_size
    if not 20<=size<=MAX_PDF_BYTES:
        raise ValueError('PDF must be 20 bytes to 40 MiB')
    with source.open('rb') as f:
        if not f.read(1024).lstrip().startswith(b'%PDF-'):
            raise ValueError('Not a recognizable PDF header')
    if source_lang not in VALID_LANG or target_lang not in VALID_LANG:
        raise ValueError('Unsupported source or target language')
    if service not in VALID_SERVICES:
        raise ValueError('Service must be selected from the supported adapter list')
    if not 1<=timeout_seconds<=3600:
        raise ValueError('Timeout must be 1-3600 seconds')
    binary=executable or shutil.which('pdf2zh')
    if not binary:raise RuntimeError('pdf2zh not installed; install the GPL/AGPL upstream locally')
    output.mkdir(parents=True,exist_ok=True)
    command=[str(binary),str(source),'-li',source_lang,'-lo',target_lang,
             '-s',service,'-o',str(output)]
    if ultrafast:command.append('--ultrafast')
    existing={p.resolve() for p in output.glob('*.pdf')}
    started=time.time()
    try:
        result=subprocess.run(command,check=False,timeout=timeout_seconds,
                              stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,
                              env=os.environ.copy())
    except subprocess.TimeoutExpired:
        raise RuntimeError('pdf2zh process timed out; no translation result is accepted') from None
    if result.returncode:
        raise RuntimeError('pdf2zh failed with exit code '+str(result.returncode)+
                           '; check upstream CLI logs locally without publishing API credentials')
    # Do not mistake unrelated files or stale outputs for success.
    produced=[]
    for path in sorted(output.glob('*.pdf')):
        if path.resolve() in existing:continue
        if path.stat().st_mtime<started-2 or path.stat().st_size<20:continue
        if not path.read_bytes()[:1024].lstrip().startswith(b'%PDF-'):continue
        produced.append({"file":str(path),"bytes":path.stat().st_size,
                         "sha256":hashlib.sha256(path.read_bytes()).hexdigest()})
    if not produced:
        raise RuntimeError('pdf2zh returned successfully but no new PDF file was verified')
    return {"adapter":"pdf2zh CLI (upstream AGPL-3.0)","service":service,
            "mode":"ultrafast" if ultrafast else "standard",
            "source_lang":source_lang,"target_lang":target_lang,
            "outputs":produced,
            "layout_verified":False,"translation_quality_verified":False}

def main():
    parser=argparse.ArgumentParser(description='Local-only PDFMathTranslate CLI adapter')
    parser.add_argument('input',type=Path)
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--source-lang',default='en')
    parser.add_argument('--target-lang',default='zh')
    parser.add_argument('--service',default='google')
    parser.add_argument('--ultrafast',action='store_true')
    parser.add_argument('--timeout',type=int,default=900)
    args=parser.parse_args()
    result=run_pdf_layout(args.input,args.output,source_lang=args.source_lang,
        target_lang=args.target_lang,service=args.service,
        ultrafast=args.ultrafast,timeout_seconds=args.timeout)
    print(json.dumps(result,ensure_ascii=False,indent=2))

if __name__=='__main__':main()
