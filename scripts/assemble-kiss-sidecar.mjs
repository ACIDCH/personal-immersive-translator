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
 must(manifest.manifest_version===3&&manifest.version==='2.1.1','Expected pinned KISS v2.1.1 MV3 release');
 must(manifest.background?.service_worker==='background.js','Unexpected upstream KISS background');
 must((manifest.host_permissions||[]).includes('<all_urls>'),'Unexpected KISS host permission policy');
 must(!existsSync(join(build,'pit')),'Sidecar already exists');
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
 writeFileSync(opt,txt);
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
 manifest.permissions=[...new Set([...(manifest.permissions||[]),'permissions'])];
 manifest.optional_host_permissions=[...new Set([...(manifest.optional_host_permissions||[]),'http://127.0.0.1/*'])];
 writeFileSync(manifestFile,JSON.stringify(manifest,null,2)+'\n');
 copyFileSync(join(root,'LICENSE'),join(build,'pit/PIT-LICENSE-MIT.txt'));
 const report={host:'KISS Translator v2.1.1',hostLicense:'GPL-3.0',originalCorePreserved:true,
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