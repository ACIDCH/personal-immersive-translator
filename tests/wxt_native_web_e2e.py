"""Real Chromium MV3 integration of the WXT React popup and PIT background.

Network translation is mocked INSIDE the real extension service worker:
this verifies runtime wiring without paid API traffic or user credentials.
"""
import asyncio
import json
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
                # Initial settings have no self-hosted Worker endpoint.
                # The owner must still be able to save reading preferences.
                await options.locator('[name="webDisplay"]').select_option("translation-only")
                await options.get_by_role("button",name="保存设置").click()
                await options.get_by_text("设置已保存。").wait_for(timeout=8000)
                saved=await options.evaluate("""async()=>(
                  await chrome.storage.local.get('pit_settings_v1')
                ).pit_settings_v1""")
                assert saved["webDisplay"]=="translation-only"
                assert saved["standardProvider"]=="cloud"
                assert saved["cloudEndpoint"]==""
                await options.locator('[name="webDisplay"]').select_option("bilingual")
                print("PASS: first-run reading settings save without an undeployed cloud provider")
                await options.locator('[name="microsoftKey"]').fill("fixture-only-never-sent")
                await options.locator('[name="standardProvider"]').select_option("microsoft")
                await options.get_by_role("button",name="保存设置").click()
                await options.get_by_text("设置已保存。").wait_for(timeout=8000)
                # Exercise the real options UI, not just the pure helper:
                # exported JSON cannot contain credentials or translation data.
                async with options.expect_download(timeout=12000) as exported:
                    await options.get_by_role("button",name="导出非敏感偏好 JSON").click()
                downloaded=await exported.value
                exported_text=Path(await downloaded.path()).read_text(encoding="utf-8")
                snapshot=json.loads(exported_text)
                assert snapshot["kind"]=="pit-preferences"
                assert "fixture-only-never-sent" not in exported_text
                assert "microsoftKey" not in exported_text
                snapshot["settings"]["webDisplay"]="translation-only"
                snapshot["settings"]["target"]="fr"
                await options.locator("#importPreferences").set_input_files({
                    "name":"pit-preferences.json","mimeType":"application/json",
                    "buffer":json.dumps(snapshot).encode("utf-8")
                })
                await options.get_by_text("已预览导入的非敏感偏好",exact=False).wait_for(timeout=8000)
                assert await options.locator('[name="webDisplay"]').input_value()=="translation-only"
                assert await options.locator('[name="target"]').input_value()=="fr"
                assert await options.locator('[name="microsoftKey"]').input_value()=="fixture-only-never-sent"
                # Import only fills the form; the owner must explicitly save.
                # Leave the previously saved English-to-Chinese fixture intact.
                await options.locator('[name="webDisplay"]').select_option("bilingual")
                await options.locator('[name="target"]').select_option("zh")
                print("PASS: real options JSON export excludes credentials, import preview preserves keys")

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

                # Keep model keys/settings only in extension contexts.
                assert "fixture-only-never-sent" not in await target.content()
                assert not errors,errors
            finally:
                await context.close()

if __name__=="__main__":
    asyncio.run(main())
