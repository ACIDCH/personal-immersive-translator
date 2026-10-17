"""Local-only PDF bridge: OCRmyPDF (if scanned) -> BabelDOC layout-preserving translation.

Set PIT_BRIDGE_TOKEN and PIT_PDF_API_KEY/PIT_PDF_MODEL/PIT_PDF_BASE_URL (or legacy DEEPSEEK_API_KEY). This bridge
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
import struct
import io
import csv
import httpx
try:
    from services.whisper_server import configured_server_port, transcribe_server, server_is_ready
except ModuleNotFoundError:  # Running python services/babeldoc_bridge.py directly
    from whisper_server import configured_server_port, transcribe_server, server_is_ready
try:
    from services.faster_whisper_backend import model_available, model_loaded, transcribe_local
except ModuleNotFoundError:
    from faster_whisper_backend import model_available, model_loaded, transcribe_local
from PIL import Image, ImageOps, UnidentifiedImageError
try:
    from services.pdf_provider_profile import resolve_pdf_provider
except ModuleNotFoundError:
    from pdf_provider_profile import resolve_pdf_provider
try:
    from services.babeldoc_preflight import inspect_babeldoc_cli
except ModuleNotFoundError:
    from babeldoc_preflight import inspect_babeldoc_cli

from fastapi import FastAPI, File, UploadFile, Form, Header, HTTPException
from fastapi.responses import Response
from fastapi.middleware.cors import CORSMiddleware

TOKEN=os.environ.get("PIT_BRIDGE_TOKEN","")
KEY=os.environ.get("DEEPSEEK_API_KEY","")
MAX_BYTES=25*1024*1024
# Never launch two memory-heavy layout/OCR translation jobs simultaneously.
pdf_lock=asyncio.Lock()
LANGS={"zh":"chi_sim","en":"eng","fr":"fra","ja":"jpn","ko":"kor","de":"deu","es":"spa"}
app=FastAPI(docs_url=None,redoc_url=None,openapi_url=None)
app.add_middleware(CORSMiddleware,
    allow_origin_regex=r"^chrome-extension://[a-z]{32}$",
    allow_methods=["GET","POST","OPTIONS"],
    allow_headers=["X-PIT-Token","Content-Type"])

def authorized(header):
    return bool(TOKEN and header and secrets.compare_digest(header,TOKEN))
def scanned_pdf(path):
    """Detect substantial raster-only pages without treating blank pages as scans.

    The old text-length-only check ran OCR over completely blank separators,
    short title pages and digitally-searchable covers. Inspect every page so
    scanned appendices are still found after a born-digital introduction.
    """
    try:
        import fitz
        with fitz.open(path) as doc:
            if doc.needs_pass: raise ValueError("PDF 已加密，请先提供可读取版本")
            if not 1 <= doc.page_count <= 300:
                raise ValueError("PDF 页数必须在 1–300 之间")
            for page in doc:
                if len(page.get_text().strip()) >= 10:
                    continue  # Searchable short covers do not need OCR.
                page_area=max(1.0,page.rect.width*page.rect.height)
                # get_image_info includes inline raster images, unlike
                # get_images(full=True), which only lists XObject references.
                for img in page.get_image_info():
                    rect=fitz.Rect(img.get("bbox",(0,0,0,0))) & page.rect
                    if not rect.is_empty and rect.get_area()/page_area >= 0.07:
                        return True
            return False
    except (ImportError,ValueError):
        raise
    except Exception as exc:
        raise ValueError("PDF 文件无法解析") from exc

def run_pipeline(source, dest, source_lang, target_lang, ocr):
    pdf_profile=resolve_pdf_provider({**os.environ,"PIT_PDF_API_KEY":os.environ.get("PIT_PDF_API_KEY") or KEY})
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
    settings={"openai":True,"openai-model":pdf_profile["model"],
        "openai-base-url":pdf_profile["base_url"],
        "openai-api-key":pdf_profile["api_key"],"lang-in":source_lang,"lang-out":target_lang,
        "output":str(dest),"no-mono":True,"qps":2}
    # The config contains a user-owned API key. Create it as private from
    # the first byte: chmod AFTER writing briefly exposes a mode-0644 file.
    fd=os.open(config,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    with os.fdopen(fd,"w",encoding="utf8") as f:
        f.write("[babeldoc]\n")
        for field,value in settings.items():f.write(field+" = "+json.dumps(value,ensure_ascii=False)+"\n")
    try:
        subprocess.run(["babeldoc","--config",str(config),"--files",str(input_file)],
             check=True,timeout=900,cwd=str(dest),stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
    finally:
        config.unlink(missing_ok=True)
    outputs=[f for f in dest.glob("*.pdf") if f not in {input_file,source} and f.is_file()]
    dual=[f for f in outputs if "dual" in f.name.lower() or "bilingual" in f.name.lower()]
    if not dual: raise RuntimeError("BabelDOC 未产生可识别的双语 PDF；请检查 CLI 版本及输出命名")
    winner=max(dual,key=lambda p:p.stat().st_mtime)
    if winner.stat().st_size > 100*1024*1024:
        raise RuntimeError("BabelDOC 输出超过 100MB 上限")
    try:
        import fitz
        with fitz.open(winner) as translated:
            if translated.page_count < 1:
                raise RuntimeError("译文 PDF 不包含有效页面")
    except RuntimeError:
        raise
    except Exception as exc:
        raise RuntimeError("BabelDOC 输出并非有效 PDF") from exc
    # A valid file header is not proof of a usable translated document.
    # Reject missing pages or universally unextractable text; report clipped
    # spans as structural warnings for subsequent human review.
    try:
        try:
            from services.pdf_quality import inspect_pair
        except ModuleNotFoundError:
            from pdf_quality import inspect_pair
        quality=inspect_pair(source,winner)
    except (ValueError,RuntimeError) as exc:
        raise RuntimeError("译文 PDF 结构验收失败") from exc
    if quality["status"]=="review-needed":
        import logging
        logging.getLogger(__name__).warning(
            "PDF 翻译版面需要人工复核：%s 个越界文本对象",
            quality["outside_text_spans"])
    return winner.read_bytes()

def installed_ocr_languages():
    if not shutil.which("tesseract"):return []
    try:
        result=subprocess.run(["tesseract","--list-langs"],check=True,
            capture_output=True,timeout=6,text=True)
        names=set(result.stdout.splitlines()+result.stderr.splitlines())
        return [language for language,pack in LANGS.items() if pack in names]
    except (OSError,subprocess.CalledProcessError,subprocess.TimeoutExpired):
        return []


def server_port_valid():
    try:
        configured_server_port()
        return True
    except ValueError:
        return False


@app.get("/health")
def health(x_pit_token: str|None=Header(None)):
    if not authorized(x_pit_token): raise HTTPException(status_code=401)
    asr_ready=(bool(ASR_MODEL and pathlib.Path(ASR_MODEL).is_file() and shutil.which(ASR_BIN))
               if ASR_BACKEND=="cli" else
               model_available() if ASR_BACKEND=="faster" else
               ASR_BACKEND=="server" and ASR_SERVER_EXPERIMENTAL and server_is_ready())
    babeldoc_cli=inspect_babeldoc_cli()
    return {
        "ready":bool(KEY and babeldoc_cli["compatible"]),
        "babeldoc_cli":babeldoc_cli,
        "pdf_ocr":bool(shutil.which("ocrmypdf") and shutil.which("tesseract")),
        "image_ocr":bool(shutil.which("tesseract")),
        "speech_asr":asr_ready,
        "speech_asr_backend":ASR_BACKEND,
        "speech_asr_verified":ASR_BACKEND=="server" and asr_ready,
        "speech_asr_model_loaded":ASR_BACKEND=="faster" and model_loaded(),
        "speech_asr_requires_risk_ack":ASR_BACKEND=="server" and not ASR_SERVER_EXPERIMENTAL,
        "languages":list(LANGS.keys()),
        "installed_ocr_languages":installed_ocr_languages(),
        "engine":"local-only"
    }


def parse_ocr_layout(tsv: str, width: int, height: int):
    """Extract bounded image-relative text lines, never executable markup."""
    if width < 1 or height < 1: return []
    lines={}
    for row in csv.DictReader(io.StringIO(tsv),delimiter="\t"):
        try:
            if row.get("level") != "5":continue
            word=(row.get("text") or "").strip()
            if not word:continue
            x,y,w,h=(int(row[k]) for k in ("left","top","width","height"))
            if w < 1 or h < 1 or x < 0 or y < 0 or x >= width or y >= height:continue
            key=tuple(row.get(k,"") for k in ("page_num","block_num","par_num","line_num"))
            if key not in lines:lines[key]={"words":[],"x":x,"y":y,"r":x+w,"b":y+h}
            item=lines[key]
            item["words"].append(word)
            item["x"]=min(item["x"],x);item["y"]=min(item["y"],y)
            item["r"]=max(item["r"],min(x+w,width))
            item["b"]=max(item["b"],min(y+h,height))
        except (ValueError,KeyError,TypeError):
            continue
    result=[]
    for item in lines.values():
        txt=" ".join(item["words"])[:500].strip()
        if not txt:continue
        result.append({"text":txt,"x":item["x"],"y":item["y"],
                       "w":item["r"]-item["x"],"h":item["b"]-item["y"]})
        if len(result)>=80:break
    return result


@app.post("/ocr-image")
async def ocr_image(image: UploadFile=File(...), source: str=Form("en"),
                    layout: bool=Form(False), x_pit_token: str|None=Header(None)):
    if not authorized(x_pit_token): raise HTTPException(status_code=401)
    if source not in LANGS:raise HTTPException(status_code=400,detail="语言代码无效")
    if image.content_type not in ("image/png","image/jpeg","image/webp"):
        raise HTTPException(status_code=415,detail="不支持的图片格式")
    payload=await image.read(8_000_001)
    if len(payload)>8_000_000:raise HTTPException(status_code=413)
    if not shutil.which("tesseract"):raise HTTPException(status_code=503,detail="未安装 Tesseract OCR")
    # Image formats are not interchangeable: a WebP payload saved as .jpg
    # may fail in Tesseract. Normalize with the actual Pillow decoder, correct
    # mobile EXIF orientation, and guard against huge decompression bombs.
    try:
        with Image.open(io.BytesIO(payload)) as original:
            width,height=original.size
            if width<1 or height<1 or width*height>20_000_000:
                raise ValueError("图片像素超过 2000 万上限")
            normalized=ImageOps.exif_transpose(original).convert("RGB")
            with tempfile.TemporaryDirectory(prefix="pit-ocr-") as temp:
                path=pathlib.Path(temp)/"normalized.png"
                normalized.save(path,format="PNG")
                try:
                    result=await asyncio.to_thread(subprocess.run,
                        ["tesseract",str(path),"stdout","-l",LANGS[source]],
                        capture_output=True,timeout=100,check=True)
                except (subprocess.CalledProcessError,subprocess.TimeoutExpired) as exc:
                    raise HTTPException(status_code=422,detail="OCR 识别失败，请安装对应语言包") from exc
                boxes=[]
                if layout:
                    try:
                        tsv=await asyncio.to_thread(subprocess.run,
                            ["tesseract",str(path),"stdout","-l",LANGS[source],"tsv"],
                            capture_output=True,timeout=100,check=True)
                        boxes=parse_ocr_layout(tsv.stdout.decode("utf8",errors="replace"),
                                               normalized.width,normalized.height)
                    except (subprocess.CalledProcessError,subprocess.TimeoutExpired):
                        boxes=[]  # Plain OCR text remains usable as a fallback.
    except (UnidentifiedImageError,OSError,ValueError,Image.DecompressionBombError) as exc:
        raise HTTPException(status_code=422,detail="图片损坏、格式不匹配或尺寸超限") from exc
    response={"original_text":result.stdout.decode("utf8",errors="replace")[:12000]}
    if layout:
        response.update({"image_width":normalized.width,"image_height":normalized.height,
                         "lines":boxes})
    return response


def validate_asr_wav(data: bytes):
    """Accept the exact mono PCM16, 16kHz WAV format emitted by the extension."""
    if len(data) < 46 or len(data) > 44 + 16_000 * 2 * 12:
        raise ValueError("PCM WAV 时长无效")
    if data[:4] != b"RIFF" or data[8:12] != b"WAVE" or data[12:16] != b"fmt ":
        raise ValueError("不支持该音频封装")
    if struct.unpack_from("<I",data,4)[0] != len(data)-8:
        raise ValueError("WAV 文件长度不一致")
    if struct.unpack_from("<I",data,16)[0] != 16 or data[36:40] != b"data":
        raise ValueError("只支持标准 44 字节 PCM WAV")
    codec,channels,rate,byte_rate,align,bits=struct.unpack_from("<HHIIHH",data,20)
    if (codec,channels,rate,byte_rate,align,bits)!=(1,1,16000,32000,2,16):
        raise ValueError("Whisper 仅接受 16 kHz / 16-bit / 单声道 PCM")
    if struct.unpack_from("<I",data,40)[0] != len(data)-44:
        raise ValueError("PCM 数据区大小无效")
    return (len(data)-44)//2

ASR_MODEL=os.environ.get("PIT_WHISPER_MODEL","")
ASR_BIN=os.environ.get("PIT_WHISPER_BIN","whisper-cli")
ASR_BACKEND=os.environ.get("PIT_ASR_BACKEND","cli").strip().lower()
ASR_SERVER_EXPERIMENTAL=os.environ.get("PIT_ACK_UNAUTH_WHISPER_SERVER","")=="1"
asr_lock=asyncio.Lock()
@app.post("/asr")
async def transcribe_audio(audio: UploadFile=File(...),x_pit_token: str|None=Header(None)):
    if not authorized(x_pit_token): raise HTTPException(status_code=401)
    if ASR_BACKEND=="server":
        if not ASR_SERVER_EXPERIMENTAL:
            raise HTTPException(status_code=503,
                detail="常驻 Whisper server 默认禁用；需确认本机独立服务的跨域安全风险")
        try:
            configured_server_port()
        except ValueError as exc:
            raise HTTPException(status_code=503,detail="本机 Whisper server 端口配置无效") from exc
    elif ASR_BACKEND=="faster":
        if not model_available():
            raise HTTPException(status_code=503,
                detail="请安装 faster-whisper，并配置含模型文件的本机目录（不自动下载）")
    elif ASR_BACKEND=="cli":
        if not ASR_MODEL or not pathlib.Path(ASR_MODEL).is_file() or not shutil.which(ASR_BIN):
            raise HTTPException(status_code=503,detail="尚未配置本地 Whisper 模型或 whisper-cli")
    else:
        raise HTTPException(status_code=503,detail="PIT_ASR_BACKEND 只能为 cli、faster 或 server")
    data=await audio.read(2_000_001)
    try:
        validate_asr_wav(data)
    except ValueError as exc:
        raise HTTPException(status_code=400,detail=str(exc)) from exc
    if asr_lock.locked():
        raise HTTPException(status_code=429,detail="语音模型繁忙；当前音频片段已跳过")
    async with asr_lock:
        if ASR_BACKEND=="faster":
            try:
                text=await asyncio.to_thread(transcribe_local,data)
            except (RuntimeError,ValueError,OSError) as exc:
                raise HTTPException(status_code=503,
                    detail="本机 faster-whisper 模型加载或语音识别失败") from exc
            return {"text":text}
        if ASR_BACKEND=="server":
            try:
                text=await transcribe_server(data)
            except (httpx.HTTPError,RuntimeError,ValueError) as exc:
                raise HTTPException(status_code=503,detail="本机 Whisper server 无法识别该语音片段，请检查独立模型服务") from exc
            return {"text":text}
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
    if pdf_lock.locked():
        raise HTTPException(status_code=429,detail="已有 PDF 正在翻译，请待其完成后再试")
    async with pdf_lock:
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
