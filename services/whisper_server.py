"""Optional persistent whisper.cpp server adapter. No model or audio leaves loopback.

The upstream whisper-server loads the model ONCE when started separately:
whisper-server -m /path/to/ggml-small.bin --host 127.0.0.1 --port 8080

Set PIT_ASR_BACKEND=server (default: cli) and PIT_WHISPER_SERVER_PORT=8080.
Only 127.0.0.1 is permitted, with environment proxies and redirects disabled.
"""
import os
import httpx


def configured_server_port(raw=None):
    if raw is None:
        raw=os.environ.get("PIT_WHISPER_SERVER_PORT","8080")
    value=str(raw)
    if not value.isascii() or not value.isdecimal():
        raise ValueError("Whisper server 端口必须是数字")
    port=int(value)
    if not 1024 <= port <= 65535:
        raise ValueError("Whisper server 只允许 1024–65535 的本机端口")
    return port


async def transcribe_server(wav: bytes, port: int | None = None, transport=None) -> str:
    """Send one validated WAV to a preloaded local model; never upload online."""
    selected=configured_server_port() if port is None else configured_server_port(port)
    endpoint=f"http://127.0.0.1:{selected}/inference"
    options={"language":"auto","response_format":"json",
             "temperature":"0.0","no_context":"true","no_timestamps":"true"}
    timeout=httpx.Timeout(timeout=12.0,connect=2.0)
    async with httpx.AsyncClient(timeout=timeout,transport=transport,
                                 trust_env=False,follow_redirects=False) as client:
        response=await client.post(endpoint,
            files={"file":("chunk.wav",wav,"audio/wav")},data=options)
    if response.status_code!=200 or len(response.content)>200_000:
        raise RuntimeError("本机 Whisper server 暂时不可用或响应过大")
    try:
        body=response.json()
    except ValueError as error:
        raise RuntimeError("本机 Whisper server 返回了非 JSON 响应") from error
    result=body.get("text") if isinstance(body,dict) else None
    if not isinstance(result,str):
        raise RuntimeError("Whisper server 响应格式不兼容")
    return result.strip()[:5000]
