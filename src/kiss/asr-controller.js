/**
 * PIT speech/caption controller for a pinned KISS MV3 module service worker.
 * The original KISS background.js remains imported by background-entry.js.
 * No media bytes ever leave the opt-in local Whisper offscreen pipeline.
 */
import {translateBatch} from '../lib/providers.js';
import {normalizeSettings,SETTINGS_KEY} from '../lib/settings.js';
import {sendToView} from './view-client.js';
import {checkWhisperReady} from './whisper-readiness.js';

const KEYS=['pit_live_asr_tab','pit_live_asr_session'];
const OFFSCREEN='pit/offscreen.html';
const offscreenWaiters=new Set(),pendingOffscreen=new Map();
let offscreenPort=null,sequence=0;
async function waitOffscreen(){
 if(offscreenPort)return offscreenPort;
 return new Promise((resolve,reject)=>{
   const done=p=>{clearTimeout(timer);offscreenWaiters.delete(done);resolve(p);};
   const timer=setTimeout(()=>{
     offscreenWaiters.delete(done);reject(Error('Whisper offscreen transport did not connect'));
   },8000);
   offscreenWaiters.add(done);
 });
}
async function commandOffscreen(type,extra={}){
 const port=await waitOffscreen();
 return new Promise((resolve,reject)=>{
   const id=++sequence;
   const timer=setTimeout(()=>{
     pendingOffscreen.delete(id);reject(Error('Whisper offscreen operation timed out'));
   },15000);
   pendingOffscreen.set(id,{resolve,reject,timer});
   try{port.postMessage({kind:'command',seq:id,type,...extra});}
   catch(e){clearTimeout(timer);pendingOffscreen.delete(id);reject(e);}
 });
}
let transition=Promise.resolve();
const serial=fn=>{const p=transition.then(fn,fn);transition=p.catch(()=>{});return p;};
const ctrlUrl=chrome.runtime.getURL('pit/control.html');
function isController(sender){return sender.id===chrome.runtime.id&&
  typeof sender.url==='string'&&sender.url.split('?')[0]===ctrlUrl;}
