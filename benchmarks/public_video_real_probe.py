"""Observational L2 public-player PIT Chromium MV3 acceptance.

Real publisher-hosted native HTML5/WebVTT, YouTube/Bilibili players and
real Google public translation endpoint. No page interception, login, DRM bypass, cookie inspection, saved
captions, external subtitle overlays or privileged streaming requests.
A network-blocked or unavailable CC outcome is INCONCLUSIVE, not PASS.
"""
import asyncio,json,time,tempfile
from pathlib import Path
from playwright.async_api import async_playwright

EXT=Path(__file__).resolve().parents[1]/'apps/wxt-ui/.output/chrome-mv3'
PUBLIC=[
 ('youtube','https://www.youtube.com/watch?v=qp0HIF3SfI4',
  '.ytp-caption-window-container .ytp-caption-segment',
  '.ytp-subtitles-button','.ytp-play-button'),
 ('bilibili','https://www.bilibili.com/video/BV1H44y1a7JM',
  '.bpx-player-subtitle-panel-text,.bpx-player-subtitle-item,.bilibili-player-video-subtitle',
  '.bpx-player-ctrl-subtitle','.bpx-player-ctrl-play'),
]
async def diagnostics(popup):
    return await popup.evaluate("""async()=>{
      const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
      if(!tab?.id)return null;
      try{
        const diag=await chrome.tabs.sendMessage(tab.id,{type:'PIT_CAPTIONS_DIAGNOSTICS'});
        return diag?.ok ? {active:diag.active,status:diag.status,
          renderRoute:diag.renderRoute,translationCount:diag.translationCount,
          errorKind:diag.lastError?'SUBTITLE_OR_PROVIDER_ERROR':null} : null;
      }catch{return null;}
    }""")

async def observe(ctx,popup,item):
    platform,url,selector,toggle,play=item
    row={'platform':platform,'page_state':'NOT_CHECKED',
         'caption_state':'NOT_CHECKED','translation_state':'NOT_CHECKED',
         'provider':'google-free','real_page':True,'real_provider':True}
    page=await ctx.new_page()
    started=time.monotonic()
    try:
        response=await page.goto(url,wait_until='domcontentloaded',timeout=23000)
        row['http_status']=response.status if response else None
        if not response or response.status>=400:
            row['page_state']='PUBLIC_PAGE_INACCESSIBLE'
            return row
        row['page_state']='PUBLIC_PLAYER_LOADED'
        await page.wait_for_timeout(3200)
        startplay=page.locator(play).first
        if await startplay.count() and await startplay.is_visible():
            try:
                await startplay.click(timeout=1900)
                row['playback_button']='clicked'
            except Exception:
                row['playback_button']='unavailable'
        caption=page.locator(selector)
        showed=False
        for i in range(min(await caption.count(),12)):
            if await caption.nth(i).is_visible():
                showed=True
                break
        if not showed:
            cc=page.locator(toggle).first
            if await cc.count() and await cc.is_visible():
                try:
                    await cc.click(timeout=2000)
                    row['cc_toggle']='clicked'
                except Exception:
                    row['cc_toggle']='unavailable'
            end=time.monotonic()+16
            while time.monotonic()<end:
                if await caption.count()>0 and await caption.first.is_visible():
                    showed=True
                    break
                await asyncio.sleep(.9)
        if not showed:
            row['caption_state']='PUBLIC_CC_NOT_RENDERED'
            return row
        row['caption_state']='VISIBLE_PUBLISHER_CC'
        await page.bring_to_front()
        await popup.get_by_role('button',name='翻译视频字幕').click()
        row['translation_state']='PENDING'
        end=time.monotonic()+25
        while time.monotonic()<end:
            diag=await diagnostics(popup)
            if diag:
                row['diagnostics']=diag
                if diag['renderRoute'] in ('platform-dom','native-track') and diag['translationCount']>0:
                    row['translation_state']='NATIVE_REPLACEMENT_OBSERVED'
                    break
                if diag['status']=='error':
                    row['translation_state']='PROVIDER_OR_CAPTURE_ERROR'
                    break
            await asyncio.sleep(.9)
        row['overlay_absent']=await page.evaluate("""()=>{
          const overlay=document.querySelector('.pit-caption-overlay');
          return !overlay || getComputedStyle(overlay).display==='none';
        }""")
        if row['translation_state']=='NATIVE_REPLACEMENT_OBSERVED' and not row['overlay_absent']:
            row['translation_state']='FALSE_EXTERNAL_OVERLAY'
        await popup.get_by_role('button',name='停止字幕翻译').click()
        row['stop_removed_overlay']=await page.evaluate(
          "()=>!document.querySelector('.pit-caption-overlay')")
        row['stop_diagnostics']=await diagnostics(popup)
        if row['translation_state']=='NATIVE_REPLACEMENT_OBSERVED' and (
            not row['stop_removed_overlay'] or
            row['stop_diagnostics'] and row['stop_diagnostics']['active']):
            row['translation_state']='STOP_FAILED'
        return row
    except Exception as error:
        row['translation_state']='BROWSER_OR_PUBLIC_NETWORK_ERROR'
        row['error_type']=type(error).__name__
        return row
    finally:
        row['elapsed_seconds']=round(time.monotonic()-started,2)
        await page.close()

