"""Non-gating L2 real-public-web + real-free-provider PIT Chromium smoke.

No route fixtures, mocked provider, paid API, browser profiles or personal data.
A pass requires >=90% of eligible page blocks and translation restoration on
the CI runner only. An unreachable/blocked page is INCONCLUSIVE, not success.
"""
import asyncio,json,tempfile,time
from pathlib import Path
from urllib.parse import urlparse
from playwright.async_api import async_playwright

ROOT=Path(__file__).resolve().parents[1]
EXT=ROOT/'apps/wxt-ui/.output/chrome-mv3'
PUBLIC=[
 'https://www.careers.philips.com/student/apac/en/graduate-development-program',
 'https://www.iana.org/domains/reserved',
]
async def check_site(ctx,popup,url):
    row={'host':urlparse(url).hostname,'status':'NOT_RUN','live_http':True,
         'provider':'google-free','mock_provider':False,'mock_html':False}
    page=await ctx.new_page()
    try:
        response=await page.goto(url,wait_until='domcontentloaded',timeout=20000)
        row['http_status']=response.status if response else None
        if not response or response.status>=400:
            row['status']='SITE_BLOCKED_OR_UNAVAILABLE'
            return row
        await page.bring_to_front()
        row['visible_original_blocks']=await page.locator('main p,article p,h1,h2').count()
        row['baseline_horizontal_overflow_px']=await page.evaluate(
          "()=>Math.max(0,document.documentElement.scrollWidth-window.innerWidth)")
        await popup.get_by_role('button',name='翻译当前网页').click()
        await asyncio.sleep(.5)
        grant=popup.locator('.grant-site')
        if await grant.count() and await grant.is_visible():
            await grant.click()
            await popup.get_by_role('button',name='翻译当前网页').click()
        # Do not stop after the first two translated nodes: that used to
        # mark a 6/67-partial page as PASS and concealed the backlog.
        # Respect the actual public Google endpoint rate limit, and bound CI.
        deadline=time.monotonic()+105
        previous_count=-1
        previous_change=time.monotonic()
        first_translated_s=None
        progress=None
        while time.monotonic()<deadline:
            progress=await popup.evaluate("""async()=>{
              const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
              if(!tab?.id)return null;
              try{
                const p=await chrome.tabs.sendMessage(tab.id,{type:'PIT_GET_PROGRESS'});
                if(!p?.progress)return null;
                const v=p.progress;
                const error=String(v.lastError||'');
                const errorClass=/\\b429\\b/.test(error)?'HTTP_429':
                  /\\b(500|502|503|504)\\b/.test(error)?'HTTP_5XX':
                  /超时|timeout|连接失败|network/i.test(error)?'NETWORK_OR_TIMEOUT':
                  /数量|不匹配|格式|空译文/i.test(error)?'INVALID_RESPONSE':
                  /源语言|语言包/i.test(error)?'LANGUAGE_DETECTION_OR_PACK':
                  error?'OTHER_TRANSLATION_FAILURE':'NONE';
                return {eligible:v.eligible,translated:v.translated,
                  failedBatches:v.failedBatches,succeededBatches:v.succeededBatches,
                  remaining:v.remaining,busy:v.busy,
                  coveragePercent:v.coveragePercent,errorClass};
              }catch{return null;}
            }""")
            if progress:
                count=progress.get('translated',0)
                if first_translated_s is None and count>0:
                    first_translated_s=round(105-(deadline-time.monotonic()),2)
                if count>previous_count:
                    previous_change=time.monotonic()
                    previous_count=count
                if progress.get('failedBatches',0):
                    row['status']='PROVIDER_OR_DOM_FAILURE'
                    break
                if progress.get('remaining')==0 and not progress.get('busy'):
                    row['status']='COMPLETE_REPORTED'
                    break
                if count>0 and time.monotonic()-previous_change>26:
                    row['status']='STALLED_AFTER_PROGRESS'
                    break
            await asyncio.sleep(1.5)
        row['first_translated_seconds']=first_translated_s
        row['elapsed_translation_seconds']=round(105-(deadline-time.monotonic()),2)
        row['progress']=progress
        row['real_chinese_translation_nodes']=await page.evaluate("""()=>{
          return [...document.querySelectorAll('.pit-translation')]
            .filter(n=>/[\\u3400-\\u9fff]/u.test(n.textContent||'')).length;
        }""")
        row['all_translation_nodes']=await page.locator('.pit-translation').count()
        # A native site must retain functional controls and must not cause
        # a viewport-wide horizontal scrollbar because of inserted blocks.
        row['layout']=await page.evaluate("""()=>{
          const roots=[...document.querySelectorAll('main,article')];
          const translations=[...document.querySelectorAll('.pit-translation')];
          return {
            horizontalOverflowPx:Math.max(0,
              document.documentElement.scrollWidth-window.innerWidth),
            translatedTopLevelControls:document.querySelectorAll(
              'input.pit-translation,button.pit-translation,select.pit-translation'
            ).length,
            unalteredFormInputs:document.querySelectorAll('input,select,textarea').length,
            translationsInsideMain:translations.filter(el=>
              roots.some(root=>root.contains(el))).length
          };
        }""")
        share=(progress or {}).get('coveragePercent')
        if (row['status']=='COMPLETE_REPORTED' and share is not None
                and share>=90 and row['real_chinese_translation_nodes']>=2):
            row['status']='PASS_FULL_ELIGIBLE_CONTENT_AND_MT'
        elif row['status']=='NOT_RUN':
            row['status']='PARTIAL_OR_TIMED_OUT'
        row['new_horizontal_overflow_px']=max(0,row['layout']['horizontalOverflowPx']-
          row['baseline_horizontal_overflow_px'])
        if row['new_horizontal_overflow_px']>24:
            row['status']='PIT_INTRODUCED_LAYOUT_OVERFLOW'
        await popup.get_by_role('button',name='恢复原文').click()
        await asyncio.sleep(.5)
        row['restored']=(await page.locator('.pit-translation').count())==0
        if not row['restored']:row['status']='RESTORE_FAILED'
        return row
    except Exception as error:
        row['status']='BROWSER_NETWORK_OR_TRANSLATION_FAILURE'
        row['error_type']=type(error).__name__
        return row
    finally:
        await page.close()