function must(b,msg){if(!b)throw Error(msg);}
const session=()=>chrome.storage.session.get(KEYS);
async function stop(){
  const old=await session();
  await chrome.storage.session.remove(KEYS);
  try{
    if(await chrome.offscreen.hasDocument()){
      if(offscreenPort)await commandOffscreen('PIT_OFFSCREEN_STOP').catch(()=>{});
      await chrome.offscreen.closeDocument();
    }
  }catch{}
  if(Number.isInteger(old.pit_live_asr_tab))
    await sendToView(old.pit_live_asr_tab,{
      type:'PIT_ASR_VIEW_STOP',sessionId:old.pit_live_asr_session
    }).catch(()=>{});
  return {stopped:true};
}
async function start(msg){
  const id=msg.tabId;
  must(Number.isInteger(id)&&id>0,'无效的目标网页标签页');
  must(typeof msg.token==='string'&&msg.token.length>=16,'请输入本机 Whisper 服务令牌');
  const tab=await chrome.tabs.get(id);
  must(/^https?:\/\//.test(tab?.url||''),'只能录制当前用户选择的网页');
  // Link from the KISS popup binds this window's selected recording URL.
  must(tab.url===msg.expectedUrl,'目标页面已经跳转，请重新打开控制面板');
  // Fail before tearing down an already-running session if local Whisper
  // is offline, the token is wrong or the model is unavailable.
  await checkWhisperReady(msg.token);
  await stop();
  const permission=await chrome.permissions.contains({origins:['http://127.0.0.1/*']});
  must(permission,'未授予本机 Whisper 服务访问权限');
  await chrome.scripting.insertCSS({target:{tabId:id},files:['pit/content.css']});
  await chrome.scripting.executeScript({target:{tabId:id},files:[
    'pit/bridge-client.js','pit/live-captions.js'
  ]});
  await chrome.offscreen.createDocument({url:OFFSCREEN,reasons:['USER_MEDIA'],
    justification:'用户明确启动的当前标签页本机 Whisper 实时语音字幕'});
  try{
    const streamId=await chrome.tabCapture.getMediaStreamId({targetTabId:id});
    const sessionId=crypto.randomUUID();
    await chrome.storage.session.set({
      pit_live_asr_tab:id,pit_live_asr_session:sessionId});
    const activated=await commandOffscreen('PIT_OFFSCREEN_START',
      {streamId,tabId:id,token:msg.token,sessionId});
    must(activated?.ok,'本机音频捕获失败：'+(activated?.error||'未知错误'));
    const now=await session();
    must(now.pit_live_asr_tab===id&&now.pit_live_asr_session===sessionId,
      '实时字幕会话已提前结束');
    const view=await sendToView(id,{type:'PIT_ASR_VIEW_START',sessionId});
    must(view?.ok===true,'网页实时字幕显示模块未就绪');
    return {started:true,sessionId};
  }catch(e){await stop();throw e;}
}
async function fromOffscreen(msg,sender){
  must(sender.url===chrome.runtime.getURL(OFFSCREEN),'ASR 消息来源无效');
  const current=await session();
  if(!current.pit_live_asr_tab||current.pit_live_asr_tab!==msg.tabId||
    current.pit_live_asr_session!==msg.sessionId)return {ignored:true};
  if(msg.type==='PIT_ASR_STREAM_ENDED')
    return serial(async()=>{
      const latest=await session();
      if(latest.pit_live_asr_session!==msg.sessionId)return {ignored:true};
      await stop();
      await sendToView(msg.tabId,{type:'PIT_ASR_INTERRUPTED_VIEW',
        sessionId:msg.sessionId}).catch(()=>{});
      return {stopped:true};
    });
  const name=msg.type==='PIT_ASR_RESULT'?'PIT_ASR_TEXT_VIEW':
    msg.type==='PIT_ASR_ERROR'?'PIT_ASR_ERROR_VIEW':'PIT_ASR_METRICS_VIEW';
  const out={type:name,sessionId:msg.sessionId};
  if(name==='PIT_ASR_TEXT_VIEW'){
    out.text=String(msg.text||'').slice(0,5000);
    out.capturedAt=Number(msg.capturedAt)||Date.now();
    out.segmentMs=Number(msg.segmentMs)||0;
    out.asrMs=Number(msg.asrMs)||0;
  }else if(name==='PIT_ASR_ERROR_VIEW')out.message=String(msg.message||'').slice(0,300);
  else{
    const m=msg.metrics||{};
    out.metrics=Object.fromEntries(['requests','dropped','errors','p50Ms','p95Ms']
      .map(k=>[k,Number(m[k])||0]));
  }
  await sendToView(msg.tabId,out).catch(()=>{});
  return {forwarded:true};
}
async function translate(msg,sender){
  must(sender.id===chrome.runtime.id&&sender.tab?.id,'只允许网页内容脚本请求字幕翻译');
  must(Array.isArray(msg.texts)&&msg.texts.length>0&&msg.texts.length<=5 &&
    msg.texts.every(x=>typeof x==='string'&&x.length>0&&x.length<=3000),
  '字幕文本格式无效');
  must(['standard','ai'].includes(msg.mode),'字幕翻译模式无效');
  if(msg.mode==='ai')must(msg.userInitiated===true&&!msg.transient,
    'AI 翻译只能由用户主动开启且不能用于实时语音');
  if(msg.transient){
    must(msg.mode==='standard','实时语音只使用普通机器翻译');
    const active=await session();
    must(active.pit_live_asr_tab===sender.tab.id&&
      active.pit_live_asr_session===msg.sessionId,'已失效的语音会话');
  }
  const setting=normalizeSettings((await chrome.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY]);
  const provider=msg.mode==='ai'?setting.aiProvider:setting.standardProvider;
  const values=await translateBatch(msg.texts,{...setting,provider});
  return {translations:values,provider};
}
async function handle(msg,sender){
  if(['PIT_ASR_START','PIT_ASR_STOP','PIT_ASR_STATUS','PIT_ASR_PREFLIGHT'].includes(msg.type)){
    must(isController(sender),'只能从本人控制面板管理音频录制');
    if(msg.type==='PIT_ASR_START')return serial(()=>start(msg));
    if(msg.type==='PIT_ASR_STOP')return serial(stop);
    if(msg.type==='PIT_ASR_PREFLIGHT')return checkWhisperReady(msg.token);
    const active=await session();
    return {active:!!active.pit_live_asr_session,tabId:active.pit_live_asr_tab||null};
  }
  if(['PIT_ASR_RESULT','PIT_ASR_ERROR','PIT_ASR_METRICS','PIT_ASR_STREAM_ENDED'].includes(msg.type))
    return fromOffscreen(msg,sender);
  if(msg.type==='PIT_SIDECAR_TRANSLATE')return translate(msg,sender);
  throw Error('Unsupported PIT command');
}
// KISS registers its own onMessage polyfill. A different Port transport
// prevents it from intercepting our status/caption requests with an error.
chrome.runtime.onConnect.addListener(port=>{
 if(port.name==='pit-offscreen-v046'){
   if(port.sender?.url!==chrome.runtime.getURL(OFFSCREEN)){
     port.disconnect();return;
   }
   offscreenPort=port;
   for(const waiter of offscreenWaiters)waiter(port);
   port.onDisconnect.addListener(()=>{
     if(offscreenPort===port)offscreenPort=null;
     for(const pending of pendingOffscreen.values()){
       clearTimeout(pending.timer);pending.reject(Error('Whisper offscreen disconnected'));
     }
     pendingOffscreen.clear();
   });
   port.onMessage.addListener(msg=>{
     if(msg?.kind==='reply'){
       const pending=pendingOffscreen.get(msg.seq);
       if(!pending)return;
       pendingOffscreen.delete(msg.seq);clearTimeout(pending.timer);
       pending.resolve(msg);
     }else if(msg?.kind==='event'){
       void fromOffscreen(msg,port.sender).catch(()=>{});
     }
   });
   return;
 }
 if(port.name!=='pit-v046')return;
 port.onMessage.addListener(msg=>{
   Promise.resolve().then(()=>handle(msg,port.sender))
     .then(result=>{try{port.postMessage({ok:true,...result});}catch{}})
     .catch(e=>{try{port.postMessage({ok:false,error:String(e.message||e).slice(0,300)});}catch{}});
 });
});
async function stopIfMatching(id){
  const observed=await session();
  if(observed.pit_live_asr_tab!==id)return;
  await serial(async()=>{
    const now=await session();
    if(now.pit_live_asr_tab===id&&now.pit_live_asr_session===observed.pit_live_asr_session)
      await stop();
  });
}
chrome.tabs.onRemoved.addListener(id=>{void stopIfMatching(id).catch(()=>{});});
chrome.tabs.onUpdated.addListener((id,change)=>{
 if(change.status==='loading')void stopIfMatching(id).catch(()=>{});
});