"""Offline, opt-in Windows/Linux/macOS whisper.cpp latency benchmark.

Runs the *same* whisper-cli per-chunk interface used by the local bridge.
No network calls, audio uploads, transcript logging or invented metrics.
Usage:
  python benchmarks/whisper_real_device.py --model PATH --input sample-3sec.wav
  python benchmarks/whisper_real_device.py --model PATH --input sample-3sec.wav --count 600
The latter repeats 3 seconds of authorized sample audio 600 times (~30 min of
audio processed); it does not substitute for 30 min of real video playback.
"""
import argparse
import json
import math
import pathlib
import statistics
import subprocess
import tempfile
import time
import wave


def wav_duration(path):
    with wave.open(str(path), "rb") as wav:
        if (wav.getnchannels(), wav.getsampwidth(), wav.getframerate()) != (1, 2, 16000):
            raise ValueError("必须使用单声道 16-bit 16kHz PCM WAV")
        seconds=wav.getnframes()/16000
    if not 0.4 <= seconds <= 12:
        raise ValueError("录音样本应为 0.4 至 12 秒")
    return seconds


def summarize(samples, failures, duration):
    if not samples:
        return {"runs":0,"failures":failures,"p50_ms":None,"p95_ms":None,
                "dropped_over_12s":0}
    values=sorted(round(x*1000) for x in samples)
    percentile=lambda p:values[math.ceil(p*len(values))-1]
    return {"runs":len(samples),"failures":failures,
            "p50_ms":percentile(.5),"p95_ms":percentile(.95),
            "dropped_over_12s":sum(x>12000 for x in values),
            "mean_realtime_factor":round(statistics.mean(samples)/duration,3),
            "model_loading_included":True}


def run(cli, model, filename, count, timeout):
    if not pathlib.Path(model).is_file():
        raise ValueError("请指定真实存在的 multilingual whisper.cpp 模型")
    seconds=wav_duration(filename)
    durations=[]
    failures=0
    for index in range(count):
        with tempfile.TemporaryDirectory(prefix="pit-whisper-bench-") as temp:
            out=pathlib.Path(temp)/"transcript"
            command=[cli,"-m",str(model),"-f",str(filename),"-l","auto",
                     "-otxt","-of",str(out),"-np"]
            start=time.perf_counter()
            try:
                subprocess.run(command,stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,check=True,timeout=timeout)
                durations.append(time.perf_counter()-start)
            except (OSError,subprocess.SubprocessError):
                failures+=1
        # All transcripts disappear with TemporaryDirectory. Only timing
        # aggregates are emitted. Stop early if the configured model fails.
        if failures >= 4:
            break
    return summarize(durations,failures,seconds)


if __name__=="__main__":
    parser=argparse.ArgumentParser(description="Whisper real-device inference measurements")
    parser.add_argument("--model",required=True,type=pathlib.Path)
    parser.add_argument("--input",required=True,type=pathlib.Path)
    parser.add_argument("--cli",default="whisper-cli")
    parser.add_argument("--count",type=int,default=10)
    parser.add_argument("--timeout",type=int,default=40)
    args=parser.parse_args()
    if not 1 <= args.count <= 600 or not 5 <= args.timeout <= 180:
        parser.error("count 必须为 1–600，timeout 为 5–180 秒")
    print(json.dumps(run(args.cli,args.model,args.input,args.count,args.timeout),
                     ensure_ascii=False,indent=2))
