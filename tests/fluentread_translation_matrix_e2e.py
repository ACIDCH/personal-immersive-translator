"""Pinned FluentRead GPL, actual Chromium DOM translation via its own Alt+T hotkey.

Uses upstream configStorageRead/persistConfig and fake Microsoft HTTP only.
24 paragraphs are identical to KISS/PIT source text. We do not use any
FluentRead source code in PIT's distributed extension.
"""
import asyncio,json,tempfile,time,sys
from pathlib import Path
from playwright.async_api import async_playwright

URL='https://api.deepl.com/multimodal-kiss-benchmark'
N=24

async def main():
  ext=Path(sys.argv[1]).resolve()
  report={'engine':'FluentRead pinned WXT/Vue','source_paragraphs':N,
    'translation':'native content script, Microsoft mock HTTP',
    'translated_paragraphs':0,'status':'not_run'}
  with tempfile.TemporaryDirectory(prefix='fr-headtohead-') as profile:
    async with async_playwright() as p:
      ctx=await p.chromium.launch_persistent_context(profile,channel='chromium',
        headless=True,viewport={'width':1350,'height':1200},
        args=[f'--disable-extensions-except={ext}',f'--load-extension={ext}',
              '--no-sandbox','--disable-dev-shm-usage'])
      try:
        sw=ctx.service_workers[0] if ctx.service_workers else await ctx.wait_for_event('serviceworker',timeout=30000)
        eid=sw.url.split('/')[2]
        await sw.evaluate("""()=>{
          const original=globalThis.fetch.bind(globalThis);
          globalThis.__frTestCalls=0;
          globalThis.fetch=async(input,init)=>{
            const url=new URL(typeof input==='string'||input instanceof URL?String(input):input.url);
            if(url.hostname==='edge.microsoft.com'&&url.pathname==='/translate/translatetext'){
              const data=JSON.parse(init?.body||'[]');
              globalThis.__frTestCalls++;
              return new Response(JSON.stringify(data.map(text=>({
                translations:[{text:'测试译文：'+text}]
              }))),{status:200,headers:{'content-type':'application/json'}});
            }
            return original(input,init);
          };
        }""")
        popup=await ctx.new_page()
        await popup.goto(f'chrome-extension://{eid}/popup.html',timeout=22000)
        configured=await popup.evaluate("""async()=>{
          const stored=await chrome.runtime.sendMessage({type:'configStorageRead',key:'local:config'});
          if(!stored?.success)return {step:'read',stored};
          const config=typeof stored.value==='string'?JSON.parse(stored.value):stored.value;
          const updates={service:'microsoft',from:'en',to:'zh-Hans',display:1,
            autoTranslate:false,hotkey:'Control',floatingBallHotkey:'Alt+T',
            fullPageTranslationMode:'viewport',useCache:false,
            enableAIContext:false,enableAIMultiSegment:false,uiLanguage:'zh-CN',
            uiLanguageSetupCompleted:true};
          const patched=await chrome.runtime.sendMessage({type:'persistConfig',mode:'patch',
            config:updates,expected:Object.fromEntries(Object.keys(updates).map(key=>[key,config[key]])),
            clientId:'headtohead-isolated',sequence:1,baseRevision:config.__fluentConfigRevision});
          return {step:'patch',ok:patched?.success,error:patched?.error||''};
        }""")
        report['settings_applied']=configured.get('ok') is True
        assert configured.get('ok') is True,configured
        await popup.close()
        html='<!doctype html><html lang="en"><head><meta charset="utf-8"><style>'+\
          'body{margin:10px}p{font:14px sans-serif;margin:3px 0;line-height:20px}'+\
          '</style></head><body><main><article>'+''.join(
          f'<p id="paragraph-{i}">Benchmark article paragraph {i} discusses forecasting global capital markets and multilingual document processing.</p>'
          for i in range(N))+'</article></main></body></html>'
        async def fixture(route):await route.fulfill(status=200,content_type='text/html',body=html)
        await ctx.route(URL,fixture)
        page=await ctx.new_page()
        await page.goto(URL,wait_until='domcontentloaded',timeout=25000)
        await page.wait_for_timeout(1400)
        start=time.monotonic()
        await page.keyboard.down('Alt')
        await page.keyboard.press('t')
        await page.keyboard.up('Alt')
        try:
          await page.wait_for_function("""()=>Array.from({length:24},(_,i)=>{
            const p=document.querySelector('#paragraph-'+i);
            return p?.querySelector('.fluent-read-bilingual-content')?.textContent?.includes('测试译文：');
          }).every(Boolean)""",timeout=40000)
        except Exception:
          # Capture real partial coverage; never turn lack of translation into PASS.
          pass
        translated=await page.evaluate("""()=>Array.from({length:24},(_,i)=>
          Boolean(document.querySelector('#paragraph-'+i)?.querySelector('.fluent-read-bilingual-content')?.textContent?.includes('测试译文：'))
        ).filter(Boolean).length""")
        report.update({'translated_paragraphs':translated,'coverage_percent':round(100*translated/N,1),
          'elapsed_seconds':round(time.monotonic()-start,2),
          'mock_http_calls':await sw.evaluate('()=>globalThis.__frTestCalls')})
        report['status']='pass' if translated==N and report['mock_http_calls']>0 else 'incomplete'
        print('FLUENTREAD REAL WEB TRANSLATION:',json.dumps(report,ensure_ascii=False),flush=True)
        assert report['status']=='pass',report
      finally:
        Path('fluentread-translation-benchmark.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
        await ctx.close()

if __name__=='__main__':asyncio.run(main())