async def observe_native_public(ctx,popup):
    """Real hosted page, unmodified public MP4 and publisher WebVTT tracks.

    No injected fixtures, replacement VTT, mocked translation response, or
    caption overlay. This covers native HTML5, NOT YouTube/Bilibili adapters.
    """
    url='https://ableplayer.github.io/ableplayer/demos/other-native.html'
    row={'platform':'public-native-html5','page_state':'NOT_CHECKED',
         'caption_state':'NOT_CHECKED','translation_state':'NOT_CHECKED',
         'provider':'google-free','real_page':True,'real_provider':True,
         'real_media_and_vtt':False,'native_html5':True}
    page=await ctx.new_page()
    started=time.monotonic()
    try:
        response=await page.goto(url,wait_until='domcontentloaded',timeout=23000)
        row['http_status']=response.status if response else None
        if not response or response.status>=400:
            row['page_state']='PUBLIC_PAGE_INACCESSIBLE'
            return row
        row['page_state']='PUBLIC_PLAYER_LOADED'
        await page.locator('#video1').wait_for(timeout=10000)
        # Selecting the site's supplied English CC is equivalent to clicking
        # the native captions menu; never fabricate or inject a track.
        await page.evaluate("""()=>{
          const v=document.querySelector('video#video1');
          const en=[...v.textTracks].find(t=>t.language?.split('-')[0]==='en');
          if(en)en.mode='showing';
          if(v){v.muted=true;void v.play().catch(()=>{});}
        }""")
        try:
            await page.wait_for_function("""()=>{
              const v=document.querySelector('video#video1');
              const en=v && [...v.textTracks].find(t=>
                t.language?.split('-')[0]==='en');
              return v?.readyState>=1 && en?.mode==='showing' &&
                en.cues?.length>0;
            }""",timeout=18000)
        except Exception:
            row['caption_state']='PUBLIC_NATIVE_CC_OR_MEDIA_NOT_READY'
            return row
        observed=await page.evaluate("""()=>{
          const v=document.querySelector('video#video1');
          const t=[...v.textTracks].find(x=>x.language?.split('-')[0]==='en');
          const cues=[...t.cues];
          const sample=cues.find(c=>c.endTime-c.startTime>=.5 &&
            /[A-Za-z]/.test(c.text) && c.startTime<90);
          if(!sample)return null;
          v.currentTime=sample.startTime+Math.min(.3,(sample.endTime-sample.startTime)/3);
          v.pause();
          return {original:sample.text,startTime:sample.startTime,
            endTime:sample.endTime,cueCount:cues.length};
        }""")
        if not observed:
            row['caption_state']='NO_USABLE_PUBLIC_ENGLISH_CC_CUES'
            return row
        row['caption_state']='PUBLISHER_NATIVE_VTT_AVAILABLE'
        row['real_media_and_vtt']=True
        row['publisher_cue_count']=observed['cueCount']
        await page.bring_to_front()
        await popup.get_by_role('button',name='翻译视频字幕').click()
        row['translation_state']='PENDING'
        end=time.monotonic()+28
        while time.monotonic()<end:
            state=await page.evaluate("""({start,original})=>{
              const v=document.querySelector('video#video1');
              const t=v && [...v.textTracks].find(x=>
                x.language?.split('-')[0]==='en');
              const cue=t?.cues && [...t.cues].find(x=>
                Math.abs(x.startTime-start)<.001);
              const overlay=document.querySelector('.pit-caption-overlay');
              return {text:cue?.text||'',mode:t?.mode||'absent',
                overlayHidden:!overlay||getComputedStyle(overlay).display==='none',
                moved:!!cue && cue.text!==original && /[㐀-鿿]/.test(cue.text)};
            }""",{'start':observed['startTime'],'original':observed['original']})
            diag=await diagnostics(popup)
            if diag:
                row['diagnostics']=diag
                if (state['moved'] and state['mode']=='showing' and
                    state['overlayHidden'] and diag['renderRoute']=='native-track'):
                    row['translation_state']='NATIVE_REPLACEMENT_OBSERVED'
                    break
                if diag['status'] in ('error','unsupported'):
                    row['translation_state']='PROVIDER_OR_NATIVE_RENDER_ERROR'
                    break
            await asyncio.sleep(.7)
        row['overlay_absent']=await page.evaluate("""()=>{
          const el=document.querySelector('.pit-caption-overlay');
          return !el || getComputedStyle(el).display==='none';
        }""")
        await popup.get_by_role('button',name='停止字幕翻译').click()
        restored=await page.evaluate("""({start,original})=>{
          const v=document.querySelector('video#video1');
          const t=v && [...v.textTracks].find(x=>
            x.language?.split('-')[0]==='en');
          const cue=t?.cues && [...t.cues].find(x=>
            Math.abs(x.startTime-start)<.001);
          return !!cue && cue.text===original;
        }""",{'start':observed['startTime'],'original':observed['original']})
        row['restored_original_cue']=restored
        if row['translation_state']=='NATIVE_REPLACEMENT_OBSERVED' and not restored:
            row['translation_state']='STOP_FAILED'
        return row
    except Exception as error:
        row['translation_state']='BROWSER_OR_PUBLIC_NETWORK_ERROR'
        row['error_type']=type(error).__name__
        return row
    finally:
        row['elapsed_seconds']=round(time.monotonic()-started,2)
        await page.close()

