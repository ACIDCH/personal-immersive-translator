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
  ("bilibili","https://www.bilibili.com/video/BVfixture",
   '<video style="width:640px;height:360px"></video><div class="bpx-player-subtitle-panel"><span class="bpx-player-subtitle-panel-text">First lecture caption</span></div>',
   ".bpx-player-subtitle-panel-text"),
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
    window.pitAction=(type,cues=[],mode='standard')=>new Promise(r=>{
      for(const cb of window.pitCallbacks)cb({type,mode,cues},{},r);
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

      # Paid AI calls are never automatically repeated after provider
      # refusal. Standard MT retains bounded manual/automatic recovery.
      ai_failed=await browser.new_page()
      await setup(ai_failed,"https://www.youtube.com/watch?v=ai-failure",
        '<video style="width:640px;height:360px"></video>'
        '<div class="ytp-caption-window-container">'
        '<span class="ytp-caption-segment">AI provider is down</span></div>')
      await ai_failed.evaluate("""()=>{
        window.pitRequests=[];
        chrome.runtime.sendMessage=async msg=>{
          window.pitRequests.push(msg);
          throw Error('AI quota exceeded');
        };
      }""")
      ai_start=await ai_failed.evaluate(
        "()=>window.pitAction('PIT_CAPTIONS_START',[],'ai')")
      assert ai_start['ok'],ai_start
      await ai_failed.locator('.pit-caption-translated').get_by_text(
        '已停止自动重试',exact=False).wait_for(timeout=5000)
      await ai_failed.wait_for_timeout(1400)
      assert await ai_failed.evaluate('window.pitRequests.length')==1, (
        'A failed opt-in AI caption provider must not re-bill automatically')
      await ai_failed.evaluate("()=>window.pitAction('PIT_CAPTIONS_STOP')")
      assert await ai_failed.locator('.pit-caption-overlay').count()==0
      await ai_failed.close()

      # If PIT activates a disabled native subtitle TextTrack, the original
      # is otherwise invisible. The original and translation must both appear
      # in the overlay without introducing an additional original DOM copy
      # for sites that already paint visible captions.
      bilingual=await browser.new_page()
      await setup(bilingual,"https://www.youtube.com/watch?v=bilingual-native",
                  '<video style="width:640px;height:360px"></video>')
      await bilingual.evaluate("""()=>{
        const track=document.querySelector('video').addTextTrack('subtitles','English','en');
        track.addCue(new VTTCue(0,8,'Original native caption'));
        track.mode='disabled';
        window.nativeTrack=track;
      }""")
      native=await bilingual.evaluate("()=>window.pitAction('PIT_CAPTIONS_START')")
      assert native['ok'],native
      await bilingual.locator('.pit-caption-translated').get_by_text(
        '译文:Original native caption').wait_for(timeout=6000)
      assert await bilingual.locator('.pit-caption-original').inner_text()=='Original native caption'
      await bilingual.evaluate("()=>window.pitAction('PIT_CAPTIONS_STOP')")
      assert await bilingual.evaluate("window.nativeTrack.mode")=='disabled'
      assert await bilingual.locator('.pit-caption-overlay').count()==0
      await bilingual.close()
      print('PASS bilingual native text-track original and translated overlay')

      # AI captions must actually supply bounded cross-sentence
      # context; v0.4.4 had hardcoded context:'' even with AI enabled.
      # This mock does not call a paid model or establish translation quality.
      contextual=await browser.new_page()
      await setup(contextual,"https://www.youtube.com/watch?v=context-fixture",
                  '<video style="width:640px;height:360px"></video>')
      await contextual.evaluate("""()=>{
        const video=document.querySelector('video');
        const track=video.addTextTrack('subtitles','English','en');
        track.mode='showing';
        track.addCue(new VTTCue(0,3,'She studies the financial system.'));
        track.addCue(new VTTCue(3,6,'The bank has experienced a run.'));
        track.addCue(new VTTCue(6,9,'It must restore consumer confidence.'));
      }""")
      result=await contextual.evaluate(
        "()=>window.pitAction('PIT_CAPTIONS_START',[],'ai')")
      assert result["ok"],result
      await contextual.wait_for_function("""()=>
        window.pitRequests.some(m=>m.mode==='ai' && m.texts?.length>0)
      """,timeout=5000)
      contexts=await contextual.evaluate("""()=>window.pitRequests
        .filter(m=>m.mode==='ai')
        .map(m=>({context:m.context,mode:m.mode,optedIn:m.userInitiated}))""")
      assert contexts and any(
        'financial system' in r['context'] and
        'consumer confidence' in r['context'] and
        r['optedIn'] is True for r in contexts
      ),contexts
      assert all(len(r['context'])<=1600 for r in contexts)
      await contextual.evaluate("()=>window.pitAction('PIT_CAPTIONS_STOP')")
      await contextual.close()
      print("PASS user-opted AI caption batch carries preceding and upcoming dialogue context")

      # Separate visible-only subtitle DOM: the next line inherits the
      # prior line's context, unlike the uncontextualized original code.
      ai_dom=await browser.new_page()
      await setup(ai_dom,"https://www.youtube.com/watch?v=context-dom",
                  PLATFORMS[0][2])
      ai_start=await ai_dom.evaluate(
        "()=>window.pitAction('PIT_CAPTIONS_START',[],'ai')")
      assert ai_start["ok"],ai_start
      await ai_dom.locator('.pit-caption-translated').get_by_text(
        '译文:First lecture caption').wait_for(timeout=5000)
      await ai_dom.locator('.ytp-caption-segment').evaluate(
        "(node)=>node.textContent='Second lecture caption'")
      await ai_dom.locator('.pit-caption-translated').get_by_text(
        '译文:Second lecture caption').wait_for(timeout=5000)
      followup=await ai_dom.evaluate("""()=>window.pitRequests
        .filter(m=>m.mode==='ai' && m.texts?.includes('Second lecture caption'))""")
      assert followup and 'First lecture caption' in followup[-1]['context'],followup
      await ai_dom.evaluate("()=>window.pitAction('PIT_CAPTIONS_STOP')")
      await ai_dom.close()
      print("PASS user-opted AI visible caption translation carries previous line")

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

      # Sites pre-create hidden advertisements before the visible lecture
      # player; a bigger hidden <video> must not steal caption selection.
      # They may also arm the actual video before assigning any media src.
      late_media=await browser.new_page()
      await setup(late_media,"https://www.youtube.com/watch?v=late-src-fixture",
        '<video id="hidden-ad" style="width:1280px;height:720px;display:none"></video>'
        '<video id="lecture" style="width:640px;height:360px"></video>')
      await late_media.evaluate("""()=>{
        const lecture=document.querySelector('#lecture');
        const tr=lecture.addTextTrack('subtitles','English','en');
        tr.mode='showing';tr.addCue(new VTTCue(0,15,'Visible lesson caption'));
        const ad=document.querySelector('#hidden-ad');
        const adTrack=ad.addTextTrack('subtitles','Ad','en');
        adTrack.mode='showing';adTrack.addCue(new VTTCue(0,15,'Wrong ad caption'));
      }""")
      started=await late_media.evaluate("()=>window.pitAction('PIT_CAPTIONS_START')")
      assert started['ok'],started
      await late_media.locator('.pit-caption-translated').get_by_text(
        '译文:Visible lesson caption').wait_for(timeout=6000)
      assert not await late_media.locator('.pit-caption-overlay').get_by_text(
        'Wrong ad caption').count()
      await late_media.evaluate("""()=>{
        document.querySelector('#lecture').src=
          'https://media.example.org/videos/lecture-1.mp4';
      }""")
      await late_media.wait_for_timeout(700)
      assert await late_media.locator('.pit-caption-overlay').count()==1, (
        'the first delayed media URL must not terminate translation')
      await late_media.evaluate("""()=>{
        document.querySelector('#lecture').src=
          'https://media.example.org/videos/lecture-2.mp4';
      }""")
      await late_media.locator('.pit-caption-overlay').wait_for(
        state="detached",timeout=2300)
      assert not await late_media.evaluate("""()=>window.pitRequests.some(
        r=>r.texts?.includes('Wrong ad caption'))""")
      print("PASS visible player priority and late source binding stop cross-video reuse")
      await late_media.close()

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
