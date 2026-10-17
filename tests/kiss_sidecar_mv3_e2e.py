"""Actual Chromium MV3 extension fixture: KISS original browser engine
plus PIT PDF.js + OCR tools. No paid API keys, private media or real OCR model.
"""
import asyncio
import json
import os
import tempfile
from pathlib import Path
import fitz
from playwright.async_api import async_playwright

async def main():
    ext=Path(os.environ.get("PIT_KISS_EXTENSION_DIR",
       "/tmp/pit-kiss-upstream/build/chrome")).resolve()
    assert (ext/"pit/tools.html").is_file(),ext
    with tempfile.TemporaryDirectory(prefix="kiss-sidecar-") as profile:
      async with async_playwright() as p:
        browser=await p.chromium.launch_persistent_context(
          profile,channel="chromium",headless=True,args=[
            "--no-sandbox",f"--disable-extensions-except={ext}",
            f"--load-extension={ext}"])
        try:
          # Playwright bundled Chromium supports the --load-extension flag.
          # Google-branded Chrome >=137 ignores that flag (Chrome policy),
          # so waiting on its extension manager was not a valid install test.
          worker=browser.service_workers[0] if browser.service_workers else await browser.wait_for_event(
              "serviceworker",timeout=20000)
          origin="/".join(worker.url.split("/")[:3])
          assert origin.startswith("chrome-extension://"),worker.url
          print("PASS: KISS MV3 background worker is active",origin,flush=True)
          display=await worker.evaluate("""()=>{
            const m=chrome.runtime.getManifest();
            return {name:m.name,version:m.version,version_name:m.version_name,
              title:m.action?.default_title,icon:m.icons?.['128']};
          }""")
          assert display["name"]=="PIT 沉浸式翻译（测试版）",display
          assert display["version"]=="2.1.1",display
          assert display["version_name"]=="PIT v0.4.9 (KISS 2.1.1)",display
          assert display["title"]=="PIT 沉浸式翻译 · v0.4.9",display
          assert display["icon"]=="pit/icons/icon128.png",display
          print("PASS: Chrome extension identity displays PIT brand and KISS core attribution",flush=True)
          errors=[]
          popup=await browser.new_page()
          popup.on("pageerror",lambda e:errors.append(str(e)))
          await popup.goto(origin+"/popup.html")
          await popup.locator("#pit-multimodal-links a").first.wait_for(timeout=10000)
          hrefs=await popup.locator("#pit-multimodal-links a").evaluate_all(
            "(els)=>els.map(el=>el.getAttribute('href'))")
          assert "pit/tools.html" in hrefs and "pit/options.html" in hrefs,hrefs
          # Validate KISS's ACTUAL upstream site content script in Chromium
          # (not merely a built manifest entry or an active MV3 worker).
          fixture=await browser.new_page()
          fixture_url="https://pit-upstream-fixture.example/"
          await fixture.route("https://pit-upstream-fixture.example/*",
            lambda route: route.fulfill(status=200,content_type="text/html",
              body="<html lang='en'><body><p>Hello from KISS upstream fixture</p></body></html>"))
          await fixture.goto(fixture_url,wait_until="domcontentloaded")
          await fixture.locator("p").get_by_text("Hello from KISS").wait_for(timeout=5000)
          await fixture.wait_for_timeout(900)
          injected=await worker.evaluate("""async()=>{
            const tabs=await chrome.tabs.query({});
            const t=tabs.find(tab=>tab.url?.startsWith('https://pit-upstream-fixture.example/'));
            if(!t)return {value:null,reason:'fixture tab not visible'};
            const results=await chrome.scripting.executeScript({
              target:{tabId:t.id},func:()=>globalThis.__KISS_CONTEXT__
            });
            return {value:results[0]?.result||null,tabId:t.id};
          }""")
          assert injected.get("value")=="content",injected
          print("PASS: genuine KISS upstream translation content script injected",flush=True)
          # The personal controller must resolve a real source tab and use
          # the imported namespaced KISS/PIT speech router.
          fixture_id=injected["tabId"]
          control=await browser.new_page()
          control.on("pageerror",lambda e:errors.append(str(e)))
          await control.goto(origin+"/pit/control.html?tabId="+str(fixture_id))
          await control.locator("#target").get_by_text(
            "pit-upstream-fixture.example",exact=False).wait_for(timeout=10000)
          state=await control.evaluate("""async()=>
            globalThis.PITSidecar.send({type:'PIT_ASR_STATUS'})""")
          assert state.get("ok")==True and state.get("active")==False,state
          await control.locator("#asrStart").click()
          await control.locator("#status").get_by_text(
            "至少 16 字符",exact=False).wait_for(timeout=5000)
          print("PASS: personal Whisper controller routed to original KISS MV3 worker",flush=True)
          # Captions script is injected on owner click, not globally.
          await control.locator("#captionStart").click()
          await control.wait_for_timeout(350)
          captions=await worker.evaluate("""async id=>{
            const results=await chrome.scripting.executeScript({
              target:{tabId:id},func:()=>globalThis.__PIT_CAPTION_V1__===true
            });
            return results?.[0]?.result||false;
          }""",fixture_id)
          assert captions,"Owner-started advanced caption code did not inject"
          print("PASS: opt-in advanced captions content script injected on selected page",flush=True)

          # Intercept ALL network requests made through the imported
          # personal provider adapter. This is a deterministic fake, not a
          # paid or public translation service and not actual model inference.
          await worker.evaluate("""async()=>{
            await chrome.storage.local.set({pit_settings_v1:{
              source:'en',target:'zh',standardProvider:'microsoft',
              microsoftKey:'CI_FAKE_KEY_NO_EXTERNAL_REQUEST'
            }});
            globalThis.fetch=async(input,options={})=>{
              const url=String(input);
              if(url==='http://127.0.0.1:8765/health'){
                if(options.headers?.['X-PIT-Token']!=='local-test-token-123456')
                  return new Response('',{status:401});
                return new Response(JSON.stringify({
                  engine:'local-only',ready:false,speech_asr:true,
                  speech_asr_backend:'faster',speech_asr_model_loaded:false
                }),{status:200,headers:{'Content-Type':'application/json'}});
              }
              if(url.startsWith('https://api.cognitive.microsofttranslator.com/translate?')){
                const body=JSON.parse(options.body);
                return new Response(JSON.stringify(body.map(c=>({
                  translations:[{text:'中文测试译文：'+c.Text}]
                }))),{status:200,headers:{'Content-Type':'application/json'}});
              }
              throw Error('Unexpected network access blocked by CI: '+url);
            };
          }""")
          await control.locator("#token").fill("local-test-token-123456")
          await control.locator("#asrCheck").click()
          await control.locator("#status").get_by_text("已就绪",exact=False).wait_for(timeout=9000)
          print("PASS: token-authorized Whisper readiness health request via isolated Port",flush=True)

          await fixture.evaluate("""()=>{
            const player=document.createElement('video');
            player.id='owned-player';
            player.controls=true;
            document.body.append(player);
          }""")
          await control.locator("#cues").set_input_files({
            "name":"offline-fixture.vtt","mimeType":"text/vtt",
            "buffer":b"WEBVTT\n\n00:00:00.000 --> 00:00:08.000\nOwned subtitle fixture\n"
          })
          await control.locator("#captionStart").click()
          await control.locator("#status").get_by_text(
            "已加载",exact=False).wait_for(timeout=6000)
          await fixture.locator(".pit-caption-overlay").get_by_text(
            "中文测试译文：Owned subtitle fixture",exact=False
          ).wait_for(timeout=16000)
          print("PASS: imported VTT -> isolated Port -> standard provider -> translated on-screen overlay",flush=True)
          await control.locator("#captionStop").click()
          await control.locator("#status").get_by_text(
            "已停止",exact=False).wait_for(timeout=6000)
          assert await fixture.locator(".pit-caption-overlay").count()==0
          print("PASS: stopped subtitles remove translated overlay",flush=True)

          # Real Chrome site diagnostics, but never exfiltrate account URLs,
          # query strings or protected course/caption content.
          await fixture.evaluate("""()=>{
            const iframe=document.createElement('iframe');
            iframe.src='about:blank';iframe.width='400';iframe.height='200';
            document.body.append(iframe);
            const secret=document.createElement('p');
            secret.textContent='PRIVATE COURSE CONTENT MUST NEVER LEAVE THE TAB';
            document.body.append(secret);
          }""")
          await control.locator("#diagPlatform").select_option("O2B")
          await control.locator("#diagVideo").select_option("pass")
          await control.locator("#diagSource").select_option("fail")
          await control.locator("#diagScan").click()
          await control.locator("#diagExport").wait_for(state="visible")
          assert await control.locator("#diagExport").is_enabled()
          async with control.expect_download() as downloaded:
            await control.locator("#diagExport").click()
          dl=await downloaded.value
          report=json.loads(Path(await dl.path()).read_text(encoding="utf-8"))
          assert report["schema"]=="pit-real-site-check-v1"
          assert report["platform"]=="O2B"
          assert report["counts"]["videoElements"]>=1,report
          assert report["checks"]["video"]=="pass"
          assert report["checks"]["sourceCaptions"]=="fail"
          serialized=json.dumps(report)
          for sensitive in ("PRIVATE COURSE","pit-upstream-fixture.example",
                             "Owned subtitle fixture","local-test-token"):
            assert sensitive not in serialized,sensitive
          print("PASS: opt-in real-site diagnostic report has no URL, captions or credentials",flush=True)

          # Verify ONE CLICK performs a fresh site scan and an actual
          # issue-creation API call with only whitelist data. This mock is
          # installed in the trusted extension page itself. There is no
          # external GitHub request, login or paid API in this CI test.
          await control.locator("#diagPlatform").select_option("Bilibili")
          await control.locator("#diagWebTranslation").select_option("fail")
          await control.locator("#diagImageOcr").select_option("pass")
          await control.locator("#diagGithubToken").fill(
            "github_pat_FAKE_ISSUES_ONLY_CI_1234567890")
          await control.locator("#diagGithubSave").click()
          await control.locator("#diagGithubStatus").get_by_text(
            "已配置",exact=False).wait_for(timeout=5000)
          assert await control.locator("#diagGithubToken").input_value()==""
          await control.evaluate("""()=>{
            globalThis.__githubIssuePost=null;
            globalThis.fetch=async(url,opts)=>{
              if(url!=='https://api.github.com/repos/ACIDCH/personal-immersive-translator/issues')
                throw Error('Unexpected GitHub destination: '+url);
              globalThis.__githubIssuePost={
                url,method:opts.method,auth:opts.headers.Authorization,
                payload:JSON.parse(opts.body)
              };
              return new Response(JSON.stringify({number:7421}),{
                status:201,headers:{'Content-Type':'application/json'}
              });
            };
          }""")
          await control.locator("#diagUpload").click()
          await control.locator("#diagIssueLink").get_by_text(
            "Issue #7421",exact=False).wait_for(timeout=10000)
          assert await control.locator("#diagIssueLink").get_attribute(
            "href")=="https://github.com/ACIDCH/personal-immersive-translator/issues/7421"
          issued=await control.evaluate("globalThis.__githubIssuePost")
          assert issued["method"]=="POST"
          assert issued["auth"]=="Bearer github_pat_FAKE_ISSUES_ONLY_CI_1234567890"
          payload=issued["payload"]
          assert "Bilibili" in payload["title"]
          content=payload["body"]
          assert '"webTranslation": "fail"' in content
          assert '"imageOcr": "pass"' in content
          for secret in ("PRIVATE COURSE","pit-upstream-fixture.example",
            "Owned subtitle fixture","github_pat_FAKE","local-test-token",
            "PRIVATE", "COOKIE"):
            assert secret not in content,secret
          print("PASS: one-click GitHub diagnostic creates safe issue via authenticated fake API",flush=True)
          await fixture.close()
          tools=await browser.new_page()
          tools.on("pageerror",lambda e:errors.append(str(e)))
          await tools.goto(origin+"/pit/tools.html")
          await tools.locator("#localOCR").wait_for()
          await tools.locator("#pdfTranslate").wait_for()
          source=fitz.open()
          page=source.new_page()
          page.insert_text((70,85),"PIT KISS sidecar PDF.js fixture")
          pdf=source.tobytes()
          source.close()
          await tools.locator("#pdf").set_input_files(
            {"name":"fixture.pdf","mimeType":"application/pdf","buffer":pdf})
          await tools.locator("#pdfPreviewStatus").get_by_text(
            "已抽查",exact=False).wait_for(timeout=20000)
          assert await tools.locator("#pdfPreview canvas").count()==1
          assert "Mozilla PDF.js" in await tools.locator("#pdfPreview").inner_text()
          settings=await browser.new_page()
          settings.on("pageerror",lambda e:errors.append(str(e)))
          await settings.goto(origin+"/pit/options.html")
          await settings.locator('form[data-ready="1"]').wait_for(timeout=10000)
          await settings.locator('[name="target"]').select_option('fr')
          await settings.locator('#optionsForm button[type="submit"]').click()
          await settings.locator("#status").get_by_text("设置已保存").wait_for(timeout=5000)
          await settings.reload()
          await settings.locator('form[data-ready="1"]').wait_for(timeout=10000)
          assert await settings.locator('[name="target"]').input_value()=="fr"
          # KISS's React popup may have upstream log warnings, but the tools'
          # own module imports and PDF.js worker must not cause JS errors.
          assert not [e for e in errors if 'pit/' in e],errors
          print("PASS: original KISS MV3 popup exposes PIT PDF/OCR links")
          print("PASS: Mozilla PDF.js renders a generated PDF in Chromium")
          print("PASS: independent PIT settings save and reload without remote API")
        finally:
          await browser.close()

if __name__=="__main__":
    asyncio.run(main())
