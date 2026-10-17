"""Real Chrome MV3 file-lab tab: local DOCX parse and English PNG OCR."""
import asyncio
import io
import json
import tempfile
import time
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
from playwright.async_api import async_playwright

ROOT=Path(__file__).resolve().parents[1]
PACKAGE=ROOT/"apps/wxt-ui/.output/chrome-mv3"

def ooxml_docx():
  out=io.BytesIO()
  with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as z:
    z.writestr('[Content_Types].xml','<?xml version="1.0" encoding="UTF-8"?>'+
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'+
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'+
      '<Default Extension="xml" ContentType="application/xml"/>'+
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
    z.writestr('_rels/.rels','<?xml version="1.0" encoding="UTF-8"?>'+
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
    z.writestr('word/document.xml','<?xml version="1.0" encoding="UTF-8"?>'+
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'+
      '<w:body><w:p><w:r><w:t>My finance DOCX document</w:t></w:r></w:p></w:body></w:document>')
  return out.getvalue()

def structured_docx():
  # A more representative OOXML document: mixed runs, a table, header, and
  # a separate image asset. Preserve the ZIP/package structure after translation.
  from base64 import b64decode
  out=io.BytesIO()
  with zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED) as z:
    z.writestr('[Content_Types].xml','<?xml version="1.0" encoding="UTF-8"?>'+
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'+
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'+
      '<Default Extension="xml" ContentType="application/xml"/>'+
      '<Default Extension="png" ContentType="image/png"/>'+
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'+
      '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/></Types>')
    z.writestr('_rels/.rels','<?xml version="1.0" encoding="UTF-8"?>'+
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
    z.writestr('word/_rels/document.xml.rels','<?xml version="1.0" encoding="UTF-8"?>'+
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/></Relationships>')
    z.writestr('word/document.xml','<?xml version="1.0" encoding="UTF-8"?>'+
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'+
      '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Bold financial </w:t></w:r>'+
      '<w:r><w:t>report overview</w:t></w:r></w:p>'+
      '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Annual income table value</w:t></w:r></w:p></w:tc></w:tr></w:tbl>'+
      '</w:body></w:document>')
    z.writestr('word/header1.xml','<?xml version="1.0" encoding="UTF-8"?>'+
      '<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'+
      '<w:p><w:r><w:t>Private finance header</w:t></w:r></w:p></w:hdr>')
    z.writestr('word/media/image1.png',b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAOaQSLQAAAAASUVORK5CYII='))
  return out.getvalue()

def pptx_fixture():
  o=io.BytesIO()
  with zipfile.ZipFile(o,'w',zipfile.ZIP_DEFLATED) as z:
    z.writestr('ppt/presentation.xml','<?xml version="1.0"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>')
    z.writestr('ppt/slides/slide1.xml','<?xml version="1.0"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Strategic planning presentation</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>')
    z.writestr('ppt/media/image1.png',b'unchanged-fixture-media')
  return o.getvalue()
def xlsx_fixture():
  o=io.BytesIO()
  with zipfile.ZipFile(o,'w',zipfile.ZIP_DEFLATED) as z:
    z.writestr('xl/workbook.xml','<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"/>')
    z.writestr('xl/sharedStrings.xml','<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>Income and investment</t></si></sst>')
    z.writestr('xl/worksheets/sheet1.xml','<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1"><f>1+2</f><v>3</v></c><c r="C1" t="inlineStr"><is><t>Forecast notes</t></is></c></row></sheetData></worksheet>')
  return o.getvalue()

async def main():
  report={"application":"installed WXT Chrome MV3 file-lab","docx":"not_run","ocr":"not_run"}
  with tempfile.TemporaryDirectory(prefix="wxt-doc-file-") as profile:
    async with async_playwright() as p:
      context=await p.chromium.launch_persistent_context(
        profile,channel="chromium",headless=True,
        args=[f"--disable-extensions-except={PACKAGE}",f"--load-extension={PACKAGE}",
              "--no-sandbox","--disable-dev-shm-usage"])
      try:
        sw=context.service_workers[0] if context.service_workers else await context.wait_for_event('serviceworker',timeout=30000)
        eid=sw.url.split('/')[2]
        page=await context.new_page()
        page.on("pageerror",lambda e:print("FILELAB PAGE ERROR:",str(e)[:300],flush=True))
        await page.goto(f'chrome-extension://{eid}/file-lab.html',wait_until='domcontentloaded',timeout=20000)
        await page.get_by_role('heading',name='文件与图片处理').wait_for(timeout=15000)
        await page.locator('.document-lab input[type="file"]').set_input_files({
          'name':'fixture.docx',
          'mimeType':'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'buffer':ooxml_docx()
        })
        await page.get_by_role('button',name='开始本地读取 / 识别').click()
        await page.locator('.document-result').get_by_text('My finance DOCX document').wait_for(timeout=15000)
        report['docx']='pass'
        print("WXT DOCUMENT LAB DOCX: PASS",flush=True)
        # Actual document translation MUST go through PIT's native provider,
        # not a client-side simulated translation function.
        options=await context.new_page()
        await options.goto(f'chrome-extension://{eid}/pit-options.html')
        await options.locator('form[data-ready="1"]').wait_for(timeout=15000)
        await options.locator('[name="standardProvider"]').select_option('microsoft')
        await options.locator('[name="microsoftKey"]').fill('file-fixture-only')
        await options.get_by_role('button',name='保存设置').click()
        await options.get_by_text('设置已保存。').wait_for(timeout=8000)
        await sw.evaluate("""()=>{
          const original=globalThis.fetch.bind(globalThis);
          globalThis.__fileDocxCalls=0;
          globalThis.fetch=async(input,opts)=>{
            const url=String(input?.url||input);
            if(url.startsWith('https://api.cognitive.microsofttranslator.com/')){
              globalThis.__fileDocxCalls++;
              const data=JSON.parse(opts.body);
              return new Response(JSON.stringify(data.map(x=>({
                translations:[{text:'译文:'+x.Text}]
              }))),{status:200,headers:{'content-type':'application/json'}});
            }
            return original(input,opts);
          };
        }""")
        async with page.expect_download(timeout=25000) as download_event:
          await page.get_by_role('button',name='翻译并导出 Office').click()
        download=await download_event.value
        assert download.suggested_filename=='fixture-translated.docx',download.suggested_filename
        output=await download.path()
        assert output
        with zipfile.ZipFile(output) as z:
          text=z.read('word/document.xml').decode('utf8')
          assert '译文:My finance DOCX document' in text,text[:500]
          assert '[Content_Types].xml' in z.namelist()
        report['docx_export']='pass'
        report['docx_provider_calls']=await sw.evaluate('()=>globalThis.__fileDocxCalls')
        assert report['docx_provider_calls']==1,report
        print('WXT DOCX TRANSLATION + DOWNLOAD: PASS',flush=True)
        source=structured_docx()
        await page.locator('.document-lab input[type="file"]').set_input_files({
          'name':'structured.docx',
          'mimeType':'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'buffer':source})
        async with page.expect_download(timeout=26000) as event:
          await page.get_by_role('button',name='翻译并导出 Office').click()
        structured_export=await (await event.value).path()
        with zipfile.ZipFile(io.BytesIO(source)) as origin,zipfile.ZipFile(structured_export) as output:
          assert origin.read('word/media/image1.png')==output.read('word/media/image1.png')
          assert origin.read('word/_rels/document.xml.rels')==output.read('word/_rels/document.xml.rels')
          xml=output.read('word/document.xml').decode('utf8')
          header=output.read('word/header1.xml').decode('utf8')
          ns={'w':'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
          doc=ET.fromstring(xml)
          paragraphs=doc.findall('.//w:p',ns)
          first_runs=paragraphs[0].findall('.//w:t',ns)
          assert len(first_runs)==2,xml[:450]
          assert all((node.text or '').strip() for node in first_runs),'Styled runs should not be discarded'
          assert ''.join(node.text or '' for node in first_runs)=='译文:Bold financial report overview'
          assert doc.find('.//w:b',ns) is not None,'Original bold property was lost'
          assert '译文:Annual income table value' in xml,xml[:400]
          assert '译文:Private finance header' in header,header[:400]
          assert '<w:tbl>' in xml
        report['docx_tables_header_media']='pass'
        print('WXT DOCX COMPLEX STRUCTURE: PASS (table/header/media preserved; inline run format caveat)',flush=True)
        for kind,label,fixture,xml_part,needle,media in [
          ('pptx','PPTX 演示文稿',pptx_fixture(),'ppt/slides/slide1.xml',
             '译文:Strategic planning presentation','ppt/media/image1.png'),
          ('xlsx','XLSX 表格',xlsx_fixture(),'xl/sharedStrings.xml',
             '译文:Income and investment',None)
        ]:
          await page.get_by_role('button',name=label).click()
          await page.locator('.document-lab input[type="file"]').set_input_files({
            'name':'fixture.'+kind,'mimeType':'application/octet-stream','buffer':fixture})
          await page.get_by_role('button',name='开始本地读取 / 识别').click()
          await page.locator('.document-result').wait_for(timeout=16000)
          async with page.expect_download(timeout=22000) as ev:
            await page.get_by_role('button',name='翻译并导出 Office').click()
          saved=await (await ev.value).path()
          with zipfile.ZipFile(io.BytesIO(fixture)) as original,zipfile.ZipFile(saved) as generated:
            assert needle in generated.read(xml_part).decode('utf8')
            if media:assert original.read(media)==generated.read(media)
            if kind=='xlsx':
              sheet=generated.read('xl/worksheets/sheet1.xml').decode('utf8')
              assert '译文:Forecast notes' in sheet
              assert '<f>1+2</f>' in sheet and '<v>3</v>' in sheet
          report[kind+'_translation_export']='pass'
          print('WXT '+kind.upper()+' TRANSLATION + STRUCTURE: PASS',flush=True)

        image_batch=Image.new('RGB',(950,170),'white')
        ImageDraw.Draw(image_batch).text((30,40),'HELLO WORLD 2026',
          font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',64),fill='black')
        image_data=io.BytesIO();image_batch.save(image_data,format='PNG')
        await page.locator('.batch-file-lab input[type="file"]').set_input_files([
          {'name':'batch.docx','mimeType':'application/octet-stream','buffer':ooxml_docx()},
          {'name':'batch.pptx','mimeType':'application/octet-stream','buffer':pptx_fixture()},
          {'name':'batch.xlsx','mimeType':'application/octet-stream','buffer':xlsx_fixture()},
          {'name':'batch.png','mimeType':'image/png','buffer':image_data.getvalue()}
        ])
        async with page.expect_download(timeout=105000) as batch_event:
          await page.get_by_role('button',name='翻译全部并打包 ZIP').click()
        bundle=await batch_event.value
        assert bundle.suggested_filename=='multimodal-translated-batch.zip'
        with zipfile.ZipFile(await bundle.path()) as pack:
          names=pack.namelist()
          assert len(names)==4,names
          for part,entry,expected in [
            ('translated/01-batch-translated.docx','word/document.xml','译文:My finance DOCX document'),
            ('translated/02-batch-translated.pptx','ppt/slides/slide1.xml','译文:Strategic planning presentation'),
            ('translated/03-batch-translated.xlsx','xl/sharedStrings.xml','译文:Income and investment')
          ]:
            with zipfile.ZipFile(io.BytesIO(pack.read(part))) as inner:
              assert expected in inner.read(entry).decode('utf8')
          with Image.open(io.BytesIO(pack.read('translated/04-batch-translated.png'))) as raster:
            assert raster.format=='PNG' and raster.width>image_batch.width
          report['office_batch_zip']='pass'
          report['image_batch_zip']='pass'
        print('WXT MIXED OFFICE BATCH ZIP: PASS',flush=True)
        await page.get_by_role("button",name="图片 OCR").click()
        image=Image.new('RGB',(920,170),'white')
        d=ImageDraw.Draw(image)
        font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',66)
        d.text((25,36),'HELLO WORLD 2026',font=font,fill='black')
        f=io.BytesIO();image.save(f,format='PNG')
        await page.locator('.document-lab input[type="file"]').set_input_files({
          'name':'fixture.png','mimeType':'image/png','buffer':f.getvalue()
        })
        started=time.monotonic()
        await page.get_by_role('button',name='开始本地读取 / 识别').click()
        await page.wait_for_function("""()=>{
          const msg=document.querySelector('.document-lab p[aria-live="polite"]')?.textContent||'';
          const content=document.querySelector('.document-result')?.textContent||'';
          return msg.includes('处理失败')||content.length>0;
        }""",timeout=90000)
        text=await page.locator('.document-result').all_inner_texts()
        if text and 'HELLO' in text[0].upper() and 'WORLD' in text[0].upper() and '2026' in text[0]:
          report['ocr']='pass'
        else:
          report['ocr']='failed'
          report['message']=(await page.locator('.document-lab p[aria-live="polite"]').inner_text())[:200]
        report['ocr_elapsed_seconds']=round(time.monotonic()-started,2)
        print("WXT DOCUMENT LAB RESULT: "+json.dumps(report,ensure_ascii=False),flush=True)
        assert report['ocr']=='pass',report
      finally:
        Path('wxt-file-lab-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n")
        await context.close()

if __name__=='__main__':
  asyncio.run(main())
