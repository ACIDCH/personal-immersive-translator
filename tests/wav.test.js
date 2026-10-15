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
