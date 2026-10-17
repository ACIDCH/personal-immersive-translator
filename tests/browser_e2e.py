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
                sendMessage: async msg=>msg.type==='PIT_PUBLIC_PREFERENCES'
                  ? {ok:true,preferences:{hoverTranslate:true,inputTranslate:true,
                    webScope:'smart',webDisplay:'bilingual',
                    translationTheme:'subtle',autoTranslateHosts:'',blockedHosts:''}}
                  : {ok:true,translations:msg.texts.map(t=>'译文:'+t)}
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
            # Regression for the old Latin-only letter pattern and 12-char
            # threshold, which made Chinese/Japanese short text ineligible.
            await page.evaluate("""()=>{
              const host=document.createElement('section');
              host.innerHTML='<p id="cjk-short">中文金融</p>'+
                '<p id="latin-short">Good day</p>'+
                '<div id="div-only">Div-only financial summary</div>';
              document.querySelector('main').append(host);
            }""")
            await page.locator('#cjk-short + .pit-translation').get_by_text(
              '译文:中文金融').wait_for(timeout=9000)
            await page.locator('#latin-short + .pit-translation').get_by_text(
              '译文:Good day').wait_for(timeout=9000)
            await page.locator('#div-only + .pit-translation').get_by_text(
              '译文:Div-only financial summary').wait_for(timeout=9000)
            print("PASS: actual browser short CJK, short Latin and div-only article segments")
            await page.evaluate("""()=>{
              const container=document.createElement('section');
              container.innerHTML='<p id="hover-target">Hover interaction for finance readers</p>'+
                '<input id="input-target" type="text" value="Financial markets" />'+
                '<input id="secret-target" type="password" value="dont-touch-me" />';
              document.querySelector('main').append(container);
              document.querySelector('#hover-target').dispatchEvent(
                new PointerEvent('pointerover',{bubbles:true,shiftKey:true}));
            }""")
            await page.locator('#hover-target + .pit-translation').get_by_text(
              '译文:Hover interaction for finance readers').wait_for(timeout=9000)
            input_box=page.locator('#input-target')
            await input_box.focus()
            await input_box.press('Space')
            await input_box.press('Space')
            await input_box.press('Space')
            await page.wait_for_function("""()=>{
              return document.querySelector('#input-target').value==='译文:Financial markets';
            }""",timeout=9000)
            assert await page.locator('#secret-target').input_value()=='dont-touch-me'
            await page.evaluate("()=>window.pitAction('PIT_SET_DISPLAY')")
            # A direct display-mode command is tested below with its value.
            await page.evaluate("""()=>new Promise(resolve=>
              window.pitListeners.forEach(fn=>fn({
                type:'PIT_SET_DISPLAY',display:'translation-only',theme:'highlight'
              },{},resolve)))""")
            assert await page.locator('#hover-target').evaluate(
              "el=>el.classList.contains('pit-original-concealed')")
            assert await page.locator('#hover-target + .pit-translation').get_attribute(
              'data-theme')=='highlight'
            print("PASS: Shift hover, triple-Space translation and translation-only mode")
            await page.evaluate("""()=>{
              const node=document.getElementById('latin-short').firstChild;
              const selection=window.getSelection();
              const range=document.createRange();
              range.selectNodeContents(node);
              selection.removeAllRanges();selection.addRange(range);
            }""")
            await page.evaluate("()=>window.pitAction('PIT_SELECTION')")
            await page.locator('.pit-selection-card .pit-selection-result').get_by_text(
              '译文:Good day').wait_for(timeout=10000)
            assert await page.locator('.pit-selection-card button').count()==4
            assert await page.locator('.pit-selection-card button').all_text_contents()==[
              '关闭','复制译文','朗读原文','朗读译文']
            await page.locator('.pit-selection-card button').get_by_text(
              '关闭').click()
            assert await page.locator('.pit-selection-card').count()==0
            print("PASS: persistent selection card with copy, native TTS and dismiss")

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

            # Regression: long lecture subtitle files must still translate after
            # seeking beyond the previously truncated 3000-cue boundary.
            await video.evaluate("""() => {
              window.pitSimTime=4050;
              Object.defineProperty(document.querySelector('video'),'currentTime',{
                configurable:true,get:()=>window.pitSimTime
              });
            }""")
            long_result=await video.evaluate("""()=>window.pitAction(
              'PIT_CAPTIONS_START','standard',
              Array.from({length:5000},(_,i)=>({
                startTime:i,endTime:i+0.75,text:'cue '+i
              }))
            )""")
            assert long_result["ok"],long_result
            await video.locator(".pit-caption-translated").get_by_text(
                "译文:cue 4050").wait_for(timeout=5000)
            await video.evaluate("()=>window.pitAction('PIT_CAPTIONS_STOP')")
            assert await video.locator(".pit-caption-overlay").count() == 0
            print("PASS: long lecture subtitle seeks beyond 3000 cues")
            assert not errors, "Browser console exceptions: "+repr(errors)
        finally:
            await browser.close()


if __name__=="__main__":
    asyncio.run(main())
