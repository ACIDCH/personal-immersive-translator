import test from 'node:test';
import assert from 'node:assert/strict';

test('quick START then STOP is serialized without orphaned offscreen recorder',async()=>{
 let handler,open=false,pendingStart=null,opened=0,closed=0;
 const store=new Map(),calls=[],notifications=[];
 const session={
  async get(keys){return Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(k=>[k,store.get(k)]));},
  async set(obj){for(const [k,v] of Object.entries(obj))store.set(k,v);},
  async remove(keys){for(const key of (Array.isArray(keys)?keys:[keys]))store.delete(key);}
 };
 globalThis.chrome={
  runtime:{
   id:'pit-race-test',getURL:p=>'chrome-extension://pit-race-test/'+p,
   onInstalled:{addListener(){}},
   onMessage:{addListener(fn){handler=fn;}},
   async sendMessage(msg){
    calls.push(msg);
    if(msg.type==='PIT_OFFSCREEN_START')return new Promise(resolve=>{pendingStart=resolve;});
    return {ok:true};
   }
  },
  storage:{local:{setAccessLevel:async()=>{},get:async()=>({})},session},
  tabs:{
   query:async()=>[{id:44,url:'https://example.org/video'}],
   sendMessage:async(tabId,payload)=>{notifications.push({tabId,...payload});return {ok:true};},
   onRemoved:{addListener(){}},onUpdated:{addListener(){}}
  },
  tabCapture:{getMediaStreamId:async()=> 'test-stream'},
  offscreen:{
   hasDocument:async()=>open,
   createDocument:async()=>{assert.equal(open,false);open=true;opened++;},
   closeDocument:async()=>{assert.equal(open,true);open=false;closed++;}
  }
 };
 await import('../src/background.js');
 const ui={id:chrome.runtime.id};
 const dispatch=(msg,sender=ui)=>new Promise(resolve=>handler(msg,sender,resolve));
 const starting=dispatch({type:'PIT_ASR_START',tabId:44,token:'test-token-123456789'});
 for(let i=0;i<200 && !pendingStart;i++)await new Promise(resolve=>setImmediate(resolve));
 assert.equal(typeof pendingStart,'function','startup fixture should pause before offscreen reply');
 const stopping=dispatch({type:'PIT_ASR_STOP'});
 assert.equal(open,true,'STOP must wait for in-progress START transition');
 pendingStart({ok:true});
 const a=await starting,b=await stopping;
 assert.equal(a.ok,true);assert.equal(b.ok,true);
 assert.equal(open,false);assert.equal(opened,1);assert.equal(closed,1);
 assert.equal(store.has('pit_live_asr_session'),false);
 const startView=notifications.find(x=>x.type==='PIT_ASR_VIEW_START');
 const stopView=notifications.find(x=>x.type==='PIT_ASR_VIEW_STOP');
 assert.ok(startView&&stopView);
 assert.equal(stopView.sessionId,startView.sessionId);
 assert.ok(calls.some(x=>x.type==='PIT_OFFSCREEN_STOP'));
});
