import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {assembleKissSidecar} from '../scripts/assemble-kiss-sidecar.mjs';
function setup(version='2.1.1'){
 const dir=mkdtempSync(join(tmpdir(),'pit-kiss-')),src=join(dir,'source'),build=join(dir,'kiss','build','chrome');
 mkdirSync(src);mkdirSync(build,{recursive:true});
 writeFileSync(join(dir,'kiss','LICENSE'),'GNU GENERAL PUBLIC LICENSE Version 3');
 const file=(path,body)=>{const full=join(src,path);mkdirSync(dirname(full),{recursive:true});writeFileSync(full,body);};
 file('LICENSE','MIT License');
 for(const p of ['tools.html','tools.js','options.html','options.js','ui.css','pdf-preview.js','lib/settings.js','lib/cache.js','lib/providers.js','lib/vision.js','vendor/pdf.mjs','vendor/pdf.worker.mjs','vendor/PDFJS-LICENSE.txt','vendor/SOURCE.json'])file('src/'+p,'mock');
 file('src/tools.html','<h1>文件与图片翻译</h1>');
 file('src/options.html','<h1>Personal Immersive Translator</h1>');
 file('src/pdf-preview.js',"const url=chrome.runtime.getURL('src/vendor/pdf.worker.mjs');");
 const additional=['kiss/background-entry.js','kiss/asr-controller.js',
 'kiss/control.html','kiss/control.js','kiss/popup-entry.js',
 'kiss/bridge-client.js','kiss/view-client.js','kiss/whisper-readiness.js',
 'offscreen.html','offscreen.js','audio-capture-worklet.js',
 'live-captions.js','subtitles.js','content.css',
 'lib/live-pipeline.js','lib/wav.js','lib/caption-core.js',
 'lib/platform-captions.js','lib/subtitle-import.js','lib/frame-route.js'];
 for(const name of additional)file('src/'+name,'fixture');
 file('src/kiss/background-entry.js',"import '../background.js';");
 file('src/kiss/asr-controller.js',
   "import {translateBatch} from '../lib/providers.js';\n"+
   "import {normalizeSettings} from '../lib/settings.js';");
 file('src/kiss/control.js',"import {chooseEmbeddedFrame} from '../lib/frame-route.js';");
 file('src/offscreen.js',
 "const path=chrome.runtime.getURL('src/audio-capture-worklet.js');\n"+
 "async function notify(type,payload){\n  try{await chrome.runtime.sendMessage({type,...payload});}catch{}\n}");
 file('src/live-captions.js',
 "const message=chrome.runtime.sendMessage({type:'TRANSLATE_BATCH'});\n"+
 "chrome.runtime.onMessage.addListener((msg,_sender,respond)=>{});");
 file('src/subtitles.js',
 "const message=chrome.runtime.sendMessage({type:'TRANSLATE_BATCH'});\n"+
 "chrome.runtime.onMessage.addListener((msg,_sender,respond)=>{});");
 file('src/tools.js',"const a=chrome.permissions.request({}); const b=chrome.permissions.request({}); const c=chrome.permissions.request({});");
 const tick=String.fromCharCode(96),dollar=String.fromCharCode(36);
 file('src/options.js',"import {normalizeSettings, SETTINGS_KEY} from './lib/settings.js';\n"+
  "    const res=await chrome.runtime.sendMessage({type:'TEST_PROVIDER',mode});\n"+
  "    if(!res.ok) throw new Error(res.error);\n"+
  "    status.textContent="+tick+"测试成功："+dollar+"{res.translations[0]}"+tick+";\n"+
  "  const res=await chrome.runtime.sendMessage({type:'CLEAR_CACHE'});\n"+
  "  status.textContent=res.ok?'缓存已清空':'清理失败：'+res.error;");
 writeFileSync(join(build,'manifest.json'),JSON.stringify({
  manifest_version:3,version,background:{service_worker:'background.js'},
  permissions:['storage'],host_permissions:['<all_urls>'],
  content_scripts:[{js:['content.js'],matches:['<all_urls>']}]
 }));
 writeFileSync(join(build,'popup.html'),'<html><body><div id="root"></div></body></html>');
 return {dir,src,build};
}
test('sidecar retains KISS core while exposing original PDF/OCR files',()=>{
 const f=setup();
 try{
  const report=assembleKissSidecar(f.build,f.src);
  assert.equal(report.distribution,'POC_ONLY_NO_RELEASE');
  const m=JSON.parse(readFileSync(join(f.build,'manifest.json'),'utf8'));
  assert.equal(m.background.service_worker,'pit/background-entry.js');
  assert.ok(m.permissions.includes('tabCapture'));
  assert.ok(m.permissions.includes('offscreen'));
  assert.ok(m.permissions.includes('activeTab'));
  assert.ok(m.permissions.includes('webNavigation'));
  assert.ok(readFileSync(join(f.build,'pit/background-entry.js'),'utf8')
    .includes("import '../background.js'"));
  assert.ok(readFileSync(join(f.build,'pit/offscreen.js'),'utf8')
    .includes("chrome.runtime.getURL('pit/audio-capture-worklet.js')"));
  const live=readFileSync(join(f.build,'pit/live-captions.js'),'utf8');
  assert.ok(live.includes("type:'PIT_SIDECAR_TRANSLATE'"));
  assert.ok(live.includes('globalThis.PITSidecar.send('));
  assert.ok(live.includes('globalThis.PITSidecar.onViewMessage.addListener'));
  assert.ok(existsSync(join(f.build,'pit/bridge-client.js')));
  assert.ok(existsSync(join(f.build,'pit/view-client.js')));
  assert.ok(existsSync(join(f.build,'pit/whisper-readiness.js')));
  const offscreen=readFileSync(join(f.build,'pit/offscreen.js'),'utf8');
  assert.ok(offscreen.includes("name:'pit-offscreen-v046'"));
  assert.ok(offscreen.includes("sidecarPort?.postMessage({kind:'event'"));
  assert.ok(readFileSync(join(f.build,'pit/subtitles.js'),'utf8')
    .includes("type:'PIT_SIDECAR_TRANSLATE'"));
  assert.ok(m.permissions.includes('storage'));
  assert.ok(!m.permissions.includes('permissions'));
  assert.ok(!(m.optional_host_permissions||[]).includes('http://127.0.0.1/*'));
  assert.ok(readFileSync(join(f.build,'popup.html'),'utf8').includes('pit-multimodal-links'));
  assert.ok(readFileSync(join(f.build,'pit/options.js'),'utf8').includes('translateBatch'));
  const pdfPreview=readFileSync(join(f.build,'pit/pdf-preview.js'),'utf8');
  assert.ok(pdfPreview.includes("chrome.runtime.getURL('pit/vendor/pdf.worker.mjs')"));
  assert.ok(!readFileSync(join(f.build,'pit/tools.js'),'utf8').includes('chrome.permissions.request('));
  assert.ok(existsSync(join(f.build,'pit/vendor/pdf.worker.mjs')));
  assert.throws(()=>assembleKissSidecar(f.build,f.src),/already exists/);
 }finally{rmSync(f.dir,{recursive:true,force:true});}
});
test('unknown KISS version is rejected before writing output',()=>{
 const f=setup('9.1.1');
 try{
  assert.throws(()=>assembleKissSidecar(f.build,f.src),/pinned KISS/);
  assert.equal(existsSync(join(f.build,'pit')),false);
 }finally{rmSync(f.dir,{recursive:true,force:true});}
});