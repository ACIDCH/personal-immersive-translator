import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
test('AudioWorklet converts stereo to mono in bounded transferable blocks',()=>{
  let processor;
  class FakeProcessor{
    constructor(){this.port={onmessage:null,postMessage:(data,transfer)=>{
      events.push({data,transfer});
    }};}
  }
  const events=[];
  const sandbox={AudioWorkletProcessor:FakeProcessor,Float32Array,sampleRate:16000,
    registerProcessor:(name,ctor)=>{assert.equal(name,'pit-capture');processor=ctor;}};
  vm.runInNewContext(readFileSync(new URL('../src/audio-capture-worklet.js',import.meta.url),'utf8'),sandbox);
  const node=new processor();
  const left=new Float32Array(128).fill(.6),right=new Float32Array(128).fill(.2);
  for(let i=0;i<32;i++)assert.equal(node.process([[left,right]]),true);
  assert.equal(events.length,1,'one transfer per quarter second, not every callback');
  assert.equal(events[0].data.length,4000);
  assert.ok(Math.abs(events[0].data[200]-.4)<1e-6);
  assert.equal(events[0].transfer.length,1);
  node.port.onmessage({data:{type:'stop'}});
  assert.equal(node.process([[left,right]]),false);
  assert.equal(events.length,1);
});
