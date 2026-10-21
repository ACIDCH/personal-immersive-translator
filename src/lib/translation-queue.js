/**
 * Small MV3 service-worker translation queue.
 * Bound public HTTP bursts from simultaneous web, video and file requests.
 * Priority favors time-synchronized captions over bulk offline documents;
 * no request is silently switched to a different (potentially paid) service.
 */
export class PriorityTranslationQueue {
 constructor({maxQueued=64}={}){
  this.maxQueued=maxQueued;this.pending=[];this.busy=false;this.serial=0;
 }
 enqueue(operation,{context='article'}={}){
  if(typeof operation!=='function')return Promise.reject(Error('Invalid translation task'));
  if(this.pending.length>=this.maxQueued)
   return Promise.reject(Error('免费翻译服务请求队列已满，请稍后重试'));
  const score=context==='video'?0:context==='probe'?1:
   context==='article'?2:context==='document'?3:4;
  return new Promise((resolve,reject)=>{
   this.pending.push({operation,score,order:this.serial++,resolve,reject});
   void this.process();
  });
 }
 async process(){
  if(this.busy)return;
  this.busy=true;
  try{
   while(this.pending.length){
    this.pending.sort((a,b)=>a.score-b.score||a.order-b.order);
    const next=this.pending.shift();
    try{next.resolve(await next.operation());}
    catch(error){next.reject(error);}
   }
  }finally{
   this.busy=false;
  }
 }
 get waiting(){return this.pending.length;}
}

/**
 * Yield between bounded public-MT sub-batches. A single very long article
 * used to monopolize the service-worker serial queue with many HTTP calls,
 * making subtitle updates appear several seconds too late. A video job
 * arriving during an article slice is next in priority; no in-flight request
 * is cancelled or silently rerouted to a paid provider.
 */
export async function translateKeylessSliced(queue,texts,opts,translate){
 if(!Array.isArray(texts)||!texts.length)return [];
 const slices=[];let batch=[],size=0;
 for(const text of texts){
  if(typeof text!=='string')throw Error('Invalid public translation text');
  if(batch.length&&(batch.length>=2||size+text.length>2600)){
   slices.push(batch);batch=[];size=0;
  }
  batch.push(text);size+=text.length;
 }
 if(batch.length)slices.push(batch);
 const translated=[];
 for(const slice of slices){
  const values=await queue.enqueue(()=>translate(slice,opts),{
   context:opts?.requestContext||'article'
  });
  if(!Array.isArray(values)||values.length!==slice.length||
     values.some(t=>typeof t!=='string'||!t.trim()))
   throw Error('Public provider returned an incomplete sub-batch');
  translated.push(...values);
 }
 return translated;
}
