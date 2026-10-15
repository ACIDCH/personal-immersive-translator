import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync,statSync} from 'node:fs';
test('Mozilla PDF.js assets are installed locally, pinned, and Apache license preserved',()=>{
 const root=new URL('../src/vendor/',import.meta.url);
 const meta=JSON.parse(readFileSync(new URL('SOURCE.json',root),'utf8'));
 assert.equal(meta.package,'pdfjs-dist');
 assert.equal(meta.version,'6.4.299');
 assert.equal(meta.license,'Apache-2.0');
 for(const file of ['pdf.mjs','pdf.worker.mjs','PDFJS-LICENSE.txt']){
  const path=new URL(file,root);
  assert.ok(existsSync(path),file);
  assert.ok(statSync(path).size>200,file);
 }
 assert.match(readFileSync(new URL('PDFJS-LICENSE.txt',root),'utf8'),/Apache License/);
});
