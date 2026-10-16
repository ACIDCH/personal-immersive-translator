/* Opt-in local Whisper tab audio capture. No persistent audio storage.
 * Audio capture uses authorized Chrome tabCapture; speech TEXT subsequently
 * goes to the user's selected standard translation provider.
 */
import {encodeMonoPcm16,averageEnergy,resampleChunks,ASR_SAMPLE_RATE} from './lib/wav.js';
import {LiveStats,BoundedAudioQueue,makeAudioContext} from './lib/live-pipeline.js';
const SEGMENT_MS=3000;
const MAX_REQUESTS=1440; // explicit safety stop ~72 minutes of speech.
let current=null;
let epoch=0;
async function notify(type,payload){
  try{await chrome.runtime.sendMessage({type,...payload});}catch{}
}
async function dispose(c){
  if(!c)return;
  clearInterval(c.timer);
  c.abort?.abort();
  if(c.processor){
    if(c.processor.port){
      c.processor.port.onmessage=null;
      try{c.processor.port.postMessage({type:'stop'});}catch{}
    }
    c.processor.onaudioprocess=null;
    try{c.processor.disconnect();}catch{}
  }
  if(c.source){try{c.source.disconnect();}catch{}}
  if(c.mute){try{c.mute.disconnect();}catch{}}
  c.queue?.clear();
  c.stream?.getTracks().forEach(t=>t.stop());
  await c.context?.close().catch(()=>{});
}
async function stop(){
  epoch++;
  const old=current;current=null;
  await dispose(old);
}
async function flush(c){
  if(current!==c)return;
  if(c.busy || Date.now()<(c.retryAt||0)){
    // Let the bounded queue preserve only recent samples; old audio cannot
    // create unlimited waiting time if Whisper inference is slower than speech.
    return;
  }
  const samples=c.queue.take();
  if(!samples.length || averageEnergy(samples)<0.008)return;
  if(c.attempts>=MAX_REQUESTS){
    await notify('PIT_ASR_ERROR',{tabId:c.tabId,message:'已到本次语音识别安全时长上限，请停止并重新启动。'});
    await stop();return;
  }
  c.attempts++;
  c.busy=true;
  const capturedAt=Date.now();
  const started=performance.now();
  const droppedNow=c.queue.droppedSamples-c.lastDroppedSamples;
  c.lastDroppedSamples=c.queue.droppedSamples;
  if(droppedNow>0)c.stats.drop(Math.max(1,Math.ceil(droppedNow/(c.context.sampleRate*SEGMENT_MS/1000))));
  c.abort=new AbortController();
  try{
    const data=resampleChunks(samples,c.context.sampleRate,ASR_SAMPLE_RATE);
    const wav=encodeMonoPcm16(data,ASR_SAMPLE_RATE);
    const body=new FormData();body.append('audio',wav,'chunk.wav');
    const response=await fetch('http://127.0.0.1:8765/asr',{
      method:'POST',headers:{'X-PIT-Token':c.token},body,
      signal:AbortSignal.any([c.abort.signal,AbortSignal.timeout(15000)])
    });
    if(!response.ok)throw Error('Whisper HTTP '+response.status);
    const result=await response.json();
    if(current!==c)return;
    const asrMs=Math.round(performance.now()-started);
    c.failures=0;c.retryAt=0;
    c.stats.record(asrMs);
    const text=String(result.text||'').trim().slice(0,5000);
    if(asrMs>12000){
      c.stats.drop(1);
      await notify('PIT_ASR_ERROR',{tabId:c.tabId,
        message:'本机识别延迟超过 12 秒，已跳过过期字幕。请使用较小的 Whisper 模型。'});
    }else if(text){
      await notify('PIT_ASR_RESULT',{tabId:c.tabId,text,capturedAt,segmentMs:SEGMENT_MS,asrMs});
    }
  }catch(e){
    if(current===c){
      c.stats.error();
      c.failures++;
      c.retryAt=Date.now()+Math.min(30000,3000*Math.pow(2,Math.min(c.failures-1,4)));
      if(c.failures>=4 || /Whisper HTTP (401|403|503)/.test(String(e?.message||e))){
        await notify('PIT_ASR_ERROR',{tabId:c.tabId,
          message:'本机识别连续失败，音频已自动停止，请核查模型、令牌和服务配置。'});
        await stop();
        await notify('PIT_ASR_STREAM_ENDED',{tabId:c.tabId});
      }else await notify('PIT_ASR_ERROR',{tabId:c.tabId,
        message:'本机识别失败，将在稍后重试，不会累积过期音频。'});
    }
  }finally{
    if(current===c){
      await notify('PIT_ASR_METRICS',{tabId:c.tabId,metrics:c.stats.snapshot()});
      c.busy=false;c.abort=null;
    }
  }
}
async function start({streamId,tabId,token}){
  await stop();
  const generation=++epoch;
  if(typeof token!=='string'||token.length<16||!Number.isInteger(tabId)||!streamId)throw Error('本地 ASR 会话参数不完整');
  let stream=null,context=null,c=null;
  try {
    stream=await navigator.mediaDevices.getUserMedia({audio:{mandatory:{
      chromeMediaSource:'tab',chromeMediaSourceId:streamId}},video:false});
    if(generation!==epoch){stream.getTracks().forEach(t=>t.stop());return {ok:false,error:'捕获已取消'};}
    context=makeAudioContext(AudioContext);
    const source=context.createMediaStreamSource(stream);
    const queue=new BoundedAudioQueue(context.sampleRate,6);
    let processor=null,modern=false;
    if(context.audioWorklet && typeof AudioWorkletNode==='function'){
      try{
        await context.audioWorklet.addModule(chrome.runtime.getURL('src/audio-capture-worklet.js'));
        processor=new AudioWorkletNode(context,'pit-capture',{
          numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[1]
        });
        modern=true;
      }catch{
        // A restricted Chrome profile may disable AudioWorklets. Use the
        // existing ScriptProcessor as a documented compatibility fallback.
      }
    }
    if(!processor)processor=context.createScriptProcessor(4096,1,1);
    const mute=context.createGain();mute.gain.value=0;
    source.connect(processor);
    processor.connect(mute);mute.connect(context.destination);
    source.connect(context.destination); // Preserve playback of captured tab.
    c={context,source,processor,mute,stream,tabId,token,queue,busy:false,
      timer:null,abort:null,stats:new LiveStats(120),lastDroppedSamples:0,attempts:0,failures:0,retryAt:0};
    if(generation!==epoch){await dispose(c);return {ok:false,error:'捕获已取消'};}
    current=c;
    if(modern){
      processor.port.onmessage=e=>{
        if(current!==c || !(e.data instanceof Float32Array))return;
        c.queue.push(e.data);
      };
    }else{
      processor.onaudioprocess=e=>{
        if(current!==c)return;
        c.queue.push(new Float32Array(e.inputBuffer.getChannelData(0)));
      };
    }
    stream.getAudioTracks().forEach(t=>t.addEventListener('ended',()=>{
      if(current===c)void (async()=>{
        await stop();
        // The audio track may end due to a player's device/permission change,
        // tab closure or Chrome revoking capture. Clear the service worker's
        // session too, rather than leaving a fake "recording" UI behind.
        await notify('PIT_ASR_STREAM_ENDED',{tabId:c.tabId});
      })();
    },{once:true}));
    await context.resume();
    if(generation!==epoch){await dispose(c);return {ok:false,error:'捕获已取消'};}
    c.timer=setInterval(()=>{void flush(c);},SEGMENT_MS);
    return {ok:true};
  }catch(e){
    if(current===c)current=null;
    if(c)await dispose(c);
    else {
      stream?.getTracks().forEach(t=>t.stop());
      await context?.close().catch(()=>{});
    }
    return {ok:false,error:'本机音频流初始化失败：'+String(e?.message||e)};
  }
}
chrome.runtime.onMessage.addListener((msg,_sender,respond)=>{
  if(msg?.target!=='offscreen')return false;
  if(msg.type==='PIT_OFFSCREEN_START'){
    start(msg).then(respond).catch(e=>respond({ok:false,error:String(e.message||e)}));
    return true;
  }
  if(msg.type==='PIT_OFFSCREEN_STOP'){
    stop().then(()=>respond({ok:true})).catch(e=>respond({ok:false,error:String(e.message||e)}));
    return true;
  }
  return false;
});
