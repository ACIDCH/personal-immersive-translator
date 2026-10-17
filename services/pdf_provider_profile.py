"""Choose any explicitly configured OpenAI-compatible model for local BabelDOC.

No key is returned in logs or sent to Cloudflare. Native Anthropic Messages
is NOT an OpenAI-compatible protocol; use a compatible gateway or separate
provider adapter, never quietly rewrite its protocol.
"""
import os
import re
from urllib.parse import urlsplit

DEFAULT_MODEL='deepseek-chat'
DEFAULT_URL='https://api.deepseek.com/v1'
def resolve_pdf_provider(environ=None):
    env=os.environ if environ is None else environ
    key=(env.get('PIT_PDF_API_KEY') or env.get('DEEPSEEK_API_KEY') or '').strip()
    model=(env.get('PIT_PDF_MODEL') or DEFAULT_MODEL).strip()
    base_url=(env.get('PIT_PDF_BASE_URL') or DEFAULT_URL).strip().rstrip('/')
    if not key or len(key)>1000 or '\n' in key or '\r' in key:
        raise RuntimeError('缺少或无效的 PIT_PDF_API_KEY / DEEPSEEK_API_KEY')
    if not re.fullmatch(r'[a-zA-Z0-9][\w.:/-]{1,150}',model):
        raise RuntimeError('PDF OpenAI-compatible 模型 ID 无效')
    try:url=urlsplit(base_url)
    except ValueError:raise RuntimeError('PDF AI Base URL 无效') from None
    trusted_local=url.scheme=='http' and url.hostname in ('localhost','127.0.0.1','[::1]')
    if (url.scheme!='https' and not trusted_local) or not url.netloc or url.username or url.password or url.query or url.fragment:
        raise RuntimeError('PDF AI Base URL 必须是 HTTPS 或明确的本机开发服务，不能包含凭据与查询参数')
    return {'model':model,'base_url':base_url,'api_key':key}
