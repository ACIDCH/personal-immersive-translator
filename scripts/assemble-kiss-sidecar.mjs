import {copyFileSync,existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
const SOURCES=['tools.html','tools.js','options.html','options.js','ui.css','pdf-preview.js','lib/settings.js','lib/cache.js','lib/providers.js','lib/vision.js','vendor/pdf.mjs','vendor/pdf.worker.mjs','vendor/PDFJS-LICENSE.txt','vendor/SOURCE.json'];
function must(ok,msg){if(!ok)throw Error(msg);}
function replaceOne(text,old,next){must(text.split(old).length===2,'Unexpected options adapter source');return text.replace(old,next);}
export function assembleKissSidecar(buildDirectory,sourceRoot=process.cwd()){
 const root=resolve(sourceRoot),build=resolve(buildDirectory),manifestFile=join(build,'manifest.json');
 must(existsSync(manifestFile),'KISS build manifest missing');
 const manifest=JSON.parse(readFileSync(manifestFile,'utf8'));
 must(!existsSync(join(build,'pit')),'Sidecar already exists');
 must(manifest.manifest_version===3&&manifest.version==='2.1.1','Expected pinned KISS v2.1.1 MV3 release');
 must(manifest.background?.service_worker==='background.js','Unexpected upstream KISS background');
 must((manifest.host_permissions||[]).includes('<all_urls>'),'Unexpected KISS host permission policy');
 for(const path of SOURCES)must(existsSync(join(root,'src',path)),'Missing PIT file: '+path);
 for(const path of SOURCES){const dest=join(build,'pit',path);mkdirSync(dirname(dest),{recursive:true});copyFileSync(join(root,'src',path),dest);}
 const opt=join(build,'pit/options.js');
 let txt=readFileSync(opt,'utf8');
 txt=replaceOne(txt,"import {normalizeSettings, SETTINGS_KEY} from './lib/settings.js';",
   "import {normalizeSettings, SETTINGS_KEY} from './lib/settings.js';\nimport {translateBatch} from './lib/providers.js';\nimport {clearTranslations} from './lib/cache.js';");
 const backtick=String.fromCharCode(96);
 const original="    const res=await chrome.runtime.sendMessage({type:'TEST_PROVIDER',mode});\n"+
   "    if(!res.ok) throw new Error(res.error);\n"+
   "    status.textContent="+backtick+"测试成功："+String.fromCharCode(36)+"{res.translations[0]}"+backtick+";";
 txt=replaceOne(txt,original,
   "    const provider=mode==='ai'?settings.aiProvider:settings.standardProvider;\n"+
   "    const translations=await translateBatch(['Hello, world!'],{...settings,provider,source:settings.source,target:settings.target,context:''});\n"+
   "    status.textContent='测试成功：'+translations[0];");
 txt=replaceOne(txt,"  const res=await chrome.runtime.sendMessage({type:'CLEAR_CACHE'});\n  status.textContent=res.ok?'缓存已清空':'清理失败：'+res.error;",
   "  try{await clearTranslations(chrome.storage.local);status.textContent='文件工具缓存已清空';}\n  catch(e){status.textContent='清理失败：'+String(e.message||e);}");
 writeFileSync(opt,txt.replaceAll('chrome.permissions.request(', 'chrome.permissions.contains('));
 // The upstream required <all_urls> host grant already covers localhost.
 // Do not redundantly declare an overlapping optional host permission.
 // Check the existing user's grant rather than requesting a duplicate one.
 const toolFile=join(build,'pit/tools.js');
 let tools=readFileSync(toolFile,'utf8');
 must(tools.split("chrome.permissions.request(").length===4,
   'Expected three current PIT localhost permission requests to adapt');
 tools=tools.replaceAll('chrome.permissions.request(', 'chrome.permissions.contains(');
 writeFileSync(toolFile,tools);
 // The original PDF.js page worker lived under src/vendor; the merged
 // extension places this module under pit/vendor instead.
 const pdfFile=join(build,'pit/pdf-preview.js');
 const originalPdf=readFileSync(pdfFile,'utf8');
 must(originalPdf.includes("chrome.runtime.getURL('src/vendor/pdf.worker.mjs')"),
    'Unexpected PDF.js Worker URL in PIT original');
 writeFileSync(pdfFile,originalPdf.replace(
    "chrome.runtime.getURL('src/vendor/pdf.worker.mjs')",
    "chrome.runtime.getURL('pit/vendor/pdf.worker.mjs')"));
 const optionHtml=join(build,'pit/options.html');
 writeFileSync(optionHtml,readFileSync(optionHtml,'utf8').replace('<h1>Personal Immersive Translator</h1>','<h1>个人文件工具配置</h1>'));
 const toolHtml=join(build,'pit/tools.html');
 writeFileSync(toolHtml,readFileSync(toolHtml,'utf8').replace('<h1>文件与图片翻译</h1>',
   '<h1>个人 PDF / 图片工具</h1><p class="muted">本机文件工具配置与 KISS 网页翻译配置独立。<a href="options.html">设置文件工具</a></p>'));
 const popupFile=join(build,'popup.html');
 const popup=readFileSync(popupFile,'utf8');
 must(popup.includes('</body>')&&!popup.includes('pit-multimodal-links'),'Unexpected popup HTML');
 const links='<nav id="pit-multimodal-links" style="display:flex;gap:12px;padding:8px;background:#eaf0fc;font:12px system-ui,sans-serif" aria-label="个人 PDF 图片工具">'+
  '<a href="pit/tools.html" target="_blank" rel="noopener noreferrer">PDF / 图片 OCR</a>'+
  '<a href="pit/options.html" target="_blank" rel="noopener noreferrer">文件工具设置</a></nav>';
 writeFileSync(popupFile,popup.replace('</body>',links+'</body>'));
 // Preserve the original, valid KISS manifest permissions verbatim.
 // "permissions" is not a Chrome API permission name; adding it is an
 // unnecessary unknown permission warning. Required <all_urls> already
 // includes localhost, so duplicating it in optional_host_permissions
 // creates Chromium's optional/required overlap warning.
 writeFileSync(manifestFile,JSON.stringify(manifest,null,2)+'\n');
 copyFileSync(join(root,'LICENSE'),join(build,'pit/PIT-LICENSE-MIT.txt'));
 const upstreamLicense=resolve(build,'../../LICENSE');
 must(existsSync(upstreamLicense),'Upstream GPL license missing from source checkout');
 copyFileSync(upstreamLicense,join(build,'pit/KISS-LICENSE-GPL3.txt'));

 // Opt-in personal video/Whisper modules are copied from the existing PIT
 // regression-tested implementation. KISS's original browser translator
 // stays compiled and unchanged: its background is imported by a wrapper.
 const extra={
   'kiss/background-entry.js':'background-entry.js',
   'kiss/asr-controller.js':'asr-controller.js',
   'kiss/bridge-client.js':'bridge-client.js',
   'kiss/view-client.js':'view-client.js',
   'kiss/whisper-readiness.js':'whisper-readiness.js',
   'kiss/site-diagnostics.js':'site-diagnostics.js',
   'kiss/site-diagnostics-ui.js':'site-diagnostics-ui.js',
   'kiss/github-diagnostics.js':'github-diagnostics.js',
   'kiss/control.html':'control.html',
   'kiss/control.js':'control.js',
   'kiss/popup-entry.js':'popup-entry.js',
   'offscreen.html':'offscreen.html',
   'offscreen.js':'offscreen.js',
   'audio-capture-worklet.js':'audio-capture-worklet.js',
   'live-captions.js':'live-captions.js',
   'subtitles.js':'subtitles.js',
   'content.css':'content.css',
   'lib/live-pipeline.js':'lib/live-pipeline.js',
   'lib/wav.js':'lib/wav.js',
   'lib/caption-core.js':'lib/caption-core.js',
   'lib/platform-captions.js':'lib/platform-captions.js',
   'lib/subtitle-import.js':'lib/subtitle-import.js',
   'lib/frame-route.js':'lib/frame-route.js'
 };
 for(const [from,to] of Object.entries(extra)){
   const input=join(root,'src',from);
   must(existsSync(input),'Missing PIT video module: '+from);
   const dest=join(build,'pit',to);
   mkdirSync(dirname(dest),{recursive:true});copyFileSync(input,dest);
 }
 const patches=[
   ['asr-controller.js',"from '../lib/providers.js'","from './lib/providers.js'"],
   ['asr-controller.js',"from '../lib/settings.js'","from './lib/settings.js'"],
   ['control.js',"from '../lib/frame-route.js'","from './lib/frame-route.js'"],
   ['offscreen.js',"chrome.runtime.getURL('src/audio-capture-worklet.js')",
    "chrome.runtime.getURL('pit/audio-capture-worklet.js')"],
   ['live-captions.js',"type:'TRANSLATE_BATCH'","type:'PIT_SIDECAR_TRANSLATE'"],
   ['subtitles.js',"type:'TRANSLATE_BATCH'","type:'PIT_SIDECAR_TRANSLATE'"],
   ['live-captions.js','chrome.runtime.sendMessage({','globalThis.PITSidecar.send({'],
   ['subtitles.js','chrome.runtime.sendMessage({','globalThis.PITSidecar.send({'],
   ['live-captions.js','chrome.runtime.onMessage.addListener((msg,_sender,respond)=>{',
    'globalThis.PITSidecar.onViewMessage.addListener((msg,_sender,respond)=>{'],
   ['subtitles.js','chrome.runtime.onMessage.addListener((msg,_sender,respond)=>{',
    'globalThis.PITSidecar.onViewMessage.addListener((msg,_sender,respond)=>{']
 ];
 for(const [target,old,replacement] of patches){
   const file=join(build,'pit',target);
   const text=readFileSync(file,'utf8');
   must(text.split(old).length===2,'Unexpected PIT upstream module version: '+target);
   writeFileSync(file,text.replace(old,replacement));
 }

 // The original offscreen audio engine is unchanged; only its messaging
 // interface is adapted to a dedicated Port so KISS's onMessage polyfill
 // never intercepts our capture start, stop, or recognition results.
 const offscreenFile=join(build,'pit/offscreen.js');
 let offscreen=readFileSync(offscreenFile,'utf8');
 const notifyOriginal="async function notify(type,payload){\n  try{await chrome.runtime.sendMessage({type,...payload});}catch{}\n}";
 must(offscreen.split(notifyOriginal).length===2,
   'Unexpected upstream Whisper notification transport');
 offscreen=offscreen.replace(notifyOriginal,
   "let sidecarPort=null;\nasync function notify(type,payload){\n"+
   "  try{sidecarPort?.postMessage({kind:'event',type,...payload});}catch{}\n}");
 offscreen += `
// Isolated, persistent offscreen-to-worker Port. KISS's original background
// remains unaware of this communication channel.
sidecarPort=chrome.runtime.connect({name:'pit-offscreen-v046'});
sidecarPort.onMessage.addListener(msg=>{
  if(msg?.kind!=='command')return;
  const operation=msg.type==='PIT_OFFSCREEN_START'
    ?start(msg):msg.type==='PIT_OFFSCREEN_STOP'
      ?stop().then(()=>({ok:true}))
      :Promise.resolve({ok:false,error:'Unsupported offscreen command'});
  Promise.resolve(operation).then(result=>{
    try{sidecarPort?.postMessage({kind:'reply',seq:msg.seq,...result});}catch{}
  }).catch(e=>{
    try{sidecarPort?.postMessage({kind:'reply',seq:msg.seq,
      ok:false,error:String(e.message||e).slice(0,300)});}catch{}
  });
});
sidecarPort.onDisconnect.addListener(()=>{
  sidecarPort=null;
  void stop();
});
`;
 writeFileSync(offscreenFile,offscreen);

 const background=readFileSync(join(build,'pit/background-entry.js'),'utf8');
 must(background.includes("import '../background.js'"),
   'Cannot prove KISS original worker is imported into wrapper');
 manifest.background={...manifest.background,service_worker:'pit/background-entry.js',type:'module'};
 manifest.permissions=[...new Set([
   ...(manifest.permissions||[]),'activeTab','offscreen','tabCapture','webNavigation'
 ])];
 // Keep KISS engine's numeric version intact for its internal upgrade
 // logic; Chrome's version_name labels our composite distribution.
 // Do not mutate/rebrand the KISS source package or strip its GPL license.
 manifest.name='PIT 沉浸式翻译（测试版）';
 manifest.short_name='PIT 翻译';
 manifest.version_name='PIT v0.4.9 (KISS 2.1.1)';
 manifest.description='PIT 个人沉浸式翻译测试版：双语网页、视频字幕、图片 OCR、PDF 与 GitHub 诊断。基于 KISS Translator 2.1.1（GPL-3.0）。';
 const pitIcons={};
 for(const size of [16,48,128]){
   const relative='pit/icons/icon'+size+'.png';
   const source=join(root,'assets','icon'+size+'.png');
   must(existsSync(source),'Missing PIT identity icon: '+source);
   mkdirSync(dirname(join(build,relative)),{recursive:true});
   copyFileSync(source,join(build,relative));
   pitIcons[size]=relative;
 }
 manifest.icons=pitIcons;
 manifest.action={...manifest.action,
   default_title:'PIT 沉浸式翻译 · v0.4.9',
   default_icon:pitIcons
 };
 writeFileSync(manifestFile,JSON.stringify(manifest,null,2)+'\n');
 const popupExtra=readFileSync(popupFile,'utf8');
 must(popupExtra.includes('pit-multimodal-links'),'Expected original PIT navigation');
 const withVideo=popupExtra.replace('</nav>',
   '<a id="pit-caption-control" href="pit/control.html">视频字幕 / Whisper</a></nav>');
 must(withVideo!==popupExtra,'PIT popup navigation injection failed');
 writeFileSync(popupFile,withVideo.replace('</body>',
   '<script type="module" src="pit/popup-entry.js"></script></body>'));

 const report={host:'KISS Translator v2.1.1',hostLicense:'GPL-3.0',originalCorePreserved:true,originalKissWorkerImported:true,whisperControl:'pit/control.html',
  entry:'pit/tools.html',settings:'pit/options.html',pdfEngine:'Mozilla PDF.js 6.4.299 Apache-2.0',
  sidecarLicense:'MIT',distribution:'POC_ONLY_NO_RELEASE'};
 writeFileSync(join(build,'pit/INTEGRATION-SOURCE.json'),JSON.stringify(report,null,2));
 return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 if(!process.argv[2]){console.error('Provide built KISS directory');process.exitCode=2;}
 else try{console.log(JSON.stringify(assembleKissSidecar(process.argv[2]),null,2));}
 catch(e){console.error(e.message);process.exitCode=1;}
}