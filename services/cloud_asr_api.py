"""PIT independently deployable cloud ASR for Chrome tab-capture subtitles.

The model is locally installed in the server container at image build time.
Audio is received only on an explicitly authorized, Bearer-token request and
is never stored or logged. CPU/latency/cost must be verified on the actual host.
"""
import asyncio
import io
import os
import secrets
import wave
from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from services.faster_whisper_backend import model_available, model_loaded, transcribe_local

app=FastAPI(title="PIT Cloud ASR",docs_url=None,redoc_url=None,openapi_url=None)
app.add_middleware(CORSMiddleware,
    allow_origin_regex=r"^chrome-extension://[a-z]{32}$",
    allow_methods=["GET","POST","OPTIONS"],
    allow_headers=["Authorization","Content-Type"])
asr_lock=asyncio.Lock()
MAX_AUDIO_BYTES=400_000
MAX_AUDIO_SECONDS=12

def require_auth(header):
    token=os.environ.get("PIT_CLOUD_ASR_TOKEN","")
    if not token or len(token)<16 or not header or not secrets.compare_digest(
        header,"Bearer "+token):
        raise HTTPException(status_code=401,detail="ASR authorization required")

def validate_audio(data):
    if not isinstance(data,bytes) or len(data)<44 or len(data)>MAX_AUDIO_BYTES:
        raise ValueError("Audio must be bounded 16kHz PCM16 mono WAV")
    try:
        with wave.open(io.BytesIO(data),"rb") as audio:
            if (audio.getnchannels(),audio.getsampwidth(),audio.getframerate(),
                audio.getcomptype())!=(1,2,16000,"NONE"):
                raise ValueError("Expected mono 16kHz PCM16 WAV")
            if not 1<=audio.getnframes()<=16000*MAX_AUDIO_SECONDS:
                raise ValueError("Audio duration must be 0-12 seconds")
            # Reject truncated or malicious RIFF data before model inference.
            if len(audio.readframes(audio.getnframes()))!=audio.getnframes()*2:
                raise ValueError("Truncated PCM data")
    except (EOFError,wave.Error,ValueError) as exc:
        raise ValueError("Invalid 16kHz PCM16 mono WAV") from exc

@app.get("/livez")
def livez():
    return {"status":"alive"}

@app.get("/v1/capabilities")
def capabilities(authorization:str|None=Header(default=None)):
    require_auth(authorization)
    available=model_available()
    return {
        "ready":bool(available),
        "routes":{"asr":"ready" if available else "unavailable"},
        "engine":"faster-whisper local CTranslate2 CPU",
        "model_loaded":model_loaded(),
        "max_audio_seconds":MAX_AUDIO_SECONDS
    }

@app.post("/v1/asr")
async def speech(request:Request,authorization:str|None=Header(default=None)):
    require_auth(authorization)
    if request.headers.get("content-type","").split(";")[0].strip().lower() not in (
        "audio/wav","audio/wave","audio/x-wav"):
        raise HTTPException(status_code=415,detail="Use audio/wav")
    if not model_available():
        raise HTTPException(status_code=503,detail="Whisper model unavailable")
    parts=[];size=0
    async for part in request.stream():
        size+=len(part)
        if size>MAX_AUDIO_BYTES:
            raise HTTPException(status_code=413,detail="Audio too large")
        parts.append(part)
    try:
        data=b"".join(parts)
        validate_audio(data)
    except ValueError as exc:
        raise HTTPException(status_code=400,detail=str(exc)) from exc
    if asr_lock.locked():
        raise HTTPException(status_code=429,detail="ASR worker busy")
    async with asr_lock:
        try:
            result=await asyncio.wait_for(
                asyncio.to_thread(transcribe_local,data,return_metadata=True),
                timeout=22
            )
        except (RuntimeError,OSError,ValueError,asyncio.TimeoutError) as exc:
            raise HTTPException(status_code=503,detail="Whisper inference unavailable or timed out") from exc
    if not isinstance(result,dict) or not isinstance(result.get("text"),str):
        raise HTTPException(status_code=502,detail="Whisper returned invalid transcript")
    # Result structure matches PIT offscreen normalizeAsrResult.
    return result
