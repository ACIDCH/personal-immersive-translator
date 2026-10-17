# Separate AGPL BabelDOC service, NOT bundled into the MIT Chrome extension.
# Memory-intensive: configure 2-4GiB+, single concurrency and long HTTP timeout.
FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 PORT=8080
WORKDIR /opt/pit
RUN apt-get update && apt-get install -y --no-install-recommends \
    ghostscript tesseract-ocr tesseract-ocr-eng tesseract-ocr-chi-sim \
    tesseract-ocr-fra tesseract-ocr-jpn tesseract-ocr-kor \
    tesseract-ocr-deu tesseract-ocr-spa ocrmypdf libglib2.0-0 libgl1 \
    fonts-noto-cjk && rm -rf /var/lib/apt/lists/*
COPY services/requirements.txt services/requirements.txt
COPY services/requirements-babeldoc.txt services/requirements-babeldoc.txt
RUN pip install -r services/requirements.txt -r services/requirements-babeldoc.txt \
    'langdetect>=1.0.9,<2'
COPY services services
RUN useradd -r -u 10001 -m pit && chown -R pit:pit /opt/pit
USER pit
EXPOSE 8080
# Cloud HTTPS and authentication are provided by the hosting ingress and
# bearer token; the container itself must NOT be exposed unauthenticated.
CMD ["sh","-c","exec uvicorn services.cloud_pdf_api:app --host 0.0.0.0 --port ${PORT:-8080} --workers 1 --no-access-log"]
