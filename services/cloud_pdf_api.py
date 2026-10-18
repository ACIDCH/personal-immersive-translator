"""PIT separately deployable cloud PDF/OCR/BabelDOC service (not localhost).

Actual layout reconstruction is the existing run_pipeline subprocess and
upstream BabelDOC. This API has no local-browser dependency: user may deploy
it on a Python container service and connect via a HTTPS URL.

Not deployed by merely committing this code; upstream models, a compatible
BabelDOC binary, real translation provider credentials and cloud compute are
required. Production operation is single-job, bounded by 25MiB/300 pages,
auth token and external ingress controls. No source PDF is logged.
"""
import asyncio
import io
import os
import pathlib
import secrets
import subprocess
import tempfile
import time
import unicodedata

from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, JSONResponse
from services.babeldoc_bridge import run_pipeline, LANGS
from services.babeldoc_preflight import inspect_babeldoc_cli

app=FastAPI(title="PIT Cloud Document",docs_url=None,redoc_url=None,openapi_url=None)
app.add_middleware(CORSMiddleware,allow_origin_regex=r"^chrome-extension://[a-z]{32}$",
    allow_methods=["GET","POST","OPTIONS"],allow_headers=["Authorization","Content-Type"])
lock=asyncio.Lock()
MAX_FILE=25*1024*1024
MAX_PAGES=300

def require_bearer(header):
    expected=os.getenv("PIT_CLOUD_PDF_TOKEN","")
    if not expected or len(expected)<16 or not header or not secrets.compare_digest(
       header,"Bearer "+expected):
        raise HTTPException(status_code=401,detail="cloud PDF authorization required")

def infer_source(pdf:bytes)->tuple[str,str]:
    """Language detection on the original searchable text, not a fake LLM.
    Confidence is flagged heuristic. For scanned-only pages a short offline
    Tesseract sample can be used when available. Latin-language detection
    benefits from optional langdetect and should still be reviewed.
    """
    try:
        import fitz
        with fitz.open(stream=pdf,filetype="pdf") as doc:
            raw="\n".join(doc[i].get_text() for i in range(min(4,len(doc))))[:12000]
            if len(raw.strip())<15 and len(doc):
                # Prevent automatic OCR from reading/transmitting arbitrary
                # files: render only page 1 to memory, bounded pixels.
                import shutil
                if shutil.which("tesseract"):
                    page=doc[0]
                    bitmap=page.get_pixmap(matrix=fitz.Matrix(1.4,1.4),
                        colorspace=fitz.csRGB)
                    if bitmap.width*bitmap.height<=4_000_000:
                        with tempfile.TemporaryDirectory(prefix="pit-language-") as d:
                            image=pathlib.Path(d)/"sample.png"
                            image.write_bytes(bitmap.tobytes("png"))
                            result=subprocess.run([
                                "tesseract",str(image),"stdout","-l",
                                "eng+fra+chi_sim+jpn+kor+deu+spa"
                            ],capture_output=True,timeout=50,check=False)
                            if result.returncode==0:
                                raw=result.stdout.decode("utf-8","replace")[:12000]
    except Exception:
        raw=""
    if any("\uac00"<=ch<="\ud7af" for ch in raw):return "ko","script-estimated"
    if any("\u3040"<=ch<="\u30ff" for ch in raw):return "ja","script-estimated"
    if sum("\u3400"<=ch<="\u9fff" for ch in raw)>4:return "zh","script-estimated"
    try:
        from langdetect import detect
        detected=detect(raw) if len(raw.strip())>=30 else "en"
        if detected in LANGS:return detected,"statistical-estimated"
    except Exception:
        pass
    return "en","latin-default-review-required"

