"""E2E installed WXT: native video cues, local OCR -> real bilingual PNG,
and PDF.js first-page viewer. Provider response alone is a deliberate stub.
"""
import asyncio,io,json,tempfile,time,base64
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
from playwright.async_api import async_playwright

EXT=Path(__file__).resolve().parents[1]/'apps/wxt-ui/.output/chrome-mv3'
VIDEO_URL='https://example.org/pit-video-fixture'
def pdf_fixture():
  # A genuine 1-page PDF file with correct xref and Helvetica text.
  stream=b'BT /F1 16 Tf 80 715 Td (Academic PDF Preview 2026 with selectable original text and multiple course finance concepts) Tj ET\n'
  objs=[
    b'<< /Type /Catalog /Pages 2 0 R >>',
    b'<< /Type /Pages /Count 1 /Kids [3 0 R] >>',
    b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    b'<< /Length '+str(len(stream)).encode()+b' >>\nstream\n'+stream+b'endstream',
    b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ]
  pdf=bytearray(b'%PDF-1.4\n')
  offsets=[0]
  for i,obj in enumerate(objs,1):
    offsets.append(len(pdf))
    pdf.extend(f'{i} 0 obj\n'.encode()+obj+b'\nendobj\n')
  start=len(pdf)
  pdf.extend(f'xref\n0 {len(offsets)}\n0000000000 65535 f \n'.encode())
  for pos in offsets[1:]:pdf.extend(f'{pos:010} 00000 n \n'.encode())
  pdf.extend(f'trailer\n<< /Size {len(offsets)} /Root 1 0 R >>\nstartxref\n{start}\n%%EOF\n'.encode())
  return bytes(pdf)


def scanned_pdf_fixture():
  # Build a real PDF image XObject and xref: it has NO extractable text.
  # The WXT scanner must actually render its pixels and call Tesseract.
  picture=Image.new('RGB',(1100,600),'white')
  draw=ImageDraw.Draw(picture)
  font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',66)
  draw.text((40,220),'HELLO WORLD 2026',font=font,fill='black')
  jpg=io.BytesIO();picture.save(jpg,format='JPEG',quality=95)
  pixels=jpg.getvalue()
  stream=b'q 612 0 0 792 0 0 cm /Img Do Q\n'
  objects=[
    b'<< /Type /Catalog /Pages 2 0 R >>',
    b'<< /Type /Pages /Count 1 /Kids [3 0 R] >>',
    b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /XObject << /Img 5 0 R >> >> >>',
    b'<< /Length '+str(len(stream)).encode()+b' >>\nstream\n'+stream+b'endstream',
    b'<< /Type /XObject /Subtype /Image /Width 1100 /Height 600 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length '+
      str(len(pixels)).encode()+b' >>\nstream\n'+pixels+b'\nendstream'
  ]
  buffer=bytearray(b'%PDF-1.4\n')
  offsets=[0]
  for i,obj in enumerate(objects,1):
    offsets.append(len(buffer))
    buffer.extend(f'{i} 0 obj\n'.encode()+obj+b'\nendobj\n')
  start=len(buffer)
  buffer.extend(f'xref\n0 {len(offsets)}\n0000000000 65535 f \n'.encode())
  for offset in offsets[1:]:
    buffer.extend(f'{offset:010} 00000 n \n'.encode())
  buffer.extend(f'trailer\n<< /Size {len(offsets)} /Root 1 0 R >>\nstartxref\n{start}\n%%EOF\n'.encode())
  return bytes(buffer)

