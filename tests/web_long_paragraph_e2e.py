"""Chromium DOM integration: long paragraphs must not gain whitespace at
provider chunk boundaries. This uses an identity MOCK provider, not live MT.
"""
import asyncio
from pathlib import Path
from playwright.async_api import async_playwright

CONTENT = Path(__file__).resolve().parents[1] / "src" / "content.js"

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(channel="chrome", headless=True,
                                         args=["--no-sandbox"])
        try:
            page = await browser.new_page()
            failures = []
            page.on("pageerror", lambda error: failures.append(str(error)))
            await page.set_content(
                '<main><article><p id="cjk"></p><p id="latin"></p>'
                '<p id="long"></p><p id="dense"></p><p id="oversized"></p><p id="spaced"></p>'
                '</article></main>'
            )
            originals = await page.evaluate("""() => {
              const cjk='这是关于国际贸易、人工智能与经济发展的一段学术讨论。'.repeat(190);
              const latin=('Economic research must preserve adjacent words, '
                +'punctuation, and translation fragment boundaries. ').repeat(105).trim();
              document.querySelector('#cjk').textContent=cjk;
              document.querySelector('#latin').textContent=latin;
              // A 20k+ character article paragraph was previously dropped
              // without a request, even though chunked translation works.
              const long=('A scientific discussion of global market structures. ').repeat(600).trim();
              const oversized='Z'.repeat(120100);
              // Huge whitespace collapses after normalization: a naive
              // 120001-char prefix would otherwise masquerade as full text.
              const spaced='Opening '+(' '.repeat(120100))+' important final words';
              document.querySelector('#long').textContent=long;
              // Rich editor DOM: more than 5,000 text nodes in one paragraph.
              // The old extractor silently discarded everything after node 5001.
              const dense='Text '.repeat(5300);
              const denseNode=document.querySelector('#dense');
              for(let i=0;i<5300;i++)denseNode.appendChild(
                document.createTextNode('Text '));
              document.querySelector('#oversized').textContent=oversized;
              document.querySelector('#spaced').textContent=spaced;
              window.calls=[];window.trimOutputs=false;
              window.listeners=[];
              window.chrome={runtime:{
                onMessage:{addListener:fn=>window.listeners.push(fn)},
                sendMessage:async msg=>{
                  if(msg.type!=='TRANSLATE_BATCH')throw Error('unexpected message');
                  window.calls.push(msg.texts);
                  return {ok:true,translations:window.trimOutputs
                    ?msg.texts.map(s=>s.trim()):msg.texts};
                }
              }};
              window.action=type=>new Promise(resolve=>{
                for(const listener of window.listeners)listener({type,mode:'standard'},{},resolve);
              });
              return {cjk,latin,long,dense,oversized,spaced};
            }""")
            assert len(originals["cjk"]) > 3200
            assert len(originals["latin"]) > 3200
            assert 20000<len(originals["long"])<120000
            assert len(originals["oversized"])>120000
            await page.add_script_tag(path=str(CONTENT))
            await page.evaluate("()=>window.action('PIT_START')")
            await page.locator("#cjk + .pit-translation").wait_for(timeout=25000)
            await page.locator("#latin + .pit-translation").wait_for(timeout=25000)
            await page.locator("#long + .pit-translation").wait_for(timeout=25000)
            await page.locator("#dense + .pit-translation").wait_for(timeout=25000)
            actual = await page.evaluate("""() => ({
              cjk:document.querySelector('#cjk + .pit-translation').textContent,
              latin:document.querySelector('#latin + .pit-translation').textContent,
              long:document.querySelector('#long + .pit-translation').textContent,
              dense:document.querySelector('#dense + .pit-translation').textContent,
              calls:window.calls
            })""")
            assert actual["cjk"] == originals["cjk"], "CJK has extra spaces or missing characters"
            assert actual["latin"] == originals["latin"], "Latin punctuation/spacing corrupted"
            assert actual["long"] == originals["long"], "20k+ paragraph was skipped or corrupted"
            assert actual["dense"] == originals["dense"].strip(), "rich editor dropped text after 5000 nodes"
            progress=await page.evaluate("()=>window.action('PIT_GET_PROGRESS')")
            assert progress["ok"] and progress["progress"]["skippedOversized"]==2,progress
            assert progress["progress"]["translated"]==4,progress
            assert progress["progress"]["eligible"]==6,progress
            assert progress["progress"]["coveragePercent"]==66.67,progress
            assert await page.locator("#oversized + .pit-translation").count()==0
            assert await page.locator("#spaced + .pit-translation").count()==0
            assert sum(map(len, actual["calls"])) >= 4, "fixture did not exercise chunking"
            for batch in actual["calls"]:
                assert len(batch) <= 6
                assert all(0 < len(s) <= 3200 for s in batch)
                assert sum(map(len, batch)) <= 9500
            assert not failures, failures
            print("PASS: actual Chromium DOM preserves CJK/Latin after mock segmented translation")
            # Real providers may trim the edges of their returned fragments.
            await page.evaluate("()=>window.action('PIT_RESTORE')")
            await page.evaluate("()=>{window.trimOutputs=true;}")
            await page.evaluate("()=>window.action('PIT_START')")
            await page.locator("#latin + .pit-translation").wait_for(timeout=25000)
            trimmed = await page.evaluate("""() => ({
              cjk:document.querySelector('#cjk + .pit-translation').textContent,
              latin:document.querySelector('#latin + .pit-translation').textContent,
              long:document.querySelector('#long + .pit-translation').textContent,
              dense:document.querySelector('#dense + .pit-translation').textContent
            })""")
            assert trimmed["cjk"] == originals["cjk"], "trimmed CJK translation changed"
            assert trimmed["latin"] == originals["latin"], "trimmed Latin fragments fused together"
            assert trimmed["long"] == originals["long"], "trimmed long Latin paragraph lost words"
            assert trimmed["dense"] == originals["dense"].strip(), "fragmented DOM original lost text"
            await page.evaluate("()=>window.action('PIT_RESTORE')")
            assert await page.locator(".pit-translation").count() == 0
        finally:
            await browser.close()

if __name__ == "__main__":
    asyncio.run(main())
