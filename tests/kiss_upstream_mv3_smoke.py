"""Smoke an *isolated* GPL KISS build, without modifying/distributing its code.
A built MV3 manifest is not evidence the translation engine translates correctly.
"""
import asyncio
import json
import tempfile
import sys
from pathlib import Path
from playwright.async_api import async_playwright

async def main():
    root=Path(sys.argv[1]).resolve()
    manifest=json.loads((root/"manifest.json").read_text())
    assert manifest["manifest_version"]==3
    with tempfile.TemporaryDirectory(prefix="kiss-isolated-mv3-") as profile:
        async with async_playwright() as p:
            browser=await p.chromium.launch_persistent_context(
                profile,channel="chromium",headless=True,
                args=[f"--disable-extensions-except={root}",
                      f"--load-extension={root}","--no-sandbox","--disable-dev-shm-usage"])
            try:
                service_worker=browser.service_workers[0] if browser.service_workers else await browser.wait_for_event("serviceworker",timeout=30000)
                extension_id=service_worker.url.split("/")[2]
                assert len(extension_id)==32
                popup=await browser.new_page()
                await popup.goto(f"chrome-extension://{extension_id}/"+manifest["action"]["default_popup"],timeout=20000)
                assert await popup.locator("body").count()==1
                await popup.wait_for_timeout(1200)
                report={"engine":"KISS Translator","runtime":"Chromium MV3",
                  "service_worker_detected":True,"popup_loaded":True,
                  "translation_dom_verified":False,"provider_requests_verified":False,
                  "note":"Browser boot smoke only; translation comparison NOT YET RUN"}
                Path("kiss-browser-smoke-report.json").write_text(json.dumps(report,indent=2)+"\n")
                print("KISS MV3 RUNTIME SMOKE: "+json.dumps(report))
            finally:
                await browser.close()
if __name__=="__main__":
    asyncio.run(main())
