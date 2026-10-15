"""Local-only PDF bridge: OCRmyPDF (if scanned) -> BabelDOC layout-preserving translation.

Set PIT_BRIDGE_TOKEN and DEEPSEEK_API_KEY environment variables. This bridge
must not be exposed to the internet, reverse-proxied or run with elevated rights.
BabelDOC is AGPL-3.0; use a separately installed, license-compliant release.
"""
import asyncio
import os
import pathlib
import secrets
import shutil
import subprocess
import tempfile
import json

from fastapi import FastAPI, File, UploadFile, Form, Header, HTTPException
from fastapi.responses import Response
from fastapi.middleware.cors import CORSMiddleware

TOKEN=os.environ.get("PIT_BRIDGE_TOKEN","")
KEY=os.environ.get("DEEPSEEK_API_KEY","")
MAX_BYTES=25*1024*1024
LANGS={"zh":"chi_sim","en":"eng","fr":"fra","ja":"jpn","ko":"kor","de":"deu","es":"spa"}
app=FastAPI(docs_url=None,redoc_url=None,openapi_url=None)
app.add_middleware(CORSMiddleware,
    allow_origin_regex=r"^chrome-extension://[a-z]{32}$",
    allow_methods=["GET","POST","OPTIONS"],
    allow_headers=["X-PIT-Token","Content-Type"])

def authorized(header):
    return bool(TOKEN and header and secrets.compare_digest(header,TOKEN))
def scanned_pdf(path):
    try:
        import fitz
        with fitz.open(path) as doc:
            if doc.page_count > 300: raise ValueError("超过 300 页上限")
            scan=min(3,doc.page_count)
            if not scan: raise ValueError("PDF 没有任何页面")
            return sum(len(doc[i].get_text().strip()) for i in range(scan)) < scan*30
    except (ImportError,ValueError):
        raise
    except Exception as exc:
        raise ValueError("PDF 文件无法解析") from exc

