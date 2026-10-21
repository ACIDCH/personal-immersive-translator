"""Pre-install user-interface gate for the ACTUAL packaged Chrome MV3 extension.

Verifies major entry points and source-of-truth controls without mocking a
Provider response or claiming that authenticated videos/cloud PDF work.
"""
import asyncio,json,tempfile
from pathlib import Path
from playwright.async_api import async_playwright

ROOT=Path(__file__).resolve().parents[1]
EXT=ROOT/'apps/wxt-ui/.output/chrome-mv3'

async def overflow(page,name,viewport,zoom=1.0):
    await page.set_viewport_size({'width':viewport,'height':900})
    await page.evaluate('(factor)=>{document.documentElement.style.zoom=factor}',zoom)
    await page.wait_for_timeout(100)
    value=await page.evaluate("""()=>{
      const d=document.documentElement;
      return {scroll:d.scrollWidth,client:d.clientWidth,body:document.body.scrollWidth,
        viewport:window.innerWidth};
    }""")
    assert value['scroll']<=value['client']+5,(name,viewport,zoom,value)
    return {'name':name,'width':viewport,'zoom':zoom,**value}

async def main():
    assert (EXT/'manifest.json').exists(),'Build WXT extension first'
    checks=[]
    with tempfile.TemporaryDirectory(prefix='pit-delivery-ui-') as profile:
      async with async_playwright() as pw:
        ctx=await pw.chromium.launch_persistent_context(
          profile,channel='chromium',headless=True,
          args=[f'--disable-extensions-except={EXT}',f'--load-extension={EXT}',
                '--no-sandbox','--disable-dev-shm-usage'])
        try:
          sw=ctx.service_workers[0] if ctx.service_workers else await ctx.wait_for_event('serviceworker',timeout=30000)
          eid=sw.url.split('/')[2]
          opts=await ctx.new_page()
          await opts.goto(f'chrome-extension://{eid}/pit-options.html')
          await opts.locator('form[data-ready="1"]').wait_for(timeout=20000)
          for width,zoom in ((1280,1),(1024,1.25),(760,1),(760,1.25)):
            checks.append(await overflow(opts,'options',width,zoom))
          await opts.evaluate('document.documentElement.style.zoom=1')
          await opts.set_viewport_size({'width':1280,'height':900})
          for target in ('baseSettings','services','readingSettings','video',
                         'files','sync','help'):
            await opts.locator('.options-nav a[href="#'+target+'"]').click()
            panel=opts.locator('#'+target)
            await panel.wait_for(state='visible',timeout=8000)
          await opts.locator('.options-nav a[href="#services"]').click()
          cards=opts.locator('.pit-service-group .provider-card[data-provider]')
          count=await cards.count()
          assert count>=8,('service list unexpectedly incomplete',count)
          for index in range(count):
            card=cards.nth(index)
            assert await card.locator('button[aria-label^="测试此服务 "]').count()==1,(
                'missing per-provider real test action',index)
          await opts.screenshot(path='pit-delivery-options.png',full_page=True)
          popup=await ctx.new_page()
          await popup.goto(f'chrome-extension://{eid}/popup.html')
          await popup.get_by_role('button',name='网页翻译',exact=True).wait_for(timeout=12000)
          for width,zoom in ((465,1),(410,1),(380,1)):
            checks.append(await overflow(popup,'popup',width,zoom))
          await popup.get_by_role('button',name='视频字幕',exact=True).click()
          select=popup.get_by_role('combobox',name='字幕显示方式')
          assert await select.input_value()=='replace-track'
          await popup.get_by_role('button',name='检查字幕状态').wait_for()
          await popup.screenshot(path='pit-delivery-video.png',full_page=True)
          await popup.get_by_role('button',name='文件与图片',exact=True).click()
          assert await popup.get_by_role('button',name='打开文件翻译工作台').is_visible()
          await popup.get_by_role('button',name='设置与诊断',exact=True).click()
          assert await popup.get_by_role('button',name='打开完整设置').is_visible()
          await popup.get_by_role('button',name='网页翻译',exact=True).click()
          assert await popup.get_by_role('button',name='翻译当前网页').is_visible()
          file=await ctx.new_page()
          await file.goto(f'chrome-extension://{eid}/file-lab.html')
          await file.locator('.pit-workbench-nav').wait_for(timeout=20000)
          for width,zoom in ((1280,1),(760,1)):
            checks.append(await overflow(file,'file-lab',width,zoom))
          for name,target in [('多文件批量','batch-file-lab'),
                              ('SRT / VTT / ASS 字幕','subtitle-file-lab'),
                              ('双语 PDF · BabelDOC','pdf-bilingual-lab'),
                              ('文档 · 图片 OCR','document-lab')]:
            await file.locator('.pit-workbench-nav a[href="#'+target+'"]').click()
            await file.locator('#'+target).wait_for(state='visible',timeout=8000)
          await file.screenshot(path='pit-delivery-filelab.png',full_page=True)
          print('PIT PREDELIVERY UI: PASS',
                json.dumps({'services':count,'layouts':checks},ensure_ascii=False),
                flush=True)
        finally:
          Path('pit-delivery-ui-readiness.json').write_text(
            json.dumps({'observed_layouts':checks},ensure_ascii=False,indent=2)+'\n',
            encoding='utf8')
          await ctx.close()

if __name__=='__main__':
    asyncio.run(main())
