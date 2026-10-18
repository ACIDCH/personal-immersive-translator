import test from 'node:test';
import assert from 'node:assert/strict';

test('explicit cloud ASR initializes remote Whisper without local Python',async()=>{
 const state=new Map(),outbound=[],notice=[];
 let listener,open=false,preflight=0,mt=0;
 const session={
  async get(keys){return Object.fromEntries((Array.isArray(keys)?keys:[keys])
     .map(k=>[k,state.get(k)]));},
  async set(value){for(const [k,v] of Object.entries(value))state.set(k,v);},
  async remove(keys){for(const k of (Array.isArray(keys)?keys:[keys]))state.delete(k);}
 };
 globalThis.chrome={
  runtime:{
   id:'pit-cloud-asr-fixture',getURL:p=>'chrome-extension://pit-cloud-asr-fixture/'+p,
   onInstalled:{addListener(){}},
   onMessage:{addListener(cb){listener=cb;}},
   async sendMessage(msg){outbound.push(msg);return {ok:true};}
  },
  storage:{
   local:{
    setAccessLevel:async()=>{},
    async get(key){
     if(key==='pit_settings_v1')return {pit_settings_v1:{
      source:'auto',target:'zh',standardProvider:'cloud',
      cloudEndpoint:'https://pit-cloud.example',cloudToken:'temporary-strong-token-12345'}};
     return {};
    }
   },session
  },
  tabs:{
   query:async()=>[{id:33,url:'https://example.org/video'}],
   sendMessage:async(id,msg)=>{notice.push(msg);return {ok:true};},
   onRemoved:{addListener(){}},onUpdated:{addListener(){}}
  },
  tabCapture:{getMediaStreamId:async()=> 'test-stream'},
  offscreen:{
   hasDocument:async()=>open,
   createDocument:async()=>{open=true;},
   closeDocument:async()=>{open=false;}
  }
 };
 globalThis.fetch=async(url,init)=>{
  if(String(url)==='https://pit-cloud.example/v1/capabilities'){
   preflight++;
   assert.equal(init.headers.Authorization,'Bearer temporary-strong-token-12345');
   return {ok:true,json:async()=>({ready:true,routes:{asr:'ready'}})};
  }
  if(String(url)==='https://pit-cloud.example/v1/translate'){
   mt++;
   const body=JSON.parse(init.body);
   assert.equal(body.source,'fr',
     'explicit Whisper speech language must outrank short-text English fallback');
   return {ok:true,json:async()=>({translations:['实时云端译文']})};
  }
  throw Error('Unexpected network URL '+url);
 };
 await import('../src/background.js');
 const dispatch=(msg,sender={id:chrome.runtime.id})=>
  new Promise(resolve=>listener(msg,sender,resolve));
 const absent=await dispatch({type:'PIT_ASR_START',tabId:33,asrBackend:'cloud'});
 assert.equal(absent.ok,false);
 assert.equal(open,false);
 assert.equal(preflight,0);
 const result=await dispatch({type:'PIT_ASR_START',tabId:33,
  asrBackend:'cloud',userInitiated:true});
 assert.equal(result.ok,true,JSON.stringify(result));
 assert.equal(preflight,1);
 assert.equal(open,true);
 const started=outbound.find(x=>x.type==='PIT_OFFSCREEN_START');
 assert.equal(started.asrBackend,'cloud');
 assert.equal(started.cloudEndpoint,'https://pit-cloud.example/v1/asr');
 assert.equal(started.token,'temporary-strong-token-12345');
 assert.ok(notice.some(x=>x.type==='PIT_ASR_VIEW_START'));
 const site={id:chrome.runtime.id,tab:{id:33,url:'https://example.org/video'},
             url:'https://example.org/video'};
 const translated=await dispatch({type:'TRANSLATE_BATCH',mode:'standard',
   transient:true,sessionId:started.sessionId,texts:['Bonjour'],
   captionSourceLanguage:'fr'},site);
 assert.equal(translated.ok,true,JSON.stringify(translated));
 assert.deepEqual(translated.translations,['实时云端译文']);
 assert.equal(mt,1);
 const ended=await dispatch({type:'PIT_ASR_STOP'});
 assert.equal(ended.ok,true);
 assert.equal(open,false);
});
