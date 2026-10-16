"""Actual Chromium MV3 extension fixture: KISS original browser engine
plus PIT PDF.js + OCR tools. No paid API keys, private media or real OCR model.
"""
import asyncio
import hashlib
import json
import os
import tempfile
from pathlib import Path
import fitz
from playwright.async_api import async_playwright

async def main():
    ext=Path(os.environ.get("PIT_KISS_EXTENSION_DIR",
       "/tmp/pit-kiss-upstream/build/chrome")).resolve()
    assert (ext/"pit/tools.html").is_file(),ext
    with tempfile.TemporaryDirectory(prefix="kiss-sidecar-") as profile:
      async with async_playwright() as p:
        browser=await p.chromium.launch_persistent_context(
          profile,channel="chrome",headless=True,args=[
            "--no-sandbox",f"--disable-extensions-except={ext}",
            f"--load-extension={ext}"])
        try:
          # Headless Chromium may not expose chrome://extensions or start an
          # idle MV3 worker immediately. Resolve targets first; for unpacked
          # extensions without a manifest key, Chrome derives the ID from
          # the canonical absolute unpacked directory path.
          probe=await browser.new_page()
          session=await browser.new_cdp_session(probe)
          targets=(await session.send("Target.getTargets"))["targetInfos"]
          urls=[t["url"] for t in targets if
            t.get("url","").startswith("chrome-extension://")]
          if urls:
            extension_id=urls[0].split("/")[2]
          else:
            digest=hashlib.sha256(str(ext).encode("utf-8")).digest()[:16]
            extension_id="".join(chr(97+(b>>4))+chr(97+(b&15)) for b in digest)
          prefs=Path(profile)/"Default/Preferences"
          if prefs.is_file():
            config=json.loads(prefs.read_text(encoding="utf-8"))
            print("Chromium installed extension IDs:",list(config.get("extensions",{}).get("settings",{})),flush=True)
          print("Chrome extension targets:",urls,
                "candidate ID:",extension_id,flush=True)
          origin="chrome-extension://"+extension_id
          errors=[]
          popup=await browser.new_page()
          popup.on("pageerror",lambda e:errors.append(str(e)))
          await popup.goto(origin+"/popup.html")
          await popup.locator("#pit-multimodal-links a").first.wait_for(timeout=10000)
          hrefs=await popup.locator("#pit-multimodal-links a").evaluate_all(
            "(els)=>els.map(el=>el.getAttribute('href'))")
          assert "pit/tools.html" in hrefs and "pit/options.html" in hrefs,hrefs
          tools=await browser.new_page()
          tools.on("pageerror",lambda e:errors.append(str(e)))
          await tools.goto(origin+"/pit/tools.html")
          await tools.locator("#localOCR").wait_for()
          await tools.locator("#pdfTranslate").wait_for()
          source=fitz.open()
          page=source.new_page()
          page.insert_text((70,85),"PIT KISS sidecar PDF.js fixture")
          pdf=source.tobytes()
          source.close()
          await tools.locator("#pdf").set_input_files(
            {"name":"fixture.pdf","mimeType":"application/pdf","buffer":pdf})
          await tools.locator("#pdfPreviewStatus").get_by_text(
            "已抽查",exact=False).wait_for(timeout=20000)
          assert await tools.locator("#pdfPreview canvas").count()==1
          assert "Mozilla PDF.js" in await tools.locator("#pdfPreview").inner_text()
          settings=await browser.new_page()
          settings.on("pageerror",lambda e:errors.append(str(e)))
          await settings.goto(origin+"/pit/options.html")
          await settings.locator('form[data-ready="1"]').wait_for(timeout=10000)
          await settings.locator('[name="target"]').select_option('fr')
          await settings.locator('#optionsForm button[type="submit"]').click()
          await settings.locator("#status").get_by_text("设置已保存").wait_for(timeout=5000)
          await settings.reload()
          await settings.locator('form[data-ready="1"]').wait_for(timeout=10000)
          assert await settings.locator('[name="target"]').input_value()=="fr"
          # KISS's React popup may have upstream log warnings, but the tools'
          # own module imports and PDF.js worker must not cause JS errors.
          assert not [e for e in errors if 'pit/' in e],errors
          print("PASS: original KISS MV3 popup exposes PIT PDF/OCR links")
          print("PASS: Mozilla PDF.js renders a generated PDF in Chromium")
          print("PASS: independent PIT settings save and reload without remote API")
        finally:
          await browser.close()

if __name__=="__main__":
    asyncio.run(main())
