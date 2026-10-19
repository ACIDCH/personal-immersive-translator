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
from wxt_video_image_pdf_e2e import pdf_fixture

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
    z.writestr('ppt/slides/slide2.xml','<?xml version="1.0"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:rPr b="1"/><a:t>Bold strategy </a:t></a:r><a:r><a:t>forecast</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>')
    z.writestr('ppt/media/image1.png',b'unchanged-fixture-media')
  return o.getvalue()
def xlsx_fixture():
  o=io.BytesIO()
  with zipfile.ZipFile(o,'w',zipfile.ZIP_DEFLATED) as z:
    z.writestr('xl/workbook.xml','<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"/>')
    z.writestr('xl/sharedStrings.xml','<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>Income and investment</t></si></sst>')
    z.writestr('xl/worksheets/sheet1.xml','<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1"><f>1+2</f><v>3</v></c><c r="C1" t="inlineStr"><is><t>Forecast notes</t></is></c></row></sheetData></worksheet>')
  return o.getvalue()


def epub_fixture():
  out=io.BytesIO()
  with zipfile.ZipFile(out,'w') as z:
    z.writestr(zipfile.ZipInfo('mimetype'),b'application/epub+zip',
               compress_type=zipfile.ZIP_STORED)
    z.writestr('META-INF/container.xml',
      '<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">'+
      '<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>'+
      '</rootfiles></container>')
    z.writestr('OEBPS/content.opf',
      '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">'+
      '<manifest><item id="chapter" href="Text/ch1.xhtml" media-type="application/xhtml+xml"/>'+
      '<item id="img" href="Images/art.png" media-type="image/png"/></manifest>'+
      '<spine><itemref idref="chapter"/></spine></package>')
    z.writestr('OEBPS/Text/ch1.xhtml',
      '<?xml version="1.0" encoding="UTF-8"?>'+
      '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Finance book</title></head>'+
      '<body><h1>Market outlook</h1><p>Economics <strong>in context</strong></p>'+
      '<p><code>const total = 3;</code> Next sentence</p>'+
      '<img src="../Images/art.png" alt="figure"/></body></html>')
    z.writestr('OEBPS/Images/art.png',b'epub-original-picture-bytes')
  return out.getvalue()

