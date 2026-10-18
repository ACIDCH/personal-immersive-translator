import test from 'node:test';
import assert from 'node:assert/strict';
test('background discards stale offscreen ASR events and closes a valid session',async()=>{
 const values=new Map(),notices=[],commands=[];
 let listener,offscreenOpen=false,activeSession='';
 const session={
  async get(keys){return Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(k=>[k,values.get(k)]));},
  async set(obj){for(const [k,v] of Object.entries(obj))values.set(k,v);},
  async remove(keys){for(const k of (Array.isArray(keys)?keys:[keys]))values.delete(k);}
 };
 globalThis.chrome={
  runtime:{
   id:'pit-asr-test',getURL:path=>'chrome-extension://pit-asr-test/'+path,
   onInstalled:{addListener(){}},
   onMessage:{addListener(cb){listener=cb;}},
   async sendMessage(msg){commands.push(msg);if(msg.type==='PIT_OFFSCREEN_START')activeSession=msg.sessionId;return {ok:true};}
  },
  storage:{local:{setAccessLevel:async()=>{},get:async()=>({})},session},
  tabs:{
   query:async()=>[{id:31,url:'https://example.com/watch'}],
   sendMessage:async(id,msg)=>{notices.push({id,...msg});return {ok:true};},
   onRemoved:{addListener(){}},onUpdated:{addListener(){}}
  },
  tabCapture:{getMediaStreamId:async()=> 'fixture-stream'},
  offscreen:{
   hasDocument:async()=>offscreenOpen,
   createDocument:async()=>{offscreenOpen=true;},
   closeDocument:async()=>{offscreenOpen=false;}
  }
 };
 await import('../src/background.js');
 let modelReady=false;
 globalThis.fetch=async url=>{
   assert.equal(url,'http://127.0.0.1:8765/health');
   return {ok:modelReady,status:modelReady?200:503,
     json:async()=>({speech_asr:modelReady,speech_asr_requires_risk_ack:false})};
 };
 const request=(msg,sender)=>new Promise(resolve=>listener(msg,sender,resolve));
 const ui={id:chrome.runtime.id};
 const media={id:chrome.runtime.id,url:chrome.runtime.getURL('src/offscreen.html')};
 const blocked=await request({type:'PIT_ASR_START',tabId:31,token:'fixture-token-123456789'},ui);
 assert.equal(blocked.ok,false);
 assert.match(blocked.error,/健康检查失败/);
 assert.equal(offscreenOpen,false,'must never open tab audio before local model is ready');
 modelReady=true;
 const started=await request({type:'PIT_ASR_START',tabId:31,token:'fixture-token-123456789'},ui);
 assert.equal(started.ok,true);
 assert.match(activeSession,/^[0-9a-f-]{36}$/i);
 assert.equal(values.get('pit_live_asr_session'),activeSession);
 assert.equal(offscreenOpen,true);
 const old='11111111-1111-4111-8111-111111111111';
 const n=notices.length;
 assert.equal((await request({type:'PIT_ASR_STREAM_ENDED',tabId:31,sessionId:old},media)).ignored,true);
 assert.equal((await request({type:'PIT_ASR_RESULT',tabId:31,sessionId:old,text:'stale'},media)).ignored,true);
 assert.equal(notices.length,n);
 assert.equal(offscreenOpen,true);
 const live=await request({type:'PIT_ASR_RESULT',tabId:31,sessionId:activeSession,
  text:'Bonjour',language:'fr',languageConfidence:0.98},media);
 assert.equal(live.forwarded,true);
 assert.ok(notices.some(e=>e.type==='PIT_ASR_TEXT_VIEW'&&e.text==='Bonjour'&&e.language==='fr'));
 const invalid=await request({type:'PIT_ASR_RESULT',tabId:31,
  sessionId:activeSession,text:'untrusted',language:'unsupported'},media);
 assert.equal(invalid.forwarded,true);
 assert.equal(notices.findLast(e=>e.type==='PIT_ASR_TEXT_VIEW').language,undefined,
  'unknown Whisper languages may not become downstream MT hints');
 const ended=await request({type:'PIT_ASR_STREAM_ENDED',tabId:31,sessionId:activeSession},media);
 assert.equal(ended.stopped,true);
 assert.equal(offscreenOpen,false);
 assert.equal(values.has('pit_live_asr_session'),false);
 assert.equal(values.has('pit_live_asr_tab'),false);
 assert.ok(commands.some(e=>e.type==='PIT_OFFSCREEN_STOP'));
 assert.ok(notices.some(e=>e.type==='PIT_ASR_VIEW_STOP'));
 assert.ok(notices.some(e=>e.type==='PIT_ASR_INTERRUPTED_VIEW'));
 const m=notices.length;
 assert.equal((await request({type:'PIT_ASR_RESULT',tabId:31,sessionId:activeSession,text:'late'},media)).ignored,true);
 assert.equal(notices.length,m);
});
