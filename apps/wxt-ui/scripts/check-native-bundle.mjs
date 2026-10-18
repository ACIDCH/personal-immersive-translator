import {readFileSync,existsSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const dist=join(root,'.output','chrome-mv3');
const manifest=JSON.parse(readFileSync(join(dist,'manifest.json'),'utf8'));
const expected=['activeTab','scripting','storage','webNavigation','offscreen','tabCapture'];
for(const permission of expected)assert(manifest.permissions.includes(permission),'Missing permission: '+permission);
assert(manifest.permissions.includes('contextMenus'),'Native selection and page right-click actions require contextMenus');
for(const origin of ['https://*/*','http://*/*'])assert(manifest.host_permissions.includes(origin),'Missing ordinary webpage access: '+origin);
assert.equal(manifest.options_page,'pit-options.html','Functional native options page must be used');
assert.equal(manifest.action.default_popup,'popup.html');
assert.equal(manifest.background.service_worker,'pit-background.js');
assert.equal(manifest.background.type,'module');
assert(manifest.content_scripts?.some(entry=>
  entry.matches?.includes('https://*/*') &&
  entry.js?.includes('pit-native.js') &&
  entry.css?.includes('pit-native.css') &&
  entry.run_at==='document_idle'
),'Opt-in hover/input and per-site reading must have a passive registered script');
assert.deepEqual(
  Object.keys(manifest.commands||{}).sort(),
  ['pit-toggle-translation','pit-translate-whole-page'],
  'Both immersive-style keyboard shortcuts must be wired into Chrome');

assert(manifest.content_security_policy?.extension_pages?.includes('wasm-unsafe-eval'),
  'Packaged Tesseract requires MV3 wasm-unsafe-eval, not remote code');
for(const f of ['pit-native.js','pit-native.css','pit-options.html','options.js',
  'lib/settings.js','lib/ai-profiles.js','lib/providers.js','lib/cache.js','file-lab.html','tesseract/worker.min.js','tesseract/core/tesseract-core.wasm.js','tesseract/core/tesseract-core-simd.wasm.js','tesseract/core/tesseract-core-lstm.wasm.js','tesseract/core/tesseract-core-simd-lstm.wasm.js','pit-background.js','popup.html','pit-caption-core.js','pit-platform-captions.js','pit-subtitle-import.js','pit-subtitles.js','pit-tools.html','tools.js','lib/vision.js','pdf-preview.js','vendor/pdf.mjs','vendor/pdf.worker.mjs','vendor/PDFJS-LICENSE.txt','src/offscreen.html','src/offscreen.js','src/audio-capture-worklet.js','src/live-captions.js','src/lib/wav.js','src/lib/live-pipeline.js']){
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
