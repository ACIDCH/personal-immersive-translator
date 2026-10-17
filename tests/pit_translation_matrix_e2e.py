"""PIT WXT vs pinned KISS: 24 identical English source paragraphs, mocked Microsoft MT.

Real Chromium extension + native web content script + exact same textual fixture
and browser flags as tests/kiss_translation_matrix_e2e.py. Note PIT starts from
the WXT React popup, KISS uses its internal MV3 command (different UI overhead).
"""
import asyncio
import json
import tempfile
import time
from pathlib import Path
from playwright.async_api import async_playwright

ROOT=Path(__file__).resolve().parents[1]
PACKAGE=ROOT/"apps/wxt-ui/.output/chrome-mv3"
URL="https://api.deepl.com/multimodal-kiss-benchmark"
SAMPLES=24

async def main():
  assert (PACKAGE/"manifest.json").exists(),"Build WXT first"
  report={"engine":"PIT (WXT + native core)","page":"local deterministic English editorial fixture",
          "source_paragraphs":SAMPLES,
          "model":"Microsoft-compatible native service (mock HTTP at boundary)",
          "status":"not_run","translated_paragraphs":0}
  with tempfile.TemporaryDirectory(prefix="pit-headtohead-") as profile:
    async with async_playwright() as p:
      ctx=await p.chromium.launch_persistent_context(
          profile,channel="chromium",headless=True,
          args=[f"--disable-extensions-except={PACKAGE}",
                f"--load-extension={PACKAGE}","--no-sandbox","--disable-dev-shm-usage"])
      try:
        sw=ctx.service_workers[0] if ctx.service_workers else await ctx.wait_for_event('serviceworker',timeout=30000)
        eid=sw.url.split('/')[2]
        await sw.evaluate("""()=>{
          const original=globalThis.fetch.bind(globalThis);
          globalThis.__pitQa={calls:0};
          globalThis.fetch=async(input,init)=>{
            const url=String(input?.url||input);
            if(url.startsWith('https://api.cognitive.microsofttranslator.com/')){
              globalThis.__pitQa.calls++;
              const raw=JSON.parse(init.body);
              return new Response(JSON.stringify(raw.map(x=>({
                translations:[{to:'zh-Hans',text:'译文:'+x.Text}],
                detectedLanguage:{language:'en'}
              }))),{status:200,headers:{'content-type':'application/json'}});
            }
            return original(input,init);
          };
        }""")
        options=await ctx.new_page()
        await options.goto(f"chrome-extension://{eid}/pit-options.html")
        await options.locator('form[data-ready="1"]').wait_for(timeout=15000)
        await options.locator('[name="standardProvider"]').select_option('microsoft')
        await options.locator('[name="microsoftKey"]').fill('benchmark-placeholder-key')
        await options.get_by_role("button",name="保存设置").click()
        await options.get_by_text("设置已保存。").wait_for(timeout=8000)
        body='<!doctype html><html lang="en"><head><meta charset="utf-8"/></head><body><main><article>'+''.join(
              f'<p id="paragraph-{i}">Benchmark article paragraph {i} discusses forecasting global capital markets and multilingual document processing.</p>'
              for i in range(SAMPLES))+'</article></main></body></html>'
        async def fixture(route):
          await route.fulfill(status=200,content_type="text/html",body=body)
        await ctx.route(URL,fixture)
        popup=await ctx.new_page()
        await popup.goto(f"chrome-extension://{eid}/popup.html")
        await popup.get_by_role("button",name="翻译当前网页").wait_for(timeout=15000)
        page=await ctx.new_page()
        await page.goto(URL,wait_until="domcontentloaded",timeout=20000)
        await page.bring_to_front()
        start=time.monotonic()
        await popup.get_by_role("button",name="翻译当前网页").click()
        await page.wait_for_function("""()=>
          Array.from({length:24},(_,i)=>{
            const p=document.querySelector('#paragraph-'+i);
            return Boolean(p?.nextElementSibling?.classList?.contains('pit-translation')
              && p.nextElementSibling.textContent.includes('译文:'));
          }).every(Boolean)
        """,timeout=40000)
        elapsed=round(time.monotonic()-start,2)
        translated=await page.evaluate("""()=>
          Array.from({length:24},(_,i)=>{
            const p=document.querySelector('#paragraph-'+i);
            return Boolean(p?.nextElementSibling?.classList?.contains('pit-translation')
              && p.nextElementSibling.textContent.includes('译文:'));
          }).filter(Boolean).length
        """)
        report.update({"translated_paragraphs":translated,
          "coverage_percent":round(100*translated/SAMPLES,1),
          "elapsed_seconds":elapsed,
          "mock_http_calls":(await sw.evaluate("()=>globalThis.__pitQa.calls")),
          "status":"pass" if translated==SAMPLES else "failed_or_incomplete"})
        await popup.get_by_role("button",name="恢复原文").click()
        await page.locator(".pit-translation").first.wait_for(state="detached",timeout=12000)
        report["restored"]=await page.locator(".pit-translation").count()==0
        print("PIT REAL WEB TRANSLATION: "+json.dumps(report,ensure_ascii=False),flush=True)
        assert translated==SAMPLES and report["restored"] and report["mock_http_calls"]>0,report
      finally:
        Path("pit-translation-benchmark.json").write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n")
        await ctx.close()

if __name__=="__main__":
    asyncio.run(main())
