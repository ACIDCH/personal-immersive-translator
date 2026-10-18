"""Public-video / real-network smoke in an installed Chromium MV3 extension.

This uses the actual PUBLIC sites, not HTML route fixtures. It does not bypass
DRM, login, subscriptions, paywalls or player internals, and it never reads
site cookies, intercepts caption API requests or saves caption/source text.
The translation API remains a deterministic STUB. Only host/status counters
go into CI results. Lack of site access is INCONCLUSIVE, never a pass.
"""
import asyncio
import json
import time
import tempfile
from pathlib import Path
from playwright.async_api import async_playwright

ROOT=Path(__file__).resolve().parents[1]
PACKAGE=ROOT/"apps/wxt-ui/.output/chrome-mv3"
SITES=[
 ("youtube","https://www.youtube.com/watch?v=aqz-KE-bpKQ",
  ".ytp-caption-segment",".ytp-subtitles-button"),
 ("bilibili","https://www.bilibili.com/video/BV1H44y1a7JM",
  ".bpx-player-subtitle-panel-text, .bpx-player-subtitle-item, .bilibili-player-video-subtitle",
  ".bpx-player-ctrl-subtitle")
]

async def public_site(ctx,popup,entry):
    provider,url,selector,button=entry
    row={"platform":provider,"public_page":True,
         "page_state":"not_checked","caption_state":"not_checked",
         "translation_state":"not_checked","verified_real_caption":False}
    page=await ctx.new_page()
    try:
        started=time.monotonic()
        response=await page.goto(url,wait_until="domcontentloaded",timeout=20000)
        row["http"]=response.status if response else None
        if not response or response.status>=400:
            row["page_state"]="public_page_unavailable";return row
        row["page_state"]="http_loaded"
        await page.wait_for_timeout(4500)
        # Do not toggle captions OFF when the public player already draws
        # readable CC. Otherwise try the website's normal visible UI once.
        visible=page.locator(selector)
        existing=await visible.count()
        initially_showing=False
        for i in range(min(existing,10)):
            if await visible.nth(i).is_visible():
                initially_showing=True
                break
        cc=page.locator(button).first
        if initially_showing:
            row["caption_toggle"]="already_visible"
        elif await cc.count() and await cc.is_visible():
            try:
                await cc.click(timeout=3500)
                row["caption_toggle"]="clicked"
            except Exception:
                row["caption_toggle"]="site_ui_denied"
        else:
            row["caption_toggle"]="not_exposed"
        await page.wait_for_timeout(2000)
        captions=await visible.count()
        row["visible_caption_elements"]=min(captions,300)
        if captions<1:
            row["caption_state"]="no_public_visible_caption_or_player_blocked"
            return row
        rendered=False
        for i in range(min(captions,10)):
            if await visible.nth(i).is_visible():
                rendered=True;break
        row["caption_state"]="present" if rendered else "hidden_or_unavailable"
        if not rendered:return row
        # Active page + extension popup tests PIT's production native overlay;
        # only the standard MT network boundary is replaced with a mock.
        await page.bring_to_front()
        await popup.get_by_role("button",name="翻译视频字幕").click()
        try:
            await page.locator(".pit-caption-translated").wait_for(timeout=11000)
            row["translation_state"]="visible_with_mock_mt"
            row["verified_real_caption"]=True
        except Exception:
            row["translation_state"]="real_site_adapter_failed_or_unavailable"
        await popup.get_by_role("button",name="停止字幕翻译").click()
        return row
    except Exception as exc:
        row["page_state"]="browser_or_public_network_error"
        row["error_class"]=type(exc).__name__
        return row
    finally:
        row["elapsed_seconds"]=round(time.monotonic()-started,2) if 'started' in locals() else None
        await page.close()


async def main():
    result={"test":"actual public player UI + PIT Chromium MV3",
            "provider":"mocked Microsoft HTTP; real provider quality NOT tested",
            "authenticated_streams":False,"sites":[]}
    with tempfile.TemporaryDirectory(prefix="pit-public-players-") as profile:
        async with async_playwright() as p:
            ctx=await p.chromium.launch_persistent_context(profile,channel="chromium",headless=True,
                args=[f"--disable-extensions-except={PACKAGE}",f"--load-extension={PACKAGE}",
                      "--no-sandbox","--disable-dev-shm-usage"])
            try:
                sw=ctx.service_workers[0] if ctx.service_workers else await ctx.wait_for_event("serviceworker",timeout=25000)
                extension=sw.url.split("/")[2]
                await sw.evaluate("""()=>{
                  const orig=globalThis.fetch.bind(globalThis);
                  globalThis.fetch=async(input,opts)=>{
                    const url=String(input?.url||input);
                    if(url.startsWith('https://api.cognitive.microsofttranslator.com/')){
                      const data=JSON.parse(opts.body);
                      return new Response(JSON.stringify(data.map(x=>({
                        translations:[{text:'MOCK_TRANSLATION'}]}))),
                        {status:200,headers:{'content-type':'application/json'}});
                    }
                    return orig(input,opts);
                  };
                }""")
                options=await ctx.new_page()
                await options.goto(f"chrome-extension://{extension}/pit-options.html")
                await options.locator("form[data-ready='1']").wait_for(timeout=10000)
                await options.locator("[name='standardProvider']").select_option("microsoft")
                await options.locator("[name='microsoftKey']").fill("public-probe-fixture")
                await options.get_by_role("button",name="保存设置").click()
                popup=await ctx.new_page()
                await popup.goto(f"chrome-extension://{extension}/popup.html")
                # The React popup defaults to the WEB tab. The prior public
                # probe timed out on a hidden video action before visiting
                # YouTube/Bilibili at all, masking test harness failure as
                # public-site incompatibility. Select the VIDEO panel first.
                await popup.get_by_role("button",name="视频字幕",exact=True).click()
                await popup.get_by_role("button",name="翻译视频字幕").wait_for(timeout=10000)
                for site in SITES:
                    value=await public_site(ctx,popup,site)
                    result["sites"].append(value)
                    print("PUBLIC VIDEO OBSERVATION:",json.dumps(value,ensure_ascii=False),flush=True)
            finally:
                await ctx.close()
    result["site_count"]=len(result["sites"])
    result["actual_overlay_passes"]=sum(row["verified_real_caption"] for row in result["sites"])
    result["result"]="observational_only"
    Path("public-video-probe.json").write_text(json.dumps(result,ensure_ascii=False,indent=2)+"\n",encoding="utf8")
    print("PUBLIC PLAYER EVIDENCE:",result["actual_overlay_passes"],"/",result["site_count"])
    # Failing to access a public website is a recorded BLOCKER, not a fake pass.
    if result["actual_overlay_passes"]==0:raise SystemExit(2)


if __name__=="__main__":
    asyncio.run(main())
