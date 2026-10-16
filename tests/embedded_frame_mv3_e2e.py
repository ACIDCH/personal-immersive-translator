"""Real Chromium MV3 cross-origin targeted frame injection, no platform login.

Uses a fully synthetic LMS and Panopto-shaped embed served through Playwright
routing. Chrome actually creates distinct cross-origin frames and grants
site-specific permissions; no private captions or protected streams are read.
"""
import asyncio
import tempfile
from pathlib import Path
from playwright.async_api import async_playwright

ROOT=Path(__file__).resolve().parents[1]
PARENT="https://lms.example.edu/course/lesson"
VISIBLE="https://school.panopto.com/Panopto/Pages/Embed.aspx?id=visible"
WRONG="https://school.panopto.com/Panopto/Pages/Embed.aspx?id=private"

async def main():
  with tempfile.TemporaryDirectory(prefix="pit-iframe-profile-") as profile:
    async with async_playwright() as playwright:
      context=await playwright.chromium.launch_persistent_context(
        profile,channel="chromium",headless=True,
        args=[f"--disable-extensions-except={ROOT}",f"--load-extension={ROOT}",
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

        # Optional extension host permissions MUST be requested from a
        # genuine user gesture, not pre-granted by bypassing the permission API.
        await popup.evaluate("""() => {
          window.permissionOutcome='pending';
          const btn=document.createElement('button');
          btn.id='grantPanoptoForTest';btn.textContent='Authorize test frame';
          btn.addEventListener('click',async()=>{
            try{
              window.permissionOutcome=await chrome.permissions.request({
                origins:['https://school.panopto.com/*']});
            }catch(error){window.permissionOutcome=String(error);}
          });
          document.body.append(btn);
        }""")
        await popup.locator("#grantPanoptoForTest").click()
        await popup.wait_for_function("window.permissionOutcome!=='pending'",timeout=12000)
        granted=await popup.evaluate("window.permissionOutcome")
        assert granted is True,f"Explicit Panopto host permission denied: {granted}"
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