async def main():
  report={'runtime':'actual installed Chrome MV3 WXT','video_cues':'not_run',
    'video_stop':'not_run','ocr_translation_png':'not_run','pdfjs_preview':'not_run'}
  with tempfile.TemporaryDirectory(prefix='wxt-media-') as profile:
    async with async_playwright() as p:
      ctx=await p.chromium.launch_persistent_context(profile,channel='chromium',headless=True,
        args=[f'--disable-extensions-except={EXT}',f'--load-extension={EXT}',
              '--no-sandbox','--disable-dev-shm-usage'],accept_downloads=True)
      try:
        sw=ctx.service_workers[0] if ctx.service_workers else await ctx.wait_for_event('serviceworker',timeout=30000)
        eid=sw.url.split('/')[2]
        await sw.evaluate("""()=>{
          const orig=globalThis.fetch.bind(globalThis);
          globalThis.__videoImageCalls=0;
          globalThis.fetch=async(input,opts)=>{
            const url=String(input?.url||input);
            if(url.startsWith('https://api.cognitive.microsofttranslator.com/')){
              globalThis.__videoImageCalls++;
              const texts=JSON.parse(opts.body);
              return new Response(JSON.stringify(texts.map(x=>({translations:[{text:'译文:'+x.Text}]}))),
                {status:200,headers:{'content-type':'application/json'}});
            }
            return orig(input,opts);
          };
        }""")
        options=await ctx.new_page()
        await options.goto(f'chrome-extension://{eid}/pit-options.html')
        await options.locator('form[data-ready="1"]').wait_for(timeout=15000)
        await options.locator('.options-nav a[href="#baseSettings"]').click()
        await options.locator('[name="standardProvider"]').select_option('microsoft')
        await options.locator('.options-nav a[href="#standardKeys"]').click()
        await options.locator('[name="microsoftKey"]').fill('fixture-test-token')
        await options.get_by_role('button',name='保存设置').click()
        await options.get_by_text('设置已保存。').wait_for(timeout=8000)
        async def video_fixture(route):
          await route.fulfill(status=200,content_type='text/html',body='''<!doctype html>
<html lang="en"><body><main><video id="lecture" width="640" height="360" controls></video>
<div>Academic video captions test, only native TextTracks are observed.</div></main></body></html>''')
        await ctx.route(VIDEO_URL,video_fixture)
        video=await ctx.new_page()
        await video.goto(VIDEO_URL,wait_until='domcontentloaded')
        await video.evaluate("""()=>{
          const v=document.getElementById('lecture');
          const track=v.addTextTrack('subtitles','English','en');
          track.mode='showing';
          track.addCue(new VTTCue(0,30,'Hello world from the lecture video'));
          track.addCue(new VTTCue(0,30,'A second overlapping lecture subtitle'));
        }""")
        popup=await ctx.new_page()
        await popup.goto(f'chrome-extension://{eid}/popup.html')
        await popup.get_by_role('button',name='视频字幕',exact=True).click()
        await popup.get_by_role('button',name='翻译视频字幕').wait_for(timeout=10000)
        await video.bring_to_front()
        await popup.get_by_role('button',name='翻译视频字幕').click()
        # PIT's default mode changes native VTTCue.text inside the player.
        # An external overlay is deliberately hidden after both native cues
        # are translated; checking .pit-caption-translated was a V1 false
        # negative and did not prove the required in-player replacement.
        expected=[
          '译文:Hello world from the lecture video',
          '译文:A second overlapping lecture subtitle'
        ]
        await video.wait_for_function("""expected=>{
          const track=document.getElementById('lecture')?.textTracks?.[0];
          const cues=track?.cues?[...track.cues]:[];
          return cues.length===expected.length &&
            cues.every((cue,i)=>cue.text===expected[i]);
        }""",arg=expected,timeout=22000)
        native=await video.evaluate("""()=>{
          const video=document.getElementById('lecture');
          const overlay=document.querySelector('.pit-caption-overlay');
          return {
            mode:video.textTracks[0].mode,
            lines:[...video.textTracks[0].cues].map(c=>c.text),
            overlayVisible:Boolean(overlay && getComputedStyle(overlay).display!=='none')
          };
        }""")
        assert native['lines']==expected,native
        assert native['mode']=='showing',native
        assert native['overlayVisible'] is False,(
          'Native replacement must not display a second external overlay:',native)
        report['video_cues']='pass'
        await popup.get_by_role('button',name='停止字幕翻译').click()
        await video.locator('.pit-caption-overlay').wait_for(state='detached',timeout=10000)
        restored=await video.evaluate("""()=>{
          const v=document.getElementById('lecture');
          return {mode:v.textTracks[0].mode,
            lines:[...v.textTracks[0].cues].map(c=>c.text)};
        }""")
        assert restored['mode']=='showing',restored
        assert restored['lines']==[
          'Hello world from the lecture video',
          'A second overlapping lecture subtitle'
        ],restored
        report['video_stop']='pass'
        print('WXT NATIVE VIDEO CAPTIONS AND STOP: PASS',flush=True)

        filepage=await ctx.new_page()
        await filepage.goto(f'chrome-extension://{eid}/file-lab.html')
        await filepage.get_by_role('button',name='图片 OCR').click()
        pic=Image.new('RGB',(950,170),'white')
        d=ImageDraw.Draw(pic)
        font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',64)
        d.text((30,36),'HELLO WORLD 2026',font=font,fill='black')
        data=io.BytesIO();pic.save(data,format='PNG')
        await filepage.locator('.document-lab').first.locator('input[type=file]').set_input_files({
          'name':'image-fixture.png','mimeType':'image/png','buffer':data.getvalue()})
        await filepage.get_by_role('button',name='开始本地读取 / 识别').click()
        await filepage.locator('.document-result').get_by_text('HELLO WORLD 2026',exact=False).wait_for(timeout=95000)
        async with filepage.expect_download(timeout=28000) as download:
          await filepage.get_by_role('button',name='翻译识别文本并导出 PNG').click()
        artifact=await download.value
        assert artifact.suggested_filename=='image-fixture-bilingual.png'
        path=await artifact.path()
        with Image.open(path) as result:
          assert result.format=='PNG'
          assert result.width>pic.width
        report['ocr_translation_png']='pass'
        print('WXT IMAGE OCR + PROVIDER + BILINGUAL PNG DOWNLOAD: PASS',flush=True)
        # New spatial translation: local OCR coordinate boxes + flat-background
        # replacement. Check pixel geometry, not only download existence.
        await filepage.get_by_role('button',name='原位覆盖（纯色背景）').click()
        async with filepage.expect_download(timeout=24000) as inline_event:
          await filepage.get_by_role('button',name='翻译识别文本并导出 PNG').click()
        inline=await inline_event.value
        assert inline.suggested_filename=='image-fixture-overlay.png'
        inline_path=await inline.path()
        with Image.open(inline_path) as overlay:
          assert overlay.format=='PNG'
          assert overlay.size==pic.size
          assert overlay.convert('RGB').getpixel((3,3))==pic.getpixel((3,3))
          # The recognized line rectangle was changed; no layout expansion.
          assert overlay.convert('RGB').tobytes()!=pic.tobytes()
        report['ocr_original_position_png']='pass'
        print('WXT IN-PLACE OCR TRANSLATION EXPORT: PASS',flush=True)

        # One-time screenshot hand-off between WXT popup and local OCR page.
        # This validates the transfer path without depending on flaky
        # headless desktop capture behavior or retaining a screenshot.
        encoded='data:image/png;base64,'+base64.b64encode(data.getvalue()).decode()
        await popup.evaluate('(img)=>chrome.storage.session.set({pit_ocr_screenshot:img})',encoded)
        screenshot=await ctx.new_page()
        await screenshot.goto(f'chrome-extension://{eid}/file-lab.html')
        await screenshot.get_by_text('已载入当前网页的可见区域截图',exact=False).wait_for(timeout=12000)
        assert await screenshot.get_by_role('button',name='图片 OCR').get_attribute('aria-pressed')=='true'
        assert not (await popup.evaluate(
          '()=>chrome.storage.session.get("pit_ocr_screenshot")')).get('pit_ocr_screenshot')
        report['screenshot_local_relay']='pass'
        await screenshot.close()
        print('WXT ONE-TIME SCREENSHOT -> LOCAL OCR RELAY: PASS',flush=True)

        tools=await ctx.new_page()
        await tools.goto(f'chrome-extension://{eid}/pit-tools.html')
        await tools.get_by_role('heading',name='文件与图片翻译').wait_for(timeout=12000)
        await tools.locator('#pdf').set_input_files({
          'name':'onepage.pdf','mimeType':'application/pdf','buffer':pdf_fixture()})
        await tools.locator('#pdfPreviewStatus').get_by_text('抽查',exact=False).wait_for(timeout=28000)
        assert await tools.locator('#pdfPreview canvas').count()==1
        report['pdfjs_preview']='pass'

        # Actual WXT scanned PDF OCR -> provider -> raster bilingual PDF, then
        # reopen the downloaded PDF with the extension's pinned PDF.js.
        file_laboratory=await ctx.new_page()
        await file_laboratory.goto(f'chrome-extension://{eid}/file-lab.html')
        await file_laboratory.locator('.pit-workbench-nav a[href="#pdf-bilingual-lab"]').click()
        pdf_input=file_laboratory.locator('.pdf-bilingual-lab input[type=file]')
        for kind,raw_pdf in [('digital',pdf_fixture()),('scanned',scanned_pdf_fixture())]:
          await pdf_input.set_input_files({
            'name':kind+'.pdf','mimeType':'application/pdf','buffer':raw_pdf
          })
          async with file_laboratory.expect_download(timeout=95000) as exported:
            await file_laboratory.get_by_role('button',name='翻译并导出双语 PDF').click()
          download=await exported.value
          assert download.suggested_filename==kind+'-bilingual.pdf'
          output=Path(await download.path()).read_bytes()
          assert output.startswith(b'%PDF-')
          assert len(output)>900
          decoded=base64.b64encode(output).decode()
          result=await file_laboratory.evaluate("""async(value)=>{
            const raw=atob(value);
            const data=new Uint8Array(raw.length);
            for(let i=0;i<raw.length;i++)data[i]=raw.charCodeAt(i);
            const pdfjs=await import(chrome.runtime.getURL('vendor/pdf.mjs'));
            pdfjs.GlobalWorkerOptions.workerSrc=chrome.runtime.getURL('vendor/pdf.worker.mjs');
            const task=pdfjs.getDocument({data,isEvalSupported:false});
            try{
              const pdfDoc=await task.promise;
              const page=await pdfDoc.getPage(1);
              const viewport=page.getViewport({scale:0.25});
              const canvas=document.createElement('canvas');
              canvas.width=Math.ceil(viewport.width);
              canvas.height=Math.ceil(viewport.height);
              await page.render({canvas,canvasContext:canvas.getContext('2d'),viewport}).promise;
              return {pages:pdfDoc.numPages,width:canvas.width,height:canvas.height};
            }finally{await task.destroy();}
          }""",decoded)
          assert result['pages']==1 and result['width']>200 and result['height']>100,result
          notice=await file_laboratory.locator('.pdf-bilingual-lab p[aria-live=polite]').inner_text()
          if kind=='digital':assert 'OCR 0 页' in notice,notice
          else:assert 'OCR 1 页' in notice,notice
          report['pdf_'+kind+'_translation']='pass'
          print('WXT '+kind.upper()+' PDF OCR/TRANSLATION/REOPEN: PASS',flush=True)
        await file_laboratory.close()
        report['mock_translation_requests']=await sw.evaluate('()=>globalThis.__videoImageCalls')
        assert report['mock_translation_requests']>=2
        print('WXT REAL PDF.JS READER: PASS',flush=True)
      finally:
        Path('wxt-video-image-pdf-e2e-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
        await ctx.close()
  assert all(report[x]=='pass' for x in ['video_cues','video_stop','ocr_translation_png','pdfjs_preview']),report

if __name__=='__main__':asyncio.run(main())
