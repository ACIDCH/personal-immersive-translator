/** Task-scoped provider stability wrapper.
 * Caches repeated source strings only in memory for this user-initiated job.
 * Never retries invalid API credentials or content-policy errors.
 */
export type TranslateBatch=(texts:string[])=>Promise<string[]>;
export type RetryInfo={attempt:number;delayMs:number;reason:string};
export function createRecoverableTranslator(
  request:TranslateBatch,
  options:{signal?:AbortSignal;onRetry?:(info:RetryInfo)=>void;maxRetries?:number}={}
):TranslateBatch{
  const cache=new Map<string,string>();
  const maxRetries=Math.max(0,Math.min(3,options.maxRetries??2));
  const cancelled=()=>{
    if(options.signal?.aborted)throw new Error('用户已取消翻译');
  };
  const retryable=(error:unknown)=>{
    const message=String(error instanceof Error?error.message:error);
    return /(?:^|\D)(?:429|502|503|504)(?:\D|$)|rate.limit|too.many.requests|timed?\s*out|超时|限流|服务繁忙|暂时不可用|network|连接失败|connection.reset|fetch.failed/i.test(message);
  };
  const boundedRequest=(chunk:string[]):Promise<string[]>=>new Promise((resolve,reject)=>{
    // Chrome MV3 worker shutdown or a stalled provider must not leave a file
    // task displaying "busy" forever. This stops waiting only: it cannot
    // revoke a request already accepted by an external paid provider.
    if(options.signal?.aborted){reject(Error('用户已取消翻译'));return;}
    let settled=false;
    const cleanup=()=>{
      clearTimeout(timer);
      options.signal?.removeEventListener('abort',abort);
    };
    const finish=(callback:()=>void)=>{
      if(settled)return;
      settled=true;cleanup();callback();
    };
    const abort=()=>finish(()=>reject(Error('用户已取消翻译')));
    const timer=setTimeout(
      ()=>finish(()=>reject(Error('翻译服务超时（60 秒）；请检查服务状态后手动重试，避免重复收费'))),
      60000);
    options.signal?.addEventListener('abort',abort,{once:true});
    try{
      Promise.resolve(request(chunk)).then(
        values=>finish(()=>resolve(values)),
        error=>finish(()=>reject(error))
      );
    }catch(error){finish(()=>reject(error));}
  });
  const sleep=async (ms:number)=>{
    await new Promise<void>((resolve,reject)=>{
      if(options.signal?.aborted){reject(Error('用户已取消翻译'));return;}
      const done=()=>{clearTimeout(timer);options.signal?.removeEventListener('abort',abort);resolve();};
      const abort=()=>{clearTimeout(timer);options.signal?.removeEventListener('abort',abort);reject(Error('用户已取消翻译'));};
      const timer=setTimeout(done,ms);
      options.signal?.addEventListener('abort',abort,{once:true});
    });
  };
  return async texts=>{
    cancelled();
    if(!texts.length)return [];
    if(texts.length>8||texts.some(t=>typeof t!=='string'||!t.trim()||t.length>4500))
      throw Error('一次最多 8 个非空翻译段落，每段最多 4500 字符');
    const keys=texts.map(t=>t);
    const missing:string[]=[];
    const current=new Set<string>();
    for(const key of keys){
      if(!cache.has(key)&&!current.has(key)){
        missing.push(key);current.add(key);
      }
    }
    if(missing.length){
      // Background providers have a 12k-character request ceiling. The
      // front-end stays below 10.5k even for OCR paragraphs that can be long.
      for(let i=0;i<missing.length;){
        const chunk:string[]=[];let chars=0;
        for(let j=i;j<missing.length&&chunk.length<8;j++){
          if(chunk.length&&chars+missing[j].length>10500)break;
          chunk.push(missing[j]);chars+=missing[j].length;
        }
        let translated:string[]|undefined;
        for(let attempt=0;attempt<=maxRetries;attempt++){
          cancelled();
          try{
            const output=await boundedRequest(chunk);
            if(!Array.isArray(output)||output.length!==chunk.length||
              output.some(s=>typeof s!=='string'||!s.trim()))
              throw Error('翻译服务返回的段落数量不正确');
            translated=output;break;
          }catch(error){
            if(attempt>=maxRetries||!retryable(error))throw error;
            const delay=350*Math.pow(2,attempt);
            options.onRetry?.({attempt:attempt+1,delayMs:delay,
              reason:String(error instanceof Error?error.message:error).slice(0,160)});
            await sleep(delay);
          }
        }
        if(!translated)throw Error('翻译任务未得到有效响应');
        cancelled();
        // Commit independently after each validated provider request.
        // If the next chunk fails, retrying the same logical batch should
        // reuse successful fragments, not pay for them a second time.
        chunk.forEach((key,index)=>cache.set(key,translated[index]));
        i+=chunk.length;
      }
    }
    cancelled();
    return keys.map(key=>cache.get(key)!);
  };
}
