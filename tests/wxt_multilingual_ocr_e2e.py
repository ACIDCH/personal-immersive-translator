"""Read French, Chinese, Japanese and Korean fixture PNGs in installed Chrome MV3.

Real local Tesseract WASM, independently downloaded language data. Do not call
this a language-quality pass unless the recognized text passes each threshold.
"""
import asyncio,io,json,tempfile,time,unicodedata
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
from playwright.async_api import async_playwright

EXT=Path(__file__).resolve().parents[1]/'apps/wxt-ui/.output/chrome-mv3'
SAMPLES=[
  ('fra','BONJOUR PARIS ÉTÉ 2026','/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',49),
  ('chi_sim','中文翻译测试','/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',73),
  ('jpn','東京の学校','/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',72),
  ('kor','한국어 번역 테스트','/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',66),
]
def png(text,font_name,size):
  image=Image.new('RGB',(1200,170),'white')
  draw=ImageDraw.Draw(image)
  draw.text((40,40),text,font=ImageFont.truetype(font_name,size),fill='black')
  buf=io.BytesIO();image.save(buf,format='PNG');return buf.getvalue()

async def main():
  report={'runtime':'installed MV3 Tesseract local WASM','cases':[]}
  with tempfile.TemporaryDirectory(prefix='wxt-i18n-ocr-') as profile:
    async with async_playwright() as p:
      ctx=await p.chromium.launch_persistent_context(profile,channel='chromium',headless=True,
        args=[f'--disable-extensions-except={EXT}',f'--load-extension={EXT}',
              '--no-sandbox','--disable-dev-shm-usage'])
      try:
        sw=ctx.service_workers[0] if ctx.service_workers else await ctx.wait_for_event('serviceworker',timeout=30000)
        eid=sw.url.split('/')[2]
        page=await ctx.new_page()
        await page.goto(f'chrome-extension://{eid}/file-lab.html')
        await page.get_by_role('button',name='图片 OCR').click()
        for lang,original,font,fontsize in SAMPLES:
          result={'language':lang,'expected':original,'status':'pending'}
          t=time.monotonic()
          try:
            await page.locator('.document-lab').first.locator('select').select_option(lang)
            await page.locator('.document-lab').first.locator('input[type=file]').set_input_files({
              'name':'sample-'+lang+'.png','mimeType':'image/png',
              'buffer':png(original,font,fontsize)})
            await page.get_by_role('button',name='开始本地读取 / 识别').click()
            await page.wait_for_function("""()=>{
              const result=document.querySelector('.document-result')?.textContent||'';
              const error=document.querySelector('.document-lab p[aria-live="polite"]')?.textContent||'';
              return result.trim().length>0||error.includes('处理失败');
            }""",timeout=85000)
            recognized=' '.join((await page.locator('.document-result').all_inner_texts())).strip()
            normalized=unicodedata.normalize('NFKC',recognized).upper().replace(' ','').replace('\n','')
            result['recognized']=recognized[:100]
            if lang=='fra':
              result['status']='pass' if 'BONJOUR' in normalized and 'PARIS' in normalized and '2026' in normalized else 'recognition_mismatch'
            elif lang=='chi_sim':
              result['status']='pass' if '中文翻译测试' in normalized else 'recognition_mismatch'
            elif lang=='jpn':
              result['status']='pass' if '東京' in normalized and '学校' in normalized else 'recognition_mismatch'
            else:
              result['status']='pass' if '한국어' in normalized and '번역' in normalized and '테스트' in normalized else 'recognition_mismatch'
            if not recognized:
              result['status']='model_or_worker_error'
              result['error']=(await page.locator('p[aria-live=polite]').inner_text())[:180]
          except Exception as exc:
            result['status']='browser_or_language_download_error'
            result['error_class']=type(exc).__name__
          result['elapsed_seconds']=round(time.monotonic()-t,2)
          report['cases'].append(result)
          print('MULTILINGUAL OCR CASE:',json.dumps(result,ensure_ascii=False),flush=True)
          await page.get_by_role('button',name='DOCX 文档').click()
          await page.get_by_role('button',name='图片 OCR').click()
      finally:await ctx.close()
  Path('wxt-multilingual-ocr-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
  assert all(c['status']=='pass' for c in report['cases']),report

if __name__=='__main__':asyncio.run(main())
