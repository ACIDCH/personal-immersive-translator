import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

const script='benchmarks/real_translation_provider_acceptance.mjs';
const env={...process.env};
for(const key of Object.keys(env))if(key.startsWith('PIT_TEST_'))delete env[key];

test('real-vendor acceptance refuses default execution without explicit billing consent',()=>{
  const done=spawnSync(process.execPath,[script,'--provider','gemini'],{
    env,encoding:'utf8',timeout:3000});
  assert.equal(done.status,2);
  assert.match(done.stderr,/billing consent/i);
  assert.ok(!done.stdout.includes('gemini-2.5-flash'));
});
test('real-vendor acceptance refuses acknowledged call without explicitly supplied credentials',()=>{
  const done=spawnSync(process.execPath,[script,'--provider','gemini','--acknowledge-billed-requests'],{
    env,encoding:'utf8',timeout:3000});
  assert.equal(done.status,2);
  assert.match(done.stderr,/No provider credential/);
});
