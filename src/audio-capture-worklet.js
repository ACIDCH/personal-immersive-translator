/* Worklet runs in Chrome's dedicated audio render thread, isolated from
 * page scripts. Collect mono PCM into ~250 ms transferable frames. No audio
 * is stored outside the explicit in-memory ASR queue.
 */
class PITCaptureProcessor extends AudioWorkletProcessor {
  constructor(){
    super();
    this.size=Math.max(1024,Math.round(sampleRate/4));
    this.chunk=new Float32Array(this.size);
    this.position=0;
    this.stopped=false;
    this.port.onmessage=(event)=>{
      if(event.data?.type==='stop')this.stopped=true;
    };
  }
  process(inputs){
    if(this.stopped)return false;
    const channels=inputs[0];
    if(!channels?.length || !channels[0]?.length)return true;
    const left=channels[0],right=channels[1];
    for(let i=0;i<left.length;i++){
      const l=left[i]||0,r=right?.[i]??l;
      this.chunk[this.position++]=(l+r)/2;
      if(this.position>=this.size){
        const ready=this.chunk;
        this.chunk=new Float32Array(this.size);
        this.position=0;
        this.port.postMessage(ready,[ready.buffer]);
      }
    }
    return true;
  }
}
registerProcessor('pit-capture',PITCaptureProcessor);
