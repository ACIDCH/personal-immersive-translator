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
import json
import os
import pathlib
import secrets
import re
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
    allow_methods=["GET","POST","OPTIONS"],allow_headers=["Authorization","Content-Type"],
    expose_headers=["X-PIT-Detected-Source","X-PIT-Detection-Confidence"])
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
        "job_storage":job_storage(),
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
    if lock.locked() or any(j["status"] in ("queued","running") for j in jobs.values()):
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

# The single-worker queue is ephemeral by default. When a persistent volume
# is explicitly mounted at PIT_PDF_JOB_DIR, completed result files and job
# metadata survive a container restart (running inference does NOT resume).
# No database, multi-worker locking or false percentage-based progress.
JOB_TTL_SECONDS=15*60
JOB_MAX_OUTPUT_BYTES=100*1024*1024
JOB_MAX_RETAINED=4
JOB_ID_PATTERN=re.compile(r"^[A-Za-z0-9_-]{16,80}$")
jobs:dict[str,dict]={}
job_gate=asyncio.Lock()

def job_directory():
    configured=os.getenv("PIT_PDF_JOB_DIR","").strip()
    if not configured:
        return None
    root=pathlib.Path(configured).resolve()
    root.mkdir(parents=True,exist_ok=True,mode=0o700)
    return root

def job_storage():
    return "persistent-volume-single-worker" if job_directory() else "ephemeral-single-process"

def job_paths(job_id):
    if not JOB_ID_PATTERN.fullmatch(job_id):
        raise HTTPException(status_code=404,detail="Job not found")
    root=job_directory()
    return (root/(job_id+".json"),root/(job_id+".pdf")) if root else (None,None)

