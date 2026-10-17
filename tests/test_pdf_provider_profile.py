import unittest
from services.pdf_provider_profile import resolve_pdf_provider

class PdfProviderProfileTest(unittest.TestCase):
  def test_legacy_default(self):
    p=resolve_pdf_provider({'DEEPSEEK_API_KEY':'test-key'})
    self.assertEqual(p['model'],'deepseek-chat')
    self.assertEqual(p['base_url'],'https://api.deepseek.com/v1')
  def test_arbitrary_openai_compatible_model(self):
    p=resolve_pdf_provider({'PIT_PDF_API_KEY':'my-test-only-key',
        'PIT_PDF_MODEL':'openai/gpt-4o-mini',
        'PIT_PDF_BASE_URL':'https://openrouter.ai/api/v1/'})
    self.assertEqual(p['model'],'openai/gpt-4o-mini')
    self.assertEqual(p['base_url'],'https://openrouter.ai/api/v1')
  def test_reject_credentials_in_url(self):
    for u in ['https://key@provider.test/v1','http://unsafe.test/v1',
              'https://provider.test/v1?key=hello','ftp://provider.test/v1']:
      with self.subTest(url=u),self.assertRaises(RuntimeError):
        resolve_pdf_provider({'PIT_PDF_API_KEY':'test','PIT_PDF_BASE_URL':u})
  def test_local_gateway_is_explicit(self):
    p=resolve_pdf_provider({'PIT_PDF_API_KEY':'test','PIT_PDF_BASE_URL':'http://127.0.0.1:11434/v1',
        'PIT_PDF_MODEL':'my-local-model'})
    self.assertEqual(p['base_url'],'http://127.0.0.1:11434/v1')
  def test_missing_key_or_invalid_model(self):
    with self.assertRaises(RuntimeError):resolve_pdf_provider({})
    with self.assertRaises(RuntimeError):
      resolve_pdf_provider({'PIT_PDF_API_KEY':'x','PIT_PDF_MODEL':'abc\nInjected'})
if __name__=='__main__':unittest.main()
