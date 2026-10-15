/* Experimental opt-in tab audio capture. Never uploads audio beyond user's local
   loopback Whisper bridge. No persistent audio/video recording. */
import {encodeMonoPcm16,averageEnergy,resampleChunks,ASR_SAMPLE_RATE} from './lib/wav.js';
let current=null;
async function stop() {
 const old=current;current=null;
 if(!old)return;
 clearInterval(old.timer);
 old.processor.disconnect();
 old.output.disconnect();
 old.stream.getTracks().forEach(t=>t.stop());
 await old.context.close().catch(()=>{});
 old.buffers.length=0;
}
async function flush(c) {
 if(current!==c || c.busy)return;
 const buffers=c.buffers.splice(0);
 if(!buffers.length || averageEnergy(buffers)<0.008)return;
 c.busy=true;
 try {
  const wav=encodeMonoPcm16(resampleChunks(buffers,c.context.sampleRate,ASR_SAMPLE_RATE),ASR_SAMPLE_RATE);
  const body=new FormData();body.append('audio',wav,'chunk.wav');
  const response=await fetch('http://127.0.0.1:8765/asr',{
    method:'POST',headers:{'X-PIT-Token':c.token},body,
    signal:AbortSignal.timeout(80000)});
  if(!response.ok)throw new Error('Whisper HTTP '+response.status);
  const result=await response.json();
  const text=String(result.text||'').trim().slice(0,5000);
  if(text && current===c)chrome.runtime.sendMessage({type:'PIT_ASR_RESULT',tabId:c.tabId,text}).catch(()=>{});
 }catch(error){
  if(current===c)chrome.runtime.sendMessage({type:'PIT_ASR_ERROR',tabId:c.tabId,message:'本地 ASR 暂不可用：'+String(error.message||error)}).catch(()=>{});
 }finally{c.busy=false;}
}
async function start({streamId,tabId,token}) {
 await stop();
 if(typeof token!=='string'||token.length<16||!Number.isInteger(tabId))throw Error('本地 ASR 会话参数不完整');
 const stream=await navigator.mediaDevices.getUserMedia({audio:{mandatory:{
  chromeMediaSource:'tab',chromeMediaSourceId:streamId}},video:false});
 const context=new AudioContext({sampleRate:16000});
 const source=context.createMediaStreamSource(stream);
 const processor=context.createScriptProcessor(4096,1,1);
 const mute=context.createGain();mute.gain.value=0;
 source.connect(processor);processor.connect(mute);mute.connect(context.destination);
 source.connect(context.destination); // preserve normal tab sound
 const c={context,processor,output:source,stream,tabId,token,buffers:[],busy:false,timer:null};
 current=c;
 processor.onaudioprocess=(event)=>{
  if(current!==c)return;
  if(c.buffers.length>70){c.buffers.splice(0,35);} // bounded queue
  c.buffers.push(new Float32Array(event.inputBuffer.getChannelData(0)));
 };
 stream.getAudioTracks().forEach(t=>t.addEventListener('ended',()=>{void stop();},{once:true}));
 c.timer=setInterval(()=>{void flush(c);},5500);
 return {ok:true};
}
chrome.runtime.onMessage.addListener((msg,_sender,respond)=>{
 if(msg?.target!=='offscreen')return false;
 if(msg.type==='PIT_OFFSCREEN_START'){
  start(msg).then(result=>respond(result)).catch(err=>respond({ok:false,error:String(err.message||err)}));
  return true;
 }
 if(msg.type==='PIT_OFFSCREEN_STOP'){
  stop().then(()=>respond({ok:true})).catch(err=>respond({ok:false,error:String(err.message||err)}));
  return true;
 }
 return false;
});
