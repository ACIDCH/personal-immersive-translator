"""Offline integration regression for actual Whisper server protocol and PDF quality."""
import importlib
import io
import os
import tempfile
import unittest
import wave
from pathlib import Path
from unittest.mock import AsyncMock,patch

import fitz
import httpx
from fastapi.testclient import TestClient
from services.pdf_quality import inspect_pair
from services.whisper_server import configured_server_port,transcribe_server,server_is_ready

os.environ.setdefault("PIT_BRIDGE_TOKEN","test-local-secret-at-least-16")
os.environ.setdefault("DEEPSEEK_API_KEY","fake-test-key-never-use")
from services import babeldoc_bridge as bridge


def pcm_sample():
    buffer=io.BytesIO()
    with wave.open(buffer,"wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(16000)
        wav.writeframes(b"\x00\x00"*16000)
    return buffer.getvalue()


def make_pdf(path,pages=("Academic finance lecture",)):
    document=fitz.open()
    for text in pages:
        page=document.new_page()
        if text:page.insert_text((40,72),text,fontsize=14)
    document.save(path)
    document.close()


class ServerAdapterTest(unittest.IsolatedAsyncioTestCase):
    async def test_server_uses_only_loopback_and_whisper_protocol(self):
        requests=[]
        def handler(request):
            requests.append(request)
            assert str(request.url)=="http://127.0.0.1:8080/inference"
            assert request.method=="POST"
            data=request.read()
            assert b"response_format" in data and b"json" in data
            assert b"language" in data and b"auto" in data
            assert b"chunk.wav" in data
            assert b"RIFF" in data
            return httpx.Response(200,json={"text":"bonjour monde"})
        result=await transcribe_server(pcm_sample(),port=8080,
            transport=httpx.MockTransport(handler))
        self.assertEqual(result,"bonjour monde")
        self.assertEqual(len(requests),1)

    async def test_server_rejects_redirects_and_bad_payload(self):
        redirect=httpx.MockTransport(lambda r:httpx.Response(302,headers={
            "location":"https://remote-server.example/upload"}))
        with self.assertRaises(RuntimeError):
            await transcribe_server(pcm_sample(),port=8080,transport=redirect)
        broken=httpx.MockTransport(lambda r:httpx.Response(200,json={"segments":[]}))
        with self.assertRaises(RuntimeError):
            await transcribe_server(pcm_sample(),port=8080,transport=broken)

    async def test_health_distinguishes_running_server_from_open_port_only(self):
        valid=httpx.MockTransport(lambda request:httpx.Response(200,
            headers={"server":"whisper.cpp"},text="whisper local server"))
        wrong=httpx.MockTransport(lambda request:httpx.Response(200,
            headers={"server":"unrelated"},text="unrelated local process"))
        self.assertTrue(server_is_ready(port=8080,transport=valid))
        self.assertFalse(server_is_ready(port=8080,transport=wrong))

    async def test_invalid_ports_rejected(self):
        for value in ("0","80","65536","-1","1000x","8080/../../remote",
                      "https://outside.example",""):
            with self.assertRaises(ValueError):
                configured_server_port(value)


class BridgeServerTest(unittest.TestCase):
    def setUp(self):
        self.client=TestClient(bridge.app)
        self.headers={"X-PIT-Token":"test-local-secret-at-least-16"}

    def test_server_backend_processes_valid_wav_without_loading_cli(self):
        with patch.object(bridge,"ASR_BACKEND","server"),\
             patch.object(bridge,"transcribe_server",new_callable=AsyncMock,
                          return_value="recognised French speech") as backend,\
             patch.object(bridge,"ASR_MODEL",""),\
             patch.object(bridge,"ASR_BIN","missing-whisper-cli"):
            result=self.client.post("/asr",headers=self.headers,
                files={"audio":("sample.wav",pcm_sample(),"audio/wav")})
        self.assertEqual(result.status_code,200,result.text)
        self.assertEqual(result.json(),{"text":"recognised French speech"})
        backend.assert_awaited_once()
        self.assertEqual(backend.call_args.args[0],pcm_sample())

    def test_server_backend_rejects_invalid_wav_before_contact(self):
        with patch.object(bridge,"ASR_BACKEND","server"),\
             patch.object(bridge,"transcribe_server",new_callable=AsyncMock) as backend:
            result=self.client.post("/asr",headers=self.headers,
                files={"audio":("bad.wav",b"oops","audio/wav")})
        self.assertEqual(result.status_code,400)
        backend.assert_not_awaited()


class RealLoopbackTransportTest(unittest.TestCase):
    """Actual socket, multipart upload, protected FastAPI forwarding.

    The HTTP responder is a harmless local fixture, NOT a real Whisper model.
    """
    def test_live_loopback_asr_request_uses_persistent_server(self):
        import json
        from http.server import ThreadingHTTPServer,BaseHTTPRequestHandler
        from threading import Thread
        import asyncio

        class Handler(BaseHTTPRequestHandler):
            server_version="whisper.cpp"
            sys_version=""
            def version_string(self):
                return "whisper.cpp"
            def do_GET(self):
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b"local server")
            def do_POST(self):
                if self.path!="/inference":
                    self.send_error(404)
                    return
                size=int(self.headers.get("Content-Length",0))
                if not 0<size<1000000:
                    self.send_error(413)
                    return
                request=self.rfile.read(size)
                self.server.requests.append(request)
                response=json.dumps({"text":"recognized speech from local server"}).encode()
                self.send_response(200)
                self.send_header("Content-Type","application/json")
                self.send_header("Content-Length",str(len(response)))
                self.end_headers()
                self.wfile.write(response)
            def log_message(self,*args):
                return

        server=ThreadingHTTPServer(("127.0.0.1",0),Handler)
        server.requests=[]
        worker=Thread(target=server.serve_forever,daemon=True)
        worker.start()
        try:
            port=server.server_address[1]
            self.assertTrue(server_is_ready(port))
            transcript=asyncio.run(transcribe_server(pcm_sample(),port))
            self.assertEqual(transcript,"recognized speech from local server")
            with patch.object(bridge,"ASR_BACKEND","server"),\
                 patch.dict(os.environ,{"PIT_WHISPER_SERVER_PORT":str(port)}):
                reply=TestClient(bridge.app).post("/asr",
                    headers={"X-PIT-Token":"test-local-secret-at-least-16"},
                    files={"audio":("chunk.wav",pcm_sample(),"audio/wav")})
            self.assertEqual(reply.status_code,200,reply.text)
            self.assertEqual(reply.json()["text"],transcript)
            self.assertEqual(len(server.requests),2)
            self.assertTrue(all(b"RIFF" in raw and b"chunk.wav" in raw
                                for raw in server.requests))
        finally:
            server.shutdown()
            server.server_close()
            worker.join(timeout=2)


class PdfQualityTest(unittest.TestCase):
    def test_structural_pass_and_page_retention(self):
        with tempfile.TemporaryDirectory() as root:
            source=Path(root)/"original.pdf"
            translated=Path(root)/"dual.pdf"
            make_pdf(source,["Finance methods and data interpretation"])
            make_pdf(translated,["Finance methods and data interpretation",
                                  "金融建模翻译示例"])
            result=inspect_pair(source,translated)
            self.assertEqual(result["status"],"structural-pass")
            self.assertEqual(result["input_pages"],1)
            self.assertEqual(result["output_pages"],2)
            self.assertNotIn("text",str(result.get("source_text","")))

    def test_rejects_missing_pages_and_flattened_text(self):
        with tempfile.TemporaryDirectory() as root:
            source=Path(root)/"original.pdf"
            translated=Path(root)/"translated.pdf"
            make_pdf(source,["Document beginning","Document ending"])
            make_pdf(translated,["Only one page"])
            with self.assertRaisesRegex(ValueError,"页数"):
                inspect_pair(source,translated)
            make_pdf(translated,["",""])
            with self.assertRaisesRegex(ValueError,"可提取文字"):
                inspect_pair(source,translated)


if __name__=="__main__":
    unittest.main()
