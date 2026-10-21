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
function transientPublicError(error){
 const status=Number(error?.status);
 return [429,500,502,503,504].includes(status)||
   (status===0 && /连接失败|超时|network|timeout|fetch failed/i.test(String(error?.message||'')))||
   (!Number.isFinite(status)&&/Google 免费接口连接失败或超时/.test(String(error?.message||'')));
}
function retryPublicDelay(error,attempt,context){
 const hinted=Number(error?.retryAfterMs);
 // Never thrash an endpoint that explicitly asks for a long cool-down.
 if(Number.isFinite(hinted)&&hinted>18000)return null;
 const start=context==='video'?650:context==='document'?3000:2200;
 const fallback=start*Math.pow(2,attempt);
 return Math.min(18000,Math.max(fallback,Number.isFinite(hinted)&&hinted>=0?hinted:0));
}
const sleep=milliseconds=>new Promise(resolve=>setTimeout(resolve,milliseconds));

/**
 * Limited public MT retries belong at the scheduling layer, NOT inside the
 * provider's parallel worker, otherwise a stalled article monopolizes the
 * video-priority queue. HTTP 429/5xx and connection timeouts may retry with
 * bounded backoff and optional Retry-After; malformed/blank translations,
 * auth errors and provider-limit messages are never retried.
 *
 * No invisible provider switch or paid AI fallback, and all partial slices
 * remain private until every slice returns a complete string array.
 */
export async function translateKeylessSliced(queue,texts,opts,translate){
 if(!Array.isArray(texts)||!texts.length)return [];
 const context=opts?.requestContext||'article';
 const slices=[];let batch=[],size=0;
 for(const part of texts){
  if(typeof part!=='string'||!part.trim())throw Error('Invalid public translation text');
  if(batch.length&&(batch.length>=2||size+part.length>2600)){
   slices.push(batch);batch=[];size=0;
  }
  batch.push(part);size+=part.length;
 }
 if(batch.length)slices.push(batch);
 const translated=[];
 for(let i=0;i<slices.length;i++){
  const slice=slices[i];
  // Moderate sustained whole-page throughput without delaying subtitle jobs.
  // Delay is OUTSIDE the serial queue so any waiting video has priority.
  if(i>0&&context==='article')await sleep(240);
  const maxRetries=context==='video'?1:2;
  let answer=null;
  for(let attempt=0;attempt<=maxRetries;attempt++){
   try{
    answer=await queue.enqueue(()=>translate(slice,opts),{context});
    if(!Array.isArray(answer)||answer.length!==slice.length||
       answer.some(t=>typeof t!=='string'||!t.trim()))
      throw Error('Public provider returned an incomplete sub-batch');
    break;
   }catch(error){
    if(attempt>=maxRetries||!transientPublicError(error))throw error;
    const delay=retryPublicDelay(error,attempt,context);
    if(delay===null)throw error;
    await sleep(delay);
   }
  }
  translated.push(...answer);
 }
 return translated;
}
