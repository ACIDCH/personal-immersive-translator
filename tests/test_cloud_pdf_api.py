"""Cloud PDF route checks with a real multi-page PDF, no paid translation.

The BabelDOC subprocess is deliberately patched here; independent
actual-babeldoc-layout.yml separately invokes the REAL official BabelDOC
binary on a PDF fixture and verifies output. This suite tests cloud
authentication, payload validation, language inference and response.
"""
import os
import unittest
from unittest.mock import patch
import fitz
from fastapi.testclient import TestClient

from services import cloud_pdf_api as cloud

TOKEN="test-cloud-pdf-secret-123456"


def fixture(text="Financial networks and economic policy",pages=13):
    doc=fitz.open()
    for i in range(pages):
        page=doc.new_page()
        if any(ord(ch)>127 for ch in text):
            from pathlib import Path
            font=Path("/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc")
            if not font.exists():
                raise unittest.SkipTest("Actual CJK source text font not available")
            page.insert_font(fontname="NotoCJK",fontfile=str(font))
            page.insert_text((55,85),text+" number "+str(i),fontname="NotoCJK")
        else:
            page.insert_text((55,85),text+" number "+str(i))
    raw=doc.tobytes()
    doc.close()
    return raw


class CloudDocumentTests(unittest.TestCase):
    def setUp(self):
        self.scope=patch.dict(os.environ,{"PIT_CLOUD_PDF_TOKEN":TOKEN})
        self.scope.start()
        self.addCleanup(self.scope.stop)
        self.client=TestClient(cloud.app)
        self.auth={"Authorization":"Bearer "+TOKEN}

    def test_authentication_denies_unsolicited_pdf_and_health(self):
        self.assertEqual(self.client.get("/health").status_code,401)
        self.assertEqual(self.client.post("/v1/pdf/translate",
            files={"pdf":("test.pdf",fixture(),"application/pdf")}).status_code,401)

    def test_rejects_invalid_pdf_without_invoking_heavy_engine(self):
        with patch.object(cloud,"run_pipeline") as pipeline:
            res=self.client.post("/v1/pdf/translate",headers=self.auth,
                files={"pdf":("bad.pdf",b"not a PDF","application/pdf")})
            self.assertEqual(res.status_code,415)
            pipeline.assert_not_called()

    def test_real_thirteen_page_input_and_source_auto_routes_to_babeldoc(self):
        sample=fixture(pages=13)
        calls=[]
        def engine(original,directory,source,target,ocr):
            calls.append((source,target,ocr))
            return sample
        with patch.object(cloud,"run_pipeline",side_effect=engine):
            res=self.client.post("/v1/pdf/translate",headers=self.auth,
                data={"source":"auto","target":"zh","ocr":"true"},
                files={"pdf":("finance.pdf",sample,"application/pdf")})
        self.assertEqual(res.status_code,200,res.text[:400])
        self.assertEqual(res.headers["content-type"],"application/pdf")
        self.assertEqual(res.headers["x-pit-detected-source"],"en")
        with fitz.open(stream=res.content,filetype="pdf") as doc:
            self.assertEqual(len(doc),13)
        self.assertEqual(calls,[("en","zh",True)])

    def test_auto_script_zh_and_ja(self):
        self.assertEqual(cloud.infer_source(fixture("这是中国金融市场发展趋势"))[0],"zh")
        self.assertEqual(cloud.infer_source(fixture("日本語の金融授業"))[0],"ja")


if __name__=="__main__":
    unittest.main()
