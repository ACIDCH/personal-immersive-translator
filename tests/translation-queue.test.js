import test from 'node:test';
import assert from 'node:assert/strict';
import {PriorityTranslationQueue} from '../src/lib/translation-queue.js';
test('video subtitle requests go ahead of queued document batches, without preemption',async()=>{
 const q=new PriorityTranslationQueue();
 const events=[];
 let resume;
 const first=q.enqueue(async()=>{events.push('document-1');await new Promise(r=>resume=r);},{
  context:'document'
 });
 const second=q.enqueue(async()=>{events.push('document-2');},{context:'document'});
 const subtitle=q.enqueue(async()=>{events.push('video');},{context:'video'});
 await Promise.resolve();
 resume();
 await Promise.all([first,second,subtitle]);
 assert.deepEqual(events,['document-1','video','document-2']);
 assert.equal(q.waiting,0);
});
test('failed provider does not block subsequent translation and no paid route is invoked',async()=>{
 const q=new PriorityTranslationQueue();
 await assert.rejects(q.enqueue(async()=>{throw Error('HTTP 429');}),/429/);
 assert.equal(await q.enqueue(async()=>['真实译文']),['真实译文']);
 assert.equal(q.busy,false);
});
test('public queue bounds pending memory and signals backpressure',async()=>{
 const q=new PriorityTranslationQueue({maxQueued:1});
 let done;
 const blocking=q.enqueue(async()=>new Promise(r=>done=r));
 const queued=q.enqueue(async()=>true,{context:'video'});
 await assert.rejects(q.enqueue(async()=>true),/队列已满/);
 done();
 await Promise.all([blocking,queued]);
 assert.equal(q.waiting,0);
});
