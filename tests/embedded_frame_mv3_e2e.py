"""Real Chromium MV3 cross-origin targeted frame injection, no platform login.

Uses a fully synthetic LMS and Panopto-shaped embed served through Playwright
routing. A disposable test-only manifest pregrants fixture origins because
headless Chrome cannot approve permission dialogs. Production manifest remains
unchanged and requests explicit grants. Browser frame APIs are real.
"""
import asyncio
import tempfile
import json
import shutil
from pathlib import Path
from playwright.async_api import async_playwright

ROOT=Path(__file__).resolve().parents[1]
PARENT="https://lms.example.edu/course/lesson"
VISIBLE="https://school.panopto.com/Panopto/Pages/Embed.aspx?id=visible"
WRONG="https://school.panopto.com/Panopto/Pages/Embed.aspx?id=private"

async def main():
  with tempfile.TemporaryDirectory(prefix="pit-iframe-profile-") as profile, \
       tempfile.TemporaryDirectory(prefix="pit-fixture-extension-") as temp_ext:
    # CI cannot accept a real Chrome permission bubble in headless mode.
    # Pregrant ONLY the two *synthetic fixture* origins in a throwaway manifest.
    # Production manifest remains untouched and requires explicit user grant.
    ext=Path(temp_ext)
    shutil.copytree(ROOT/"src",ext/"src")
    shutil.copytree(ROOT/"assets",ext/"assets")
    manifest=json.loads((ROOT/"manifest.json").read_text(encoding="utf8"))
    manifest["host_permissions"].extend([
      "https://lms.example.edu/*","https://school.panopto.com/*"
    ])
    (ext/"manifest.json").write_text(json.dumps(manifest),encoding="utf8")
    async with async_playwright() as playwright:
      context=await playwright.chromium.launch_persistent_context(
        profile,channel="chromium",headless=True,
        args=[f"--disable-extensions-except={ext}",f"--load-extension={ext}",
              "--no-sandbox","--disable-dev-shm-usage"])
      try:
        sw=context.service_workers[0] if context.service_workers else await context.wait_for_event(
          "serviceworker",timeout=30000)
        extension_id=sw.url.split("/")[2]
        async def fake_page(route):
          url=route.request.url
          if url.startswith(PARENT):
            html=f"""<!doctype html><html><body>
              <iframe id="visible" src="{VISIBLE}" style="width:640px;height:340px"></iframe>
              <iframe id="private" src="{WRONG}" style="width:640px;height:340px"></iframe>
            </body></html>"""
          elif url.startswith(VISIBLE):
            html='<html><body><div class="captionText">Visible course caption</div></body></html>'
          elif url.startswith(WRONG):
            html='<html><body><div class="captionText">PRIVATE wrong caption</div></body></html>'
          else:
            await route.abort();return
          await route.fulfill(status=200,content_type="text/html",body=html)
        await context.route("https://lms.example.edu/**",fake_page)
        await context.route("https://school.panopto.com/**",fake_page)
        course=await context.new_page()
        await course.goto(PARENT,wait_until="load")
        await course.frame_locator("#visible").locator(".captionText").wait_for(timeout=10000)
        await course.frame_locator("#private").locator(".captionText").wait_for(timeout=10000)

        popup=await context.new_page()
        await popup.goto(f"chrome-extension://{extension_id}/src/popup.html")
        await popup.locator("#captionsStart").wait_for(state="attached")
        allowed=await popup.evaluate("""async()=>
          chrome.permissions.contains({origins:['https://lms.example.edu/*']})
        """)
        assert allowed is True,allowed
        print("PASS: CI fixture manifest contains LMS host permission (not production)")

        state=await popup.evaluate("""async()=> {
          const tabs=await chrome.tabs.query({});
          const target=tabs.find(t=>t.url?.startsWith('https://lms.example.edu/course/lesson'));
          if(!target?.id)throw Error('LMS tab missing');
          const frames=await chrome.webNavigation.getAllFrames({tabId:target.id});
          const {chooseEmbeddedFrame}=await import('./lib/frame-route.js');
          return {tabId:target.id,selected:chooseEmbeddedFrame(
            ['https://school.panopto.com/Panopto/Pages/Embed.aspx?id=visible'],frames),
            ignored:chooseEmbeddedFrame(
            ['https://school.panopto.com/Panopto/Pages/Embed.aspx?id=missing'],frames),
            frames:frames.map(f=>({frameId:f.frameId,url:f.url}))};
        }""")
        assert state["selected"],state
        assert state["ignored"] is None,state
        assert state["selected"]["origin"]=="https://school.panopto.com"
        assert state["selected"]["frameId"]>0
        print("PASS: real Chrome webNavigation selects the correct Panopto recording URL")

        allowed=await popup.evaluate("""async()=>
          chrome.permissions.contains({origins:['https://school.panopto.com/*']})
        """)
        assert allowed is True,allowed
        print("PASS: CI fixture Panopto origin host-permission check")

        tab_id=state["tabId"]
        frame_id=state["selected"]["frameId"]
        result=await popup.evaluate("""async({tab,frame})=>{
          const target={tabId:tab,frameIds:[frame]};
          await chrome.scripting.insertCSS({target,files:['src/content.css']});
          await chrome.scripting.executeScript({target,files:[
            'src/lib/caption-core.js','src/lib/platform-captions.js','src/subtitles.js'
          ]});
          return chrome.tabs.sendMessage(tab,{
            type:'PIT_CAPTIONS_START',mode:'standard'
          },{frameId:frame});
        }""",{"tab":tab_id,"frame":frame_id})
        assert result["ok"],result
        await course.frame_locator("#visible").locator(".pit-caption-overlay").wait_for(timeout=8000)
        assert await course.frame_locator("#private").locator(".pit-caption-overlay").count()==0
        assert await course.locator(".pit-caption-overlay").count()==0
        print("PASS: real MV3 injected only the authorized chosen child frame")

        stopped=await popup.evaluate("""({tab,frame})=>
          chrome.tabs.sendMessage(tab,{type:'PIT_CAPTIONS_STOP'},{frameId:frame})
        """,{"tab":tab_id,"frame":frame_id})
        assert stopped["ok"],stopped
        await course.frame_locator("#visible").locator(".pit-caption-overlay").wait_for(state="detached")
        assert await course.frame_locator("#private").locator(".pit-caption-overlay").count()==0
        print("PASS: stop removes only targeted embedded-caption overlay")
      finally:
        await context.close()

if __name__=="__main__":
  asyncio.run(main())
