/**
 * Vendor only the official Mozilla PDF.js distribution via npm.
 * No CDN/remote scripts are loaded inside Manifest V3 extension.
 * pdfjs-dist is Apache-2.0; retain its complete LICENSE alongside files.
 */
import {copyFileSync,existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
const upstream=join(process.cwd(),'node_modules','pdfjs-dist');
const packageJson=JSON.parse(readFileSync(join(upstream,'package.json'),'utf8'));
if(packageJson.version!=='6.4.299' || packageJson.license!=='Apache-2.0') {
 throw Error('Unexpected upstream PDF.js version/license; review dependency');
}
const output=join(process.cwd(),'src','vendor');
mkdirSync(output,{recursive:true});
const files=[
 ['build/pdf.mjs','pdf.mjs'],
 ['build/pdf.worker.mjs','pdf.worker.mjs'],
 ['LICENSE','PDFJS-LICENSE.txt']
];
for(const [from,to] of files){
 const source=join(upstream,from);
 if(!existsSync(source))throw Error('Missing upstream PDF.js asset: '+from);
 copyFileSync(source,join(output,to));
}
writeFileSync(join(output,'SOURCE.json'),JSON.stringify({
 project:'Mozilla PDF.js',repository:'https://github.com/mozilla/pdf.js',
 package:'pdfjs-dist',version:packageJson.version,license:packageJson.license,
 source:'npm official package',files:files.map(pair=>pair[1])
},null,2)+'\n');
console.log('Vendored Mozilla PDF.js '+packageJson.version+' from pinned npm dependency');
