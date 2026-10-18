"""Real Chrome live subtitle overlay regression, with delayed mocked APIs.
No personal video, paid API, Whisper inference or microphone access involved.
"""
import asyncio
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[1]/"src"/"live-captions.js"

async def main():
  async with async_playwright() as p:
    browser=await p.chromium.launch(channel="chrome",headless=True,args=["--no-sandbox"])
    try:
      page=await browser.new_page()
      await page.set_content("<main><p>Public test audio transcript fixture</p></main>")
      errors=[]
      page.on("pageerror",lambda e:errors.append(str(e)))
      await page.evaluate("""() => {
        window.callbacks=[];
        window.requests=[];
        window.chrome={runtime:{
          onMessage:{addListener:cb=>window.callbacks.push(cb)},
          sendMessage:async msg=>{
            window.requests.push(msg);
            await new Promise(r=>setTimeout(r,msg.texts?.[0]==='Slow previous session'?2200:600));
            return {ok:true,translations:msg.texts.map(t=>'译文:'+t)};
          }
        }};
        window.simulate=(message)=>new Promise(r=>{
          for(const cb of window.callbacks)cb(message,{},r);
          if(!['PIT_ASR_VIEW_START','PIT_ASR_VIEW_STOP'].includes(message.type))r();
        });
      }""")
      await page.add_script_tag(path=str(ROOT))
      sid_a="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
      sid_b="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
      await page.evaluate("(sid)=>window.simulate({type:'PIT_ASR_VIEW_START',sessionId:sid})",sid_a)
      now=await page.evaluate("Date.now()")
      await page.evaluate("""now=>window.simulate({
        type:'PIT_ASR_TEXT_VIEW',sessionId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',text:'First sentence',
        capturedAt:now,segmentMs:3000
      })""",now)
      for i in range(1,12):
        await page.evaluate("""({now,i})=>window.simulate({
          type:'PIT_ASR_TEXT_VIEW',sessionId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',text:'Latest sentence '+i,
          capturedAt:now,segmentMs:3000
        })""",{"now":now,"i":i})
      await page.locator(".pit-caption-translated").get_by_text("译文:Latest sentence 11").wait_for(timeout=5000)
      count=await page.evaluate("window.requests.length")
      assert count<=2,("translation requests not backpressure-limited",count)
      assert await page.evaluate("window.requests.every(r=>r.transient===true && r.mode==='standard')")
      await page.evaluate("()=>window.simulate({type:'PIT_ASR_METRICS_VIEW',sessionId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',metrics:{requests:15,dropped:4,errors:1,p50Ms:850,p95Ms:3300}})")
      await page.evaluate("""now=>window.simulate({
        type:'PIT_ASR_TEXT_VIEW',sessionId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',text:'Final sentence',capturedAt:now,segmentMs:3000
      })""",now)
      await page.locator(".pit-caption-translated").get_by_text("译文:Final sentence").wait_for(timeout=5000)
      footer=await page.locator(".pit-live-meta").inner_text()
      assert "p95" in footer and "丢弃 4" in footer and "识别错误 1" in footer,footer
      # A short ASR fragment cannot reliably be distinguished as French by
      # CLD. The spoken-language metadata supplied by Whisper must reach MT.
      await page.evaluate("""()=>window.simulate({
        type:'PIT_ASR_TEXT_VIEW',sessionId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        text:'Bonjour',language:'fr',capturedAt:Date.now(),segmentMs:3000
      })""")
      await page.locator(".pit-caption-translated").get_by_text(
        "译文:Bonjour").wait_for(timeout=5000)
      assert await page.evaluate("""()=>
        window.requests.at(-1).captionSourceLanguage==='fr'
      """),"Whisper spoken-language tag was not sent to transient MT"
      label=await page.locator('.pit-live-meta').inner_text()
      assert '识别语种 fr' in label,label
      await page.evaluate("""()=>window.simulate({
        type:'PIT_ASR_TEXT_VIEW',sessionId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        text:'Unknown text',language:'xx',capturedAt:Date.now(),segmentMs:3000
      })""")
      await page.locator(".pit-caption-translated").get_by_text(
        "译文:Unknown text").wait_for(timeout=5000)
      assert await page.evaluate("""()=>
        window.requests.at(-1).captionSourceLanguage===''
      """),"unsupported spoken-language claims must be discarded"
      # Old response must never hold the new session's translation queue.
      await page.evaluate("""()=>window.simulate({
        type:'PIT_ASR_TEXT_VIEW',sessionId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        text:'Slow previous session',capturedAt:Date.now(),segmentMs:3000
      })""")
      await page.wait_for_function("""()=>
        window.requests.some(r=>r.texts?.[0]==='Slow previous session')
      """)
      await page.evaluate("(sid)=>window.simulate({type:'PIT_ASR_VIEW_STOP',sessionId:sid})",sid_a)
      await page.evaluate("(sid)=>window.simulate({type:'PIT_ASR_VIEW_START',sessionId:sid})",sid_b)
      await page.evaluate("""()=>window.simulate({
        type:'PIT_ASR_TEXT_VIEW',sessionId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        text:'Fresh session subtitle',capturedAt:Date.now(),segmentMs:3000
      })""")
      await page.locator(".pit-caption-translated").get_by_text(
        "译文:Fresh session subtitle").wait_for(timeout=1700)
      # Replayed OLD stop and old recognized text must not affect new content.
      await page.evaluate("(sid)=>window.simulate({type:'PIT_ASR_VIEW_STOP',sessionId:sid})",sid_a)
      await page.evaluate("""()=>window.simulate({
        type:'PIT_ASR_TEXT_VIEW',sessionId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        text:'STALE should not show'
      })""")
      assert await page.locator(".pit-caption-translated").get_by_text(
        "译文:Fresh session subtitle").count()==1
      await asyncio.sleep(2.1)
      assert await page.locator(".pit-caption-translated").get_by_text(
        "译文:Fresh session subtitle").count()==1
      await page.evaluate("(sid)=>window.simulate({type:'PIT_ASR_VIEW_STOP',sessionId:sid})",sid_b)
      assert await page.locator(".pit-asr-overlay").count()==0
      # Previously in-flight translation cannot reintroduce overlay after STOP.
      await asyncio.sleep(.9)
      assert await page.locator(".pit-asr-overlay").count()==0
      await page.evaluate("(sid)=>window.simulate({type:'PIT_ASR_INTERRUPTED_VIEW',sessionId:sid})",sid_b)
      alert=await page.locator(".pit-asr-interrupted").inner_text()
      assert '已中断' in alert and '已停止' in alert,alert
      assert await page.locator(".pit-asr-overlay").count()==0
      # An expressly opt-in AI ASR session switches the actual transient
      # provider request mode and supplies limited previous dialogue as context.
      sid_c="cccccccc-cccc-4ccc-8ccc-cccccccccccc"
      await page.evaluate("(sid)=>window.simulate({type:'PIT_ASR_VIEW_START',sessionId:sid,mode:'ai'})",sid_c)
      await page.evaluate("""()=>window.simulate({
        type:'PIT_ASR_TEXT_VIEW',sessionId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        text:'Financial markets are changing',capturedAt:Date.now(),segmentMs:3000
      })""")
      await page.locator(".pit-caption-translated").get_by_text(
        "译文:Financial markets are changing").wait_for(timeout=5000)
      await page.evaluate("""()=>window.simulate({
        type:'PIT_ASR_TEXT_VIEW',sessionId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        text:'They remain resilient',capturedAt:Date.now(),segmentMs:3000
      })""")
      await page.locator(".pit-caption-translated").get_by_text(
        "译文:They remain resilient").wait_for(timeout=5000)
      ai_requests=await page.evaluate("""()=>window.requests.filter(r=>
        r.mode==='ai'&&r.sessionId==='cccccccc-cccc-4ccc-8ccc-cccccccccccc')""")
      assert len(ai_requests)==2,ai_requests
      assert all(x['userInitiated'] is True and x['transient'] is True for x in ai_requests)
      assert 'Financial markets are changing' in ai_requests[1]['context']
      await page.evaluate("(sid)=>window.simulate({type:'PIT_ASR_VIEW_STOP',sessionId:sid})",sid_c)
      assert await page.locator(".pit-asr-overlay").count()==0
      print("PASS: opt-in live Whisper AI receives bounded historical subtitle context")

      print("PASS: unexpected track-end notification without stale recording overlay")
      assert not errors,errors
      print("PASS: rapid ASR captions coalesce, no stale results, latency metrics, stop cleanup")
    finally:await browser.close()

if __name__=="__main__":
  asyncio.run(main())
