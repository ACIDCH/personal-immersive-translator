import assert from 'node:assert/strict';
import {readFileSync,statSync,existsSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {execFileSync} from 'node:child_process';
const root=resolve(process.argv[2]||'upstream/fluentread');
const pin='877ee77b5e3c905f6cc016db63633342dceb2419';
assert.equal(execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),pin,'upstream SHA mismatch');
assert.match(readFileSync(join(root,'LICENSE'),'utf8'),/GNU GENERAL PUBLIC LICENSE[\s\S]*Version 3/);
const dist=join(root,'.output/chrome-mv3');
const manifest=JSON.parse(readFileSync(join(dist,'manifest.json'),'utf8'));
assert.equal(manifest.manifest_version,3);
assert.equal(typeof manifest.background?.service_worker,'string');
assert(existsSync(join(dist,manifest.background.service_worker)),'Missing MV3 service worker');
const scripts=(manifest.content_scripts||[]).flatMap(x=>x.js||[]);
assert(scripts.length>0&&scripts.every(x=>existsSync(join(dist,x))),'Missing content scripts');
const popup=manifest.action?.default_popup;
assert(popup&&existsSync(join(dist,popup)),'Missing popup');
const report={engine:'FluentRead',upstream:'FluentRead/FluentRead',sha:pin,license:'GPL-3.0',
  built:true,mv3:true,content_scripts:scripts.length,
  background_bytes:statSync(join(dist,manifest.background.service_worker)).size,
  popup_bytes:statSync(join(dist,popup)).size,
  native_page_translation:'NOT_TESTED',translation_quality:'NOT_TESTED'};
writeFileSync('fluentread-build-report.json',JSON.stringify(report,null,2)+'\n');
console.log('FLUENTREAD BUILD:',JSON.stringify(report));
