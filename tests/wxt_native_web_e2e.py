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
                # Chrome CLD is an actual built-in extension language detector;
                # the standalone Translator model may be absent on CI runners.
                native=await options.evaluate("""async()=>{
                  const detection=await chrome.i18n.detectLanguage(
                    'Bonjour, nous sommes étudiants et nous étudions la finance internationale.'
                  );
                  return {translatorApi:typeof globalThis.Translator,
                    detectorReady:Array.isArray(detection?.languages),
                    languages:detection?.languages?.map(x=>x.language)||[]};
                }""")
                assert native["detectorReady"],native
                print("REAL CHROME CLD:",native["languages"],
                      "; built-in Translator object:",native["translatorApi"],flush=True)
                actual=await options.evaluate("""async()=>{
                  return await chrome.runtime.sendMessage({
                    type:'PIT_BROWSER_STATUS',source:'en',target:'zh'
                  });
                }""")
                assert actual.get("ok") is True,actual
                assert actual.get("status") in (
                    "available","downloadable","downloading","unavailable"),actual
                assert actual.get("code") not in ("no_response","status_timeout"), (
                    "Chrome native model diagnostic was not routed to offscreen:",actual)
                print("REAL CHROME OFFSCREEN Translator availability:",
                      actual.get("status"),actual.get("reason",""),
                      flush=True)


                # User-click-only public fallback: confirm a real saved engine
                # switch, no implicit remote request or paid AI selection.
                await options.locator('.options-nav a[href="#browserModelSettings"]').click()
                await options.locator('#nativeFallbackMyMemory').click()
                await options.get_by_text('已主动切换至 MyMemory', exact=False).wait_for(timeout=8000)
                fallback=await options.evaluate("""async()=>(
                  await chrome.storage.local.get('pit_settings_v1')
                ).pit_settings_v1""")
                assert fallback["standardProvider"]=="mymemory", fallback
                assert fallback["autoAI"] is False, fallback
                # Restore default on-device preference for subsequent tests.
                await options.locator('.options-nav a[href="#baseSettings"]').click()
                await options.locator('[name="standardProvider"]').select_option("browser")
                await options.get_by_role("button",name="保存设置").click()
                await options.get_by_text("设置已保存。").wait_for(timeout=8000)
                # Initial settings have no self-hosted Worker endpoint.
                # The owner must still be able to save reading preferences.
                await options.locator('.options-nav a[href="#readingSettings"]').click()
                await options.locator('[name="webDisplay"]').select_option("translation-only")
                await options.get_by_role("button",name="保存设置").click()
                await options.get_by_text("设置已保存。").wait_for(timeout=8000)
                saved=await options.evaluate("""async()=>(
                  await chrome.storage.local.get('pit_settings_v1')
                ).pit_settings_v1""")
                assert saved["webDisplay"]=="translation-only"
                assert saved["standardProvider"]=="browser"
                assert saved["cloudEndpoint"]==""
                await options.locator('.options-nav a[href="#readingSettings"]').click()
                await options.locator('[name="webDisplay"]').select_option("bilingual")
                print("PASS: first-run reading settings save without an undeployed cloud provider")
                await options.locator('.options-nav a[href="#standardKeys"]').click()
                await options.locator('[name="microsoftKey"]').fill("fixture-only-never-sent")
                await options.locator('.options-nav a[href="#baseSettings"]').click()
                await options.locator('[name="standardProvider"]').select_option("microsoft")
                await options.get_by_role("button",name="保存设置").click()
                await options.get_by_text("设置已保存。").wait_for(timeout=8000)
                # Exercise the real options UI, not just the pure helper:
                # exported JSON cannot contain credentials or translation data.
                async with options.expect_download(timeout=12000) as exported:
                    await options.locator('.options-nav a[href="#backupSettings"]').click()
                    await options.get_by_role("button",name="导出非敏感偏好 JSON").click()
                downloaded=await exported.value
                exported_text=Path(await downloaded.path()).read_text(encoding="utf-8")
                snapshot=json.loads(exported_text)
                assert snapshot["kind"]=="pit-preferences"
                assert "fixture-only-never-sent" not in exported_text
                assert "microsoftKey" not in exported_text
                snapshot["settings"]["webDisplay"]="translation-only"
                snapshot["settings"]["target"]="fr"
                await options.locator('.options-nav a[href="#backupSettings"]').click()
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
                await options.locator('.options-nav a[href="#readingSettings"]').click()
                await options.locator('[name="webDisplay"]').select_option("bilingual")
                await options.locator('.options-nav a[href="#baseSettings"]').click()
                await options.locator('[name="target"]').select_option("zh")
                print("PASS: real options JSON export excludes credentials, import preview preserves keys")

                # MV3 event workers may be retired while a person edits the
                # options page. An old Playwright Worker object then raises
                # TargetClosedError; wake and reacquire the active instance.
                await options.evaluate("""async()=>await chrome.runtime.sendMessage({
                  type:'GET_SETTINGS'
                })""")
                sw=context.service_workers[-1] if context.service_workers else (
                    await context.wait_for_event("serviceworker",timeout=15000))
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
                # Browser/MyMemory have an explicit in-popup free probe;
                # configured Microsoft requires its own precise service card.
                # Ensure the popup preserves that provider instead of silently
                # testing a different browser-native model.
                async with context.expect_page(timeout=12000) as opened_service:
                    await popup.get_by_role("button",name="测试当前翻译服务").click()
                service_page=await opened_service.value
                await service_page.wait_for_load_state()
                assert '#services/microsoft' in service_page.url,service_page.url
                await service_page.close()
                assert '仅设置界面' not in await popup.locator('.pit-quick-preferences').inner_text()
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
                # Philips-like live career landing pages put display headlines
                # inside a fixed grid column alongside form controls. PIT must
                # translate only the headline, not turn its parent into a
                # full-width translation banner or concatenate form labels.
                landing="https://careers.philips.com/pit-responsive-hero-fixture"
                async def serve_landing(route):
                    await route.fulfill(status=200,content_type="text/html",body='''<!doctype html>
                    <html lang="en"><head><style>
                      body{margin:0;font-family:Arial,sans-serif}
                      .hero{display:grid;grid-template-columns:50% 50%;width:100%;
                        padding:45px;box-sizing:border-box;background:#2b6065}
                      .hero-column{min-width:0;color:#fff}
                      .hero h1{font-size:46px;line-height:1.2;margin:0;max-width:450px}
                      .search-panel{display:flex;gap:10px;margin-top:20px}
                      .search-panel input,.search-panel button{min-width:0;max-width:160px}
                    </style></head><body>
                    <header><nav>Working At Philips</nav></header>
                    <main><section class="hero">
                    <div class="hero-column">
                      <h1 id="hero-title"><span>What you choose to do</span>
                      with your career matters</h1>
                      <div class="search-panel" role="search">
                        <label>Search for job title<input aria-label="Job title" placeholder="Search for job title"></label>
                        <label>Enter location<input aria-label="Location" placeholder="Enter location"></label>
                        <button>Search Jobs</button>
                      </div>
                    </div><div aria-hidden="true">Player photo</div>
                    </section>
                    <section><p id="body-copy">It's not just a job when you're
                      doing the work of your life.</p></section></main></body></html>''')
                await context.route(landing,serve_landing)
                hero=await context.new_page()
                await hero.goto(landing);await hero.bring_to_front()
                await popup.get_by_role('button',name='翻译当前网页').click()
                await hero.locator('#hero-title > .pit-flow-translation').wait_for(timeout=18000)
                hero_layout=await hero.evaluate("""()=>{
                  const title=document.querySelector('#hero-title');
                  const trans=title.querySelector('.pit-flow-translation');
                  const column=document.querySelector('.hero-column');
                  const form=document.querySelector('.search-panel');
                  const rs=trans.getBoundingClientRect(),cs=column.getBoundingClientRect();
                  return {titleInside:trans.parentElement===title,
                    translated:trans.textContent,
                    background:getComputedStyle(trans).backgroundColor,
                    border:getComputedStyle(trans).borderLeftWidth,
                    columnWidth:cs.width,
                    translationWidth:rs.width,
                    formTranslated:form.querySelectorAll('.pit-translation').length,
                    searchButtons:form.querySelectorAll('button').length,
                    overflow:document.documentElement.scrollWidth-innerWidth
                  };
                }""")
                assert hero_layout['titleInside'],hero_layout
                assert hero_layout['translated'].startswith('译文:What you choose'),hero_layout
                assert hero_layout['formTranslated']==0 and hero_layout['searchButtons']==1,hero_layout
                assert hero_layout['translationWidth']<=hero_layout['columnWidth']+2,hero_layout
                assert hero_layout['overflow']<=2,hero_layout
                assert hero_layout['border']=='0px',hero_layout
                assert hero_layout['background'] in ('rgba(0, 0, 0, 0)','transparent'),hero_layout
                await popup.get_by_role('button',name='恢复原文').click()
                await hero.locator('#hero-title > .pit-flow-translation').wait_for(
                  state='detached',timeout=8000)
                await hero.close();await target.bring_to_front()
                print('PASS: career hero bilingual translation stays inside headline column; form untouched')



                await target.bring_to_front()
                await popup.get_by_role("button",name="设置与诊断").click()
                await popup.get_by_text("当前网站：api.deepl.com").wait_for(timeout=10000)
                await popup.get_by_role("button",name="自动翻译此网站").click()
                rules=await popup.evaluate("""async()=>(
                  await chrome.storage.local.get('pit_settings_v1')
                ).pit_settings_v1""")
                assert "api.deepl.com" in rules["autoTranslateHosts"]
                await popup.get_by_role("button",name="取消本站自动翻译").click()
                await popup.get_by_role("button",name="禁用此网站翻译").click()
                rules=await popup.evaluate("""async()=>(
                  await chrome.storage.local.get('pit_settings_v1')
                ).pit_settings_v1""")
                assert "api.deepl.com" in rules["blockedHosts"]
                assert "api.deepl.com" not in rules["autoTranslateHosts"]
                await popup.get_by_role("button",name="解除本站禁用").click()
                print("PASS: real Settings tab adds/removes current-site allow/block rules")
                # Keep model keys/settings only in extension contexts.
                assert "fixture-only-never-sent" not in await target.content()
                # Each service card calls its adapter without replacing the default.
                # MyMemory transport here is explicitly mocked; live evidence is separate.
                await sw.evaluate("""()=>{const old=fetch;globalThis.fetch=(url,init)=>String(url).startsWith('https://api.mymemory.translated.net/')?Promise.resolve(new Response(JSON.stringify({responseStatus:200,responseData:{translatedText:'欢迎来到课堂。'}}),{headers:{'content-type':'application/json'}})):old(url,init);} """)
                await options.locator('.options-nav a[href="#services"]').click()
                options.on('dialog',lambda dialog:asyncio.create_task(dialog.accept()))
                assert await options.locator('[data-service-group="keyless"] [data-provider="browser"]').count()==1
                assert await options.locator('[data-service-group="keyless"] [data-provider="mymemory"]').count()==1
                assert await options.locator('[data-service-group="ai"] [data-provider="gemini"]').count()==1
                assert await options.locator('[data-service-group="standard"] [data-provider="deepl"]').count()==1
                for provider in ['browser','mymemory','cloud','microsoft','google','deepl','libre','gemini','deepseek']:
                    card=options.locator('[data-provider="'+provider+'"]')
                    await card.get_by_role('button',name='测试此服务',exact=False).click()
                    await card.locator('.probe-result').filter(has_text='ms').wait_for(timeout=30000)
                    result=await card.locator('.probe-result').inner_text()
                    assert 'available' in result if provider in ['mymemory','microsoft'] else ('not-configured' in result or 'missing-pack' in result or 'available' in result),result
                current=await options.evaluate("async()=>(await chrome.storage.local.get('pit_settings_v1')).pit_settings_v1")
                assert current['standardProvider']=='microsoft'
                # UI -> saved model -> existing content runtime -> restore.
                await options.locator('.options-nav a[href="#readingSettings"]').click()
                await options.locator('[data-key="translatedFontSize"]').fill('24')
                await options.locator('[data-key="translatedFontSize"]').press('Tab')
                await target.bring_to_front()
                await popup.get_by_role('button',name='网页翻译',exact=True).click()
                await popup.get_by_role('button',name='翻译当前网页').click()
                await target.wait_for_function("() => {const node=document.querySelector('.pit-translation');return node && getComputedStyle(node).fontSize==='24px';}")
                await options.locator('[data-key="translationOrder"]').select_option('translation-first')
                await target.wait_for_function("document.querySelector('#source').previousElementSibling?.classList.contains('pit-translation')")
                await popup.get_by_role('button',name='恢复原文').click()
                await target.locator('.pit-translation').wait_for(state='detached')
                await options.locator('.options-nav a[href="#services"]').click()
                await options.set_viewport_size({'width':1360,'height':950})
                await options.bring_to_front()
                await options.evaluate('window.scrollTo(0,0)')
                await options.screenshot(path=str(ROOT/'pit-v2-options.png'),full_page=True,animations='disabled')
                await popup.set_viewport_size({'width':440,'height':800})
                await popup.bring_to_front()
                await popup.evaluate('window.scrollTo(0,0)')
                await popup.screenshot(path=str(ROOT/'pit-v2-popup.png'),full_page=True,animations='disabled')
                # Layout-level reflow checks at narrow and zoom-equivalent CSS
                # viewport widths; this does not certify actual OS DPI scaling.
                for width in (360,800,910,1088,1360):
                    await options.set_viewport_size({'width':width,'height':750})
                    geometry=await options.evaluate("""()=>{
                      const root=document.documentElement;
                      const nav=document.querySelector('.options-nav');
                      const panel=document.querySelector('#services');
                      return {
                        viewport:window.innerWidth,doc:root.scrollWidth,
                        navigation:nav?.getBoundingClientRect().width,
                        visible:!panel?.hidden,
                        statusWidth:document.querySelector('#status')?.getBoundingClientRect().width
                      };
                    }""")
                    assert geometry['doc']<=geometry['viewport']+2, (width,geometry)
                    assert geometry['visible'] and geometry['navigation']>0,(width,geometry)
                    assert geometry['statusWidth']<=geometry['viewport'],(width,geometry)
                await options.goto(f"chrome-extension://{eid}/pit-options.html#retired-v1-section")
                await options.locator('form[data-ready="1"]').wait_for(timeout=10000)
                assert await options.locator('#baseSettings').is_visible(), (
                    'Unknown deep-link must not hide all settings panels')
                assert await options.locator('.options-nav a[aria-current="page"]').count()==1
                print('PASS: settings reflow 360–1360px and obsolete deep-link recovery')
                print('PASS: independent service card probes, unchanged default, live style/order and restore (mock transport L1)')
                assert not errors,errors
            finally:
                await context.close()

if __name__=="__main__":
    asyncio.run(main())
