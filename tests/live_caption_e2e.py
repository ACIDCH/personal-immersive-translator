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
            await new Promise(r=>setTimeout(r,600));
            return {ok:true,translations:msg.texts.map(t=>'译文:'+t)};
          }
        }};
        window.simulate=(message)=>new Promise(r=>{
          for(const cb of window.callbacks)cb(message,{},r);
          if(!['PIT_ASR_VIEW_START','PIT_ASR_VIEW_STOP'].includes(message.type))r();
        });
      }""")
      await page.add_script_tag(path=str(ROOT))
      await page.evaluate("()=>window.simulate({type:'PIT_ASR_VIEW_START'})")
      now=await page.evaluate("Date.now()")
      await page.evaluate("""now=>window.simulate({
        type:'PIT_ASR_TEXT_VIEW',text:'First sentence',
        capturedAt:now,segmentMs:3000
      })""",now)
      for i in range(1,12):
        await page.evaluate("""({now,i})=>window.simulate({
          type:'PIT_ASR_TEXT_VIEW',text:'Latest sentence '+i,
          capturedAt:now,segmentMs:3000
        })""",{"now":now,"i":i})
      await page.locator(".pit-caption-translated").get_by_text("译文:Latest sentence 11").wait_for(timeout=5000)
      count=await page.evaluate("window.requests.length")
      assert count<=2,("translation requests not backpressure-limited",count)
      assert await page.evaluate("window.requests.every(r=>r.transient===true && r.mode==='standard')")
      await page.evaluate("()=>window.simulate({type:'PIT_ASR_METRICS_VIEW',metrics:{requests:15,dropped:4,errors:1,p50Ms:850,p95Ms:3300}})")
      await page.evaluate("""now=>window.simulate({
        type:'PIT_ASR_TEXT_VIEW',text:'Final sentence',capturedAt:now,segmentMs:3000
      })""",now)
      await page.locator(".pit-caption-translated").get_by_text("译文:Final sentence").wait_for(timeout=5000)
      footer=await page.locator(".pit-live-meta").inner_text()
      assert "p95" in footer and "丢弃 4" in footer and "识别错误 1" in footer,footer
      await page.evaluate("()=>window.simulate({type:'PIT_ASR_VIEW_STOP'})")
      assert await page.locator(".pit-asr-overlay").count()==0
      # Previously in-flight translation cannot reintroduce overlay after STOP.
      await asyncio.sleep(.9)
      assert await page.locator(".pit-asr-overlay").count()==0
      assert not errors,errors
      print("PASS: rapid ASR captions coalesce, no stale results, latency metrics, stop cleanup")
    finally:await browser.close()

if __name__=="__main__":
  asyncio.run(main())
