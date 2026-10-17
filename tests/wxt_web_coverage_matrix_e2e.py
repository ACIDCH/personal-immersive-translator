"""Chromium MV3 coverage matrix: production React popup + PIT DOM engine.

Deterministic editorial-length HTML and mock official MT transport.
These are real browser/extension tests, NOT live MT quality evaluation.
"""
import asyncio
import json
import tempfile
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1]
PACKAGE = ROOT / "apps/wxt-ui/.output/chrome-mv3"
URL = "https://api.deepl.com/pit-coverage-matrix"

async def main():
    assert (PACKAGE / "manifest.json").exists(), "Build WXT package first"
    with tempfile.TemporaryDirectory(prefix="multimodal-matrix-") as profile:
        async with async_playwright() as p:
            context = await p.chromium.launch_persistent_context(
                profile, channel="chromium", headless=True,
                args=[f"--disable-extensions-except={PACKAGE}",
                      f"--load-extension={PACKAGE}", "--no-sandbox",
                      "--disable-dev-shm-usage"])
            try:
                sw = context.service_workers[0] if context.service_workers else await context.wait_for_event("serviceworker",timeout=30000)
                eid = sw.url.split("/")[2]
                await sw.evaluate("""() => {
                  globalThis.pitQa = {calls:0, failures:0, failNext:false};
                  const original=globalThis.fetch.bind(globalThis);
                  globalThis.fetch=async(input,init)=>{
                    if(String(input).startsWith('https://api.cognitive.microsofttranslator.com/')){
                      globalThis.pitQa.calls++;
                      if(globalThis.pitQa.failNext){
                        globalThis.pitQa.failNext=false;
                        globalThis.pitQa.failures++;
                        return new Response('{"error":"throttle"}',{status:429,headers:{'content-type':'application/json'}});
                      }
                      const data=JSON.parse(init.body);
                      return new Response(JSON.stringify(data.map(x=>({
                        translations:[{text:'译文:'+x.Text}]
                      }))),{status:200,headers:{'content-type':'application/json'}});
                    }
                    return original(input,init);
                  };
                }""")
                options=await context.new_page()
                await options.goto(f"chrome-extension://{eid}/pit-options.html")
                await options.locator('form[data-ready="1"]').wait_for(timeout=12000)
                await options.locator('[name="microsoftKey"]').fill('local-fixture-placeholder')
                await options.locator('[name="standardProvider"]').select_option('microsoft')
                await options.get_by_role('button',name='保存设置').click()
                await options.get_by_text('设置已保存。').wait_for(timeout=8000)

                paragraphs="".join(
                    f'<p id="p-{i}">Financial research paragraph number {i}: forecasting international market conditions, currency risk and operational decisions.</p>'
                    for i in range(85))
                html=('<!doctype html><html><body><header><p id="head-text">'
                      'Top site navigation not part of the readable article.</p></header>'
                      '<nav><p>Navigation content should never be translated.</p></nav>'
                      '<main><article>'+paragraphs+'</article>'
                      '<pre>Code snippet should remain in original language</pre>'
                      '<form><label>Enter password<input id="password" type="password" value="DO_NOT_TRANSLATE"></label></form>'
                      '<div id="shadow-host"></div><p id="changing">'
                      'Dynamic initial article paragraph about forecasting operational risk.'
                      '</p></main></body></html>')
                async def serve(route):
                    await route.fulfill(status=200,content_type='text/html',body=html)
                await context.route(URL,serve)
                popup=await context.new_page()
                await popup.goto(f"chrome-extension://{eid}/popup.html")
                await popup.get_by_role("button",name="翻译当前网页").wait_for(timeout=15000)
                target=await context.new_page()
                await target.goto(URL)
                await target.bring_to_front()
                await popup.get_by_role("button",name="翻译当前网页").click()
                await target.locator("#p-84 + .pit-translation").wait_for(timeout=45000)
                await popup.wait_for_function("""()=> {
                  const value=document.querySelector('.native-progress')?.textContent||'';
                  return value.includes('86/86') && value.includes('100%');
                }""",timeout=30000)
                assert await target.locator('article .pit-translation').count()==85
                assert await target.locator('nav .pit-translation,header .pit-translation,pre .pit-translation,form .pit-translation').count()==0
                assert await target.locator("#password").input_value()=="DO_NOT_TRANSLATE"
                print("PASS: 86 eligible text blocks translated through WXT; non-content and form fields preserved")

                # Dynamic SPA text replacement and newly discovered open Shadow DOM
                await target.evaluate("""()=>{
                  document.querySelector('#changing').firstChild.nodeValue =
                    'Dynamic replacement paragraph describing changing exchange rate exposures.';
                  document.querySelector('#shadow-host').attachShadow({mode:'open'}).innerHTML =
                    '<p id="shadow-content">Shadow root dynamically introduced with an eligible paragraph about supply chains.</p>';
                }""")
                await target.wait_for_function("""()=>{
                  const shadow=document.querySelector('#shadow-host').shadowRoot;
                  return document.querySelector('#changing + .pit-translation')?.textContent?.includes('Dynamic replacement')
                    && shadow?.querySelector('#shadow-content + .pit-translation')?.textContent?.includes('Shadow root dynamically');
                }""",timeout=20000)
                await popup.wait_for_function("""()=>{
                  const value=document.querySelector('.native-progress')?.textContent||'';
                  return value.includes('87/87') && value.includes('100%');
                }""",timeout=15000)
                assert await target.locator('#changing + .pit-translation').count()==1
                print("PASS: live SPA mutation + new open Shadow DOM retranslated without duplicated results")

                # Remote provider errors must not be represented as successful translations.
                await popup.get_by_role("button",name="恢复原文").click()
                await target.locator(".pit-translation").first.wait_for(state="detached",timeout=12000)
                # Existing translations are correctly cached; settings-page-only
                # cache clearing is an intentional trust boundary. Clear before
                # fault injection or no real network call would be made.
                cleared=await options.evaluate("""async()=>chrome.runtime.sendMessage({type:'CLEAR_CACHE'})""")
                assert cleared.get("ok"),cleared
                await sw.evaluate("()=>{globalThis.pitQa.failNext=true;}")
                await popup.get_by_role("button",name="翻译当前网页").click()
                await popup.wait_for_function("""()=>document.querySelector('.native-progress')?.textContent?.includes('失败批次 1')""",timeout=15000)
                assert await target.locator('.pit-translation').count()==0
                state=await sw.evaluate("()=>globalThis.pitQa")
                assert state["failures"]==1,state
                print("PASS: HTTP 429 is visible as failure, never false 100% completion")

                # User manually retries. No paid endpoint or automatic paid fallback.
                await popup.get_by_role("button",name="翻译当前网页").click()
                await target.locator("#p-84 + .pit-translation").wait_for(timeout=45000)
                await popup.wait_for_function("""()=>document.querySelector('.native-progress')?.textContent?.includes('87/87')""",timeout=20000)
                assert await target.locator('.pit-translation').count()==87
                await popup.get_by_role("button",name="恢复原文").click()
                await target.locator('.pit-translation').first.wait_for(state='detached',timeout=15000)
                print("PASS: manual retry after provider failure and complete source restoration")

                report={"environment":"Chromium MV3 + React WXT + real PIT DOM",
                        "translation_provider":"mocked HTTP, zero paid calls",
                        "initial":{"eligible":86,"translated":86,"coverage":100.0},
                        "dynamic":{"eligible":87,"translated":87,"coverage":100.0},
                        "failure":{"http":429,"surface":True,"silent_fallback":False},
                        "recovery":{"manual_retry":True,"restore":True},
                        "network_requests":(await sw.evaluate("()=>globalThis.pitQa.calls"))}
                Path("wxt-web-coverage-report.json").write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding="utf-8")
                print("QA REPORT: "+json.dumps(report,ensure_ascii=False))
            finally:
                await context.close()

if __name__=="__main__":
    asyncio.run(main())
