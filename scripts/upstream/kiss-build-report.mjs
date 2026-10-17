import assert from 'node:assert/strict';
import {readFileSync,statSync,writeFileSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';

const root=resolve(process.argv[2]||'upstream/kiss');
const commit='7a7e2957ce2084d374f802b3537f2e0ca87cd7b8';
const actual=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
assert.equal(actual,commit,'upstream source changed: abort comparison');
const license=readFileSync(join(root,'LICENSE'),'utf8');
assert(license.includes('GNU GENERAL PUBLIC LICENSE') && license.includes('Version 3'),'Missing expected upstream GPL-3.0');
const pkg=JSON.parse(readFileSync(join(root,'package.json'),'utf8'));
const manifestPath=join(root,'build/chrome/manifest.json');
assert(existsSync(manifestPath),'KISS MV3 build missing');
const manifest=JSON.parse(readFileSync(manifestPath,'utf8'));
assert.equal(manifest.manifest_version,3);
assert.equal(manifest.background.type,'module');
assert.equal(typeof manifest.background.service_worker,'string');
assert(existsSync(join(root,'build/chrome',manifest.background.service_worker)),'KISS service worker not built');
const scripts=manifest.content_scripts.flatMap(x=>x.js||[]);
assert(scripts.length && scripts.every(x=>existsSync(join(root,'build/chrome',x))),'KISS content scripts not built');
const popup=manifest.action?.default_popup;
assert(popup && existsSync(join(root,'build/chrome',popup)),'KISS popup absent');
const result={
  engine:'KISS Translator',source:'fishjar/kiss-translator',commit,
  license:'GPL-3.0',version:pkg.version,
  build:{passed:true,mv3:true,popup:true,service_worker:true,content_scripts:scripts.length},
  output_bytes:{background:statSync(join(root,'build/chrome',manifest.background.service_worker)).size,
   popup:statSync(join(root,'build/chrome',popup)).size},
  translation_functional_test:'NOT_RUN',
  translation_quality:'NOT_EVALUATED',
  status:'build_and_manifest_only'
};
writeFileSync('kiss-build-report.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result));
