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
