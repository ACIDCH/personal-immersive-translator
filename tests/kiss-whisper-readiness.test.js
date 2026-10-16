import test from 'node:test';
import assert from 'node:assert/strict';
import {checkWhisperReady} from '../src/kiss/whisper-readiness.js';
const token='fake-local-only-token-12345678';
test('accepts local ASR readiness independent of PDF/BabelDOC readiness',async()=>{
 const fake=async(url,opts)=>{
  assert.equal(url,'http://127.0.0.1:8765/health');
  assert.equal(opts.headers['X-PIT-Token'],token);
  assert.equal(opts.method,'GET');
  return {ok:true,status:200,json:async()=>({
    engine:'local-only',ready:false,speech_asr:true,
    speech_asr_backend:'faster',speech_asr_model_loaded:false
  })};
 };
 const result=await checkWhisperReady(token,fake);
 assert.equal(result.speech_asr,true);
 assert.equal(result.backend,'faster');
 assert.equal(result.model_loaded,false);
});
test('never probes without usable token',async()=>{
 await assert.rejects(checkWhisperReady('short',()=>{throw Error('not called');}),/访问令牌/);
});
test('bad token is distinguishable from local service offline',async()=>{
 await assert.rejects(checkWhisperReady(token,async()=>({status:401,ok:false})),/令牌/);
 await assert.rejects(checkWhisperReady(token,async()=>{throw Error('connection refused')}),/无法连接/);
});
test('rejects missing or malformed ASR status and incompatible engine',async()=>{
 const fake=json=>async()=>({ok:true,status:200,json:async()=>json});
 await assert.rejects(checkWhisperReady(token,fake({engine:'remote',speech_asr:true,speech_asr_backend:'faster'})),/不符合预期/);
 await assert.rejects(checkWhisperReady(token,fake({engine:'local-only',speech_asr:false,speech_asr_backend:'cli'})),/尚未准备好/);
 await assert.rejects(checkWhisperReady(token,fake({engine:'local-only',ready:true,speech_asr_backend:'faster'})),/不符合预期/);
});