@app.get("/health")
def health(authorization:str|None=Header(default=None)):
    require_bearer(authorization)
    cli=inspect_babeldoc_cli()
    return {
        "ready":bool(cli["compatible"] and
          (os.getenv("PIT_PDF_API_KEY") or os.getenv("DEEPSEEK_API_KEY"))),
        "engine":"BabelDOC cloud container",
        "cli":cli,"max_file_bytes":MAX_FILE,"max_pages":MAX_PAGES,
        "source_auto":True,"async_jobs":True,
        "job_storage":"ephemeral-single-process",
        "job_retention_seconds":JOB_TTL_SECONDS
    }

@app.post("/v1/pdf/translate")
async def translate(pdf:UploadFile=File(...),source:str=Form("auto"),
                    target:str=Form("zh"),ocr:bool=Form(True),
                    authorization:str|None=Header(default=None)):
    require_bearer(authorization)
    if source not in (*LANGS.keys(),"auto") or target not in LANGS:
        raise HTTPException(status_code=400,detail="Unsupported language")
    data=await pdf.read(MAX_FILE+1)
    if len(data)>MAX_FILE:
        raise HTTPException(status_code=413,detail="PDF exceeds 25 MiB cloud limit")
    if not data.startswith(b"%PDF-"):
        raise HTTPException(status_code=415,detail="Invalid PDF header")
    try:
        import fitz
        with fitz.open(stream=data,filetype="pdf") as doc:
            if doc.needs_pass or not 1<=len(doc)<=MAX_PAGES:
                raise ValueError("password-protected or over 300 pages")
    except Exception as error:
        raise HTTPException(status_code=422,detail="PDF cannot be read or exceeds 300 pages") from error
    chosen,confidence=infer_source(data) if source=="auto" else (source,"explicit")
    if chosen==target:
        raise HTTPException(status_code=422,
          detail="Detected source and target are identical; explicitly choose source")
    if lock.locked():
        raise HTTPException(status_code=429,detail="Document worker is occupied")
    async with lock:
        with tempfile.TemporaryDirectory(prefix="pit-cloud-doc-") as directory:
            root=pathlib.Path(directory)
            src=root/"original.pdf"
            src.write_bytes(data)
            try:
                payload=await asyncio.to_thread(
                    run_pipeline,src,root,chosen,target,ocr)
            except (ValueError,RuntimeError,subprocess.SubprocessError) as error:
                # No raw exception, source contents, API keys or subprocess
                # stderr in HTTP responses.
                raise HTTPException(status_code=422,
                    detail="BabelDOC/OCR translation failed; inspect private service logs") from error
    return Response(payload,media_type="application/pdf",headers={
        "Cache-Control":"no-store",
        "Content-Disposition":'attachment; filename="bilingual.pdf"',
        "X-PIT-Detected-Source":chosen,
        "X-PIT-Detection-Confidence":confidence
    })

# A real BabelDOC job may take far longer than an HTTP gateway request.
# This is intentionally a single-process, bounded and EPHEMERAL queue; a
# restart loses every job. Durable multi-instance recovery is NOT implemented.
JOB_TTL_SECONDS=15*60
JOB_MAX_OUTPUT_BYTES=100*1024*1024
jobs:dict[str,dict]={}
job_gate=asyncio.Lock()

def job_reply(item):
    return {"jobId":item["id"],"status":item["status"],
            "detectedSource":item["source"],
            "detectionConfidence":item["confidence"],
            "storage":"ephemeral-single-process",
            "retentionSeconds":JOB_TTL_SECONDS}

def get_job(job_id,authorization):
    require_bearer(authorization)
    item=jobs.get(job_id)
    if item is None:
        raise HTTPException(status_code=404,detail="Job not found or expired; upload again")
    return item

async def forget_result_later(job_id):
    await asyncio.sleep(JOB_TTL_SECONDS)
    item=jobs.get(job_id)
    if item is not None and item["status"] in ("completed","failed"):
        jobs.pop(job_id,None)

