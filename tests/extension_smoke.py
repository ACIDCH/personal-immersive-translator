"""Actual Manifest V3 extension-load smoke test in Playwright Chromium.

Loads the unpacked extension into a fresh temporary browser profile. Tests
popup and settings pages using real chrome.runtime/storage APIs, without real
commercial translation calls or any sensitive personal credentials.
"""
import asyncio
import tempfile
from pathlib import Path
from playwright.async_api import async_playwright

ROOT=Path(__file__).resolve().parents[1]

async def main():
    with tempfile.TemporaryDirectory(prefix="pit-browser-profile-") as profile:
        async with async_playwright() as playwright:
            context=await playwright.chromium.launch_persistent_context(
                profile,
                channel="chromium",
                headless=True,
                args=[
                    f"--disable-extensions-except={ROOT}",
                    f"--load-extension={ROOT}",
                    "--no-sandbox",
                    "--disable-dev-shm-usage",
                ],
            )
            errors=[]
            try:
                sw=context.service_workers[0] if context.service_workers else \
                    await context.wait_for_event("serviceworker",timeout=30000)
                assert sw.url.startswith("chrome-extension://"), sw.url
                extension_id=sw.url.split("/")[2]
                assert len(extension_id)==32,extension_id
                print("PASS: unpacked MV3 service worker active",extension_id)

                popup=await context.new_page()
                popup.on("pageerror",lambda e: errors.append("popup: "+str(e)))
                await popup.goto(f"chrome-extension://{extension_id}/src/popup.html")
                await popup.locator("#standard").wait_for(timeout=10000)
                assert await popup.locator("#translate").count()==1
                await popup.locator("#ai").click()
                assert "selected" in (await popup.locator("#ai").get_attribute("class") or "")
                await popup.locator("#standard").click()
                assert "selected" in (await popup.locator("#standard").get_attribute("class") or "")
                print("PASS: popup controls and mode switching")

                options=await context.new_page()
                options.on("pageerror",lambda e: errors.append("options: "+str(e)))
                await options.goto(f"chrome-extension://{extension_id}/src/options.html")
                await options.locator('[name="target"]').wait_for(timeout=10000)
                await options.locator('[name="target"]').select_option("fr")
                await options.locator('[name="standardProvider"]').select_option("deepl")
                await options.get_by_role("button",name="保存设置").click()
                await options.get_by_text("设置已保存。").wait_for(timeout=8000)
                persisted=await options.evaluate("""async()=>{
                    const data=await chrome.storage.local.get('pit_settings_v1');
                    return data.pit_settings_v1;
                }""")
                assert persisted["target"]=="fr",persisted
                assert persisted["standardProvider"]=="deepl",persisted
                assert persisted["autoAI"] is False
                print("PASS: options work and local settings persist")

                tools=await context.new_page()
                tools.on("pageerror",lambda e: errors.append("tools: "+str(e)))
                await tools.goto(f"chrome-extension://{extension_id}/src/tools.html")
                assert await tools.locator("#imageTranslate").count()==1
                assert await tools.locator("#pdfTranslate").count()==1
                assert await tools.locator("#localOCR").count()==1
                print("PASS: image OCR and PDF tools render")

                # Render an actual born-digital PDF through the vendored PDF.js
                # renderer/worker. No cloud OCR, keys or network access.
                import fitz
                from playwright.async_api import TimeoutError as PlaywrightTimeout
                doc=fitz.open()
                pg=doc.new_page()
                pg.insert_text((40,70),"University course PDF text sample for preview.")
                data=doc.tobytes()
                doc.close()
                await tools.locator('#pdf').set_input_files({
                    "name":"fixture.pdf","mimeType":"application/pdf","buffer":data
                })
                try:
                    await tools.locator('#pdfPreview canvas').wait_for(timeout=16000)
                except Exception as exc:
                    info=await tools.locator('#pdfPreviewStatus').inner_text()
                    raise AssertionError(f"PDF.js preview did not render. Status={info!r}; JS errors={errors!r}") from exc
                info=await tools.locator('#pdfPreviewStatus').inner_text()
                assert "首页可读取文字" in info,info
                assert await tools.locator('#pdfPreview canvas').evaluate("(el)=>el.width>100 && el.height>100")
                print("PASS: actual PDF.js worker renders PDF in installed extension")

                assert not errors,errors
            finally:
                await context.close()

if __name__=="__main__":
    asyncio.run(main())
