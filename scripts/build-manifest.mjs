/* A deterministic hash inventory for the actual browser-deliverable files.
 * Purpose: verify packaged assets and Mozilla PDF.js license/provenance.
 * This does not claim acceptance of real video/ASR/PDF backends.
 */
import {createHash} from 'node:crypto';
import {readdirSync,readFileSync,statSync,writeFileSync,existsSync} from 'node:fs';
import {join,relative} from 'node:path';
const root=process.cwd();
const manifest=JSON.parse(readFileSync(join(root,'manifest.json'),'utf8'));
const pkg=JSON.parse(readFileSync(join(root,'package.json'),'utf8'));
if(manifest.version!==pkg.version)throw Error('Manifest/package version mismatch');
if(manifest.manifest_version!==3)throw Error('Expected Chromium Manifest V3');
if(pkg.dependencies?.['pdfjs-dist']!=='6.4.299')throw Error('Unexpected PDF.js version');
const vendor=JSON.parse(readFileSync(join(root,'src/vendor/SOURCE.json'),'utf8'));
if(vendor.version!==pkg.dependencies['pdfjs-dist'] || vendor.license!=='Apache-2.0')throw Error('PDF.js provenance inconsistent');
const inputs=['manifest.json','README.md','LICENSE','src','assets','docs','services'];
const paths=[];
function visit(path){
  const absolute=join(root,path);
  if(!existsSync(absolute))throw Error('Missing artifact asset '+path);
  if(statSync(absolute).isDirectory()){
    for(const name of readdirSync(absolute).sort())visit(path+'/'+name);
  } else {
    paths.push(path);
  }
}
inputs.forEach(visit);
for(const must of ['src/vendor/pdf.mjs','src/vendor/pdf.worker.mjs','src/vendor/PDFJS-LICENSE.txt','src/vendor/SOURCE.json','src/pdf-preview.js']){
 if(!paths.includes(must))throw Error('Missing required official PDF.js asset '+must);
}
const files=paths.map(path=>{
  const data=readFileSync(join(root,path));
  return {path,bytes:data.length,sha256:createHash('sha256').update(data).digest('hex')};
});
const totalBytes=files.reduce((s,x)=>s+x.bytes,0);
if(totalBytes>35*1024*1024)throw Error('Package exceeds current 35MB size limit');
const audit={
  schema:1,product:'personal-immersive-translator',version:manifest.version,
  type:'development-build',repository:'https://github.com/ACIDCH/personal-immersive-translator',
  includedUpstream:[{project:'Mozilla PDF.js',package:'pdfjs-dist',version:vendor.version,license:vendor.license}],
  excludedExternalRuntime:['BabelDOC','whisper.cpp','Tesseract','OCRmyPDF','PaddleOCR'],
  files,totalBytes,
  acceptance:{automatedCI:'required',realAuthorizedPlatforms:'not-yet-validated',
    realWhisperPerformance:'not-yet-validated',babeldocQuality:'not-yet-validated'}
};
writeFileSync(join(root,'BUILD_MANIFEST.json'),JSON.stringify(audit,null,2)+'\n');
console.log('Audit created for '+files.length+' files; '+totalBytes+' bytes, v'+manifest.version);
