import {copyFileSync,existsSync,mkdirSync,readFileSync,readdirSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';

// Publish only the web translation runtime and trusted settings UI.
// Keep a single implementation in the repository's src/; no forked copies.
const here=dirname(fileURLToPath(import.meta.url));
const source=resolve(here,'../../../src');
const output=resolve(here,'../public');
const copies=[
 ['content.js','pit-native.js'],
 ['background.js','pit-background.js'],
 ['content.css','pit-native.css'],
 ['options.html','pit-options.html'],
 ['options.js','options.js'],
 ['ui.css','ui.css'],
 ['lib/settings.js','lib/settings.js'],
 ['lib/providers.js','lib/providers.js'],
 ['lib/cache.js','lib/cache.js'],
 ['lib/ai-profiles.js','lib/ai-profiles.js']
];
for(const [src,dst] of copies){
 const path=join(source,src);
 if(!existsSync(path))throw Error('Native PIT source missing: '+src);
 const target=join(output,dst);
 mkdirSync(dirname(target),{recursive:true});
 copyFileSync(path,target);
}
// Bundle executable OCR worker and WebAssembly cores in the extension,
// never load JavaScript from a remote CDN in Manifest V3.
const require=createRequire(import.meta.url);
const tesseractPackage=require.resolve('tesseract.js/package.json');
const tesseractDir=dirname(tesseractPackage);
let corePackage;
try{
  corePackage=require.resolve('tesseract.js-core/package.json');
}catch{
  corePackage=createRequire(tesseractPackage).resolve('tesseract.js-core/package.json');
}
const coreDir=dirname(corePackage);
const ocrWorker=join(tesseractDir,'dist/worker.min.js');
if(!existsSync(ocrWorker))throw Error('Missing Tesseract.js local worker entry');
const ocrTarget=join(output,'tesseract/worker.min.js');
mkdirSync(dirname(ocrTarget),{recursive:true});
copyFileSync(ocrWorker,ocrTarget);
const coreFiles=readdirSync(coreDir).filter(name=>
  /^tesseract-core(?:-simd)?(?:-lstm)?\.wasm(?:\.js)?$/.test(name));
if(coreFiles.filter(name=>name.endsWith('.wasm.js')).length!==4)
  throw Error('Expected four separately selectable Tesseract.js WASM core loaders');
for(const name of coreFiles){
 const target=join(output,'tesseract/core',name);
 mkdirSync(dirname(target),{recursive:true});
 copyFileSync(join(coreDir,name),target);
}
console.log('Staged MV3-local Tesseract Worker and '+coreFiles.length+' WASM core files.');
const html=readFileSync(join(output,'pit-options.html'),'utf8');
if(!html.includes('options.js')||!html.includes('ui.css'))throw Error('Native settings reference check failed');
console.log('Copied PIT web runtime and trusted settings page into isolated WXT build.');
