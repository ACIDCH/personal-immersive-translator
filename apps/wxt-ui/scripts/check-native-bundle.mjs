import {readFileSync,existsSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const dist=join(root,'.output','chrome-mv3');
const manifest=JSON.parse(readFileSync(join(dist,'manifest.json'),'utf8'));
const expected=['activeTab','scripting','storage'];
for(const permission of expected)assert(manifest.permissions.includes(permission),'Missing permission: '+permission);
assert.equal(manifest.options_page,'pit-options.html','Functional native options page must be used');
assert.equal(manifest.action.default_popup,'popup.html');
assert.equal(manifest.background.service_worker,'pit-background.js');
assert.equal(manifest.background.type,'module');
for(const f of ['pit-native.js','pit-native.css','pit-options.html','options.js',
  'lib/settings.js','lib/ai-profiles.js','lib/providers.js','lib/cache.js','pit-background.js','popup.html']){
  assert(existsSync(join(dist,f)), 'Missing bundled native runtime asset: '+f);
}
assert.equal(
  readFileSync(join(dist,'pit-native.js'),'utf8'),
  readFileSync(resolve(root,'../../src/content.js'),'utf8'),
  'Native content script copied incorrectly'
);
assert.equal(
  readFileSync(join(dist,'options.js'),'utf8'),
  readFileSync(resolve(root,'../../src/options.js'),'utf8'),
  'Settings handler diverged from tested implementation'
);
const bg=readFileSync(join(dist,'pit-background.js'),'utf8');
assert.equal(bg,readFileSync(resolve(root,'../../src/background.js'),'utf8'));
assert(bg.includes('TRANSLATE_BATCH'),'Native provider routing not bundled');
const popup=readFileSync(join(dist,'popup.html'),'utf8');
assert(!popup.includes('pit-native.js'),'Content scripts must be injected only after explicit popup action');
console.log('WXT UI native web integration packaging contract PASS');
