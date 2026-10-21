"""Non-gating L2 real-public-web + real-free-provider PIT Chromium smoke.

No route fixtures, mocked provider, paid API, browser profiles or personal data.
A pass proves ONE external page and Chinese translation insertion/restoration on
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
        await popup.get_by_role('button',name='翻译当前网页').click()
        await asyncio.sleep(.5)
        grant=popup.locator('.grant-site')
        if await grant.count() and await grant.is_visible():
            await grant.click()
            await popup.get_by_role('button',name='翻译当前网页').click()
        end=time.monotonic()+52
        chinese=0
        while time.monotonic()<end:
            chinese=await page.evaluate("""()=>{
              const t=[...document.querySelectorAll('.pit-translation')];
              return t.filter(n=>/[\\u3400-\\u9fff]/u.test(n.textContent||'')).length;
            }""")
            if chinese>=2:break
            await asyncio.sleep(1)
        row['real_chinese_translation_nodes']=chinese
        row['all_translation_nodes']=await page.locator('.pit-translation').count()
        row['progress']=await popup.evaluate("""async()=>{
          const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
          if(!tab?.id)return null;
          try{
            const p=await chrome.tabs.sendMessage(tab.id,{type:'PIT_GET_PROGRESS'});
            if(!p?.progress)return null;
            return {eligible:p.progress.eligible,translated:p.progress.translated,
              failedBatches:p.progress.failedBatches,
              remaining:p.progress.remaining};
          }catch{return null;}
        }""")
        row['status']='PASS_REAL_PUBLIC_HTML_AND_MT' if chinese>=2 else 'NO_REAL_CHINESE_TRANSLATION'
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
    passed=sum(x['status']=='PASS_REAL_PUBLIC_HTML_AND_MT' and x.get('restored') for x in report['pages'])
    report['passed']=passed
    report['status']='PASS_SOME_PUBLIC_SITES' if passed else 'INCONCLUSIVE_NO_END_TO_END_PASS'
    Path('pit-live-public-web-report.json').write_text(
        json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print('PIT EXTERNAL WEB VERDICT:',report['status'])
    if not passed:raise SystemExit(2)

if __name__=='__main__':
    asyncio.run(main())
