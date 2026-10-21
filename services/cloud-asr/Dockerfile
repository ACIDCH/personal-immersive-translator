# Separate MIT-licensed faster-whisper CPU ASR service for PIT.
# Build downloads a PINNED public MIT Systran tiny CTranslate2 checkpoint.
# No model fetch or remote executable code at runtime; container has no GPU.
# Production p95 latency and machine budget must be measured on Railway.
FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 PORT=8080 \
    HF_HUB_DISABLE_TELEMETRY=1
WORKDIR /opt/pit
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 \
    && rm -rf /var/lib/apt/lists/*
COPY services/requirements-faster-whisper.txt services/requirements-faster-whisper.txt
RUN pip install --no-cache-dir -r services/requirements-faster-whisper.txt \
    'huggingface_hub>=0.24,<2' 'fastapi>=0.115,<1' 'uvicorn>=0.30,<1'
RUN python - <<'PY'
from huggingface_hub import snapshot_download
snapshot_download(
    repo_id="Systran/faster-whisper-tiny",
    revision="d90ca5fe260221311c53c58e660288d3deb8d356",
    local_dir="/opt/pit/model",
    allow_patterns=["model.bin","config.json","tokenizer.json","vocabulary.txt"]
)
PY
COPY services services
ENV PIT_FASTER_WHISPER_MODEL_DIR=/opt/pit/model \
    HF_HUB_OFFLINE=1
RUN useradd -r -u 10001 -m pit && chown -R pit:pit /opt/pit
USER pit
EXPOSE 8080
CMD ["sh","-c","exec uvicorn services.cloud_asr_api:app --host 0.0.0.0 --port ${PORT:-8080} --workers 1 --no-access-log"]
