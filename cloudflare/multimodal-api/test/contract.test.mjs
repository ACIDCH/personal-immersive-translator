import test from 'node:test';
import assert from 'node:assert/strict';
import api from '../src/index.mjs';
const call=(path,method='GET')=>api.fetch(new Request('https://demo.workers.dev'+path,{method}));
test('health is explicit about scaffold stage',async()=>{
 const r=await call('/health');assert.equal(r.status,200);
 assert.equal((await r.json()).stage,'scaffold');
});
test('nonexistent billing-capable endpoints never return success',async()=>{
 const r=await call('/v1/translate','POST');assert.equal(r.status,501);
 assert.equal((await r.json()).error,'not_implemented');
});
test('capabilities do not pretend inference is enabled',async()=>{
 const r=await call('/v1/capabilities');assert.equal((await r.json()).ready,false);
});