def atomic_job_write(path,data):
    # Private mode from creation; no user-controlled filenames are accepted.
    temp=path.with_name(path.name+"."+secrets.token_hex(6)+".tmp")
    try:
        fd=os.open(temp,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
        with os.fdopen(fd,"wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temp,path)
    finally:
        temp.unlink(missing_ok=True)

def save_job(item,output=None):
    meta,path=job_paths(item["id"])
    if meta is None:return
    if output is not None:
        atomic_job_write(path,output)
    record={key:item[key] for key in ("id","status","source","confidence","expiresAt")}
    atomic_job_write(meta,json.dumps(record,separators=(",",":")).encode("utf-8"))

def remove_job(job_id):
    jobs.pop(job_id,None)
    meta,pdf=job_paths(job_id)
    if meta:
        meta.unlink(missing_ok=True)
        pdf.unlink(missing_ok=True)

def sweep_jobs():
    now=time.time()
    for key,item in list(jobs.items()):
        if item.get("expiresAt",float("inf"))<=now and item["status"] in ("completed","failed"):
            remove_job(key)
    root=job_directory()
    if not root:return
    retained=[]
    for meta in root.glob("*.json"):
        job_id=meta.stem
        if not JOB_ID_PATTERN.fullmatch(job_id):continue
        try:
            item=json.loads(meta.read_text("utf-8"))
            valid=item["id"]==job_id and item["status"] in ("completed","failed") and (
                item["status"]=="failed" or (root/(job_id+".pdf")).is_file())
            if job_id not in jobs and item["status"] in ("queued","running") and (
                float(item["expiresAt"])>now):
                # Interruption on restart: retain the status as a truthful
                # failed job until TTL, rather than deleting it immediately.
                load_job(job_id)
                retained.append((float(item["expiresAt"]),job_id))
            elif not valid or float(item["expiresAt"])<=now:
                if job_id not in jobs:remove_job(job_id)
            else:
                retained.append((float(item["expiresAt"]),job_id))
        except (OSError,ValueError,TypeError,KeyError):
            if job_id not in jobs:remove_job(job_id)
    # Bound output disk usage; each PDF <=100MiB, retain <=4 results.
    for _,old_id in sorted(retained)[:-JOB_MAX_RETAINED]:
        if old_id not in jobs or jobs[old_id]["status"] in ("completed","failed"):
            remove_job(old_id)

def load_job(job_id):
    meta,path=job_paths(job_id)
    if meta is None or not meta.is_file():return None
    try:
        item=json.loads(meta.read_text("utf-8"))
        if item["id"]!=job_id or item["source"] not in LANGS or (
           item["status"] not in ("queued","running","completed","failed")):
            return None
        if float(item["expiresAt"])<=time.time():
            remove_job(job_id);return None
        if item["status"] in ("queued","running"):
            # Container process restart cannot resume upstream BabelDOC.
            # Return a truthful failed state rather than perpetual "running".
            item["status"]="failed"
            save_job(item)
        elif item["status"]=="completed" and (
             not path.is_file() or path.stat().st_size>JOB_MAX_OUTPUT_BYTES):
            item["status"]="failed"
            save_job(item)
        item["output"]=None
        return item
    except (OSError,ValueError,TypeError,KeyError):
        return None

def job_reply(item):
    return {"jobId":item["id"],"status":item["status"],
            "detectedSource":item["source"],
            "detectionConfidence":item["confidence"],
            "storage":job_storage(),
            "retentionSeconds":JOB_TTL_SECONDS}

def get_job(job_id,authorization):
    require_bearer(authorization)
    item=jobs.get(job_id) or load_job(job_id)
    if item is None:
        raise HTTPException(status_code=404,detail="Job not found or expired; upload again")
    return item

async def forget_result_later(job_id):
    await asyncio.sleep(JOB_TTL_SECONDS)
    item=jobs.get(job_id)
    if item is not None and item["status"] in ("completed","failed") and (
        item.get("expiresAt",0)<=time.time()):
        remove_job(job_id)

async def execute_pdf_job(job_id,data,source,target,ocr):
    item=jobs[job_id]
    try:
        async with lock:
            item["status"]="running"
            save_job(item)
            with tempfile.TemporaryDirectory(prefix="pit-cloud-pdf-job-") as path:
                root=pathlib.Path(path)
                original=root/"original.pdf"
                original.write_bytes(data)
                output=await asyncio.to_thread(run_pipeline,original,root,source,target,ocr)
            if not isinstance(output,bytes) or len(output)>JOB_MAX_OUTPUT_BYTES or not output.startswith(b"%PDF-"):
                raise RuntimeError("Invalid or oversized PDF result")
            item["status"]="completed"
            item["expiresAt"]=time.time()+JOB_TTL_SECONDS
            save_job(item,output)
            item["output"]=None if job_directory() else output
    except Exception:
        # Return a neutral error, never upstream model keys, source text,
        # file paths, command line, or BabelDOC subprocess stderr.
        item["status"]="failed"
        item["expiresAt"]=time.time()+JOB_TTL_SECONDS
        save_job(item)
    finally:
        item["doneAt"]=time.monotonic()
        sweep_jobs()
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
        sweep_jobs()
        # In-memory mode keeps at most the previous completed result.
        # Mounted volumes retain up to four recent results across restarts.
        if not job_directory():
            for old_id,j in list(jobs.items()):
                if j["status"] in ("completed","failed"):
                    jobs.pop(old_id,None)
        job_id=secrets.token_urlsafe(24)
        item={"id":job_id,"status":"queued","source":chosen,
              "confidence":confidence,"output":None,
              "expiresAt":time.time()+JOB_TTL_SECONDS}
        jobs[job_id]=item
        save_job(item)
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
    result=item["output"]
    if result is None:
        _,path=job_paths(job_id)
        try:
            if path is None or path.stat().st_size>JOB_MAX_OUTPUT_BYTES:
                raise OSError("PDF result unavailable")
            result=path.read_bytes()
        except OSError as error:
            raise HTTPException(status_code=410,
                detail="PDF result is missing or expired; upload again") from error
    return Response(result,media_type="application/pdf",headers={
        "Cache-Control":"no-store",
        "Content-Disposition":'attachment; filename="bilingual.pdf"',
        "X-PIT-Detected-Source":item["source"],
        "X-PIT-Detection-Confidence":item["confidence"]
    })

