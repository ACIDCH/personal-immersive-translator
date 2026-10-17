"""Execute PIT's production in-process ASR with a real CTranslate2 model.

Unlike API mocks, the downloaded MIT-licensed Systran tiny checkpoint runs
actual CPU inference. A locally generated espeak voice is synthetic speech:
these metrics do NOT certify human speech, a 30-minute browser session, or a
user's actual laptop/latency. No audio/text or model is uploaded to CI artifacts.
"""
import argparse
import json
import math
import os
from pathlib import Path
import shutil
import statistics
import subprocess
import tempfile
import time
import wave

MODEL_REPO="Systran/faster-whisper-tiny"
# Immutable model revision: don't implicitly fetch an evolving weight file.
MODEL_REVISION="d90ca5fe260221311c53c58e660288d3deb8d356"
WORDS=[
    ("en","en","Welcome to our financial markets lecture."),
    ("en","en","We are studying economic growth and market demand."),
    ("fr","fr","Bonjour, bienvenue dans notre cours de français."),
]


def duration_seconds(wav:bytes)->float:
    import io
    with wave.open(io.BytesIO(wav),'rb') as stream:
        if (stream.getnchannels(),stream.getsampwidth(),stream.getframerate())!=(1,2,16000):
            raise ValueError("Expected 16 kHz mono PCM16")
        return stream.getnframes()/16000


def synthesize(voice:str,sentence:str)->bytes:
    # espeak only generates local synthetic test audio, no cloud TTS.
    if not shutil.which("espeak"):
        raise RuntimeError("espeak is required for the synthetic audio fixture")
    with tempfile.TemporaryDirectory(prefix="pit-real-asr-") as directory:
        output=Path(directory)/"source.wav"
        subprocess.run(["espeak","-v",voice,"-s","132","-w",str(output),sentence],
                       check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=20)
        # espeak normally emits 22050Hz mono PCM16; resample with auditable
        # standard-library audioop when available, or scipy on Python 3.13+.
        import numpy as np
        with wave.open(str(output),"rb") as w:
            if w.getnchannels()!=1 or w.getsampwidth()!=2:
                raise RuntimeError("Unexpected synthesized WAV format")
            samples=np.frombuffer(w.readframes(w.getnframes()),dtype="<i2")
            rate=w.getframerate()
        from scipy.signal import resample_poly
        from math import gcd
        divisor=gcd(rate,16000)
        normalized=resample_poly(samples.astype("float32"),16000//divisor,rate//divisor)
        normalized=np.clip(np.round(normalized),-32768,32767).astype("<i2")
        import io
        buf=io.BytesIO()
        with wave.open(buf,"wb") as w:
            w.setnchannels(1);w.setsampwidth(2);w.setframerate(16000)
            w.writeframes(normalized.tobytes())
        return buf.getvalue()


def run(n:int,model_path:str)->dict:
    from services import faster_whisper_backend as native
    os.environ["PIT_FASTER_WHISPER_MODEL_DIR"]=model_path
    native.model_directory()
    timings=[];examples=[];results=0;audio_sec=0.0
    for i in range(n):
        lang,voice,sentence=WORDS[i%len(WORDS)]
        audio=synthesize(voice,sentence)
        duration=duration_seconds(audio)
        start=time.perf_counter()
        spoken=native.transcribe_local(audio)
        elapsed=time.perf_counter()-start
        if not isinstance(spoken,str) or not spoken.strip():
            raise RuntimeError("Real CTranslate2 inference produced empty transcript")
        timings.append(elapsed)
        audio_sec+=duration
        results+=1
        # No transcript in logs: track only approximate word overlap, CER and
        # model accuracy are intentionally NOT treated as passing here.
        import re
        words=lambda s:set(re.findall(r"\w+",s.lower()))
        overlap=len(words(sentence)&words(spoken))
        examples.append({"language":lang,"duration_sec":round(duration,2),
                         "matched_reference_words":overlap,
                         "reference_word_count":len(words(sentence)),
                         "inference_ms":round(elapsed*1000)})
    ordered=sorted(timings)
    at=lambda fraction:round(ordered[math.ceil(len(ordered)*fraction)-1]*1000)
    return {"engine":"production PIT faster_whisper_backend.transcribe_local",
            "model":MODEL_REPO,"model_revision":MODEL_REVISION,
            "speech_origin":"espeak synthetic TTS (NOT human)",
            "audio_saved":False,"count":results,"inferred_audio_seconds":round(audio_sec,1),
            "p50_inference_ms":at(.5),"p95_inference_ms":at(.95),
            "mean_realtime_factor":round(statistics.mean(timings)/statistics.mean(
                x["duration_sec"] for x in examples),3),
            "measurements":examples,
            "status":"real-model-inference-pass (NOT streaming/browser/UAT)"}


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--model-dir",type=Path)
    parser.add_argument("--download",action="store_true",
                        help="Explicitly download the pinned public MIT model")
    parser.add_argument("--count",type=int,default=3)
    parser.add_argument("--report",type=Path,default=Path("real-asr-synthetic-report.json"))
    args=parser.parse_args()
    if not 1<=args.count<=600:parser.error("--count must be 1..600")
    if args.download:
        from huggingface_hub import snapshot_download
        model=snapshot_download(repo_id=MODEL_REPO,revision=MODEL_REVISION,
            allow_patterns=["model.bin","config.json","tokenizer.json","vocabulary.txt"],
            local_dir=str(args.model_dir) if args.model_dir else None)
    elif args.model_dir:
        model=str(args.model_dir.resolve())
    else:
        parser.error("Specify --model-dir for an existing checkpoint or --download")
    report=run(args.count,model)
    args.report.parent.mkdir(parents=True,exist_ok=True)
    args.report.write_text(json.dumps(report,indent=2,ensure_ascii=False)+"\n",encoding="utf-8")
    print(json.dumps({"status":report["status"],"runs":report["count"],
                      "p50_inference_ms":report["p50_inference_ms"],
                      "p95_inference_ms":report["p95_inference_ms"],
                      "speech_origin":report["speech_origin"]},ensure_ascii=False))


if __name__=="__main__":
    main()
