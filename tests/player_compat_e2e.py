"""Player-specific DOM fixture tests in real headless Google Chrome.
These fixtures imitate public DOM caption structures on named hosts. They do
NOT certify compatibility with actual logged-in YouTube/Netflix/Panopto,
cross-origin embedded players, protected streams or site A/B versions.
"""
import asyncio
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[1]/"src"

PLATFORMS=[
  ("youtube","https://www.youtube.com/watch?v=fixture",
   '<video style="width:640px;height:360px"></video><div class="ytp-caption-window-container"><span class="ytp-caption-segment">First lecture caption</span></div>',
   ".ytp-caption-segment"),
  ("netflix","https://www.netflix.com/watch/12345",
   '<video style="width:640px;height:360px"></video><div class="player-timedtext"><div class="player-timedtext-text-container"><span data-uia="subtitle-text">First lecture caption</span></div></div>',
   '[data-uia="subtitle-text"]'),
  ("panopto","https://university.panopto.com/Panopto/Pages/Viewer.aspx?id=fixture",
   '<main><div class="captionText">First lecture caption</div></main>',
   ".captionText"),
]

async def setup(page,url,html):
  async def intercept(route):
    await route.fulfill(status=200,content_type="text/html",body="<html><body>"+html+"</body></html>")
  await page.route("**/*",intercept)
  await page.goto(url)
  await page.evaluate("""() => {
    window.pitCallbacks=[];
    window.pitRequests=[];
    window.chrome={runtime:{
      onMessage:{addListener:cb=>window.pitCallbacks.push(cb)},
      sendMessage:async msg=>{
        window.pitRequests.push(msg);
        await new Promise(r=>setTimeout(r,
          msg.texts?.[0]==='English delayed caption'?1450:
          msg.texts?.[0]==='First lecture caption'?550:30));
        return {ok:true,translations:msg.texts?.map(x=>'译文:'+x)};
      }
    }};
    window.pitAction=(type,cues=[])=>new Promise(r=>{
      for(const cb of window.pitCallbacks)cb({type,mode:'standard',cues},{},r);
    });
  }""")
  for path in ("lib/caption-core.js","lib/platform-captions.js","subtitles.js"):
    await page.add_script_tag(path=str(ROOT/path))

