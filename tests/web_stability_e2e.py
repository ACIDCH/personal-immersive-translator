"""Real Chrome regression for long articles, SPA mutations and bilingual loops.

Mock translation provider. No authentication or paid provider calls.
"""
import asyncio
from pathlib import Path
from playwright.async_api import async_playwright

CONTENT=Path(__file__).resolve().parents[1]/"src"/"content.js"

async def main():
  async with async_playwright() as p:
    browser=await p.chromium.launch(channel="chrome",headless=True,args=["--no-sandbox"])
    errors=[]
    try:
      page=await browser.new_page()
      page.on("pageerror",lambda err:errors.append(str(err)))
      await page.set_content("""<main>
        <ul><li id="list-item">Original list item about academic economics.</li></ul>
        <p id="changing">Dynamic lecture text before SPA update.</p>
        <div id="article"></div>
        <div id="shadow-host"></div>
      </main>""")
      await page.evaluate("""() => {
        const host=document.querySelector('#shadow-host');
        host.attachShadow({mode:'open'}).innerHTML =
          '<p id="shadow-p">Original shadow curriculum paragraph in English.</p>';
        document.querySelector('#article').innerHTML=
          Array.from({length:320},(_,i)=>'<p id="block-'+i+'">Lecture paragraph '+i+' on global financial modelling, forecasting and supply chain analysis.</p>').join('');
        window.listeners=[];window.calls=[];
        window.chrome={runtime:{
          onMessage:{addListener:fn=>window.listeners.push(fn)},
          sendMessage:async message=>{
            window.calls.push(message);
            if(message.texts?.some(t=>t.includes('Superseded slow'))){
              window.slowEntered=true;
              await new Promise(resolve=>{window.releaseSuperseded=resolve;});
            }
            await new Promise(resolve=>setTimeout(resolve,2));
            return {ok:true,translations:message.texts.map(t=>'译文:'+t)};
          }
        }};
        window.action=(type,mode='standard')=>new Promise(resolve=>{
          for(const fn of window.listeners)fn({type,mode},{},resolve);
        });
      }""")
      await page.add_script_tag(path=str(CONTENT))
      await page.evaluate("()=>window.action('PIT_START')")
      await page.locator("#block-319 + .pit-translation").wait_for(timeout=25000)
      assert await page.locator("#article .pit-translation").count()==320
      progress=await page.evaluate("()=>window.action('PIT_GET_PROGRESS')")
      assert progress["ok"] and progress["progress"]["eligible"]>=320,progress
      assert progress["progress"]["coveragePercent"]==100,progress
      assert progress["progress"]["failedBatches"]==0,progress
      print("PASS: 320 article paragraphs + real DOM coverage metrics, no first-page truncation")

      await page.locator("#list-item .pit-translation").wait_for(timeout=5000)
      one=await page.locator("#list-item .pit-translation").inner_text()
      assert one=="译文:Original list item about academic economics.",one
      # Force a new scan without touching the list item. Its translation must
      # not feed itself back into the source text.
      await page.evaluate("""() => {
        const root=document.querySelector('#article');
        root.appendChild(Object.assign(document.createElement('p'),{
          textContent:'Additional paragraph added after initial processing.'
        }));
      }""")
      await page.locator("#article .pit-translation").count()
      await page.wait_for_timeout(1200)
      assert await page.locator("#list-item .pit-translation").count()==1
      assert await page.locator("#list-item .pit-translation").inner_text()==one
      print("PASS: list translation remains stable without recursive amplification")

      await page.locator("#changing").evaluate(
        "(node)=>{node.firstChild.nodeValue='Replaced SPA lecture text after navigation.'}")
      await page.wait_for_function("""()=>document.querySelector(
        '#changing + .pit-translation')?.textContent ===
        '译文:Replaced SPA lecture text after navigation.'""",timeout=10000)
      assert await page.locator("#changing + .pit-translation").count()==1
      assert not await page.locator("#changing + .pit-translation").get_by_text(
        "译文:Dynamic lecture text before SPA update.").count()
      await page.evaluate("""()=>document.querySelector('#shadow-host').shadowRoot
        .querySelector('#shadow-p').firstChild.nodeValue=
          'Updated module content inside open Shadow DOM.'""")
      await page.wait_for_function("""()=>{
        const root=document.querySelector('#shadow-host').shadowRoot;
        return root.querySelector('#shadow-p + .pit-translation')?.textContent===
          '译文:Updated module content inside open Shadow DOM.';
      }""",timeout=10000)
      print("PASS: text-node mutation retranslation in SPA and Shadow DOM")

      await page.evaluate("()=>window.action('PIT_RESTORE')")
      assert await page.locator(".pit-translation").count()==0
      assert await page.evaluate("""()=>
        document.querySelector('#shadow-host').shadowRoot.querySelectorAll('.pit-translation').length""")==0
      assert "Original list item" in await page.locator("#list-item").inner_text()

      # A previous provider call is still pending when the user immediately
      # restores and starts translation again. The new session must not be
      # blocked, and the old reply must not overwrite the fresh translation.
      await page.evaluate("""() => {
        document.body.innerHTML='<main><p id="race">Superseded slow academic paragraph.</p></main>';
        window.slowEntered=false;
      }""")
      await page.evaluate("()=>window.action('PIT_START')")
      await page.wait_for_function("()=>window.slowEntered===true",timeout=5000)
      await page.evaluate("()=>window.action('PIT_RESTORE')")
      await page.locator("#race").evaluate(
        "(el)=>{el.textContent='Fresh translation after restart.'}")
      await page.evaluate("()=>window.action('PIT_START')")
      await page.wait_for_function("""()=>
        document.querySelector('#race + .pit-translation')?.textContent===
        '译文:Fresh translation after restart.'
      """,timeout=1400)
      assert await page.locator("#race + .pit-translation").count()==1
      await page.evaluate("()=>window.releaseSuperseded()")
      await page.wait_for_timeout(150)
      assert await page.locator("#race + .pit-translation").count()==1
      assert await page.locator("#race + .pit-translation").inner_text()==(
        '译文:Fresh translation after restart.')
      await page.evaluate("()=>window.action('PIT_RESTORE')")
      assert not errors,errors
      print("PASS: restore original text and remove injected bilingual nodes")

      # A long paragraph can span several provider requests; if a later
      # request fails, earlier *fully translated* paragraphs stay visible.
      # Manual retry must never resend the already completed paragraph.
      await page.evaluate("""()=>{
        document.body.innerHTML='<main><p id="complete">Short original economics paragraph.</p>'+
          '<p id="huge"></p></main>';
        document.querySelector('#huge').textContent=
          ('The advanced econometric model has many interesting assumptions. ').repeat(530);
        window.checkpointCalls=[];
        window.failSecondCall=true;
        chrome.runtime.sendMessage=async message=>{
          window.checkpointCalls.push(message);
          if(window.failSecondCall && window.checkpointCalls.length===2)
            return {ok:false,error:'HTTP 503 simulated retryable provider failure'};
          return {ok:true,translations:message.texts.map(t=>'译文:'+t)};
        };
      }""")
      await page.evaluate("()=>window.action('PIT_START')")
      await page.locator("#complete + .pit-translation").wait_for(timeout=7000)
      await page.wait_for_function("""()=>window.checkpointCalls.length>=2""",
        timeout=5000)
      before=await page.evaluate("()=>window.action('PIT_GET_PROGRESS')")
      assert before['progress']['translated']==1,before
      assert before['progress']['eligible']==2,before
      assert before['progress']['coveragePercent']==50,before
      await page.evaluate("()=>{window.failSecondCall=false}")
      await page.evaluate("()=>window.action('PIT_CONTINUE')")
      await page.locator("#huge + .pit-translation").wait_for(timeout=18000)
      calls=await page.evaluate("window.checkpointCalls")
      assert sum(any('Short original economics paragraph.'==t for t in call.get('texts',[]))
                 for call in calls)==1,calls
      recovered=await page.evaluate("()=>window.action('PIT_GET_PROGRESS')")
      assert recovered['progress']['coveragePercent']==100,recovered
      await page.evaluate("()=>window.action('PIT_RESTORE')")
      assert await page.locator('.pit-translation').count()==0
      assert not errors,errors
      print("PASS: partial provider failure checkpoints complete paragraphs; manual retry skips them")
    finally:
      await browser.close()

if __name__=="__main__":
  asyncio.run(main())
