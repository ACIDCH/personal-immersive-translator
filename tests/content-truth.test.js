import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
test('README runtime version and standard provider match the packaged PIT runtime',()=>{
 const wxt=read('apps/wxt-ui/wxt.config.ts');
 const version=wxt.match(/^\s+version:'([^']+)'/m)?.[1];
 assert.ok(version,'WXT manifest must contain a version');
 const readme=read('README.md');
 assert.match(readme,new RegExp('Version under development:\\*\\* '+version.replaceAll('.','\\.')));
 const defaultProvider=read('src/lib/settings.js').match(/standardProvider: '([^']+)'/)?.[1];
 assert.equal(defaultProvider,'google-free','Audit requires the publicly declared default to be explicit');
 assert.match(readme,/Fresh-install default: Google public keyless MT/);
 assert.match(readme,/docs\/CONTENT_SYSTEM_AUDIT_2026-10-21\.md/);
 assert.ok(existsSync(new URL('../docs/CONTENT_SYSTEM_AUDIT_2026-10-21.md',import.meta.url)));
});
test('product UI never claims unverified online availability based only on integration',()=>{
 const shell=read('apps/shared-ui/Shell.tsx');
 assert.match(shell,/受控测试通过/);
 assert.match(shell,/独立预览页面/);
 assert.doesNotMatch(shell,/status:'已接入'/);
 const text=read('src/options-v2.js');
 assert.match(text,/完整英文界面尚未完成/);
 assert.match(text,/严格原位替换/);
});
test('free online providers both disclose actual document-text transmission',()=>{
 const fileLab=read('apps/wxt-ui/entrypoints/file-lab/main.tsx');
 assert.match(fileLab,/\['mymemory','google-free'\]\.includes\(id\)/);
 assert.match(fileLab,/网页、视频及文件中明确发起的翻译原文将发送给该第三方/);
});
test('historical overview documents point to the current authoritative audit',()=>{
 for(const p of [
  'docs/PRD_zh-CN.md','docs/ARCHITECTURE.md','docs/ROADMAP.md',
  'docs/MODULE_STATUS_UI_zh-CN.md','docs/RELEASE_READINESS_zh-CN.md'
 ])assert.match(read(p),/CONTENT_SYSTEM_AUDIT_2026-10-21\.md/,p);
});

test('settings sidebar is grouped by task while preserving all stable deep links',()=>{
 const js=read('src/options-v2.js');
 assert.match(js,/const navGroups=\[/);
 for(const id of [
  'baseSettings','services','browserModelSettings','standardKeys','aiKeys',
  'experts','text','readingSettings','interaction','video','files',
  'cloudPdfSettings','terms','privacySettings','advanced','sync',
  'backupSettings','help'
 ])assert.ok(js.includes("['"+id+"',"),'Missing stable section '+id);
 assert.match(js,/navGroups\.flatMap/);
 const css=read('src/product.css');
 assert.match(css,/\.pit-options-nav-group/);
});