async def execute_pdf_job(job_id,data,source,target,ocr):
    item=jobs[job_id]
    try:
        async with lock:
            item["status"]="running"
            with tempfile.TemporaryDirectory(prefix="pit-cloud-pdf-job-") as path:
                root=pathlib.Path(path)
                original=root/"original.pdf"
                original.write_bytes(data)
                output=await asyncio.to_thread(run_pipeline,original,root,source,target,ocr)
            if not isinstance(output,bytes) or len(output)>JOB_MAX_OUTPUT_BYTES or not output.startswith(b"%PDF-"):
                raise RuntimeError("Invalid or oversized PDF result")
            item["output"]=output
            item["status"]="completed"
    except Exception:
        # Return a neutral error, never upstream model keys, source text,
        # file paths, command line, or BabelDOC subprocess stderr.
        item["status"]="failed"
    finally:
        item["doneAt"]=time.monotonic()
        item["expiryTask"]=asyncio.create_task(forget_result_later(job_id))

@app.post("/v1/pdf/jobs")
async def submit_pdf_job(pdf:UploadFile=File(...),source:str=Form("auto"),
                         target:str=Form("zh"),ocr:bool=Form(True),
                         authorization:str|None=Header(default=None)):
    require_bearer(authorization)
    if source not in (*LANGS.keys(),"auto") or target not in LANGS:
        raise HTTPException(status_code=400,detail="Unsupported language")
    data=await pdf.read(MAX_FILE+1)
    if len(data)>MAX_FILE:
        raise HTTPException(status_code=413,detail="PDF exceeds 25 MiB cloud limit")
    if not data.startswith(b"%PDF-"):
        raise HTTPException(status_code=415,detail="Invalid PDF header")
    try:
        import fitz
        with fitz.open(stream=data,filetype="pdf") as doc:
            if doc.needs_pass or not 1<=len(doc)<=MAX_PAGES:
                raise ValueError("Password protected or over 300 pages")
    except Exception as error:
        raise HTTPException(status_code=422,detail="Invalid or oversized PDF") from error
    chosen,confidence=await asyncio.to_thread(infer_source,data) if source=="auto" else (source,"explicit")
    if chosen==target:
        raise HTTPException(status_code=422,detail="Source and target are identical")
    async with job_gate:
        if lock.locked() or any(j["status"] in ("queued","running") for j in jobs.values()):
            raise HTTPException(status_code=429,detail="Document worker is occupied")
        # Completed results occupy at most 100 MiB. They are not durable
        # records and are discarded when the next document starts.
        for old_id,j in list(jobs.items()):
            if j["status"] in ("completed","failed"):
                jobs.pop(old_id,None)
        job_id=secrets.token_urlsafe(24)
        item={"id":job_id,"status":"queued","source":chosen,
              "confidence":confidence,"output":None}
        jobs[job_id]=item
        item["task"]=asyncio.create_task(
            execute_pdf_job(job_id,data,chosen,target,ocr))
    return JSONResponse(job_reply(item),status_code=202,
        headers={"Cache-Control":"no-store"})

@app.get("/v1/pdf/jobs/{job_id}")
async def status_pdf_job(job_id:str,authorization:str|None=Header(default=None)):
    item=get_job(job_id,authorization)
    return JSONResponse(job_reply(item),headers={"Cache-Control":"no-store"})

@app.get("/v1/pdf/jobs/{job_id}/result")
async def result_pdf_job(job_id:str,authorization:str|None=Header(default=None)):
    item=get_job(job_id,authorization)
    if item["status"]=="failed":
        raise HTTPException(status_code=422,detail="BabelDOC job failed; retry after checking server logs")
    if item["status"]!="completed":
        raise HTTPException(status_code=409,detail="Document job is not yet complete")
    return Response(item["output"],media_type="application/pdf",headers={
        "Cache-Control":"no-store",
        "Content-Disposition":'attachment; filename="bilingual.pdf"',
        "X-PIT-Detected-Source":item["source"],
        "X-PIT-Detection-Confidence":item["confidence"]
    })

