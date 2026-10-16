"""PDF/OCR bridge contract tests without real provider keys or paid API calls."""
import importlib.util
import os
import shutil
import subprocess
import tomllib
import unittest
from pathlib import Path
from unittest.mock import patch

import fitz
from fastapi.testclient import TestClient

os.environ["PIT_BRIDGE_TOKEN"] = "test-local-secret-at-least-16"
os.environ["DEEPSEEK_API_KEY"] = "fake-test-key-never-use"
path=Path(__file__).resolve().parents[1]/"services"/"babeldoc_bridge.py"
spec=importlib.util.spec_from_file_location("bridge_to_test",path)
bridge=importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)


def pdf(text="A PDF containing sufficient searchable academic text about economics."):
    doc=fitz.open()
    page=doc.new_page()
    if text:page.insert_text((50,75),text)
    result=doc.tobytes()
    doc.close()
    return result


def wav_pcm16(rate=16000, frames=16000):
    import wave
    import io
    stream=io.BytesIO()
    with wave.open(stream,"wb") as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(rate)
        audio.writeframes(b"\x00\x00"*frames)
    return stream.getvalue()


class BridgeContractTests(unittest.TestCase):
    def setUp(self):
        self.client=TestClient(bridge.app)
        self.headers={"X-PIT-Token":"test-local-secret-at-least-16"}

    def submit(self,document,ocr=True,source="en"):
        return self.client.post("/translate",headers=self.headers,
            files={"pdf":("file.pdf",document,"application/pdf")},
            data={"source":source,"target":"zh","ocr":str(ocr).lower()})

    def test_local_bridge_denies_unauthenticated_access(self):
        self.assertEqual(self.client.get("/health").status_code,401)
        self.assertEqual(self.client.get("/health",headers={"X-PIT-Token":"wrong"}).status_code,401)

    def test_health_reports_dependency_readiness_without_exposing_secrets(self):
        response=self.client.get("/health",headers=self.headers)
        self.assertEqual(response.status_code,200,response.text)
        details=response.json()
        for key in ("ready","pdf_ocr","image_ocr","speech_asr"):
            self.assertIsInstance(details[key],bool)
        self.assertEqual(details["engine"],"local-only")
        self.assertNotIn("fake-test-key-never-use",response.text)
        self.assertNotIn("test-local-secret-at-least-16",response.text)

    def test_pdf_magic_and_language_validation(self):
        self.assertEqual(self.submit(b"not a pdf").status_code,400)
        self.assertEqual(self.submit(pdf(),source="ru").status_code,400)

    def test_real_pdf_uses_config_and_returns_bilingual_output(self):
        calls=[]
        def fake_run(args,**kwargs):
            calls.append(args[0])
            with open(args[args.index("--config")+1],"rb") as handle:
                options=tomllib.load(handle)["babeldoc"]
            assert options["openai-model"]=="deepseek-chat"
            assert options["lang-in"]=="en"
            assert options["lang-out"]=="zh"
            assert options["openai-api-key"]=="fake-test-key-never-use"
            import stat
            assert stat.S_IMODE(os.stat(args[args.index("--config")+1]).st_mode)==0o600
            (Path(options["output"])/"original.dual.pdf").write_bytes(pdf("Translated output."))
            return subprocess.CompletedProcess(args,0)
        with patch.object(bridge.shutil,"which",return_value="/usr/bin/fake"),patch.object(bridge.subprocess,"run",side_effect=fake_run):
            resp=self.submit(pdf(),ocr=False)
        self.assertEqual(resp.status_code,200,resp.text[:200])
        self.assertEqual(calls,["babeldoc"])
        self.assertTrue(resp.content.startswith(b"%PDF-"))
        self.assertEqual(resp.headers["cache-control"],"no-store")

    def test_mixed_document_detects_late_scanned_appendix(self):
        import tempfile
        document=fitz.open()
        first=document.new_page()
        first.insert_text((50,75),"A sufficiently long academic introduction containing searchable text.")
        document.new_page()  # Represents a scanned/blank appendix for detection.
        with tempfile.TemporaryDirectory() as d:
            sample=Path(d)/"mixed.pdf"
            sample.write_bytes(document.tobytes())
            self.assertTrue(bridge.scanned_pdf(sample))
        document.close()

    def test_reject_invalid_babeldoc_pdf_output(self):
        def fake_run(args,**kwargs):
            with open(args[args.index("--config")+1],"rb") as handle:
                options=tomllib.load(handle)["babeldoc"]
            (Path(options["output"])/"original.dual.pdf").write_bytes(b"fake pdf")
            return subprocess.CompletedProcess(args,0)
        with patch.object(bridge.shutil,"which",return_value="/usr/bin/fake"), \
             patch.object(bridge.subprocess,"run",side_effect=fake_run):
            response=self.submit(pdf(),ocr=False)
        self.assertEqual(response.status_code,422)

    def test_scanned_pdf_requires_ocr_permission_and_retains_bilingual_file(self):
        scanned=pdf("")
        with patch.object(bridge.shutil,"which",return_value="/usr/bin/fake"):
            self.assertEqual(self.submit(scanned,ocr=False).status_code,422)
        calls=[]
        def fake_run(args,**kwargs):
            calls.append(args[0])
            if args[0]=="ocrmypdf":
                shutil.copyfile(args[-2],args[-1])
            elif args[0]=="babeldoc":
                with open(args[args.index("--config")+1],"rb") as handle:
                    options=tomllib.load(handle)["babeldoc"]
                (Path(options["output"])/"searchable.dual.pdf").write_bytes(pdf("Translated after OCR"))
            return subprocess.CompletedProcess(args,0)
        with patch.object(bridge.shutil,"which",return_value="/usr/bin/fake"),patch.object(bridge.subprocess,"run",side_effect=fake_run):
            resp=self.submit(scanned,ocr=True)
        self.assertEqual(resp.status_code,200,resp.text[:200])
        self.assertEqual(calls,["ocrmypdf","babeldoc"])


    def test_tesseract_tsv_line_coordinates_are_bounded_and_safe(self):
        header="level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext"
        rows=[
            "5\t1\t1\t1\t1\t1\t10\t20\t45\t20\t98\tHello",
            "5\t1\t1\t1\t1\t2\t60\t20\t45\t20\t95\tworld",
            "5\t1\t1\t1\t2\t1\t10\t70\t50\t20\t90\tBonjour",
            "5\t1\t1\t1\t3\t1\t999999\t70\t50\t20\t90\tInvalid"
        ]
        result=bridge.parse_ocr_layout("\n".join([header,*rows]),500,200)
        self.assertEqual(len(result),2)
        self.assertEqual(result[0]["text"],"Hello world")
        self.assertEqual(result[0]["x"],10)
        self.assertEqual(result[0]["y"],20)
        self.assertEqual(result[0]["w"],95)
        self.assertEqual(result[1]["text"],"Bonjour")

    def test_real_local_tesseract_layout_mode(self):
        import io
        from PIL import Image,ImageDraw,ImageFont
        if not shutil.which("tesseract"):
            self.skipTest("Tesseract unavailable")
        image=Image.new("RGB",(900,180),"white")
        draw=ImageDraw.Draw(image)
        font=ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",58)
        draw.text((30,35),"HELLO IMAGE OCR",fill="black",font=font)
        buffer=io.BytesIO()
        image.save(buffer,format="PNG")
        response=self.client.post("/ocr-image",headers=self.headers,
            files={"image":("fixture.png",buffer.getvalue(),"image/png")},
            data={"source":"en","layout":"true"})
        self.assertEqual(response.status_code,200,response.text[:200])
        value=response.json()
        self.assertEqual(value["image_width"],900)
        self.assertEqual(value["image_height"],180)
        self.assertTrue(value["lines"],value)
        self.assertIn("HELLO",value["lines"][0]["text"].upper())

    def test_real_local_tesseract_english_ocr(self):
        import io
        from PIL import Image, ImageDraw, ImageFont
        if not shutil.which("tesseract"):
            self.skipTest("Tesseract executable not installed")
        image=Image.new("RGB",(850,150),"white")
        painter=ImageDraw.Draw(image)
        font=ImageFont.truetype(
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",58)
        painter.text((35,36),"HELLO WORLD 1234",fill="black",font=font)
        memory=io.BytesIO()
        image.save(memory,format="PNG")
        response=self.client.post("/ocr-image",headers=self.headers,
            files={"image":("fixture.png",memory.getvalue(),"image/png")},
            data={"source":"en"})
        self.assertEqual(response.status_code,200,response.text[:300])
        self.assertIn("HELLO WORLD",response.json()["original_text"].upper())


    def test_corrupt_image_is_rejected_before_running_ocr(self):
        with patch.object(bridge.shutil,"which",return_value="/usr/bin/fake"):
            response=self.client.post("/ocr-image",headers=self.headers,
                files={"image":("corrupt.webp",b"not a real image","image/webp")},
                data={"source":"en"})
        self.assertEqual(response.status_code,422)

    def test_real_webp_is_normalized_to_png_before_ocr(self):
        import io
        from PIL import Image,ImageDraw,ImageFont
        if not shutil.which("tesseract"):
            self.skipTest("Tesseract executable not installed")
        image=Image.new("RGB",(980,170),"white")
        draw=ImageDraw.Draw(image)
        font=ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",62)
        draw.text((45,35),"WEBP DOCUMENT TEXT",fill="black",font=font)
        buffer=io.BytesIO()
        image.save(buffer,format="WEBP",quality=99)
        response=self.client.post("/ocr-image",headers=self.headers,
            files={"image":("original.webp",buffer.getvalue(),"image/webp")},
            data={"source":"en"})
        self.assertEqual(response.status_code,200,response.text[:200])
        self.assertIn("WEBP",response.json()["original_text"].upper())

    def test_wav_validator_requires_actual_16khz_mono_pcm(self):
        good=wav_pcm16()
        self.assertEqual(bridge.validate_asr_wav(good),16000)
        with self.assertRaises(ValueError):
            bridge.validate_asr_wav(wav_pcm16(rate=48000))
        with self.assertRaises(ValueError):
            bridge.validate_asr_wav(good[:-1])
        with self.assertRaises(ValueError):
            bridge.validate_asr_wav(b"RIFFWAVEfake")

    def test_asr_http_contract_rejects_wrong_rate_before_inference(self):
        import tempfile
        with tempfile.TemporaryDirectory() as d:
            model=Path(d)/"model.bin"
            model.write_bytes(b"fake-model-fixture")
            with patch.object(bridge,"ASR_MODEL",str(model)), \
                 patch.object(bridge,"ASR_BIN","whisper-cli"), \
                 patch.object(bridge.shutil,"which",return_value="/usr/bin/fake"):
                bad=self.client.post("/asr",headers=self.headers,
                    files={"audio":("segment.wav",wav_pcm16(rate=48000),"audio/wav")})
                self.assertEqual(bad.status_code,400)
                calls=[]
                def fake_whisper(args,**kwargs):
                    calls.append(args)
                    self.assertEqual(args[0],"whisper-cli")
                    out=Path(args[args.index("-of")+1]+".txt")
                    out.write_text("recognized English speech",encoding="utf8")
                    return subprocess.CompletedProcess(args,0)
                with patch.object(bridge.subprocess,"run",side_effect=fake_whisper):
                    ok=self.client.post("/asr",headers=self.headers,
                        files={"audio":("segment.wav",wav_pcm16(),"audio/wav")})
                self.assertEqual(ok.status_code,200,ok.text[:200])
                self.assertEqual(ok.json()["text"],"recognized English speech")
                self.assertEqual(len(calls),1)


if __name__=="__main__":
    unittest.main()