async def run():
  async with async_playwright() as p:
    browser=await p.chromium.launch(channel="chrome",headless=True,args=["--no-sandbox"])
    try:
      for provider,url,html,selector in PLATFORMS:
        page=await browser.new_page()
        problems=[]
        page.on("pageerror",lambda error:problems.append(str(error)))
        await setup(page,url,html)
        started=await page.evaluate("()=>window.pitAction('PIT_CAPTIONS_START')")
        assert started["ok"],(provider,started)
        await page.locator(".pit-caption-translated").get_by_text("译文:First lecture caption").wait_for(timeout=6000)
        await page.locator(selector).evaluate("(el)=>el.textContent='Second lecture caption'")
        await page.locator(".pit-caption-translated").get_by_text("译文:Second lecture caption").wait_for(timeout=6000)
        texts=await page.locator(".pit-caption-translated").all_text_contents()
        assert all('First lecture caption' not in t for t in texts),(provider,texts)
        await page.locator(selector).evaluate("(el)=>el.style.display='none'")
        await page.wait_for_function("""()=>
          document.querySelector('.pit-caption-overlay')?.style.display==='none'
        """,timeout=3000)
        await page.evaluate("()=>window.pitAction('PIT_CAPTIONS_STOP')")
        assert await page.locator(".pit-caption-overlay").count()==0
        assert not problems,(provider,problems)
        sent=await page.evaluate("()=>window.pitRequests.length")
        assert sent<=4,(provider,sent)
        print("PASS",provider,"visible captions, update, hidden state, stop, bounded calls")
        await page.close()

      # Real Chrome regression: the player advertises a native TextTrack
      # but does not fill it. Visible YouTube CC must still be translated;
      # if native cue data arrives later we must prefer its timeline.
      fallback=await browser.new_page()
      await setup(fallback,PLATFORMS[0][1],PLATFORMS[0][2])
      await fallback.evaluate("""() => {
        const video=document.querySelector('video');
        window.testTrack=video.addTextTrack('subtitles','English','en');
      }""")
      status=await fallback.evaluate("()=>window.pitAction('PIT_CAPTIONS_START')")
      assert status["ok"],status
      await fallback.locator('.pit-caption-translated').get_by_text(
        '译文:First lecture caption').wait_for(timeout=6000)
      print("PASS empty native TextTrack automatically falls back to visible YouTube CC")
      await fallback.evaluate("""() => {
        const segment=document.querySelector('.ytp-caption-segment');
        segment.textContent='Stale caption while provider responds';
      }""")
      await fallback.wait_for_timeout(500)
      await fallback.locator('.ytp-caption-segment').evaluate("(node)=>node.style.display='none'")
      await fallback.wait_for_timeout(800)
      hidden=await fallback.locator('.pit-caption-overlay').evaluate(
        "(node)=>node.style.display==='none'")
      assert hidden, "late provider response resurrected hidden caption"
      print("PASS hidden caption cannot be resurrected by delayed provider")
      await fallback.evaluate("""() => {
        window.testTrack.addCue(new VTTCue(0,8,'New native timed caption'));
      }""")
      await fallback.locator('.pit-caption-translated').get_by_text(
        '译文:New native timed caption').wait_for(timeout=6000)
      await fallback.evaluate("()=>window.pitAction('PIT_CAPTIONS_STOP')")
      print("PASS native cue recovery takes priority over prior DOM fallback")
      await fallback.close()


      # A user may change the spoken language CC track without restarting the
      # extension. The old translation is deliberately slow, and must not
      # block or repaint newly selected French captions.
      switching=await browser.new_page()
      await setup(switching,"https://www.youtube.com/watch?v=track-fixture",
                  '<video style="width:640px;height:360px"></video>')
      await switching.evaluate("""() => {
        const video=document.querySelector('video');
        window.english=video.addTextTrack('subtitles','English','en');
        window.french=video.addTextTrack('subtitles','French','fr');
        window.english.mode='showing';
        window.french.mode='disabled';
        window.english.addCue(new VTTCue(0,8,'English delayed caption'));
        window.french.addCue(new VTTCue(0,8,'Bonjour nouvelle piste'));
      }""")
      launched=await switching.evaluate("()=>window.pitAction('PIT_CAPTIONS_START')")
      assert launched["ok"],launched
      await switching.wait_for_function("""()=>
        window.pitRequests.some(r=>r.texts?.includes('English delayed caption'))
      """,timeout=3000)
      await switching.evaluate("""()=>{
        window.english.mode='disabled';
        window.french.mode='showing';
      }""")
      await switching.locator('.pit-caption-translated').get_by_text(
          '译文:Bonjour nouvelle piste').wait_for(timeout=1100)
      await switching.wait_for_timeout(1500)
      text=await switching.locator('.pit-caption-translated').all_text_contents()
      assert text==['译文:Bonjour nouvelle piste'],text
      assert await switching.evaluate("window.french.mode")== "showing"
      await switching.evaluate("()=>window.pitAction('PIT_CAPTIONS_STOP')")
      print("PASS actual Chrome caption track switch invalidates delayed prior language")
      assert await switching.locator('.pit-caption-overlay').count()==0
      await switching.close()

      # If the player is replaced without changing its top-level URL, a
      # translated overlay from the disconnected <video> must be discarded.
      recycled=await browser.new_page()
      await setup(recycled,"https://www.youtube.com/watch?v=replaced-fixture",
                  '<video style="width:640px;height:360px"></video>')
      await recycled.evaluate("""()=>{
        const video=document.querySelector('video');
        const track=video.addTextTrack('subtitles','English','en');
        track.mode='showing';track.addCue(new VTTCue(0,8,'Old recording cue'));
      }""")
      started=await recycled.evaluate("()=>window.pitAction('PIT_CAPTIONS_START')")
      assert started["ok"],started
      await recycled.locator('.pit-caption-translated').get_by_text(
        '译文:Old recording cue').wait_for(timeout=4000)
      await recycled.evaluate("""()=>{
        document.querySelector('video').replaceWith(document.createElement('video'));
      }""")
      await recycled.locator('.pit-caption-overlay').wait_for(state="detached",timeout=2000)
      print("PASS detached media element stops subtitles without leaking old overlay")
      await recycled.close()

      # Even if an SPA keeps the original video element, a new recording URL
      # must not inherit a previous caption translation session.
      navigation=await browser.new_page()
      await setup(navigation,"https://www.youtube.com/watch?v=original-fixture",
                  '<video style="width:640px;height:360px"></video>')
      await navigation.evaluate("""()=>{
        const v=document.querySelector('video');
        const tr=v.addTextTrack('subtitles','English','en');tr.mode='showing';
        tr.addCue(new VTTCue(0,8,'First video cue'));
      }""")
      running=await navigation.evaluate("()=>window.pitAction('PIT_CAPTIONS_START')")
      assert running["ok"],running
      await navigation.locator('.pit-caption-translated').get_by_text(
        '译文:First video cue').wait_for(timeout=4000)
      await navigation.evaluate("""()=>history.replaceState({},'','?v=different-video')""")
      await navigation.locator('.pit-caption-overlay').wait_for(state="detached",timeout=2000)
      print("PASS top-level SPA video identity change stops old translation")
      await navigation.close()

      # Unsupported sites must fail explicitly rather than make up captions.
      page=await browser.new_page()
      await setup(page,"https://example.com/","<div>Unknown video</div>")
      unsupported=await page.evaluate("()=>window.pitAction('PIT_CAPTIONS_START')")
      assert not unsupported["ok"],unsupported
      print("PASS unsupported page reports missing caption source")
      # A manually imported SRT cannot be aligned without a video time axis.
      # Prior versions threw by dereferencing video.currentTime when video=null.
      imported=await page.evaluate("""()=>window.pitAction('PIT_CAPTIONS_START',[
        {startTime:0,endTime:5,text:'Authorized subtitle from a file'}
      ])""")
      assert not imported["ok"] and "视频时间轴" in imported["reason"],imported
      print("PASS imported SRT without video fails gracefully, no runtime crash")
      await page.close()

      # The LMS top document cannot inspect a Panopto cross-origin iframe.
      # Tell the user why; never reach through the frame's access boundary.
      embedded=await browser.new_page()
      await setup(embedded,"https://learning.example.edu/lecture",
          '<iframe src="https://uni.panopto.com/Panopto/Pages/Embed.aspx?id=test"></iframe>')
      denied=await embedded.evaluate("()=>window.pitAction('PIT_CAPTIONS_START')")
      assert not denied["ok"] and "跨域" in denied["reason"],denied
      await embedded.close()
      print("PASS cross-origin embedded player reports explicit limitation")
    finally:await browser.close()

if __name__=="__main__":
  asyncio.run(run())
