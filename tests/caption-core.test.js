import test from 'node:test';
import assert from 'node:assert/strict';
import '../src/lib/caption-core.js';
const {normalizeCues,currentCue,upcomingCues,CaptionCache}=globalThis.PITCaptionCore;

test('normalizes out-of-order cues, filters invalid records and duplicates',()=>{
 const out=normalizeCues([
  {startTime:3,endTime:5,text:'<i>Bonjour</i>'},
  {startTime:0,endTime:2,text:'Hello'},
  {startTime:0,endTime:2,text:'Hello'},
  {startTime:4,endTime:2,text:'invalid'},
  {startTime:8,endTime:9,text:''}
 ]);
 assert.deepEqual(out.map(x=>x.text),['Hello','Bonjour']);
 assert.equal(out.length,2);
});
test('picks current timed cue and updates accurately when seeking',()=>{
 const cues=normalizeCues([{startTime:0,endTime:2,text:'a'},{startTime:5,endTime:8,text:'b'}]);
 assert.equal(currentCue(cues,1)?.text,'a');
 assert.equal(currentCue(cues,6)?.text,'b');
 assert.equal(currentCue(cues,3),null);
 assert.equal(currentCue(cues,0)?.text,'a');
});
test('fast playback prefetches a wider time window than 1x',()=>{
 const cues=normalizeCues([{startTime:16,endTime:18,text:'future'},{startTime:30,endTime:33,text:'far'}]);
 assert.equal(upcomingCues(cues,0,1).length,1);
 assert.equal(upcomingCues(cues,0,2).length,2);
});
test('caption cache deduplicates concurrent work and bounds memory',async()=>{
 const c=new CaptionCache(2), cues=normalizeCues([{startTime:0,endTime:1,text:'a'},{startTime:1,endTime:2,text:'b'}]);
 let calls=0, release;
 const first=c.prefetch(cues,async texts=>{calls++;await new Promise(resolve=>{release=resolve});return texts.map(x=>x.toUpperCase());});
 const second=await c.prefetch(cues,async()=>{calls++;return [];});
 assert.equal(second,0);assert.equal(calls,1);
 release();assert.equal(await first,2);
 assert.equal(c.get(cues[0].key),'A');
 c.put('c','C');assert.equal(c.has(cues[0].key),false);
 assert.equal(c.map.size,2);
});
test('retries failed subtitle batches instead of permanently marking them',async()=>{
 const c=new CaptionCache(), cues=normalizeCues([{startTime:0,endTime:1,text:'a'}]);
 await assert.rejects(c.prefetch(cues,async()=>{throw new Error('429')}),/429/);
 assert.equal(c.inflight.size,0);
 assert.equal(await c.prefetch(cues,async()=>['译文']),1);
 assert.equal(c.get(cues[0].key),'译文');
});

test('long captions remain accessible after seeking 4000 seconds',()=>{
 const raw=Array.from({length:5000},(_,i)=>({startTime:i,endTime:i+0.75,text:'cue '+i}));
 const near=normalizeCues(raw,4050);
 assert.ok(near.some(c=>c.text==='cue 4050'));
 assert.equal(currentCue(near,4050)?.text,'cue 4050');
 assert.ok(near.length<3000);
});

test('manual video subtitle source has strict ISO language validation',()=>{
 const {normalizeCaptionSource}=globalThis.PITCaptionCore;
 assert.equal(normalizeCaptionSource('fr-FR'),'fr');
 assert.equal(normalizeCaptionSource('zh-Hans'),'zh');
 assert.equal(normalizeCaptionSource('EN_us'),'en');
 assert.equal(normalizeCaptionSource('auto'),'');
 assert.equal(normalizeCaptionSource('unknown'),'');
 assert.equal(normalizeCaptionSource(null),'');
});
