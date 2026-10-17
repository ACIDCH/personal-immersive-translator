"""E2E installed WXT: native video cues, local OCR -> real bilingual PNG,
and PDF.js first-page viewer. Provider response alone is a deliberate stub.
"""
import asyncio,io,json,tempfile,time
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
from playwright.async_api import async_playwright

EXT=Path(__file__).resolve().parents[1]/'apps/wxt-ui/.output/chrome-mv3'
VIDEO_URL='https://example.org/pit-video-fixture'
def pdf_fixture():
  # A genuine 1-page PDF file with correct xref and Helvetica text.
  stream=b'BT /F1 16 Tf 80 715 Td (Academic PDF Preview 2026) Tj ET\n'
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
        await options.locator('[name="standardProvider"]').select_option('microsoft')
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
        }""")
        popup=await ctx.new_page()
        await popup.goto(f'chrome-extension://{eid}/popup.html')
        await popup.get_by_role('button',name='翻译视频字幕').wait_for(timeout=10000)
        await video.bring_to_front()
        await popup.get_by_role('button',name='翻译视频字幕').click()
        await video.locator('.pit-caption-translated').get_by_text('译文:',exact=False).wait_for(timeout=22000)
        report['video_cues']='pass'
        await popup.get_by_role('button',name='停止字幕翻译').click()
        await video.locator('.pit-caption-overlay').wait_for(state='detached',timeout=10000)
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
        await filepage.locator('input[type=file]').set_input_files({
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

        tools=await ctx.new_page()
        await tools.goto(f'chrome-extension://{eid}/pit-tools.html')
        await tools.get_by_role('heading',name='文件与图片翻译').wait_for(timeout=12000)
        await tools.locator('#pdf').set_input_files({
          'name':'onepage.pdf','mimeType':'application/pdf','buffer':pdf_fixture()})
        await tools.locator('#pdfPreviewStatus').get_by_text('抽查',exact=False).wait_for(timeout=28000)
        assert await tools.locator('#pdfPreview canvas').count()==1
        report['pdfjs_preview']='pass'
        report['mock_translation_requests']=await sw.evaluate('()=>globalThis.__videoImageCalls')
        assert report['mock_translation_requests']>=2
        print('WXT REAL PDF.JS READER: PASS',flush=True)
      finally:
        Path('wxt-video-image-pdf-e2e-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
        await ctx.close()
  assert all(report[x]=='pass' for x in ['video_cues','video_stop','ocr_translation_png','pdfjs_preview']),report

if __name__=='__main__':asyncio.run(main())
