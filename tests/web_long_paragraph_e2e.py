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
                '</article></main>'
            )
            originals = await page.evaluate("""() => {
              const cjk='这是关于国际贸易、人工智能与经济发展的一段学术讨论。'.repeat(190);
              const latin=('Economic research must preserve adjacent words, '
                +'punctuation, and translation fragment boundaries. ').repeat(105);
              document.querySelector('#cjk').textContent=cjk;
              document.querySelector('#latin').textContent=latin;
              window.calls=[];
              window.listeners=[];
              window.chrome={runtime:{
                onMessage:{addListener:fn=>window.listeners.push(fn)},
                sendMessage:async msg=>{
                  if(msg.type!=='TRANSLATE_BATCH')throw Error('unexpected message');
                  window.calls.push(msg.texts);
                  return {ok:true,translations:msg.texts};
                }
              }};
              window.action=type=>new Promise(resolve=>{
                for(const listener of window.listeners)listener({type,mode:'standard'},{},resolve);
              });
              return {cjk,latin};
            }""")
            assert len(originals["cjk"]) > 3200
            assert len(originals["latin"]) > 3200
            await page.add_script_tag(path=str(CONTENT))
            await page.evaluate("()=>window.action('PIT_START')")
            await page.locator("#cjk + .pit-translation").wait_for(timeout=25000)
            await page.locator("#latin + .pit-translation").wait_for(timeout=25000)
            actual = await page.evaluate("""() => ({
              cjk:document.querySelector('#cjk + .pit-translation').textContent,
              latin:document.querySelector('#latin + .pit-translation').textContent,
              calls:window.calls
            })""")
            assert actual["cjk"] == originals["cjk"], "CJK has extra spaces or missing characters"
            assert actual["latin"] == originals["latin"], "Latin punctuation/spacing corrupted"
            assert sum(map(len, actual["calls"])) >= 4, "fixture did not exercise chunking"
            for batch in actual["calls"]:
                assert len(batch) <= 6
                assert all(0 < len(s) <= 3200 for s in batch)
                assert sum(map(len, batch)) <= 9500
            assert not failures, failures
            print("PASS: actual Chromium DOM preserves CJK/Latin after mock segmented translation")
            await page.evaluate("()=>window.action('PIT_RESTORE')")
            assert await page.locator(".pit-translation").count() == 0
        finally:
            await browser.close()

if __name__ == "__main__":
    asyncio.run(main())
