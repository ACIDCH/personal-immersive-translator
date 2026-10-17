"""Best-effort live-public-page DOM probe, in the real WXT Chromium extension.

Gets public website HTML over the real internet, but STUBS ONLY translation
provider HTTP. It measures DOM handling, not translation quality/provider uptime.
No personal pages, credentials, private URLs or page text are recorded.
"""
import asyncio
import json
import tempfile
import time
from pathlib import Path
from urllib.parse import urlparse
from playwright.async_api import async_playwright

ROOT=Path(__file__).resolve().parents[1]
PACKAGE=ROOT/"apps"/"wxt-ui"/".output"/"chrome-mv3"
PAGES=["https://www.iana.org/domains/reserved", "https://example.org/"]

async def probe_one(context,popup,url):
    result={"site":urlparse(url).hostname,"status":"unverified"}
    page=await context.new_page()
    try:
        response=await page.goto(url,wait_until="domcontentloaded",timeout=18000)
        result["http"]=response.status if response else None
        if not response or response.status>=400:
            result["status"]="site_unavailable"
            return result
        await page.bring_to_front()
        await popup.get_by_role('button',name='翻译当前网页').click()
        # A directly opened popup test page does not have the same activeTab
        # grant as an extension toolbar click. Exercise our explicit fallback.
        await asyncio.sleep(0.5)
        if await popup.locator('.grant-site').is_visible():
            result['authorization']='explicit_per_origin'
            await popup.get_by_role('button',name='允许当前网站翻译').click()
            grant_status=await popup.locator('.native-status').inner_text()
            if '已授权' not in grant_status:
                result['status']='site_access_not_granted'
                return result
            await popup.get_by_role('button',name='翻译当前网页').click()
        started=time.monotonic()
        last=None
        while time.monotonic()-started<28:
            last=await popup.evaluate("""async() => {
              const tabs=await chrome.tabs.query({active:true,currentWindow:true});
              if(!tabs[0]?.id)return null;
              try{
                const p=await chrome.tabs.sendMessage(tabs[0].id,{type:'PIT_GET_PROGRESS'});
                return p?.ok?p.progress:null;
              }catch{return null;}
            }""")
            if last and last.get("eligible",0)>0 and not last.get("busy"):
                if last.get("remaining")==0 and last.get("failedBatches")==0:
                    result["status"]="passed_dom_with_mock_mt"
                    break
                if last.get("failedBatches",0)>0:
                    result["status"]="engine_or_permission_failure"
                    break
            # A permission/injection error is actionable, not a timeout.
            popup_status=await popup.locator('.native-status').inner_text()
            if popup_status.startswith('操作失败：') or '尚未授权' in popup_status:
                result["status"]="extension_permission_or_injection_error"
                result["error_class"]="site_access" if ('权限' in popup_status or 'access' in popup_status.lower() or 'permission' in popup_status.lower()) else "other"
                break
            await asyncio.sleep(0.9)
        if result["status"]=="unverified":
            result["status"]="timeout_or_no_eligible_blocks"
        if last:
            result["eligible"]=last.get("eligible")
            result["translated"]=last.get("translated")
            result["coverage_percent"]=last.get("coveragePercent")
            result["failed_batches"]=last.get("failedBatches")
        result["elapsed_seconds"]=round(time.monotonic()-started,2)
        # Restore is also a real MV3 message, separate from the provider mock.
        if result["status"]=="passed_dom_with_mock_mt":
            await popup.get_by_role("button",name="恢复原文").click()
            await page.locator(".pit-translation").first.wait_for(state="detached",timeout=7000)
            result["restore"]=True
    except Exception as exc:
        result["status"]="browser_or_network_error"
        result["error_type"]=type(exc).__name__
        # Deliberately no exception text: network errors can contain private URLs.
    finally:
        await page.close()
    return result

async def main():
    report={"test":"public website HTML + real Chromium WXT MV3",
            "translation":"official MT response mocked; no API keys or paid calls",
            "results":[]}
    with tempfile.TemporaryDirectory(prefix="pit-public-probe-") as profile:
        async with async_playwright() as p:
            ctx=await p.chromium.launch_persistent_context(
                profile,channel="chromium",headless=True,ignore_https_errors=False,
                args=[f"--disable-extensions-except={PACKAGE}",f"--load-extension={PACKAGE}",
                      "--no-sandbox","--disable-dev-shm-usage"])
            try:
                sw=ctx.service_workers[0] if ctx.service_workers else await ctx.wait_for_event("serviceworker",timeout=30000)
                eid=sw.url.split('/')[2]
                await sw.evaluate("""()=> {
                  const original=globalThis.fetch.bind(globalThis);
                  globalThis.fetch=async(u,init)=>{
                    if(String(u).startsWith('https://api.cognitive.microsofttranslator.com/')){
                      const data=JSON.parse(init.body);
                      return new Response(JSON.stringify(data.map(x=>({
                        translations:[{text:'译文:'+x.Text}]
                      }))),{status:200,headers:{'Content-Type':'application/json'}});
                    }
                    return original(u,init);
                  };
                }""")
                options=await ctx.new_page()
                await options.goto(f"chrome-extension://{eid}/pit-options.html")
                await options.locator('form[data-ready="1"]').wait_for(timeout=10000)
                await options.locator('[name="microsoftKey"]').fill('public-probe-placeholder')
                await options.get_by_role('button',name='保存设置').click()
                await options.get_by_text('设置已保存。').wait_for(timeout=8000)
                popup=await ctx.new_page()
                await popup.goto(f"chrome-extension://{eid}/popup.html")
                await popup.get_by_role('button',name='翻译当前网页').wait_for(timeout=10000)
                for url in PAGES:
                    result=await probe_one(ctx,popup,url)
                    report["results"].append(result)
                    print("PUBLIC SITE PROBE: "+json.dumps(result,ensure_ascii=False),flush=True)
            finally:
                await ctx.close()
    Path('wxt-public-site-probe.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    passes=sum(x["status"]=="passed_dom_with_mock_mt" for x in report["results"])
    print(f"REAL PUBLIC HTML: {passes}/{len(report['results'])} sites loaded, translated with mock provider and restored")
    # Exit nonzero if all sites fail: optional/non-blocking CI step records it.
    if passes==0:raise SystemExit(2)

if __name__=="__main__":
    asyncio.run(main())
