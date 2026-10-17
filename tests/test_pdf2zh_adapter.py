"""Offline contract tests for the local pdf2zh process adapter.

A fake executable validates argument ordering and output handling. It is NOT
evidence of actual AGPL PDF translation, layout quality or vendor connectivity.
"""
import importlib.util
import json
import stat
import tempfile
import unittest
from pathlib import Path

PATH=Path(__file__).resolve().parents[1]/'services/pdf-layout/pdf2zh_adapter.py'
spec=importlib.util.spec_from_file_location('pit_pdf2zh_adapter',PATH)
adapter=importlib.util.module_from_spec(spec)
spec.loader.exec_module(adapter)

class LocalPdfLayoutAdapterTest(unittest.TestCase):
  def test_real_subprocess_boundaries_and_local_outputs(self):
    with tempfile.TemporaryDirectory() as root:
      d=Path(root);inp=d/'original.pdf';out=d/'result'
      inp.write_bytes(b'%PDF-1.4\n1 0 obj <</Type/Catalog>> endobj\n%%EOF\n')
      executable=d/'pdf2zh'
      executable.write_text('#!/usr/bin/env python3\n'
        'import sys,pathlib\n'
        'args=sys.argv[1:]\n'
        'assert args[0].endswith("original.pdf")\n'
        'assert args[args.index("-li")+1]=="en"\n'
        'assert args[args.index("-lo")+1]=="zh"\n'
        'assert "--ultrafast" in args\n'
        'dest=pathlib.Path(args[args.index("-o")+1])\n'
        '(dest/"original-mono.pdf").write_bytes(b"%PDF-1.4\\ntranslated fake test output\\n%%EOF")\n')
      executable.chmod(executable.stat().st_mode|stat.S_IXUSR)
      result=adapter.run_pdf_layout(inp,out,executable=str(executable),ultrafast=True)
      self.assertEqual(result['mode'],'ultrafast')
      self.assertEqual(len(result['outputs']),1)
      self.assertEqual(len(result['outputs'][0]['sha256']),64)
      self.assertFalse(result['layout_verified'])
  def test_reject_non_pdf_and_service_injection(self):
    with tempfile.TemporaryDirectory() as root:
      p=Path(root)/'input.pdf';p.write_bytes(b'not a PDF document for testing')
      with self.assertRaisesRegex(ValueError,'header'):
        adapter.run_pdf_layout(p,Path(root)/'out',executable='/bin/true')
      p.write_bytes(b'%PDF-1.4\nnot-a-meaningful-fixture-but-accepted\n%%EOF')
      with self.assertRaisesRegex(ValueError,'Service'):
        adapter.run_pdf_layout(p,Path(root)/'out',service='google; rm -rf /',
                               executable='/bin/true')
if __name__=='__main__':unittest.main()
