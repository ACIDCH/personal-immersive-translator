"""Chromium DOM integration tests using mocked translation APIs.

These exercise actual DOM, Shadow DOM, SPA mutation observers, and timed subtitle
display in a real browser. They do not imply actual Chrome extension installation
or successful calls to commercial translation APIs.
"""
import asyncio
import os
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1] / "src"


async def main():
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(
            executable_path=os.getenv("PIT_CHROMIUM_PATH") or None,
            channel=None if os.getenv("PIT_CHROMIUM_PATH") else "chrome",
            headless=True,
            args=["--no-sandbox", "--disable-dev-shm-usage"],
        )
        errors = []
        try:
            page = await browser.new_page()
            page.on("pageerror", lambda e: errors.append(str(e)))
            await page.set_content(
                '<main><h1>Welcome to academic learning resources</h1>'
                '<article><p>This is an example about financial economics and modelling.</p></article>'
                '<div id="slides"></div></main>'
            )
            await page.evaluate("""() => {
              window.pitListeners=[];
              window.chrome={runtime:{
                onMessage:{addListener: fn=>window.pitListeners.push(fn)},
                sendMessage: async msg=>({
                  ok:true,translations:msg.texts.map(t=>'译文:'+t)
                })
              }};
              window.pitAction=(type,mode='standard')=>new Promise(resolve=>{
                for(const fn of window.pitListeners)fn({type,mode},{},resolve);
              });
              const host=document.createElement('section');
              host.id='shadow-host';
              document.body.append(host);
              host.attachShadow({mode:'open'}).innerHTML =
                '<p>Hello from an open shadow root paragraph.</p>';
            }""")
            await page.add_script_tag(path=str(ROOT / "content.js"))
            await page.evaluate("()=>window.pitAction('PIT_START')")
            await page.locator(".pit-translation").first.wait_for(timeout=8000)
            assert await page.locator(".pit-translation").count() >= 2
            assert await page.evaluate("""()=>
              document.querySelector('#shadow-host').shadowRoot
                .querySelectorAll('.pit-translation').length
            """) == 1
            await page.locator("#slides").evaluate("""el=>
              el.innerHTML='<p>Our next lecture explains global transportation networks.</p>'
            """)
            await page.locator("#slides .pit-translation").wait_for(timeout=5000)
            assert await page.locator("#slides .pit-translation").count() == 1
            await page.evaluate("()=>window.pitAction('PIT_RESTORE')")
            assert await page.locator(".pit-translation").count() == 0
            assert await page.evaluate("""()=>
              document.querySelector('#shadow-host').shadowRoot
                .querySelectorAll('.pit-translation').length
            """) == 0
            print("PASS: web bilingual, dynamic slide, open Shadow DOM, restore")

            video = await browser.new_page()
            video.on("pageerror", lambda e: errors.append(str(e)))
            await video.set_content('<video style="width:600px;height:330px"></video>')
            await video.evaluate("""() => {
              window.pitListeners=[];
              window.chrome={runtime:{
                onMessage:{addListener: fn=>window.pitListeners.push(fn)},
                sendMessage:async msg=>({
                  ok:true,translations:msg.texts.map(t=>'译文:'+t)
                })
              }};
              window.pitAction=(type,mode='standard',cues=[])=>new Promise(resolve=>{
                for(const fn of window.pitListeners)fn({type,mode,cues},{},resolve);
              });
            }""")
            for script in ["lib/caption-core.js","lib/platform-captions.js","subtitles.js"]:
                await video.add_script_tag(path=str(ROOT / script))
            result=await video.evaluate("""()=>window.pitAction(
              'PIT_CAPTIONS_START','standard',
              [{startTime:0,endTime:20,text:'Hello lecture caption'}]
            )""")
            assert result["ok"],result
            await video.locator(".pit-caption-translated").get_by_text(
                "译文:Hello lecture caption").wait_for(timeout=5000)
            await video.evaluate("()=>window.pitAction('PIT_CAPTIONS_STOP')")
            assert await video.locator(".pit-caption-overlay").count() == 0
            print("PASS: imported subtitle timestamp rendering and stop cleanup")
            assert not errors, "Browser console exceptions: "+repr(errors)
        finally:
            await browser.close()


if __name__=="__main__":
    asyncio.run(main())
