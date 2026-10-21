"""Optional in-process, single-model local ASR using SYSTRAN faster-whisper (MIT).

NO model download, unauthenticated extra HTTP server, or audio persistence.
A model supplied by the user must be a local CTranslate2 Whisper directory.
The existing FastAPI token protects the only external-facing inference route.
"""
import importlib.util
import os
from pathlib import Path
import threading
import wave
import io

_model=None
_model_path=None
_model_lock=threading.Lock()

def model_directory(raw=None):
    value=os.environ.get("PIT_FASTER_WHISPER_MODEL_DIR","") if raw is None else raw
    if not isinstance(value,str) or not value.strip():
        raise ValueError("未指定本机 CTranslate2 Whisper 模型目录")
    try:
        path=Path(value).expanduser().resolve(strict=True)
    except (OSError,RuntimeError) as exc:
        raise ValueError("本机 CTranslate2 模型目录不存在或无法读取") from exc
    if not path.is_dir():
        raise ValueError("Whisper 模型路径必须是本地目录")
    if not all((path/name).is_file() for name in ("model.bin","config.json","tokenizer.json")):
        raise ValueError("缺少 model.bin、config.json 或 tokenizer.json，本机模型不完整")
    return path

def model_available():
    try:
        model_directory()
    except (OSError,ValueError):
        return False
    return importlib.util.find_spec("faster_whisper") is not None

def model_loaded():
    try:
        return _model is not None and _model_path==model_directory()
    except (OSError,ValueError):
        return False

def _get_model(factory=None):
    """Load once, protected by the same thread lock as native inference."""
    global _model,_model_path
    path=model_directory()
    if _model is not None and _model_path==path:
        return _model
    if factory is None:
        try:
            from faster_whisper import WhisperModel
        except ImportError as exc:
            raise RuntimeError("请额外安装 faster-whisper Python 引擎") from exc
        factory=WhisperModel
    # Strict local path + local_files_only: no model or tokenizer network downloads.
    loaded=factory(str(path),device="cpu",compute_type="int8",
                   num_workers=1,local_files_only=True)
    _model=loaded
    _model_path=path
    return loaded

def transcribe_local(wav_bytes: bytes, factory=None, return_metadata=False):
    """Called in worker thread; serialize actual native CPU inference.

    FastAPI validates 16 kHz mono PCM16 before reaching this module.
    """
    import numpy as np
    with _model_lock:
        model=_get_model(factory)
        with wave.open(io.BytesIO(wav_bytes),"rb") as source:
            if (source.getnchannels(),source.getsampwidth(),source.getframerate())!=(1,2,16000):
                raise ValueError("只接受 16kHz/PCM16/Mono")
            if source.getnframes() > 16_000*12:
                raise ValueError("语音片段超过 12 秒")
            raw=source.readframes(source.getnframes())
        samples=np.frombuffer(raw,dtype="<i2").astype(np.float32)/32768.0
        if samples.size==0:
            return {"text":"","segments":[]} if return_metadata else ""
        segments,info=model.transcribe(
            samples,beam_size=1,best_of=1,language=None,
            vad_filter=False,without_timestamps=True,
            condition_on_previous_text=False)
        # Upstream segment generator runs inference only when iterated.
        # Never fabricate language from the webpage UI or filename.
        parsed=[]
        for segment in segments:
            chunk=str(getattr(segment,"text","")).strip()
            if not chunk:continue
            entry={"text":chunk[:1200]}
            start=getattr(segment,"start",None)
            end=getattr(segment,"end",None)
            if isinstance(start,(int,float)) and isinstance(end,(int,float)) and (
                0<=start<=end<=30):
                entry.update(start=float(start),end=float(end))
            parsed.append(entry)
            if len(parsed)>=100:break
        text=" ".join(segment["text"] for segment in parsed).strip()[:5000]
        if not return_metadata:return text
        response={"text":text,"segments":parsed}
        raw_lang=getattr(info,"language",None)
        if isinstance(info,dict):raw_lang=info.get("language")
        if isinstance(raw_lang,str) and raw_lang.lower() in (
            "en","fr","zh","de","es","ja","ko"):
            response["language"]=raw_lang.lower()
            confidence=getattr(info,"language_probability",None)
            if isinstance(info,dict):confidence=info.get("language_probability")
            if isinstance(confidence,(int,float)) and 0<=confidence<=1:
                response["languageConfidence"]=float(confidence)
        return response