def run_pipeline(source, dest, source_lang, target_lang, ocr):
    if not KEY: raise RuntimeError("服务端尚未设置 DEEPSEEK_API_KEY")
    if not shutil.which("babeldoc"): raise RuntimeError("未安装 BabelDOC CLI")
    input_file=source
    if scanned_pdf(source):
        if not ocr: raise RuntimeError("检测到扫描 PDF，请启用 OCR 后再重试")
        if not shutil.which("ocrmypdf"): raise RuntimeError("扫描件需要安装 OCRmyPDF、Tesseract 和对应语言模型")
        searchable=dest/"searchable.pdf"
        subprocess.run(["ocrmypdf","--skip-text","--language",LANGS[source_lang],
                       "--jobs","2","--output-type","pdf",str(source),str(searchable)],
                       check=True,timeout=360,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
        input_file=searchable
    # Save provider credentials in a private temporary file rather than process args.
    config=dest/"babeldoc.toml"
    settings={"openai":True,"openai-model":"deepseek-chat",
        "openai-base-url":"https://api.deepseek.com/v1",
        "openai-api-key":KEY,"lang-in":source_lang,"lang-out":target_lang,
        "output":str(dest),"no-mono":True,"qps":2}
    with config.open("x",encoding="utf8") as f:
        f.write("[babeldoc]\n")
        for field,value in settings.items():f.write(field+" = "+json.dumps(value,ensure_ascii=False)+"\n")
    config.chmod(0o600)
    try:
        subprocess.run(["babeldoc","--config",str(config),"--files",str(input_file)],
             check=True,timeout=900,cwd=str(dest),stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
    finally:
        config.unlink(missing_ok=True)
    outputs=[f for f in dest.glob("*.pdf") if f not in {input_file,source} and not f.name.startswith("searchable")]
    dual=[f for f in outputs if "dual" in f.name.lower() or "bilingual" in f.name.lower()]
    if not dual: raise RuntimeError("BabelDOC 未产生可识别的双语 PDF；请检查 CLI 版本及输出命名")
    return max(dual,key=lambda p:p.stat().st_mtime).read_bytes()

@app.get("/health")
def health(x_pit_token: str|None=Header(None)):
    if not authorized(x_pit_token): raise HTTPException(status_code=401)
    return {"ready":bool(KEY and shutil.which("babeldoc")),"ocr":bool(shutil.which("ocrmypdf"))}


@app.post("/ocr-image")
async def ocr_image(image: UploadFile=File(...), source: str=Form("en"),
                    x_pit_token: str|None=Header(None)):
    if not authorized(x_pit_token): raise HTTPException(status_code=401)
    if source not in LANGS:raise HTTPException(status_code=400,detail="语言代码无效")
    if image.content_type not in ("image/png","image/jpeg","image/webp"):
        raise HTTPException(status_code=415,detail="不支持的图片格式")
    payload=await image.read(8_000_001)
    if len(payload)>8_000_000:raise HTTPException(status_code=413)
    if not shutil.which("tesseract"):raise HTTPException(status_code=503,detail="未安装 Tesseract OCR")
    with tempfile.TemporaryDirectory(prefix="pit-ocr-") as temp:
        path=pathlib.Path(temp)/("image.png" if image.content_type=="image/png" else "image.jpg")
        path.write_bytes(payload)
        try:
            result=await asyncio.to_thread(subprocess.run,["tesseract",str(path),"stdout","-l",LANGS[source]],
                capture_output=True,timeout=100,check=True)
        except (subprocess.CalledProcessError,subprocess.TimeoutExpired) as exc:
            raise HTTPException(status_code=422,detail="OCR 识别失败，请安装对应语言包") from exc
    return {"original_text":result.stdout.decode("utf8",errors="replace")[:12000]}


ASR_MODEL=os.environ.get("PIT_WHISPER_MODEL","")
ASR_BIN=os.environ.get("PIT_WHISPER_BIN","whisper-cli")
asr_lock=asyncio.Lock()
@app.post("/asr")
async def transcribe_audio(audio: UploadFile=File(...),x_pit_token: str|None=Header(None)):
    if not authorized(x_pit_token): raise HTTPException(status_code=401)
    if not ASR_MODEL or not pathlib.Path(ASR_MODEL).is_file() or not shutil.which(ASR_BIN):
        raise HTTPException(status_code=503,detail="尚未配置本地 Whisper 模型或 whisper-cli")
    data=await audio.read(2_000_001)
    if len(data)>2_000_000 or len(data)<44 or not data.startswith(b"RIFF") or data[8:12]!=b"WAVE":
        raise HTTPException(status_code=400,detail="仅支持不超过 2MB 的 PCM WAV")
    if asr_lock.locked():
        raise HTTPException(status_code=429,detail="语音模型繁忙；当前音频片段已跳过")
    async with asr_lock:
        with tempfile.TemporaryDirectory(prefix="pit-asr-") as temp:
            work=pathlib.Path(temp)
            input_file=work/"segment.wav"
            output_file=work/"transcript"
            input_file.write_bytes(data)
            command=[ASR_BIN,"-m",ASR_MODEL,"-f",str(input_file),
                     "-l","auto","-otxt","-of",str(output_file),"-np"]
            try:
                await asyncio.to_thread(subprocess.run,command,check=True,timeout=75,
                    stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
            except (subprocess.CalledProcessError,subprocess.TimeoutExpired) as exc:
                raise HTTPException(status_code=422,detail="Whisper 推理失败或超时") from exc
            txt=work/"transcript.txt"
            text=txt.read_text(encoding="utf8",errors="replace").strip() if txt.exists() else ""
    return {"text":text[:5000]}

@app.post("/translate")
async def translate(pdf: UploadFile=File(...), source: str=Form("en"),
                    target: str=Form("zh"),ocr: bool=Form(True),
                    x_pit_token: str|None=Header(None)):
    if not authorized(x_pit_token): raise HTTPException(status_code=401)
    if source not in LANGS or target not in LANGS or source==target: raise HTTPException(status_code=400,detail="语言参数无效")
    if pdf.content_type not in ("application/pdf","application/octet-stream"):raise HTTPException(status_code=415)
    data=await pdf.read(MAX_BYTES+1)
    if len(data)>MAX_BYTES or not data.startswith(b"%PDF-"):raise HTTPException(status_code=400,detail="PDF 文件格式错误或超出 25MB")
    with tempfile.TemporaryDirectory(prefix="pit-pdf-") as d:
        work=pathlib.Path(d)
        source_file=work/"original.pdf"
        source_file.write_bytes(data)
        try:
            result=await asyncio.to_thread(run_pipeline,source_file,work,source,target,ocr)
        except (ValueError,RuntimeError,subprocess.CalledProcessError,subprocess.TimeoutExpired) as e:
            # Never return subprocess stderr or credentials to the client.
            raise HTTPException(status_code=422,detail="PDF 处理失败：请检查 OCR、BabelDOC 安装、语言模型和服务端日志") from e
    return Response(result,media_type="application/pdf",
        headers={"Content-Disposition":'attachment; filename="translated-bilingual.pdf"',
                 "Cache-Control":"no-store"})

if __name__=="__main__":
    import uvicorn
    if not TOKEN: raise SystemExit("PIT_BRIDGE_TOKEN environment variable must be set")
    uvicorn.run(app,host="127.0.0.1",port=8765,workers=1,access_log=False)
