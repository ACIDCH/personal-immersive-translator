"""Real Chromium boot of pinned upstream FluentRead GPL extension, isolated from PIT."""
import asyncio,json,tempfile,sys
from pathlib import Path
from playwright.async_api import async_playwright

async def main():
  root=Path(sys.argv[1]).resolve()
  manifest=json.loads((root/'manifest.json').read_text())
  report={'engine':'FluentRead','mv3':manifest.get('manifest_version')==3,
    'service_worker':False,'popup_loaded':False,
    'page_translation':'NOT_TESTED','note':'Build and boot gate, not provider quality'}
  with tempfile.TemporaryDirectory(prefix='fluentread-qa-') as profile:
    async with async_playwright() as p:
      context=await p.chromium.launch_persistent_context(profile,channel='chromium',headless=True,
        args=[f'--disable-extensions-except={root}',f'--load-extension={root}',
              '--no-sandbox','--disable-dev-shm-usage'])
      try:
        sw=context.service_workers[0] if context.service_workers else await context.wait_for_event('serviceworker',timeout=30000)
        eid=sw.url.split('/')[2]
        report['service_worker']=len(eid)==32
        page=await context.new_page()
        await page.goto(f'chrome-extension://{eid}/'+manifest['action']['default_popup'],wait_until='domcontentloaded',timeout=25000)
        assert await page.locator('body').count()==1
        report['popup_loaded']=True
        print('FLUENTREAD RUNTIME:',json.dumps(report),flush=True)
      finally:
        Path('fluentread-browser-report.json').write_text(json.dumps(report,indent=2)+'\n')
        await context.close()
  assert report['service_worker'] and report['popup_loaded']

if __name__=='__main__':asyncio.run(main())