def long_pdf_fixture(pages=13):
  """Real multi-page PDF bytes with valid cross-reference, no OCR required."""
  stream=b'BT /F1 14 Tf 48 710 Td (Financial markets and network capacity economics lecture report sample) Tj ET\n'
  objects=[
    b'<< /Type /Catalog /Pages 2 0 R >>',
    b'<< /Type /Pages /Count '+str(pages).encode()+b' /Kids ['+
      b' '.join(f'{4+2*i} 0 R'.encode() for i in range(pages))+b'] >>',
    b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ]
  for i in range(pages):
    number=5+2*i
    objects.append(b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] '+
      b'/Resources << /Font << /F1 3 0 R >> >> /Contents '+str(number).encode()+b' 0 R >>')
    objects.append(b'<< /Length '+str(len(stream)).encode()+b' >>\nstream\n'+stream+b'endstream')
  out=bytearray(b'%PDF-1.4\n')
  offsets=[0]
  for idx,obj in enumerate(objects,1):
    offsets.append(len(out))
    out.extend(f'{idx} 0 obj\n'.encode()+obj+b'\nendobj\n')
  start=len(out)
  out.extend(f'xref\n0 {len(offsets)}\n0000000000 65535 f \n'.encode())
  for offset in offsets[1:]:out.extend(f'{offset:010} 00000 n \n'.encode())
  out.extend(f'trailer\n<< /Size {len(offsets)} /Root 1 0 R >>\nstartxref\n{start}\n%%EOF\n'.encode())
  return bytes(out)

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
        await page.locator('.document-lab').first.locator('input[type="file"]').set_input_files({
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
          globalThis.__fileRequestLengths=[];
          globalThis.__simulateOne429=false;
          globalThis.__delayNextFetch=false;
          globalThis.fetch=async(input,opts)=>{
            const url=String(input?.url||input);
            if(url.startsWith('https://api.cognitive.microsofttranslator.com/')){
              globalThis.__fileDocxCalls++;
              const data=JSON.parse(opts.body);
              globalThis.__fileRequestLengths.push(data.length);
              if(globalThis.__delayNextFetch){
                globalThis.__delayNextFetch=false;
                await new Promise(resolve=>setTimeout(resolve,3200));
              }
              if(globalThis.__simulateOne429){
                globalThis.__simulateOne429=false;
                return new Response('rate limit',{status:429,headers:{'content-type':'text/plain'}});
              }
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
        await page.locator('.document-lab').first.locator('input[type="file"]').set_input_files({
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
          await page.locator('.document-lab').first.locator('input[type="file"]').set_input_files({
            'name':'fixture.'+kind,'mimeType':'application/octet-stream','buffer':fixture})
          await page.get_by_role('button',name='开始本地读取 / 识别').click()
          await page.locator('.document-result').wait_for(timeout=16000)
          async with page.expect_download(timeout=22000) as ev:
            await page.get_by_role('button',name='翻译并导出 Office').click()
          saved=await (await ev.value).path()
          with zipfile.ZipFile(io.BytesIO(fixture)) as original,zipfile.ZipFile(saved) as generated:
            assert needle in generated.read(xml_part).decode('utf8')
            if media:assert original.read(media)==generated.read(media)
            if kind=='pptx':
              root=ET.fromstring(generated.read('ppt/slides/slide2.xml'))
              ns_a={'a':'http://schemas.openxmlformats.org/drawingml/2006/main'}
              spans=root.findall('.//a:t',ns_a)
              assert len(spans)==2 and all(node.text for node in spans)
              assert ''.join(node.text for node in spans)=='译文:Bold strategy forecast'
              assert root.find('.//a:rPr',ns_a) is not None
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
          names=[name for name in pack.namelist() if not name.endswith('/')]
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

        # Actual installed MV3 batch translator, real OOXML/EPUB ZIP serialization
        # and mocked provider transport: not vendor accuracy or reader typography.
        await page.locator('.batch-file-lab input[type=file]').set_input_files([
          {'name':'book.epub','mimeType':'application/epub+zip','buffer':epub_fixture()},
          {'name':'note.txt','mimeType':'text/plain','buffer':b'Plain document line\r\nSecond line'},
          {'name':'chapter.md','mimeType':'text/markdown','buffer':(
            b'# Finance chapter\n\n- Investment overview\n'+
            b'**Market** trends and [External link](https://example.org) with `fixed-code`.\n'+
            b'```python\nprint("stay")\n```\n')},
          {'name':'story.html','mimeType':'text/html','buffer':(
            b'<!DOCTYPE html><html><body><p>HTML greeting <strong>business reader</strong></p>'+
            b'<script>originalCode()</script></body></html>')},
          {'name':'long.txt','mimeType':'text/plain',
           'buffer':('Long economics paragraph. '*240).encode('utf8')}
        ])
        async with page.expect_download(timeout=55000) as portable_event:
          await page.get_by_role('button',name='翻译全部并打包 ZIP').click()
        with zipfile.ZipFile(await (await portable_event.value).path()) as package:
          names={name for name in package.namelist() if not name.endswith('/')}
          assert len(names)==5,names
          with zipfile.ZipFile(io.BytesIO(package.read('translated/01-book-translated.epub'))) as book:
            assert book.namelist()[0]=='mimetype',book.namelist()
            assert book.getinfo('mimetype').compress_type==zipfile.ZIP_STORED
            assert book.read('mimetype')==b'application/epub+zip'
            assert book.read('OEBPS/Images/art.png')==b'epub-original-picture-bytes'
            assert b'chapter' in book.read('OEBPS/content.opf')
            root=ET.fromstring(book.read('OEBPS/Text/ch1.xhtml'))
            ns={'h':'http://www.w3.org/1999/xhtml'}
            heading=root.find('.//h:h1',ns)
            paragraph=root.find('.//h:p',ns)
            assert ''.join(heading.itertext())=='译文:Market outlook'
            assert ''.join(paragraph.itertext())=='译文:Economics in context'
            assert paragraph.find('.//h:strong',ns) is not None
            assert 'const total = 3;' in ''.join(root.itertext())
          txt=package.read('translated/02-note-translated.txt').decode('utf8')
          assert txt=='译文:Plain document line\r\n译文:Second line',repr(txt)
          markdown=package.read('translated/03-chapter-translated.md').decode('utf8')
          assert '# 译文:Finance chapter' in markdown,markdown
          assert '- 译文:Investment overview' in markdown,markdown
          assert 'print("stay")' in markdown
          assert '](https://example.org)' in markdown and '**' in markdown
          assert '`fixed-code`' in markdown
          long_line=package.read('translated/05-long-translated.txt').decode('utf8')
          assert long_line.count('译文:')>=2 and 'Long economics paragraph' in long_line
          html=package.read('translated/04-story-translated.html').decode('utf8')
          assert '译文:HTML greeting business reader' in ''.join(ET.fromstring(
            html[html.index('<html'):]).itertext())
          assert '<strong>' in html and 'originalCode()' in html
        report['epub_html_markdown_txt_batch']='pass'
        print('WXT EPUB/TXT/MD/HTML STRUCTURE + ZIP BATCH: PASS',flush=True)


        # The same multi-file picker must accept both a genuine extractable
        # PDF and an ordinary TXT in one atomic ZIP, without requiring a
        # separate PDF-only upload step.
        await page.locator('.batch-file-lab input[type=file]').set_input_files([
          {'name':'finance.pdf','mimeType':'application/pdf','buffer':pdf_fixture()},
          {'name':'notes.txt','mimeType':'text/plain','buffer':b'One more financial note'}
        ])
        async with page.expect_download(timeout=85000) as mixed_pdf_event:
          await page.get_by_role('button',name='翻译全部并打包 ZIP').click()
        with zipfile.ZipFile(await (await mixed_pdf_event.value).path()) as bundle:
          entries={name for name in bundle.namelist() if not name.endswith('/')}
          assert len(entries)==2,entries
          bilingual=bundle.read('translated/01-finance-translated.pdf')
          assert bilingual.startswith(b'%PDF-') and len(bilingual)>1500
          translated=bundle.read('translated/02-notes-translated.txt').decode('utf8')
          assert translated=='译文:One more financial note',translated
        report['mixed_pdf_and_text_zip']='pass'
        print('WXT MIXED PDF+TXT BILINGUAL ZIP: PASS',flush=True)

        # 13-page input must no longer fail at the former hard-coded 8-page
        # limit. It is divided into 12+1-page documents inside nested ZIP.
        # Also test UTF-16LE with BOM and original CRLF preservation.
        await page.locator('.batch-file-lab input[type=file]').set_input_files([
          {'name':'long-finance.pdf','mimeType':'application/pdf',
           'buffer':long_pdf_fixture(13)},
          {'name':'utf16-notes.txt','mimeType':'text/plain',
           'buffer':'Revenue forecast\r\nInvestment returns'.encode('utf-16')}
        ])
        async with page.expect_download(timeout=180000) as large_event:
          await page.get_by_role('button',name='翻译全部并打包 ZIP').click()
        with zipfile.ZipFile(await (await large_event.value).path()) as bundle:
          inner=bundle.read('translated/01-long-finance-translated.zip')
          with zipfile.ZipFile(io.BytesIO(inner)) as parts:
            names=[name for name in parts.namelist() if name.endswith('.pdf')]
            assert len(names)==2,names
            assert all(parts.read(name).startswith(b'%PDF-') for name in names)
          utf16=bundle.read('translated/02-utf16-notes-translated.txt')
          assert utf16[:2]==b'\xff\xfe',utf16[:2]
          assert utf16.decode('utf-16')=='译文:Revenue forecast\r\n译文:Investment returns'
        report['pdf_13_pages_and_utf16_bom']='pass'
        print('WXT 13-PAGE PDF PARTS + UTF-16 BOM CRLF: PASS',flush=True)

        # Browser drag/drop must use the identical MIME/size validator and
        # translation pipeline as the multiple-select file picker.
        await page.locator('.batch-file-lab .document-drop').evaluate("""root=>{
          const data=new DataTransfer();
          data.items.add(new File(['Drag and drop economics'], 'dragged.txt',
            {type:'text/plain'}));
          root.dispatchEvent(new DragEvent('drop',{
            bubbles:true,cancelable:true,dataTransfer:data
          }));
        }""")
        await page.locator('.batch-file-lab').get_by_text('已选择 1 个文件').wait_for(timeout=8000)
        async with page.expect_download(timeout=20000) as drag_event:
          await page.get_by_role('button',name='翻译全部并打包 ZIP').click()
        with zipfile.ZipFile(await (await drag_event.value).path()) as archive:
          translation=archive.read('translated/01-dragged-translated.txt').decode('utf8')
          assert translation=='译文:Drag and drop economics',translation
        report['drag_drop_file_translation']='pass'
        print('WXT REAL DROP EVENT AND TRANSLATED TXT ZIP: PASS',flush=True)

        await page.locator('.subtitle-file-lab input[type="file"]').set_input_files({
          'name':'lecture.vtt','mimeType':'text/vtt',
          'buffer':b'WEBVTT\n\n00:00:01.000 --> 00:00:04.000\nHello world\n\n00:00:04.500 --> 00:00:08.000\nFinancial models\n'
        })
        async with page.expect_download(timeout=20000) as subtitle_event:
          await page.get_by_role('button',name='翻译并导出双语 SRT').click()
        subtitle_download=await subtitle_event.value
        assert subtitle_download.suggested_filename=='lecture-bilingual.srt'
        translated_text=Path(await subtitle_download.path()).read_text(encoding='utf8')
        assert '00:00:01,000 --> 00:00:04,000' in translated_text
        assert 'Hello world\n译文:Hello world' in translated_text
        assert '00:00:04,500 --> 00:00:08,000' in translated_text
        assert 'Financial models\n译文:Financial models' in translated_text
        # WebVTT metadata and timestamp settings are not translatable cues.
        await page.locator('.subtitle-file-lab input[type="file"]').set_input_files({
          'name':'styled.vtt','mimeType':'text/vtt',
          'buffer':b'WEBVTT - Finance seminar\n\nNOTE speaker metadata\nnot a cue\n\nSTYLE\n::cue { color: red; }\n\nlecture-1\n00:00:01.200 --> 00:00:03.400 align:start position:10%\nHello <b>students</b>\n\n00:01:62.000 --> 00:01:65.000\ninvalid time\n'
        })
        async with page.expect_download(timeout=20000) as styled_event:
          await page.get_by_role('button',name='翻译并导出双语 SRT').click()
        styled=Path(await (await styled_event.value).path()).read_text(encoding='utf8')
        assert '00:00:01,200 --> 00:00:03,400' in styled,styled
        assert 'Hello students\n译文:Hello students' in styled,styled
        assert 'STYLE' not in styled and 'NOTE' not in styled and 'invalid time' not in styled,styled
        # ASS dialogue styles do not appear in the bilingual SRT; timecodes,
        # visible text and commas must survive through the installed MV3 UI.
        ass=('[Script Info]\nTitle: Finance seminar\n\n[Events]\n'+
             'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n'+
             r'Dialogue: 0,0:00:01.25,0:00:03.50,Default,,0,0,0,,{\i1}Bonjour, world\Nnext line'+'\n')
        await page.locator('.subtitle-file-lab input[type="file"]').set_input_files({
          'name':'seminar.ass','mimeType':'text/plain','buffer':ass.encode('utf8')
        })
        async with page.expect_download(timeout=20000) as ass_event:
          await page.get_by_role('button',name='翻译并导出双语 SRT').click()
        ass_result=Path(await (await ass_event.value).path()).read_text(encoding='utf8')
        assert '00:00:01,250 --> 00:00:03,500' in ass_result,ass_result
        assert 'Bonjour, world\nnext line' in ass_result,ass_result
        assert '译文:Bonjour, world' in ass_result,ass_result
        assert 'Default' not in ass_result and '{\\i1}' not in ass_result,ass_result
        report['ass_subtitle_import']='pass'
        report['subtitle_metadata_filter']='pass'
        report['offline_subtitle_translation']='pass'
        print('WXT OFFLINE VTT TO BILINGUAL SRT: PASS',flush=True)

        # A legitimate HTTP 429 should retry, but identical paragraph text
        # must only consume one provider input even when it appears twice.
        original=ooxml_docx()
        repeat=io.BytesIO()
        with zipfile.ZipFile(io.BytesIO(original)) as source,zipfile.ZipFile(repeat,'w',zipfile.ZIP_DEFLATED) as output:
          for name in source.namelist():
            contents=source.read(name)
            if name=='word/document.xml':
              contents=contents.replace(
                b'<w:t>My finance DOCX document</w:t>',
                b'<w:t>Repeated finance sentence</w:t></w:r></w:p><w:p><w:r><w:t>Repeated finance sentence</w:t>'
              )
            output.writestr(name,contents)
        await page.get_by_role('button',name='DOCX 文档').click()
        await page.locator('.document-lab').first.locator('input[type=file]').set_input_files({
          'name':'repeated.docx','mimeType':'application/octet-stream','buffer':repeat.getvalue()
        })
        previous=await sw.evaluate('()=>globalThis.__fileDocxCalls')
        await sw.evaluate('()=>{globalThis.__simulateOne429=true;globalThis.__fileRequestLengths=[]}')
        async with page.expect_download(timeout=30000) as event:
          await page.get_by_role('button',name='翻译并导出 Office').click()
        download=await event.value
        with zipfile.ZipFile(await download.path()) as o:
          xml=o.read('word/document.xml').decode('utf8')
          assert xml.count('译文:Repeated finance sentence')==2,xml
        evidence=await sw.evaluate('()=>({calls:globalThis.__fileDocxCalls,lengths:globalThis.__fileRequestLengths})')
        assert evidence['calls']-previous>=2,evidence
        assert evidence['lengths']==[1,1],evidence
        report['transient_retry_and_dedupe']='pass'
        print('WXT REAL HTTP 429 RETRY + DUPLICATE PARAGRAPH CACHE: PASS',flush=True)

        await page.locator('.batch-file-lab input[type=file]').set_input_files([
          {'name':'cancel.docx','mimeType':'application/octet-stream','buffer':ooxml_docx()},
          {'name':'not-run.pptx','mimeType':'application/octet-stream','buffer':pptx_fixture()}
        ])
        await sw.evaluate('()=>{globalThis.__delayNextFetch=true}')
        await page.get_by_role('button',name='翻译全部并打包 ZIP').click()
        await page.get_by_role('button',name='取消批量处理').wait_for(state='visible',timeout=2500)
        clicked=await page.evaluate("""()=>{
          const button=[...document.querySelectorAll('.batch-file-lab button')]
            .find(b=>b.textContent?.trim()==='取消批量处理');
          if(!button)return false;
          button.click();return true;
        }""")
        assert clicked,'Cancellation must be available while the task is active'
        await page.locator('.batch-file-lab p[aria-live=polite]').get_by_text('用户已取消',exact=False).wait_for(timeout=12000)
        assert not await page.get_by_role('button',name='取消批量处理').count()
        report['batch_user_cancel']='pass'
        print('WXT BATCH USER CANCEL / NO PARTIAL ZIP: PASS',flush=True)
        await page.get_by_role("button",name="图片 OCR").click()
        image=Image.new('RGB',(920,170),'white')
        d=ImageDraw.Draw(image)
        font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',66)
        d.text((25,36),'HELLO WORLD 2026',font=font,fill='black')
        f=io.BytesIO();image.save(f,format='PNG')
        await page.locator('.document-lab').first.locator('input[type="file"]').set_input_files({
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
