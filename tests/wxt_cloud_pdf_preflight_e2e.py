"""Installed Chromium MV3 PDF cloud preflight contract, using mocked HTTPS
container transport. It does NOT claim a deployed BabelDOC quality pass.
"""
import asyncio
import tempfile
from pathlib import Path
from playwright.async_api import async_playwright
from wxt_video_image_pdf_e2e import pdf_fixture

PACKAGE=Path(__file__).resolve().parents[1]/'apps/wxt-ui/.output/chrome-mv3'

async def main():
    assert (PACKAGE/'manifest.json').exists(), 'Build WXT before PDF test'
    with tempfile.TemporaryDirectory(prefix='pit-cloud-pdf-preflight-') as profile:
        async with async_playwright() as p:
            ctx=await p.chromium.launch_persistent_context(
                profile,channel='chromium',headless=True,accept_downloads=True,
                args=[f'--disable-extensions-except={PACKAGE}',
                      f'--load-extension={PACKAGE}','--no-sandbox',
                      '--disable-dev-shm-usage'])
            try:
                sw=ctx.service_workers[0] if ctx.service_workers else await ctx.wait_for_event(
                    'serviceworker',timeout=30000)
                eid=sw.url.split('/')[2]
                page=await ctx.new_page()
                problems=[]
                page.on('pageerror',lambda e:problems.append(str(e)))
                await page.goto(f'chrome-extension://{eid}/file-lab.html')
                pdf=page.locator('.pdf-bilingual-lab')
                await pdf.get_by_role('heading',name='浏览器内 PDF / 扫描件双语翻译').wait_for(timeout=18000)
                await page.evaluate("""async()=>{
                  const item=await chrome.storage.local.get('pit_settings_v1');
                  await chrome.storage.local.set({pit_settings_v1:{
                    ...(item.pit_settings_v1||{}),
                    cloudPdfEndpoint:'https://pit-docs.example.test',
                    cloudPdfToken:'test-only-cloud-token-12345678',
                    target:'zh'
                  }});
                  window.confirm=()=>true;
                }""")
                await pdf.locator('input[type=file]').set_input_files({
                    'name':'real-pdf-fixture.pdf','mimeType':'application/pdf',
                    'buffer':pdf_fixture()
                })
                await pdf.get_by_label('云端 PDF 原文语言').select_option('fr')
                calls={'health':0,'upload':0,'ready':False,'valid_pdf':False,
                       'sources':[]}
                async def fake_service(route):
                    method=route.request.method
                    if method=='OPTIONS':
                        await route.fulfill(status=204,headers={
                          'Access-Control-Allow-Origin':'*',
                          'Access-Control-Allow-Methods':'GET,POST,OPTIONS',
                          'Access-Control-Allow-Headers':'authorization,content-type'
                        })
                    elif route.request.url.endswith('/health'):
                        assert method=='GET'
                        assert route.request.headers.get('authorization')=='Bearer test-only-cloud-token-12345678'
                        calls['health']+=1
                        await route.fulfill(status=200,content_type='application/json',
                            body='{"ready":'+('true' if calls['ready'] else 'false')+
                                ',"max_file_bytes":26214400}',
                            headers={'Access-Control-Allow-Origin':'*'})
                    elif route.request.url.endswith('/v1/pdf/translate'):
                        calls['upload']+=1
                        payload=route.request.post_data_buffer or b''
                        assert b'name="source"' in payload and b'\r\n\r\nfr\r\n' in payload, (
                            'cloud request ignored the user-selected original language')
                        calls['sources'].append('fr')
                        await route.fulfill(status=200,content_type='application/pdf',
                            body=pdf_fixture() if calls['valid_pdf'] else b'INVALID_PDF_CONTENT'+b'X'*200,
                            headers={
                              'Access-Control-Allow-Origin':'*',
                              'X-PIT-Detected-Source':'fr',
                              'X-PIT-Detection-Confidence':'explicit'
                            })
                    else:
                        await route.fulfill(status=404)
                await ctx.route('https://pit-docs.example.test/**',fake_service)
                button=pdf.get_by_role('button',name='云端高保真 BabelDOC（需部署并配置）')
                await button.click()
                await pdf.get_by_text('服务尚未就绪',exact=False).wait_for(timeout=11000)
                assert calls['health']==1 and calls['upload']==0,calls
                calls['ready']=True
                await button.click()
                await pdf.get_by_text('没有返回有效的 PDF 文件',exact=False).wait_for(timeout=10000)
                assert calls['health']==2 and calls['upload']==1,calls
                calls['valid_pdf']=True
                async with page.expect_download(timeout=20000) as info:
                    await button.click()
                download=await info.value
                assert download.suggested_filename.endswith('-babeldoc.pdf')
                downloaded=Path(await download.path()).read_bytes()
                assert downloaded.startswith(b'%PDF-') and len(downloaded)>100
                assert calls['health']==3 and calls['upload']==2,calls
                assert calls['sources']==['fr','fr'],calls
                await pdf.get_by_text('原文语言：fr（依据：explicit）',
                    exact=False).wait_for(timeout=10000)
                assert not problems,problems
                print('PASS: installed WXT blocks PDF upload when cloud health not ready')
                print('PASS: installed WXT uploads only after explicit ready preflight')
                print('NOTE: container and returned PDF are simulated; NOT a live BabelDOC L3 acceptance')
            finally:
                await ctx.close()

if __name__=='__main__':
    asyncio.run(main())
