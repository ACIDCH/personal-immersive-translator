import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';

const root=new URL('../',import.meta.url);
const manifest=JSON.parse(readFileSync(new URL('../manifest.json',import.meta.url),'utf8'));

test('extension uses Manifest V3 and no persistent page scraping',()=>{
 assert.equal(manifest.manifest_version,3);
 assert.ok(manifest.permissions.includes('activeTab'));
 assert.ok(!manifest.permissions.includes('tabs'));
 assert.ok(!manifest.content_scripts || manifest.content_scripts.length===0);
 assert.equal(manifest.background.type,'module');
});
test('all referenced entrypoints and icons exist',()=>{
 const paths=[manifest.background.service_worker,manifest.action.default_popup,manifest.options_page,
   ...Object.values(manifest.icons)];
 for(const p of paths) assert.ok(existsSync(new URL('../'+p,import.meta.url)),p);
});
test('extension icons are valid PNG files',()=>{
 for(const p of Object.values(manifest.icons)){
  const buffer=readFileSync(new URL('../'+p,import.meta.url));
  assert.equal(buffer.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
 }
});
test('manifest has no publicly packaged project-specific key',()=>{
 const raw=JSON.stringify(manifest);
 assert.ok(!raw.includes('service_role'));
 assert.ok(!raw.includes('sb_secret_'));
 assert.ok(!raw.includes('AIza'));
});
