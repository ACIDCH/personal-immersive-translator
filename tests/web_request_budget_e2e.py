"""Real Chrome test: automatic webpage translation is bounded and requires
an explicit second user action to translate text past 600 paragraphs.
No network API calls; provides mock translation provider messages.
"""
import asyncio
from pathlib import Path
from playwright.async_api import async_playwright
CONTENT=Path(__file__).resolve().parents[1]/"src"/"content.js"

async def main():
  async with async_playwright() as p:
    browser=await p.chromium.launch(channel="chrome",headless=True,args=["--no-sandbox"])
    try:
      page=await browser.new_page()
      problems=[]
      page.on("pageerror",lambda e:problems.append(str(e)))
      await page.set_content("<main id='article'></main>")
      await page.evaluate("""() => {
        document.querySelector('#article').innerHTML=
          Array.from({length:615},(_,i)=>'<p id="block-'+i+'">Long academic essay paragraph '+i+' describing economic network resilience and regression statistics.</p>').join('');
        window.listeners=[];window.count=0;
        window.chrome={runtime:{
          onMessage:{addListener:fn=>window.listeners.push(fn)},
          sendMessage:async msg=>{
            window.count+=msg.texts.length;
            return {ok:true,translations:msg.texts.map(t=>'译文:'+t)};
          }
        }};
        window.action=(type,mode='standard')=>new Promise(resolve=>{
          for(const fn of window.listeners)fn({type,mode},{},resolve);
        });
      }""")
      await page.add_script_tag(path=str(CONTENT))
      unsupported=await page.evaluate("()=>window.action('PIT_CONTINUE')")
      assert unsupported=={"ok":False,"reason":"请先开启标准网页翻译，才能继续翻译后续段落。"},unsupported
      await page.evaluate("()=>window.action('PIT_START')")
      await page.locator("#block-599 + .pit-translation").wait_for(timeout=30000)
      await page.wait_for_timeout(900)
      assert await page.locator(".pit-translation").count()==600
      assert await page.evaluate("window.count")==600
      assert await page.locator("#block-610 + .pit-translation").count()==0
      progress=await page.evaluate("()=>window.action('PIT_GET_PROGRESS')")
      assert progress["ok"] and progress["progress"]["eligible"]==615,progress
      assert progress["progress"]["translated"]==600,progress
      assert progress["progress"]["remaining"]==15,progress
      assert progress["progress"]["coveragePercent"]<100,progress
      print("PASS: 600 paragraph cap is honestly reported as incomplete coverage")
      continued=await page.evaluate("()=>window.action('PIT_CONTINUE')")
      assert continued.get("ok"),continued
      await page.locator("#block-614 + .pit-translation").wait_for(timeout=10000)
      assert await page.locator(".pit-translation").count()==615
      assert await page.evaluate("window.count")==615
      progress=await page.evaluate("()=>window.action('PIT_GET_PROGRESS')")
      assert progress["progress"]["eligible"]==615 and progress["progress"]["translated"]==615,progress
      assert progress["progress"]["coveragePercent"]==100,progress
      await page.evaluate("()=>window.action('PIT_RESTORE')")
      assert await page.locator(".pit-translation").count()==0
      assert not problems,problems
      print("PASS: manually granted continuation finishes document, restore cleans up")
    finally:
      await browser.close()
if __name__=="__main__":
  asyncio.run(main())
