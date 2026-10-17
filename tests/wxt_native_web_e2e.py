"""Real Chromium MV3 integration of the WXT React popup and PIT background.

Network translation is mocked INSIDE the real extension service worker:
this verifies runtime wiring without paid API traffic or user credentials.
"""
import asyncio
import tempfile
from pathlib import Path
from playwright.async_api import async_playwright

ROOT=Path(__file__).resolve().parents[1]
PACKAGE=ROOT/"apps"/"wxt-ui"/".output"/"chrome-mv3"
FIXTURE_URL="https://api.deepl.com/pit-ui-fixture"

async def main():
    assert (PACKAGE/"manifest.json").exists(), "Build WXT first"
    errors=[]
    with tempfile.TemporaryDirectory(prefix="pit-wxt-e2e-") as profile:
        async with async_playwright() as p:
            context=await p.chromium.launch_persistent_context(
                profile,channel="chromium",headless=True,
                args=[f"--disable-extensions-except={PACKAGE}",
                      f"--load-extension={PACKAGE}",
                      "--no-sandbox","--disable-dev-shm-usage"])
            try:
                sw=context.service_workers[0] if context.service_workers else (
                    await context.wait_for_event("serviceworker",timeout=30000))
                eid=sw.url.split("/")[2]
                assert len(eid)==32
                # Site host is already an allowed official provider domain in
                # the native manifest. This avoids synthetic activeTab grants.
                async def serve(route):
                    await route.fulfill(status=200, content_type="text/html",
                        body='<html><main><p id="source">Original paragraph about financial analysis and market research.</p></main></html>')
                await context.route(FIXTURE_URL,serve)
                options=await context.new_page()
                options.on("pageerror",lambda e: errors.append("options:"+str(e)))
                await options.goto(f"chrome-extension://{eid}/pit-options.html")
                await options.locator('form[data-ready="1"]').wait_for(timeout=15000)
                await options.locator('[name="microsoftKey"]').fill("fixture-only-never-sent")
                await options.locator('[name="standardProvider"]').select_option("microsoft")
                await options.get_by_role("button",name="保存设置").click()
                await options.get_by_text("设置已保存。").wait_for(timeout=8000)
                # Replace ONLY network fetch on this temporary test service worker.
                # All actual native message routing, cache, parsing and DOM
                # injection execute inside Chromium.
                await sw.evaluate("""() => {
                    const original=globalThis.fetch.bind(globalThis);
                    globalThis.fetch=async(input,options)=>{
                      const url=String(input);
                      if(url.startsWith('https://api.cognitive.microsofttranslator.com/')){
                        const data=JSON.parse(options.body);
                        const rows=data.map(x=>({translations:[{text:'译文:'+x.Text}]}));
                        return new Response(JSON.stringify(rows),{
                          status:200,headers:{'content-type':'application/json'}
                        });
                      }
                      if(url.startsWith('https://api.mymemory.translated.net/get?')){
                        const source=new URL(url).searchParams.get('q');
                        return new Response(JSON.stringify({
                          responseStatus:200,
                          responseData:{translatedText:'真实通道模拟译文:'+source}
                        }),{status:200,headers:{'content-type':'application/json'}});
                      }
                      return original(input,options);
                    };
                }""")
                popup=await context.new_page()
                popup.on("pageerror",lambda e: errors.append("popup:"+str(e)))
                await popup.goto(f"chrome-extension://{eid}/popup.html")
                await popup.get_by_role("button",name="翻译当前网页").wait_for(timeout=15000)
                target=await context.new_page()
                target.on("pageerror",lambda e:errors.append("target:"+str(e)))
                await target.goto(FIXTURE_URL)
                await target.bring_to_front()
                active=await popup.evaluate("""async()=> {
                  const tabs=await chrome.tabs.query({active:true,currentWindow:true});
                  return tabs[0]?.url||'';
                }""")
                assert active.startswith(FIXTURE_URL),f"Not fixture tab: {active}"
                await popup.get_by_role("button",name="翻译当前网页").click()
                await target.locator("#source + .pit-translation").wait_for(timeout=18000)
                translated=await target.locator("#source + .pit-translation").inner_text()
                assert "译文:Original paragraph" in translated,translated
                await popup.wait_for_function("""()=>
                  document.querySelector(".native-progress")?.textContent.includes("1/1")
                """,timeout=12000)
                progress=await popup.locator(".native-progress").inner_text()
                assert "1/1" in progress,progress
                print("PASS: WXT React button → PIT MV3 service worker → stubbed official provider → real DOM → coverage")

                await popup.get_by_role("button",name="恢复原文").click()
                await target.locator(".pit-translation").wait_for(state="detached",timeout=12000)
                print("PASS: WXT React restores original DOM")

                # Real production runtime, but only the free provider HTTP
                # boundary is mocked here. Actual live MyMemory result is
                # separately observed by the external live-provider workflow.
                await options.locator('[name="standardProvider"]').select_option('mymemory')
                await options.locator('[name="microsoftKey"]').fill('')
                await options.get_by_role("button",name="保存设置").click()
                await target.bring_to_front()
                await popup.get_by_role("button",name="翻译当前网页").click()
                await target.locator("#source + .pit-translation").get_by_text(
                  '真实通道模拟译文:Original paragraph',exact=False).wait_for(timeout=15000)
                print('PASS: WXT native background routes no-key free engine to real DOM')

                # Browser context selection is a persistent card, not a
                # transient toast. It exposes copy/voice/close actions.
                await popup.evaluate("""async()=>{
                  const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
                  await chrome.tabs.sendMessage(tab.id,{
                    type:'PIT_SELECTION_CONTEXT',text:'Capital markets are open'
                  });
                }""")
                await target.locator(".pit-selection-card .pit-selection-translated").get_by_text(
                  '真实通道模拟译文:Capital markets are open').wait_for(timeout=15000)
                assert await target.locator(".pit-selection-toolbar button").count()==3
                print('PASS: native selected text to persistent copy/TTS card')

                # User-exported reading preferences must not contain saved
                # MS keys, provider tokens or custom AI profiles.
                async with options.expect_download(timeout=15000) as backup_event:
                    await options.get_by_role('button',name='导出阅读设置').click()
                import json
                backup=json.loads(Path(await (await backup_event.value).path()).read_text(encoding='utf8'))
                assert backup['product']=='PIT'
                assert 'microsoftKey' not in backup['preferences']
                assert 'cloudToken' not in backup['preferences']
                print('PASS: portable reading settings JSON excludes API credentials')

                # Keep model keys/settings only in extension contexts.
                assert "fixture-only-never-sent" not in await target.content()
                assert not errors,errors
            finally:
                await context.close()

if __name__=="__main__":
    asyncio.run(main())
