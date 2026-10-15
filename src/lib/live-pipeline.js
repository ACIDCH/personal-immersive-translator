/** Small, bounded monitoring and audio queue for opt-in local ASR.
 * Only aggregate timing/counters, never text, URL, audio or credentials. */
export class LiveStats {
  constructor(limit=120){this.limit=Math.max(1,limit);this.samples=[];this.dropped=0;this.requests=0;this.errors=0;}
  record(ms){
    if(!Number.isFinite(ms)||ms<0)return;
    this.samples.push(Math.round(ms));
    if(this.samples.length>this.limit)this.samples.shift();
    this.requests++;
  }
  drop(n=1){this.dropped+=Math.max(0,Math.floor(n));}
  error(){this.errors++;}
  snapshot(){
    const sorted=[...this.samples].sort((a,b)=>a-b);
    const quantile=p=>sorted.length?sorted[Math.ceil(p*sorted.length)-1]:null;
    return {requests:this.requests,dropped:this.dropped,errors:this.errors,
      p50Ms:quantile(.5),p95Ms:quantile(.95)};
  }
}
export class BoundedAudioQueue {
  constructor(sampleRate,maxSeconds=6){
    if(!Number.isFinite(sampleRate)||sampleRate<8000||sampleRate>192000)throw Error('invalid rate');
    this.maxSamples=Math.floor(sampleRate*maxSeconds);
    this.chunks=[];this.length=0;this.droppedSamples=0;
  }
  push(chunk){
    if(!(chunk instanceof Float32Array))throw Error('expected audio Float32Array');
    this.chunks.push(chunk);this.length+=chunk.length;
    while(this.length>this.maxSamples && this.chunks.length){
      const first=this.chunks.shift();this.length-=first.length;this.droppedSamples+=first.length;
    }
  }
  take(){
    const taken=this.chunks;this.chunks=[];this.length=0;return taken;
  }
  clear(){this.chunks.length=0;this.length=0;}
}