async def main():
    report={'evidence':'LIVE-L2-CI-runner-only','status':'INCONCLUSIVE',
            'pages':[],'website_html':'real public HTTP',
            'translation_http':'real Google free public endpoint',
            'authenticated_media':False,'windows_owner_l3':False}
    with tempfile.TemporaryDirectory(prefix='pit-live-public-') as profile:
        async with async_playwright() as p:
            ctx=await p.chromium.launch_persistent_context(profile,
                channel='chromium',headless=True,
                args=[f'--disable-extensions-except={EXT}',
                      f'--load-extension={EXT}','--no-sandbox',
                      '--disable-dev-shm-usage'])
            try:
                sw=ctx.service_workers[0] if ctx.service_workers else await ctx.wait_for_event('serviceworker',timeout=30000)
                extid=sw.url.split('/')[2]
                options=await ctx.new_page()
                await options.goto(f'chrome-extension://{extid}/pit-options.html')
                await options.locator('form[data-ready="1"]').wait_for(timeout=12000)
                await options.locator('[name="standardProvider"]').select_option('google-free')
                await options.locator('[name="target"]').select_option('zh')
                await options.locator('.options-nav a[href="#advanced"]').click()
                await options.locator('[data-key="translateToBottom"]').check()
                await options.get_by_role('button',name='保存设置').click()
                popup=await ctx.new_page()
                await popup.goto(f'chrome-extension://{extid}/popup.html')
                await popup.get_by_role('button',name='翻译当前网页').wait_for(timeout=12000)
                for url in PUBLIC:
                    result=await check_site(ctx,popup,url)
                    report['pages'].append(result)
                    print('PIT REAL WEB OBSERVATION:',json.dumps(result,ensure_ascii=False),flush=True)
            finally:
                await ctx.close()
    passed=sum(x['status']=='PASS_FULL_ELIGIBLE_CONTENT_AND_MT' and x.get('restored') for x in report['pages'])
    report['passed']=passed
    report['status']='PASS_FULL_CONTENT_ON_SOME_SITES' if passed else 'PARTIAL_OR_UNAVAILABLE_PUBLIC_CONTENT'
    Path('pit-live-public-web-report.json').write_text(
        json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print('PIT EXTERNAL WEB VERDICT:',report['status'])
    if not passed:raise SystemExit(2)

if __name__=='__main__':
    asyncio.run(main())
