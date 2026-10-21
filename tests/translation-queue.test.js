import test from 'node:test';
import assert from 'node:assert/strict';
import {PriorityTranslationQueue,translateKeylessSliced} from '../src/lib/translation-queue.js';
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
 assert.deepEqual(await q.enqueue(async()=>['真实译文']),['真实译文']);
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

test('a long web request yields after two paragraphs so an arrived live caption gets priority',async()=>{
 const queue=new PriorityTranslationQueue(),calls=[];
 let releaseFirst;
 const firstStarted=new Promise(resolve=>{
  releaseFirst=resolve;
 });
 // First slice blocks until test releases it; subtitle arrives while queued.
 let ready;
 const started=new Promise(resolve=>{ready=resolve;});
 const web=translateKeylessSliced(queue,['one','two','three','four','five'],
  {requestContext:'article'},async parts=>{
   calls.push('article:'+parts.join('+'));
   if(parts[0]==='one'){ready();await firstStarted;}
   return parts.map(t=>'zh:'+t);
  });
 await started;
 const caption=queue.enqueue(async()=>{calls.push('video');return ['字幕'];},{
  context:'video'
 });
 releaseFirst();
 assert.deepEqual(await web,['zh:one','zh:two','zh:three','zh:four','zh:five']);
 assert.deepEqual(await caption,['字幕']);
 assert.deepEqual(calls,[
  'article:one+two','video','article:three+four','article:five'
 ]);
});
test('a failing public web slice does not misreport a completed article',async()=>{
 const q=new PriorityTranslationQueue();
 await assert.rejects(translateKeylessSliced(q,['one','two','three'],{
  requestContext:'article'
 },async parts=>parts.includes('three')?['   ']:parts.map(x=>'translated '+x)),
 /incomplete sub-batch/);
 assert.equal(q.waiting,0);
});