async def main():
    report={'evidence':'L2_REAL_PUBLIC_PLAYER_AND_PROVIDER',
            'real_sites':True,'translation_http_mocked':False,
            'authenticated_streams':False,'windows_l3':False,'sites':[]}
    with tempfile.TemporaryDirectory(prefix='pit-real-players-') as profile:
        async with async_playwright() as pw:
            ctx=await pw.chromium.launch_persistent_context(profile,
                channel='chromium',headless=True,
                args=[f'--disable-extensions-except={EXT}',
                      f'--load-extension={EXT}','--no-sandbox',
                      '--disable-dev-shm-usage'])
            try:
                sw=ctx.service_workers[0] if ctx.service_workers else await ctx.wait_for_event('serviceworker',timeout=30000)
                eid=sw.url.split('/')[2]
                options=await ctx.new_page()
                await options.goto(f'chrome-extension://{eid}/pit-options.html')
                await options.locator('form[data-ready="1"]').wait_for(timeout=12000)
                await options.locator('[name="standardProvider"]').select_option('google-free')
                await options.locator('[name="target"]').select_option('zh')
                await options.get_by_role('button',name='保存设置').click()
                popup=await ctx.new_page()
                await popup.goto(f'chrome-extension://{eid}/popup.html')
                await popup.get_by_role('button',name='视频字幕',exact=True).click()
                await popup.get_by_role('button',name='翻译视频字幕').wait_for(timeout=13000)
                # A public non-DRM HTML5 player with real publisher CC/VTT
                # provides evidence missing from inaccessible platform sites.
                native=await observe_native_public(ctx,popup)
                report['sites'].append(native)
                print('PIT REAL PLAYER OBSERVATION: '+json.dumps(native,ensure_ascii=False),flush=True)
                for item in PUBLIC:
                    value=await observe(ctx,popup,item)
                    report['sites'].append(value)
                    print('PIT REAL PLAYER OBSERVATION: '+json.dumps(value,ensure_ascii=False),flush=True)
            finally:
                await ctx.close()
    report['passed']=sum(x['translation_state']=='NATIVE_REPLACEMENT_OBSERVED' and
                         x.get('restored_original_cue',True) and
                         x.get('overlay_absent',False) for x in report['sites'])
    report['passed_platforms']=[x['platform'] for x in report['sites'] if
      x['translation_state']=='NATIVE_REPLACEMENT_OBSERVED' and
      x.get('restored_original_cue',True) and x.get('overlay_absent',False)]
    # A pass on a standalone native player cannot certify YouTube/Netflix.
    report['status']=('PASS_ALL_REAL_PUBLIC_CAPTIONS' if
        report['passed']==len(report['sites']) else
        'PARTIAL_PASS_REAL_PUBLIC_CAPTIONS' if report['passed'] else
        'INCONCLUSIVE_REAL_PUBLIC_CAPTIONS')
    Path('pit-public-video-observation.json').write_text(
        json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
    print('PIT PUBLIC VIDEO VERDICT:',report['status'])
    if not report['passed']:
        raise SystemExit(2)

if __name__=='__main__':
    asyncio.run(main())
