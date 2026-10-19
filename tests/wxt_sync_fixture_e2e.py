"""Installed MV3 + official Supabase SDK + WebCrypto, two isolated profiles.

Only the HTTP transport/auth session is a local fixture: this is L1, NOT a
claim that Google OAuth or two real user devices passed live acceptance.
"""
import asyncio, base64, json, tempfile, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from playwright.async_api import async_playwright

ROOT=Path(__file__).resolve().parents[1]
PACKAGE=ROOT/'apps/wxt-ui/.output/chrome-mv3'
USER='11111111-1111-4111-8111-111111111111'
database={}
requests=[]

class REST(BaseHTTPRequestHandler):
    def log_message(self,*args): pass
    def do_GET(self): self.run_request()
    def do_POST(self): self.run_request()
    def do_PATCH(self): self.run_request()
    def do_DELETE(self): self.run_request()
    def run_request(self):
        parsed=urlparse(self.path);table=parsed.path.split('/')[-1]
        query=parse_qs(parsed.query);body=json.loads(self.rfile.read(int(self.headers.get('Content-Length',0))) or '{}')
        requests.append((self.command,table,body))
        row=database.get(table);result=[];code=200
        if self.command=='GET': result=[row] if row else []
        elif self.command=='POST':
            if row:code=409;result={'code':'23505'}
            else:database[table]=body;result=body
        elif self.command=='PATCH':
            revision=int(query.get('revision',['eq.0'])[0].split('.')[-1])
            if row and row['revision']==revision:row.update(body);result=[row]
        elif self.command=='DELETE':database.pop(table,None)
        if self.headers.get('Accept')=='application/vnd.pgrst.object+json' and isinstance(result,list):result=result[0] if result else None
        payload=json.dumps(result).encode();self.send_response(code);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(payload)));self.end_headers();self.wfile.write(payload)

def token():
    enc=lambda x:base64.urlsafe_b64encode(json.dumps(x).encode()).decode().rstrip('=')
    return enc({'alg':'HS256','typ':'JWT'})+'.'+enc({'sub':USER,'exp':4102444800,'aud':'authenticated'})+'.fixture'

async def main():
    server=ThreadingHTTPServer(('127.0.0.1',0),REST);threading.Thread(target=server.serve_forever,daemon=True).start()
    try:
        with tempfile.TemporaryDirectory(prefix='pit-sync-a-') as a,tempfile.TemporaryDirectory(prefix='pit-sync-b-') as b:
            async with async_playwright() as p:
                contexts=[]
                try:
                    pages=[];workers=[]
                    for path in [a,b]:
                        ctx=await p.chromium.launch_persistent_context(path,channel='chromium',headless=True,args=[f'--disable-extensions-except={PACKAGE}',f'--load-extension={PACKAGE}','--no-sandbox'])
                        contexts.append(ctx);sw=ctx.service_workers[0] if ctx.service_workers else await ctx.wait_for_event('serviceworker');workers.append(sw)
                        await sw.evaluate('''port=>{const original=fetch;globalThis.fixtureOffline=false;globalThis.fetch=(url,init)=>{if(String(url).startsWith('https://ligamejpnracymxfbbff.supabase.co')){if(globalThis.fixtureOffline)return Promise.reject(Error('fixture offline'));return original('http://127.0.0.1:'+port+new URL(url).pathname+new URL(url).search,init);}return original(url,init);};}''',server.server_port)
                        page=await ctx.new_page();await page.goto('chrome-extension://'+sw.url.split('/')[2]+'/pit-options.html#sync');await page.locator('form[data-ready="1"]').wait_for();pages.append(page)
                    session={'access_token':token(),'refresh_token':'fixture-refresh','expires_at':4102444800,'expires_in':3600,'token_type':'bearer','user':{'id':USER,'aud':'authenticated','email':'fixture@example.invalid'}}
                    for i,page in enumerate(pages):
                        await page.evaluate('''async ({session,user,index})=>chrome.storage.local.set({pit_auth:JSON.stringify(session),pit_sync_state:{enabled:false,userId:user,deviceId:'fixture-'+index,options:{preferences:true,sites:false,glossary:false,vault:true},revision:0,vaultRevision:0,base:null},pit_settings_v1:{target:index===0?'fr':'zh',source:'en',standardProvider:'browser',googleKey:index===0?'fixture-secret-google':'',cloudToken:index===0?'fixture-secret-cloud':''}})''',{'session':session,'user':USER,'index':i})
                    async def call(page,action,**extra):
                        r=await page.evaluate('''async message=>chrome.runtime.sendMessage({type:'PIT_SYNC',...message})''',{'action':action,**extra});assert r.get('ok'),r;return r
                    await call(pages[0],'sync');await call(pages[0],'unlock',password='fixture-vault-password')
                    assert database['pit_user_vault']['ciphertext']
                    assert 'fixture-secret' not in json.dumps(database)
                    first=await call(pages[1],'sync');assert first['status']['conflicted'],first
                    await call(pages[1],'resolve',choice='remote')
                    wrong=await pages[1].evaluate("""async()=>chrome.runtime.sendMessage({type:'PIT_SYNC',action:'unlock',password:'wrong-vault-password'})""")
                    assert wrong.get('ok') is False,wrong
                    await call(pages[1],'unlock',password='fixture-vault-password')
                    saved=await pages[1].evaluate("async()=>(await chrome.storage.local.get('pit_settings_v1')).pit_settings_v1")
                    assert saved['target']=='fr' and saved['googleKey']=='fixture-secret-google' and saved['cloudToken']=='fixture-secret-cloud',saved
                    # Two offline edits must not silently overwrite the newer revision.
                    await call(pages[0],'pause')
                    await pages[0].evaluate("async()=>chrome.runtime.sendMessage({type:'PATCH_SETTINGS',patch:{target:'de'}})")
                    await pages[1].evaluate("async()=>chrome.runtime.sendMessage({type:'PATCH_SETTINGS',patch:{target:'ja'}})")
                    await call(pages[1],'sync')
                    conflict=await call(pages[0],'sync');assert conflict['status']['conflicted'],conflict
                    assert database['pit_user_preferences']['payload']['target']=='ja'
                    await call(pages[0],'resolve',choice='remote')
                    await workers[0].evaluate('globalThis.fixtureOffline=true')
                    await pages[0].evaluate("async()=>chrome.runtime.sendMessage({type:'PATCH_SETTINGS',patch:{target:'ko'}})")
                    await asyncio.sleep(.5)
                    local=await pages[0].evaluate("async()=>(await chrome.storage.local.get('pit_settings_v1')).pit_settings_v1")
                    assert local['target']=='ko' and local['googleKey']=='fixture-secret-google'
                    await workers[0].evaluate('globalThis.fixtureOffline=false')
                    await call(pages[0],'sync')
                    assert database['pit_user_preferences']['payload']['target']=='ko'
                    result={'level':'L1 installed MV3, simulated auth/REST only','two_profiles_preferences':True,'aes_gcm_key_restore':True,'wrong_password_rejected':True,'conflict_detected':True,'offline_local_preserved':True,'no_plaintext_secrets_in_transport':all('fixture-secret' not in json.dumps(body) for _,_,body in requests),'live_oauth':'NOT TESTED'}
                    assert result['no_plaintext_secrets_in_transport']
                    (ROOT/'wxt-sync-fixture-report.json').write_text(json.dumps(result,indent=2),encoding='utf-8');print(json.dumps(result))
                finally:
                    for ctx in contexts:await ctx.close()
    finally:server.shutdown()

if __name__=='__main__':asyncio.run(main())
