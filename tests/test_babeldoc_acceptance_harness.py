"""No billable calls: make sure optional true BabelDOC harness fails closed."""
import argparse
import os
import pathlib
import tempfile
import unittest
from unittest.mock import patch
import fitz
from benchmarks import babeldoc_real_acceptance as acceptance


def pdf_content(text):
    doc=fitz.open()
    page=doc.new_page()
    page.insert_text((35,70),text)
    content=doc.tobytes()
    doc.close()
    return content

class RealBabeldocAcceptanceSafetyTest(unittest.TestCase):
    def setUp(self):
        self.folder=tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.src=pathlib.Path(self.folder.name)/"original.pdf"
        self.dst=pathlib.Path(self.folder.name)/"bilingual.pdf"
        self.src.write_bytes(pdf_content("A legitimate source academic finance PDF with text"))
        self.args=argparse.Namespace(
            input=str(self.src),output=str(self.dst),
            source="en",target="zh",ocr=False,
            acknowledge_billed_translation=False)

    def test_never_call_real_service_without_explicit_user_ack(self):
        with patch.dict(os.environ,{"DEEPSEEK_API_KEY":"fake-test-key-never-use"}),\
             patch.object(acceptance,"inspect_babeldoc_cli") as check:
            with self.assertRaisesRegex(ValueError,"明确确认"):
                acceptance.accept(self.args)
            check.assert_not_called()
        self.assertFalse(self.dst.exists())

    def test_existing_output_never_overwritten(self):
        self.dst.write_text("original user data",encoding="utf8")
        self.args.acknowledge_billed_translation=True
        with patch.dict(os.environ,{"DEEPSEEK_API_KEY":"fake-test-key-never-use"}),\
             patch.object(acceptance,"inspect_babeldoc_cli",
                          return_value={"compatible":True}):
            with self.assertRaisesRegex(ValueError,"拒绝覆盖"):
                acceptance.accept(self.args)
        self.assertEqual(self.dst.read_text(encoding="utf8"),"original user data")

    def test_structurally_verified_pdf_saved_without_user_text_in_metrics(self):
        self.args.acknowledge_billed_translation=True
        translated=pdf_content("Safely translated finance and valuation discussion")
        with patch.dict(os.environ,{"DEEPSEEK_API_KEY":"fake-test-key-never-use"}),\
             patch.object(acceptance,"inspect_babeldoc_cli",
                          return_value={"compatible":True}),\
             patch("services.babeldoc_bridge.run_pipeline",return_value=translated) as pipeline:
            metrics=acceptance.accept(self.args)
        pipeline.assert_called_once()
        self.assertTrue(self.dst.read_bytes().startswith(b"%PDF-"))
        self.assertEqual(metrics["quality_gate"],"structural-pass")
        self.assertTrue(metrics["visual_comparison_required"])
        self.assertNotIn("Safely translated",str(metrics))
        self.assertNotIn("fake-test-key-never-use",str(metrics))


if __name__=="__main__":
    unittest.main()
