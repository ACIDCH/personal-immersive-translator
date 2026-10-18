"""Chromium WXT: native subtitle adapters on realistic YouTube/Bilibili/Netflix/Panopto
visible DOM fixtures, Panopto iframe route, and user-provided SRT. The platform
pages are controlled HTML fixtures, NOT real authenticated streaming sessions.
"""
import asyncio,json,tempfile
from pathlib import Path
from playwright.async_api import async_playwright

EXT=Path(__file__).resolve().parents[1]/'apps/wxt-ui/.output/chrome-mv3'
SITES=[
 ('youtube','https://www.youtube.com/watch?v=fixture',
  '<div class="ytp-caption-window-container"><span class="ytp-caption-segment">Visible YouTube captions now</span></div>'),
 ('bilibili','https://www.bilibili.com/video/BVfixture',
  '<div class="bpx-player-subtitle-panel"><span class="bpx-player-subtitle-panel-text">Bilibili video subtitle line</span></div>'),
 ('netflix','https://www.netflix.com/watch/10001234',
  '<div class="player-timedtext"><span data-uia="subtitle-text">Netflix subtitle example</span></div>'),
 ('panopto','https://sample.panopto.com/Panopto/Pages/Viewer.aspx?id=course',
  '<div class="captionText">Panopto lecture original caption</div>'),
]
async def main():
  results=[]
  with tempfile.TemporaryDirectory(prefix='wxt-platform-') as profile:
    async with async_playwright() as p:
      ctx=await p.chromium.launch_persistent_context(profile,channel='chromium',headless=True,
        args=[f'--disable-extensions-except={EXT}',f'--load-extension={EXT}',
              '--no-sandbox','--disable-dev-shm-usage'])
      try:
        sw=ctx.service_workers[0] if ctx.service_workers else await ctx.wait_for_event('serviceworker',timeout=30000)
        eid=sw.url.split('/')[2]
        await sw.evaluate("""()=>{
          const orig=globalThis.fetch.bind(globalThis);
          globalThis.fetch=async(input,opts)=>{
            const url=String(input?.url||input);
            if(url.startsWith('https://api.cognitive.microsofttranslator.com/')){
              const body=JSON.parse(opts.body);
              return new Response(JSON.stringify(body.map(x=>({translations:[{text:'译文:'+x.Text}]}))),
                {status:200,headers:{'content-type':'application/json'}});
            }
            return orig(input,opts);
          };
        }""")
        settings=await ctx.new_page()
        await settings.goto(f'chrome-extension://{eid}/pit-options.html')
        await settings.locator('form[data-ready="1"]').wait_for(timeout=15000)
        await settings.locator('[name="standardProvider"]').select_option('microsoft')
        await settings.locator('[name="microsoftKey"]').fill('fixture')
        await settings.get_by_role('button',name='保存设置').click()
        await settings.get_by_text('设置已保存。').wait_for(timeout=10000)
        popup=await ctx.new_page()
        await popup.goto(f'chrome-extension://{eid}/popup.html')
        await popup.get_by_role('button',name='视频字幕',exact=True).click()
        await popup.get_by_role('button',name='翻译视频字幕').wait_for(timeout=14000)
        for name,url,content in SITES:
          async def route_html(route):
            await route.fulfill(status=200,content_type='text/html',
              body='<html><body style="font-size:24px"><section>'+content+'</section></body></html>')
          await ctx.route(url,route_html)
          page=await ctx.new_page()
          await page.goto(url)
          await page.bring_to_front()
          await popup.get_by_role('button',name='翻译视频字幕').click()
          await page.locator('.pit-caption-translated').get_by_text('译文:',exact=False).wait_for(timeout=23000)
          result={'platform':name,'fixture_visible_caption':'pass'}
          results.append(result)
          await popup.get_by_role('button',name='停止字幕翻译').click()
          await page.locator('.pit-caption-overlay').wait_for(state='detached',timeout=8000)
          await page.close()
          print('PLATFORM VISIBLE-CC FIXTURE:',json.dumps(result,ensure_ascii=False),flush=True)

        parent='https://lms.example.org/course/one'
        child='https://sample.panopto.com/Panopto/Pages/Embed.aspx?id=lesson1'
        async def child_html(route):
          await route.fulfill(status=200,content_type='text/html',
            body='<html><body><span class="captionText">Embedded Panopto lecture subtitle</span></body></html>')
        async def parent_html(route):
          await route.fulfill(status=200,content_type='text/html',
            body=f'<html><body><iframe src="{child}" width="660" height="390"></iframe></body></html>')
        await ctx.route(child,child_html);await ctx.route(parent,parent_html)
        page=await ctx.new_page()
        await page.goto(parent)
        await page.frame_locator('iframe').locator('.captionText').wait_for(timeout=9000)
        await page.bring_to_front()
        await popup.get_by_role('button',name='翻译视频字幕').click()
        await page.frame_locator('iframe').locator('.pit-caption-translated').get_by_text('译文:',exact=False).wait_for(timeout=25000)
        results.append({'platform':'panopto-iframe','fixture_visible_caption':'pass'})
        await popup.get_by_role('button',name='停止字幕翻译').click()
        await page.close()

        url='https://example.org/manual-subtitles'
        async def source_html(route):
          await route.fulfill(status=200,content_type='text/html',
            body='<html><body><video id="player" width="640" height="320" controls></video></body></html>')
        await ctx.route(url,source_html)
        page=await ctx.new_page()
        await page.goto(url);await page.bring_to_front()
        await popup.locator('input[type=file]').set_input_files({
          'name':'lesson.srt','mimeType':'text/plain',
          'buffer':b'1\n00:00:00,000 --> 00:00:20,000\nManual subtitle for lecture\n\n'})
        await popup.get_by_role('button',name='翻译视频字幕').click()
        await page.locator('.pit-caption-translated').get_by_text('译文:',exact=False).wait_for(timeout=26000)
        results.append({'platform':'user-srt','fixture_visible_caption':'pass'})
        await popup.get_by_role('button',name='停止字幕翻译').click()
        print('WXT PLATFORM MATRIX:',json.dumps(results,ensure_ascii=False),flush=True)
      finally:
        Path('wxt-platform-caption-matrix.json').write_text(json.dumps(results,ensure_ascii=False,indent=2)+'\n')
        await ctx.close()
  assert len(results)==6 and all(r['fixture_visible_caption']=='pass' for r in results),results

if __name__=='__main__':asyncio.run(main())
