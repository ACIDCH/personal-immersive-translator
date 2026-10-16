import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {inspectKissUpstream,KISS_COMMIT} from '../scripts/upstream-kiss-audit.mjs';

function fixture(){
 const root=mkdtempSync(join(tmpdir(),'pit-kiss-audit-'));
 const our=join(root,'ours'),upstream=join(root,'kiss');
 for(const dir of [our,upstream])mkdirSync(dir);
 const write=(base,path,data)=>{
  const full=join(base,path);mkdirSync(dirname(full),{recursive:true});
  writeFileSync(full,typeof data==='string'?data:JSON.stringify(data));
 };
 write(our,'manifest.json',{manifest_version:3,host_permissions:['https://api.deepl.com/*']});
 write(upstream,'package.json',{name:'kiss-translator',version:'2.1.1'});
 write(upstream,'LICENSE','GNU GENERAL PUBLIC LICENSE\nVersion 3, 29 June 2007');
 write(upstream,'public/manifest.json',{
  manifest_version:3,background:{service_worker:'background.js'},
  host_permissions:['<all_urls>'],
  content_scripts:[{matches:['<all_urls>'],js:['content.js']}]
 });
 for(const path of ['src/content.js','src/background.js',
 'src/apis/trans.js','src/config/api.js','src/libs/batchQueue.js','pnpm-lock.yaml']){
  write(upstream,path,'fixture');
 }
 return {root,our,upstream,write};
}
test('upstream GPL/permission gate exposes risky differences instead of copying code',()=>{
 const f=fixture();
 try{
  const a=inspectKissUpstream(f.upstream,f.our);
  assert.equal(a.requiredCommit,KISS_COMMIT);
  assert.equal(a.sourceLicense,'GPL-3.0');
  assert.equal(a.originalHostPermissionAllUrls,true);
  assert.equal(a.pitProductionBroadHostPermission,false);
  assert.equal(a.productionCodeCopied,false);
  assert.equal(a.upstreamChromeBuildObserved,false);
  f.write(f.upstream,'build/chrome/manifest.json',{
   manifest_version:3,background:{service_worker:'background.js'},
   content_scripts:[{js:['content.js']}],action:{default_popup:'popup.html'}
  });
  for(const file of ['background.js','content.js','popup.html'])f.write(f.upstream,'build/chrome/'+file,'fixture');
  assert.equal(inspectKissUpstream(f.upstream,f.our).chromeBuild.checkedEntrypoints,3);
 }finally{rmSync(f.root,{recursive:true,force:true});}
});
test('wrong upstream version / missing GPL provenance fails closed',()=>{
 const f=fixture();
 try{
  f.write(f.upstream,'package.json',{name:'kiss-translator',version:'9.9.9'});
  assert.throws(()=>inspectKissUpstream(f.upstream,f.our),/Unexpected KISS/);
  f.write(f.upstream,'package.json',{name:'kiss-translator',version:'2.1.1'});
  f.write(f.upstream,'LICENSE','MIT License');
  assert.throws(()=>inspectKissUpstream(f.upstream,f.our),/GPL-3.0 provenance/);
 }finally{rmSync(f.root,{recursive:true,force:true});}
});
test('cannot silently broaden our own production host permissions',()=>{
 const f=fixture();
 try{
  f.write(f.our,'manifest.json',{manifest_version:3,host_permissions:['<all_urls>']});
  assert.throws(()=>inspectKissUpstream(f.upstream,f.our),/global permissions/);
 }finally{rmSync(f.root,{recursive:true,force:true});}
});
