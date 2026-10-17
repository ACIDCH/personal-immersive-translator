"""KISS 2.1.1 real Chromium webpage translation, using its own content script.

No PIT code, no up-front KISS injection. The extension is built verbatim from
the pinned GPL upstream commit. Translation requests are mocked at HTTP boundary.
"""
import asyncio
import json
import tempfile
import time
import sys
from pathlib import Path
from playwright.async_api import async_playwright

URL="https://api.deepl.com/multimodal-kiss-benchmark"
SAMPLES=24

async def main():
    extension=Path(sys.argv[1]).resolve()
    assert (extension/"manifest.json").exists()
    report={"engine":"KISS","page":"local deterministic English editorial fixture",
            "model":"Microsoft-compatible native service (mock HTTP at boundary)",
            "source_paragraphs":SAMPLES,"translated_paragraphs":0,
            "translation_route_observed":False,"status":"not_run"}
    with tempfile.TemporaryDirectory(prefix="kiss-core-compare-") as profile:
      async with async_playwright() as p:
        ctx=await p.chromium.launch_persistent_context(
            profile,channel="chromium",headless=True,
            args=[f"--disable-extensions-except={extension}",
                  f"--load-extension={extension}","--no-sandbox","--disable-dev-shm-usage"])
        try:
          sw=ctx.service_workers[0] if ctx.service_workers else await ctx.wait_for_event('serviceworker',timeout=30000)
          eid=sw.url.split('/')[2]
          assert len(eid)==32
          telemetry={"calls":0,"urls":[],"payloads":[]}
          async def mock_microsoft(route):
            req=route.request
            telemetry["calls"]+=1
            telemetry["urls"].append(req.url.split("?")[0])
            try:
              raw=req.post_data_json
              data=raw if isinstance(raw,list) else [raw]
              telemetry["payloads"].append(len(data))
              replies=[{"translations":[{"to":"zh-Hans","text":"译文:"+(x if isinstance(x,str) else str(x.get('Text','')))}],
                        "detectedLanguage":{"language":"en"}} for x in data]
              await route.fulfill(status=200,content_type="application/json",body=json.dumps(replies,ensure_ascii=False),
                headers={"access-control-allow-origin":"*","content-type":"application/json"})
            except Exception:
              await route.fulfill(status=500,body="fixture-mock-error")
          await ctx.route("https://edge.microsoft.com/translate/**",mock_microsoft)
          await ctx.route("https://api.cognitive.microsofttranslator.com/**",mock_microsoft)
          await sw.evaluate("""() => {
            const original=globalThis.fetch.bind(globalThis);
            globalThis.__kissQa={calls:0,paths:[]};
            globalThis.fetch=async(input,init)=>{
              const url=String(input?.url||input);
              if(url.includes('edge.microsoft.com/translate/')||
                 url.includes('api.cognitive.microsofttranslator.com/')){
                globalThis.__kissQa.calls++;
                globalThis.__kissQa.paths.push(url.split('?')[0]);
                const raw=JSON.parse(init?.body||'[]');
                const texts=Array.isArray(raw)?raw:[raw];
                return new Response(JSON.stringify(texts.map(x=>({
                  translations:[{to:'zh-Hans',text:'译文:'+(typeof x==='string'?x:x.Text||'')}],
                  detectedLanguage:{language:'en'}
                }))),{status:200,headers:{'content-type':'application/json'}});
              }
              return original(input,init);
            };
          }""")
          html='<!doctype html><html lang="en"><head><meta charset="utf-8"/></head><body><main><article>'+''.join(
              f'<p id="paragraph-{i}">Benchmark article paragraph {i} discusses forecasting global capital markets and multilingual document processing.</p>'
              for i in range(SAMPLES))+'</article></main></body></html>'
          async def fixture(route):
            await route.fulfill(status=200,content_type="text/html",body=html)
          await ctx.route(URL,fixture)
          page=await ctx.new_page()
          page.on("console",lambda msg: print("KISS PAGE CONSOLE:",msg.text[:260]) if msg.type=="error" else None)
          await page.goto(URL,wait_until="domcontentloaded",timeout=25000)
          await page.wait_for_timeout(2000)
          tab=await ctx.new_page()
          await tab.goto(f"chrome-extension://{eid}/popup.html",timeout=18000)
          tab_id=await tab.evaluate("""async()=>{
            const tabs=await chrome.tabs.query({});
            return tabs.find(t=>t.url?.includes('/multimodal-kiss-benchmark'))?.id;
          }""")
          assert isinstance(tab_id,int),"KISS could not access fixture tab"
          started=time.monotonic()
          response=await tab.evaluate("""async(id)=>{
            try{return await chrome.tabs.sendMessage(id,{
              action:'toggle_translate',args:{enabled:true}
            });}catch(e){return {sendError:String(e)};}
          }""",tab_id)
          report["command_response"]=str(response)[:180]
          elapsed=0
          while elapsed<40:
            covered=await page.evaluate("""()=>{
              return Array.from({length:24},(_,i)=>{
                const source=document.querySelector('#paragraph-'+i);
                // Strict per-paragraph ownership; looking up all translations
                // in the shared article would incorrectly inflate coverage.
                const translation=source?.querySelector('.kiss-translator-inner');
                return Boolean(translation?.textContent?.includes('译文:'));
              }).filter(Boolean).length;
            }""")
            if covered>=SAMPLES:break
            await page.wait_for_timeout(650)
            elapsed=time.monotonic()-started
          report["translated_paragraphs"]=covered
          report["coverage_percent"]=round(100*covered/SAMPLES,1)
          report["elapsed_seconds"]=round(time.monotonic()-started,2)
          worker=await sw.evaluate("()=>globalThis.__kissQa")
          report["translation_route_observed"]=bool(worker["calls"] or telemetry["calls"])
          report["mock_http_calls"]=worker["calls"]+telemetry["calls"]
          report["status"]="pass" if covered>=SAMPLES and report["translation_route_observed"] else "failed_or_incomplete"
          print("KISS REAL WEB TRANSLATION: "+json.dumps(report,ensure_ascii=False),flush=True)
          # Verify restore from same core, even if translation is partial.
          if covered:
            await tab.evaluate("""async(id)=>{
              await chrome.tabs.sendMessage(id,{action:'toggle_translate',args:{enabled:false}});
            }""",tab_id)
            await page.wait_for_timeout(1000)
            report["restored"]=await page.locator('.kiss-translator-inner').count()==0
          if report["status"]!="pass":raise AssertionError(f"KISS real translation not established: {report}")
        finally:
          Path("kiss-translation-benchmark.json").write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n")
          await ctx.close()

if __name__=="__main__":
    asyncio.run(main())
