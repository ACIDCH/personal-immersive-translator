import test from 'node:test';
import assert from 'node:assert/strict';
import {BoundedAudioQueue,LiveStats} from '../src/lib/live-pipeline.js';

// Thirty minutes of virtual 16kHz audio, with an intentionally slow local ASR
// taking nine seconds per clip. No audio, private data or paid APIs are used.
// This proves only bounded backlog, NOT real device inference latency.
test('30-minute simulated speech cannot grow an unbounded queue',()=>{
 const q=new BoundedAudioQueue(16000,6),stats=new LiveStats();
 const chunk=new Float32Array(8000).fill(.05); // 500ms audio
 let nextReady=0,maximum=0,dispatched=0;
 for(let i=0;i<3600;i++){
   q.push(chunk);
   maximum=Math.max(maximum,q.length);
   if(i%6===5 && i>=nextReady){
     const audio=q.take();
     if(audio.length){
       dispatched++;
       stats.record(9000); // synthetic, intentionally slower than each 3s chunk
       nextReady=i+18;
     }
   }
 }
 assert.ok(dispatched>100,dispatched);
 assert.ok(maximum<=96000,maximum);
 assert.ok(q.droppedSamples>0,'slow inference should drop stale audio');
 assert.equal(stats.snapshot().p95Ms,9000);
 assert.ok(stats.snapshot().requests<1000,'no request storm');
});
test('30-minute simulated bursts still allow immediate stop memory cleanup',()=>{
 const q=new BoundedAudioQueue(48000,6);
 const samples=new Float32Array(4096).fill(.1);
 for(let i=0;i<2500;i++)q.push(samples);
 assert.ok(q.length<=288000);
 q.clear();
 assert.equal(q.length,0);
 assert.equal(q.take().length,0);
});
