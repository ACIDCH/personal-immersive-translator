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
test('displays simultaneous subtitle cues without duplicating overlapping text',()=>{
 const {activeCues}=globalThis.PITCaptionCore;
 const cues=normalizeCues([
  {startTime:0,endTime:6,text:'speaker A'},
  {startTime:1,endTime:5,text:'speaker B'},
  {startTime:2,endTime:4,text:'speaker A'},
  {startTime:7,endTime:9,text:'speaker C'}
 ]);
 assert.deepEqual(activeCues(cues,3).map(x=>x.text),['speaker A','speaker B']);
 assert.deepEqual(activeCues(cues,8).map(x=>x.text),['speaker C']);
 assert.deepEqual(activeCues(cues,6.5),[]);
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

test('empty provider text never marks a subtitle as translated',async()=>{
 const c=new CaptionCache(), cues=normalizeCues([{startTime:0,endTime:4,text:'Actual speech'}]);
 await assert.rejects(c.prefetch(cues,async()=>['   ']),/did not match/);
 assert.equal(c.has(cues[0].key),false);
 assert.equal(c.inflight.size,0);
 assert.equal(await c.prefetch(cues,async()=>['真正译文']),1);
 assert.equal(c.get(cues[0].key),'真正译文');
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

test('KISS-inspired subtitle request dedup retains distinct cue timestamps and in-player placement',async()=>{
 const c=new CaptionCache(8);
 const cues=normalizeCues([
  {startTime:0,endTime:1,text:'Repeat after me'},
  {startTime:2,endTime:3,text:'Repeat after me'},
  {startTime:4,endTime:5,text:'Next phrase'}
 ]);
 let sent=[];
 assert.equal(await c.prefetch(cues,async texts=>{
  sent.push(texts);return texts.map(x=>'译文:'+x);
 }),3);
 assert.deepEqual(sent,[['Repeat after me','Next phrase']]);
 assert.deepEqual(cues.map(x=>c.get(x.key)),[
  '译文:Repeat after me','译文:Repeat after me','译文:Next phrase'
 ]);
 // Another timestamp reuses same session's phrase, without second remote call.
 const after=normalizeCues([{startTime:90,endTime:91,text:'Repeat after me'}]);
 assert.equal(await c.prefetch(after,async()=>{throw Error('Should be cached');}),1);
 assert.equal(c.get(after[0].key),'译文:Repeat after me');
 c.clear();
 assert.equal(c.map.size,0);
 assert.equal(c.byText.size,0);
});
test('failed translated cues never poison text-dedup cache',async()=>{
 const c=new CaptionCache(),cues=normalizeCues([
  {startTime:0,endTime:1,text:'same'},{startTime:1,endTime:2,text:'same'}
 ]);
 await assert.rejects(c.prefetch(cues,async()=>['  ']),/did not match/);
 assert.equal(c.map.size,0);
 assert.equal(c.byText.size,0);
 assert.equal(c.inflight.size,0);
 assert.equal(await c.prefetch(cues,async()=>['有效译文']),2);
 assert.equal(c.byText.get('same'),'有效译文');
});
test('caption text cache is size bounded independently from cue timing cache',async()=>{
 const c=new CaptionCache(2);
 const cues=normalizeCues([
  {startTime:0,endTime:1,text:'one'},
  {startTime:1,endTime:2,text:'two'},
  {startTime:2,endTime:3,text:'three'}
 ]);
 await c.prefetch(cues,async arr=>arr.map(x=>'T:'+x));
 assert.equal(c.byText.size,2);
 assert.equal(c.map.size,2);
 assert.equal(c.byText.has('one'),false);
});
