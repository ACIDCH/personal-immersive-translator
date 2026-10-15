import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeMonoPcm16,averageEnergy} from '../src/lib/wav.js';
test('valid mono 16kHz RIFF WAV output',async()=>{
 const wav=encodeMonoPcm16([new Float32Array([0,1,-1,.5])]);
 const bytes=await wav.arrayBuffer(),view=new DataView(bytes);
 assert.equal(String.fromCharCode(...new Uint8Array(bytes.slice(0,4))),'RIFF');
 assert.equal(view.getUint32(24,true),16000);assert.equal(view.getUint16(22,true),1);
 assert.equal(view.getInt16(46,true),32767);assert.equal(view.getInt16(48,true),-32768);
});
test('reject too long audio and estimate silence energy',()=>{
 assert.equal(averageEnergy([new Float32Array(100)]),0);
 assert.ok(averageEnergy([new Float32Array([1,-1])])>.5);
 assert.throws(()=>encodeMonoPcm16([new Float32Array(200000)]),/长度/);
});

test('48 kHz device audio is actually resampled to 16kHz, not relabeled',async()=>{
 const {resampleChunks,ASR_SAMPLE_RATE}=await import('../src/lib/wav.js');
 const samples=Float32Array.from({length:48000},(_,i)=>Math.sin(2*Math.PI*440*i/48000));
 const a=resampleChunks([samples.slice(0,11000),samples.slice(11000)],48000);
 assert.equal(a[0].length,16000);
 const wav=encodeMonoPcm16(a,ASR_SAMPLE_RATE);
 const bytes=new DataView(await wav.arrayBuffer());
 assert.equal(bytes.getUint32(24,true),16000);
 assert.equal(bytes.getUint32(40,true),32000);
 assert.ok(Math.abs(a[0][1000])<=1);
});
test('unsupported audio sample rates and excessive input are rejected',async()=>{
 const {resampleChunks}=await import('../src/lib/wav.js');
 assert.throws(()=>resampleChunks([new Float32Array([1,2])],NaN),/采样率/);
 assert.throws(()=>resampleChunks([new Float32Array(193000)],16000),/12 秒/);
});
