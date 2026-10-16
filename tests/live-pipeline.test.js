import test from 'node:test';
import assert from 'node:assert/strict';
import {LiveStats,BoundedAudioQueue,makeAudioContext} from '../src/lib/live-pipeline.js';
test('latency metrics calculate p50/p95 from bounded samples',()=>{
 const s=new LiveStats(10);
 for(let i=1;i<=10;i++)s.record(i*100);
 s.drop(3);s.error();
 assert.deepEqual(s.snapshot(),{requests:10,dropped:3,errors:1,p50Ms:500,p95Ms:1000});
 s.record(1100);assert.equal(s.samples.length,10);assert.equal(s.snapshot().p50Ms,600);
});
test('bounded sample queue drops oldest during delayed ASR to prevent backlog',()=>{
 const q=new BoundedAudioQueue(16000,3);
 for(let i=0;i<10;i++)q.push(Float32Array.from({length:8000},()=>i));
 assert.ok(q.droppedSamples>0);assert.ok(q.length<=48000);
 const packets=q.take();assert.equal(q.length,0);
 assert.equal(packets.at(-1)[0],9);assert.ok(packets[0][0]>=4);
});
test('silence and invalid timing cannot distort monitoring',()=>{
 const s=new LiveStats();s.record(NaN);s.record(-2);
 assert.equal(s.snapshot().p50Ms,null);
 const q=new BoundedAudioQueue(48000,3);q.push(new Float32Array(4096));q.clear();
 assert.equal(q.length,0);
});

test('AudioContext falls back to 48 kHz device rate if 16k unsupported',()=>{
  let attempts=0;
  class FakeAudioContext {
    constructor(options){
      attempts++;
      if(options?.sampleRate===16000)throw Error('NotSupportedError');
      this.sampleRate=48000;
    }
  }
  const ctx=makeAudioContext(FakeAudioContext);
  assert.equal(ctx.sampleRate,48000);
  assert.equal(attempts,2);
});
test('AudioContext uses requested 16k if supported',()=>{
  class FakeAudioContext {constructor(options){this.sampleRate=options?.sampleRate||48000;}}
  assert.equal(makeAudioContext(FakeAudioContext).sampleRate,16000);
});

test('recognition safety cap uses dispatched request count',async()=>{
 const {MAX_ASR_REQUESTS,asrLimitReached}=await import('../src/lib/live-pipeline.js');
 assert.equal(MAX_ASR_REQUESTS,1440);
 assert.equal(asrLimitReached(1439),false);
 assert.equal(asrLimitReached(1440),true);
 assert.equal(asrLimitReached(1441),true);
 assert.equal(asrLimitReached(NaN),false);
});
