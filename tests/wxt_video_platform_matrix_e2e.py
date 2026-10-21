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
        await settings.locator('.options-nav a[href="#baseSettings"]').click()
        await settings.locator('[name="standardProvider"]').select_option('microsoft')
        await settings.locator('.options-nav a[href="#standardKeys"]').click()
        await settings.locator('[name="microsoftKey"]').fill('fixture')
        await settings.get_by_role('button',name='保存设置').click()
        await settings.get_by_text('设置已保存。').wait_for(timeout=10000)
        popup=await ctx.new_page()
        await popup.goto(f'chrome-extension://{eid}/popup.html')
        await popup.get_by_role('button',name='视频字幕',exact=True).click()
        await popup.get_by_role('button',name='翻译视频字幕').wait_for(timeout=14000)
        caption_nodes={
          'youtube':('.ytp-caption-segment','Visible YouTube captions now'),
          'bilibili':('.bpx-player-subtitle-panel-text','Bilibili video subtitle line'),
          'netflix':('[data-uia="subtitle-text"]','Netflix subtitle example'),
          'panopto':('.captionText','Panopto lecture original caption')
        }
        for name,url,content in SITES:
          async def route_html(route):
            await route.fulfill(status=200,content_type='text/html',
              body='<html><body style="font-size:24px"><section>'+content+'</section></body></html>')
          await ctx.route(url,route_html)
          page=await ctx.new_page()
          await page.goto(url)
          await page.bring_to_front()
          selector,source=caption_nodes[name]
          original=page.locator(selector)
          assert await original.inner_text()==source
          await popup.get_by_role('button',name='翻译视频字幕').click()
          # With editable site DOM captions PIT translates the actual player
          # caption node. The old V1 test looked only for an extra overlay
          # and therefore timed out when correct in-place replacement worked.
          await original.get_by_text('译文:'+source,exact=True).wait_for(timeout=23000)
          visible_overlay=await page.evaluate("""()=>{
            const overlay=document.querySelector('.pit-caption-overlay');
            return Boolean(overlay && getComputedStyle(overlay).display!=='none');
          }""")
          assert visible_overlay is False, (name,'An external translation overlay duplicates DOM CC')
          await popup.get_by_role('button',name='停止字幕翻译').click()
          await page.locator('.pit-caption-overlay').wait_for(state='detached',timeout=8000)
          assert await original.inner_text()==source,(name,'Original DOM caption must be restored')
          result={'platform':name,'fixture_visible_caption':'pass',
            'in_player_replacement':True,'restored_on_stop':True}
          results.append(result)
          await page.close()
          print('PLATFORM VISIBLE-CC FIXTURE:',json.dumps(result,ensure_ascii=False),flush=True)

        # A single no-key Google provider must work through the same real
        # installed background pipeline for VIDEO, not only settings probes.
        # Intercept the actual public HTTP boundary; this fixture does not
        # prove that a third-party live video/Google endpoint is always up.
        await sw.evaluate("""()=>{
          const previous=globalThis.fetch.bind(globalThis);
          globalThis.fetch=async(input,opts)=>{
            const uri=String(input?.url||input);
            if(uri.startsWith('https://translate.googleapis.com/translate_a/single')){
              const url=new URL(uri);
              const q=url.searchParams.get('q');
              globalThis.__pitFreeVideoCalls=(globalThis.__pitFreeVideoCalls||0)+1;
              return new Response(JSON.stringify([[['免费译文:'+q,q]],null,'en']),{
                status:200,headers:{'content-type':'application/json'}
              });
            }
            return previous(input,opts);
          };
        }""")
        await settings.locator('.options-nav a[href="#baseSettings"]').click()
        await settings.locator('[name="standardProvider"]').select_option('google-free')
        await settings.get_by_role('button',name='保存设置').click()
        await settings.get_by_text('设置已保存。').wait_for(timeout=10000)
        free_url='https://www.youtube.com/watch?v=pit-free-service'
        async def free_page(route):
          await route.fulfill(status=200,content_type='text/html',body='''<html><body>
          <div class="ytp-caption-window-container">
            <span class="ytp-caption-segment">Free video translation actually uses the provider</span>
          </div></body></html>''')
        await ctx.route(free_url,free_page)
        page=await ctx.new_page()
        await page.goto(free_url);await page.bring_to_front()
        await popup.get_by_role('button',name='翻译视频字幕').click()
        await page.locator('.ytp-caption-segment').get_by_text(
          '免费译文:Free video translation actually uses the provider',
          exact=True).wait_for(timeout=25000)
        assert await sw.evaluate("()=>globalThis.__pitFreeVideoCalls||0")>=1,(
          'No real video translation request reached Google-free adapter')
        await popup.get_by_role('button',name='停止字幕翻译').click()
        assert await page.locator('.ytp-caption-segment').inner_text()==(
          'Free video translation actually uses the provider')
        results.append({'platform':'youtube-keyless-provider-adapter',
          'fixture_visible_caption':'pass','provider':'google-free',
          'in_player_replacement':True,'restored_on_stop':True})
        await page.close()
        await settings.locator('.options-nav a[href="#baseSettings"]').click()
        await settings.locator('[name="standardProvider"]').select_option('microsoft')
        await settings.get_by_role('button',name='保存设置').click()
        await settings.get_by_text('设置已保存。').wait_for(timeout=10000)

        # Real video CC often splits one sentence across adjacent spans.
        # The first visible caption leaf receives the translation, while the
        # remaining siblings are cleared and restored together on STOP.
        multi='https://www.youtube.com/watch?v=pit-multiple-caption-segments'
        async def multi_html(route):
          await route.fulfill(status=200,content_type='text/html',body='''<html><body>
            <div class="ytp-caption-window-container">
              <span class="ytp-caption-segment">First lecture segment</span>
              <span class="ytp-caption-segment">continues here</span>
            </div></body></html>''')
        await ctx.route(multi,multi_html)
        page=await ctx.new_page()
        await page.goto(multi);await page.bring_to_front()
        spans=page.locator('.ytp-caption-window-container .ytp-caption-segment')
        assert await spans.count()==2
        await popup.get_by_role('button',name='翻译视频字幕').click()
        await spans.nth(0).get_by_text(
          '译文:First lecture segment continues here',exact=True).wait_for(timeout=23000)
        assert await spans.nth(1).inner_text()=='',(
          'Trailing caption fragment must not display untranslated duplicate text')
        assert await page.locator('.pit-caption-overlay').evaluate(
          "(node)=>getComputedStyle(node).display==='none'")
        # The publisher replaces both subtitle segments while playback goes
        # on. PIT must release the old patch and translate the new sentence.
        await page.evaluate("""()=>{
          const nodes=[...document.querySelectorAll('.ytp-caption-segment')];
          nodes[0].textContent='The next lecture';
          nodes[1].textContent='topic is finance';
        }""")
        await spans.nth(0).get_by_text(
          '译文:The next lecture topic is finance',exact=True).wait_for(timeout=23000)
        assert await spans.nth(1).inner_text()==''
        await popup.get_by_role('button',name='停止字幕翻译').click()
        await page.locator('.pit-caption-overlay').wait_for(state='detached',timeout=8000)
        assert [await spans.nth(i).inner_text() for i in range(2)]==[
          'The next lecture','topic is finance'
        ],'STOP must restore the latest publisher-owned subtitle text'
        results.append({'platform':'youtube-split-and-updated-cc',
          'fixture_visible_caption':'pass','in_player_replacement':True,
          'publisher_updates_preserved':True,'restored_on_stop':True})
        await page.close()
        print('PLATFORM SPLIT-CC AND REPLACE: PASS',flush=True)

        # Distinct caption windows must not be flattened into a single
        # mutable subtitle or masked by a floating translation. If a player
        # prevents safe in-place writing, default strict mode reports that.
        windows='https://www.youtube.com/watch?v=pit-separated-speakers'
        async def window_html(route):
          await route.fulfill(status=200,content_type='text/html',body='''<html><body>
          <div class="ytp-caption-window-container">
            <div><span class="ytp-caption-segment">First speaker</span></div>
            <div><span class="ytp-caption-segment">Second speaker</span></div>
          </div></body></html>''')
        await ctx.route(windows,window_html)
        page=await ctx.new_page()
        await page.goto(windows);await page.bring_to_front()
        await popup.get_by_role('button',name='翻译视频字幕').click()
        await popup.wait_for_function("""async()=>{
          const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
          const diag=await chrome.tabs.sendMessage(tab.id,{
            type:'PIT_CAPTIONS_DIAGNOSTICS'
          });
          return diag?.renderRoute==='unsupported'&&diag.translationCount>=1;
        }""",timeout=23000)
        assert await page.locator('.ytp-caption-segment').all_inner_texts()==[
          'First speaker','Second speaker'
        ]
        overlay=await page.locator('.pit-caption-overlay').evaluate(
          "(node)=>getComputedStyle(node).display")
        assert overlay=='none',('Strict in-player mode must not silently use overlay',overlay)
        await popup.get_by_role('button',name='停止字幕翻译').click()
        results.append({'platform':'youtube-multiwindow-strict',
          'fixture_visible_caption':'pass','no_silent_overlay':True})
        await page.close()

        # P0 regression: known video platforms often load their caption
        # layer only after PIT has started. Do not fail at first empty frame.
        delayed='https://www.youtube.com/watch?v=pit-delayed-captions'
        async def delayed_html(route):
          await route.fulfill(status=200,content_type='text/html',
            body='<html><body><video id="late-player" width="640" height="360" controls></video></body></html>')
        await ctx.route(delayed,delayed_html)
        page=await ctx.new_page()
        await page.goto(delayed)
        await page.bring_to_front()
        await popup.get_by_role('button',name='翻译视频字幕').click()
        await popup.get_by_role('button',name='停止字幕翻译').wait_for(timeout=10000)
        await page.locator('.pit-caption-translated').get_by_text(
          '正在等待播放器显示原文字幕',exact=False).wait_for(timeout=11000)
        before=await sw.evaluate("""()=>globalThis.pitPendingTranslationCount||0""")
        await page.evaluate("""()=>{
          const layer=document.createElement('div');
          layer.className='ytp-caption-window-container';
          layer.innerHTML='<span class="ytp-caption-segment">Subtitles appeared after player setup</span>';
          document.body.append(layer);
        }""")
        await page.locator('.ytp-caption-segment').get_by_text(
          '译文:Subtitles appeared after player setup',exact=True).wait_for(timeout=23000)
        assert await page.locator('.pit-caption-overlay').evaluate(
          "(el)=>getComputedStyle(el).display==='none'"),(
          'Late site captions should be replaced in the player without overlay')
        await page.evaluate("""()=>{
          document.querySelector('.ytp-caption-window-container').remove();
        }""")
        await page.locator('.pit-caption-translated').wait_for(state='detached',timeout=12000)
        results.append({'platform':'youtube-delayed-cc','fixture_visible_caption':'pass'})
        await popup.get_by_role('button',name='停止字幕翻译').click()
        await page.close()

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
        frame_caption=page.frame_locator('iframe').locator('.captionText')
        await frame_caption.get_by_text(
          '译文:Embedded Panopto lecture subtitle',exact=True).wait_for(timeout=25000)
        await popup.get_by_role('button',name='停止字幕翻译').click()
        assert await frame_caption.inner_text()=='Embedded Panopto lecture subtitle',(
          'PIT must restore iframe caption content after STOP')
        results.append({'platform':'panopto-iframe','fixture_visible_caption':'pass',
          'in_player_replacement':True,'restored_on_stop':True})
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
  assert len(results)==10 and all(r['fixture_visible_caption']=='pass' for r in results),results

if __name__=='__main__':asyncio.run(main())
