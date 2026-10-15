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
            (Path(options["output"])/"original.dual.pdf").write_bytes(pdf("Translated output."))
            return subprocess.CompletedProcess(args,0)
        with patch.object(bridge.shutil,"which",return_value="/usr/bin/fake"),patch.object(bridge.subprocess,"run",side_effect=fake_run):
            resp=self.submit(pdf(),ocr=False)
        self.assertEqual(resp.status_code,200,resp.text[:200])
        self.assertEqual(calls,["babeldoc"])
        self.assertTrue(resp.content.startswith(b"%PDF-"))
        self.assertEqual(resp.headers["cache-control"],"no-store")

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


if __name__=="__main__":
    unittest.main()
