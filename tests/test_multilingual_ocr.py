"""Run real local Tesseract against Chinese/Japanese/Korean high-contrast text.

Synthetic fixtures do not establish OCR reliability for smartphone photos,
mixed-script screenshots, academic diagrams or handwriting.
"""
import io
import os
import subprocess
import shutil
import unittest
from pathlib import Path
from fastapi.testclient import TestClient
from PIL import Image, ImageDraw, ImageFont
from benchmarks.ocr_accuracy import char_error_rate,edit_distance
os.environ.setdefault("PIT_BRIDGE_TOKEN","test-local-secret-at-least-16")
os.environ.setdefault("DEEPSEEK_API_KEY","fake-test-key-never-use")
from services import babeldoc_bridge as bridge


class MultilingualOcrTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client=TestClient(bridge.app)
        cls.headers={"X-PIT-Token":"test-local-secret-at-least-16"}
        cls.font=Path("/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc")
        if not cls.font.is_file():
            if os.environ.get("PIT_REQUIRE_CJK_OCR")=="1":
                raise AssertionError("CI missing NotoSansCJK font; cannot claim CJK OCR tested")
            raise unittest.SkipTest("Noto CJK font not installed locally")
        if not shutil.which("tesseract"):
            raise unittest.SkipTest("Tesseract not installed")
        result=subprocess.run(["tesseract","--list-langs"],capture_output=True,
                               check=True,text=True,timeout=8)
        cls.installed=set(result.stdout.splitlines())
        expected={"chi_sim","jpn","kor","deu","spa"}
        if not expected.issubset(cls.installed):
            if os.environ.get("PIT_REQUIRE_CJK_OCR")=="1":
                raise AssertionError("CI missing required CJK Tesseract language packs")
            raise unittest.SkipTest("Chinese/Japanese/Korean packs not all installed")

    def check_language(self,language,text):
        image=Image.new("RGB",(1450,260),"white")
        draw=ImageDraw.Draw(image)
        font=ImageFont.truetype(str(self.font),100)
        draw.text((45,42),text,fill="black",font=font)
        data=io.BytesIO()
        image.save(data,format="PNG")
        response=self.client.post("/ocr-image",headers=self.headers,
            files={"image":("reference.png",data.getvalue(),"image/png")},
            data={"source":language})
        self.assertEqual(response.status_code,200,response.text[:300])
        recognized=response.json()["original_text"]
        cer=char_error_rate(text,recognized,ignore_whitespace=True)
        print(f"ACTUAL Tesseract {language} synthetic CER={cer:.3f}",flush=True)
        self.assertLessEqual(cer,0.5,
            f"{language} synthetic OCR CER {cer:.3f} exceeds the 50% smoke bound")
        return cer

    def test_chinese_real_engine(self):
        self.check_language("zh","你好世界")

    def test_japanese_real_engine(self):
        self.check_language("ja","こんにちは世界")

    def test_korean_real_engine(self):
        self.check_language("ko","안녕하세요세계")

    def test_german_real_engine(self):
        self.check_language("de","GUTEN TAG ÜBERSETZUNG")

    def test_spanish_real_engine(self):
        self.check_language("es","BUENOS DÍAS TRADUCCIÓN")


class OcrMetricsTest(unittest.TestCase):
    def test_levenshtein_unicode_and_empty_ground_truth(self):
        self.assertEqual(edit_distance("你好世界","你好世"),1)
        self.assertAlmostEqual(char_error_rate("你好世界","你好世"),0.25)
        self.assertAlmostEqual(char_error_rate("한 글","한글",ignore_whitespace=True),0)
        with self.assertRaises(ValueError):
            char_error_rate("","text")


if __name__=="__main__":
    unittest.main()
