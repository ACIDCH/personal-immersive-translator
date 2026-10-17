"""Real Tesseract.js OCR from a generated PNG via the built React portal.

Models and WASM may need a public CDN on first run. Report failures honestly.
No real documents and no remote AI translation are used.
"""
import asyncio
import io
import json
import tempfile
import time
from functools import partial
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
from threading import Thread
from pathlib import Path
from playwright.async_api import async_playwright
from PIL import Image,ImageDraw,ImageFont

DIST=Path(__file__).resolve().parents[1]/"apps/portal/dist"
FONT="/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"

async def main():
  assert (DIST/"index.html").exists(),"Build Pages portal first"
  img=Image.new("RGB",(950,190),"white")
  draw=ImageDraw.Draw(img)
  font=ImageFont.truetype(FONT,69)
  draw.text((36,44),"HELLO WORLD 2026",fill="black",font=font)
  buf=io.BytesIO();img.save(buf,format="PNG")
  handler=partial(SimpleHTTPRequestHandler,directory=str(DIST))
  server=ThreadingHTTPServer(("127.0.0.1",0),handler)
  thread=Thread(target=server.serve_forever,daemon=True);thread.start()
  report={"engine":"Tesseract.js","fixture":"synthetic 950x190 PNG with HELLO WORLD 2026",
          "browser":"Chromium","mode":"local WASM and downloaded English language data",
          "status":"not_run","recognized_text":""}
  try:
    async with async_playwright() as p:
      browser=await p.chromium.launch(channel="chromium",headless=True,args=["--no-sandbox","--disable-dev-shm-usage"])
      try:
        page=await browser.new_page()
        page.on("pageerror",lambda err:print("OCR PAGE ERROR:",str(err)[:300]))
        await page.goto(f"http://127.0.0.1:{server.server_port}/",wait_until="domcontentloaded",timeout=20000)
        await page.get_by_role("heading",name="文件与图片处理").wait_for(timeout=16000)
        await page.get_by_role("button",name="图片 OCR").click()
        await page.locator('.document-lab input[type="file"]').set_input_files({
          "name":"local-ocr-fixture.png","mimeType":"image/png","buffer":buf.getvalue()
        })
        started=time.monotonic()
        await page.get_by_role("button",name="开始本地读取 / 识别").click()
        try:
          await page.wait_for_function("""()=>{
            const result=document.querySelector('.document-lab .document-result');
            const msg=document.querySelector('.document-lab p[aria-live="polite"]')?.textContent||'';
            return Boolean(result)||msg.includes('处理失败');
          }""",timeout=105000)
        except Exception:
          report["status"]="timeout_loading_model_or_ocr"
        else:
          raw=await page.locator(".document-lab .document-result").all_inner_texts()
          if raw:
            report["recognized_text"]=raw[0][:120]
            cleaned=" ".join(raw[0].upper().split())
            report["status"]="pass" if "HELLO" in cleaned and "WORLD" in cleaned and "2026" in cleaned else "recognition_mismatch"
          else:
            report["status"]="runtime_or_model_download_error"
            report["message"]=(await page.locator('.document-lab p[aria-live="polite"]').inner_text())[:180]
        report["elapsed_seconds"]=round(time.monotonic()-started,2)
        print("REAL OCR RESULT: "+json.dumps(report,ensure_ascii=False),flush=True)
      finally:
        await browser.close()
  finally:
    Path("portal-ocr-browser-result.json").write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n",encoding="utf8")
    server.shutdown();server.server_close()
  assert report["status"]=="pass",f"Tesseract OCR not yet accepted: {report['status']}"

if __name__=="__main__":
  asyncio.run(main())
