"""Run the actual BabelDOC CLI subprocess lifecycle with an isolated test executable.

A local fixture script emulates only the CLI contract and produces a real PDF
via PyMuPDF. This is NOT upstream BabelDOC and does NOT test translation quality.
"""
import os
import stat
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path
from unittest.mock import patch
import fitz
from fastapi.testclient import TestClient

os.environ.setdefault("PIT_BRIDGE_TOKEN","test-local-secret-at-least-16")
os.environ.setdefault("DEEPSEEK_API_KEY","fake-test-key-never-use")
from services import babeldoc_bridge as bridge


def sample_pdf():
    doc=fitz.open()
    page=doc.new_page()
    page.insert_text((44,76),"Academic text for secure subprocess PDF translation testing.")
    data=doc.tobytes()
    doc.close()
    return data


def fake_executable(directory,fail=False):
    path=Path(directory)/"babeldoc"
    script=f"""#!{sys.executable}
import sys,tomllib,pathlib,os
assert sys.argv[1]=='--config'
assert sys.argv[3]=='--files'
assert len(sys.argv)==5
assert 'fake-test-key-never-use' not in repr(sys.argv)
path=pathlib.Path(sys.argv[2])
with path.open('rb') as fd: options=tomllib.load(fd)['babeldoc']
assert options['openai-api-key']=='fake-test-key-never-use'
assert options['openai-model']=='deepseek-chat'
assert (path.stat().st_mode & 0o777)==0o600
if {fail!r}: sys.exit(7)
import fitz
doc=fitz.open()
page=doc.new_page()
page.insert_text((45,74),'Academic concept translated content for user review.')
doc.save(str(pathlib.Path(options['output'])/'example.dual.pdf'))
doc.close()
"""
    path.write_text(script,encoding="utf-8")
    path.chmod(path.stat().st_mode | stat.S_IXUSR)
    return path


class SubprocessLifecycleTest(unittest.TestCase):
    def test_true_cli_process_executes_and_returns_real_searchable_pdf(self):
        with tempfile.TemporaryDirectory() as root:
            executable=fake_executable(root)
            with patch.dict(os.environ,{"PATH":root+os.pathsep+os.environ["PATH"]}),\
                 patch.object(bridge,"KEY","fake-test-key-never-use"):
                client=TestClient(bridge.app)
                result=client.post("/translate",
                    headers={"X-PIT-Token":"test-local-secret-at-least-16"},
                    data={"source":"en","target":"zh","ocr":"false"},
                    files={"pdf":("paper.pdf",sample_pdf(),"application/pdf")})
            self.assertEqual(result.status_code,200,result.text[:150])
            with fitz.open(stream=result.content,filetype="pdf") as document:
                self.assertIn("translated content",document[0].get_text())
            self.assertEqual(result.headers["cache-control"],"no-store")
            self.assertTrue(executable.exists())

    def test_true_cli_failure_does_not_return_secret_or_document(self):
        with tempfile.TemporaryDirectory() as root:
            fake_executable(root,fail=True)
            with patch.dict(os.environ,{"PATH":root+os.pathsep+os.environ["PATH"]}),\
                 patch.object(bridge,"KEY","fake-test-key-never-use"):
                response=TestClient(bridge.app).post("/translate",
                    headers={"X-PIT-Token":"test-local-secret-at-least-16"},
                    data={"source":"en","target":"zh","ocr":"false"},
                    files={"pdf":("paper.pdf",sample_pdf(),"application/pdf")})
            self.assertEqual(response.status_code,422,response.text)
            self.assertNotIn("fake-test-key-never-use",response.text)
            self.assertNotIn("Academic text",response.text)


if __name__=="__main__":
    unittest.main()
