import test from 'node:test';
import assert from 'node:assert/strict';

test('live Whisper AI requires UI consent, matches ASR session and stops after 80 requests',async()=>{
  const store=new Map(),messages=[],notices=[];
  let handler=null,open=false,calls=0;
  const session={
    async get(keys){return Object.fromEntries((Array.isArray(keys)?keys:[keys])
      .map(k=>[k,store.get(k)]));},
    async set(obj){for(const [k,v] of Object.entries(obj))store.set(k,v);},
    async remove(keys){for(const k of (Array.isArray(keys)?keys:[keys]))store.delete(k);}
  };
  globalThis.chrome={
    runtime:{
      id:'pit-ai-acceptance',getURL:p=>'chrome-extension://pit-ai-acceptance/'+p,
      onInstalled:{addListener(){}},onMessage:{addListener(fn){handler=fn;}},
      async sendMessage(message){messages.push(message);return {ok:true};}
    },
    storage:{
      local:{
        setAccessLevel:async()=>{},
        async get(key){
          if(key==='pit_settings_v1')return {pit_settings_v1:{
            standardProvider:'microsoft',microsoftKey:'test-key',
            aiProvider:'gemini',geminiKey:'fixture-ai-key',geminiModel:'gemini-2.5-flash',
            source:'en',target:'zh',contextAI:true}};
          return {};
        },async set(){},async remove(){}
      },session
    },
    tabs:{
      query:async()=>[{id:31,url:'https://example.org/watch'}],
      sendMessage:async(id,message)=>{notices.push({id,...message});return {ok:true};},
      onRemoved:{addListener(){}},onUpdated:{addListener(){}}
    },
    tabCapture:{getMediaStreamId:async()=> 'fixture-stream'},
    offscreen:{
      hasDocument:async()=>open,
      createDocument:async()=>{open=true;},
      closeDocument:async()=>{open=false;}
    }
  };
  globalThis.fetch=async(url,init)=>{
    if(url==='http://127.0.0.1:8765/health'){
      assert.equal(init.headers['X-PIT-Token'],'fixture-token-123456');
      return {ok:true,json:async()=>({speech_asr:true,speech_asr_requires_risk_ack:false})};
    }
    if(!url.startsWith('https://generativelanguage.googleapis.com/'))
      throw Error('unexpected remote provider');
    calls++;
    assert.equal(init.headers['x-goog-api-key'],'fixture-ai-key');
    return {ok:true,status:200,json:async()=>({candidates:[
      {content:{parts:[{text:'{"translations":["译文"]}'}]}}
    ]})};
  };
  await import('../src/background.js');
  const dispatch=(message,sender={id:chrome.runtime.id})=>new Promise(
    resolve=>handler(message,sender,resolve));
  const rejected=await dispatch({type:'PIT_ASR_START',tabId:31,
    token:'fixture-token-123456',mode:'ai'});
  assert.equal(rejected.ok,false);
  assert.match(rejected.error,/明确确认/);
  assert.equal(open,false);

  const authorized=await dispatch({type:'PIT_ASR_START',tabId:31,
    token:'fixture-token-123456',mode:'ai',userInitiated:true});
  assert.equal(authorized.ok,true,JSON.stringify(authorized));
  assert.equal(store.get('pit_live_asr_mode'),'ai');
  assert.ok(notices.some(e=>e.type==='PIT_ASR_VIEW_START'&&e.mode==='ai'));
  const sid=store.get('pit_live_asr_session');
  const site={id:chrome.runtime.id,tab:{id:31,url:'https://example.org/watch'},
    url:'https://example.org/watch'};

  const wrong=await dispatch({type:'TRANSLATE_BATCH',mode:'standard',transient:true,
    sessionId:sid,texts:['hello']},site);
  assert.equal(wrong.ok,false);
  assert.match(wrong.error,/模式/);
  const absent=await dispatch({type:'TRANSLATE_BATCH',mode:'ai',transient:true,
    sessionId:sid,texts:['hello']},site);
  assert.equal(absent.ok,false);
  assert.match(absent.error,/明确启用/);
  assert.equal(calls,0);

  for(let i=0;i<80;i++){
    const result=await dispatch({
      type:'TRANSLATE_BATCH',mode:'ai',transient:true,userInitiated:true,
      sessionId:sid,texts:['speech-'+i],context:'Prior sentence'
    },site);
    assert.equal(result.ok,true,'provider request '+i+': '+JSON.stringify(result));
    assert.deepEqual(result.translations,['译文']);
  }
  assert.equal(calls,80);
  assert.equal(store.get('pit_live_ai_requests'),80);
  const over=await dispatch({type:'TRANSLATE_BATCH',mode:'ai',transient:true,
    userInitiated:true,sessionId:sid,texts:['extra speech']},site);
  assert.equal(over.ok,false);
  assert.match(over.error,/80 次/);
  assert.equal(calls,80);

  const stopped=await dispatch({type:'PIT_ASR_STOP'});
  assert.equal(stopped.ok,true);
  assert.equal(open,false);
  assert.equal(store.has('pit_live_ai_requests'),false);
  assert.equal(store.has('pit_live_asr_mode'),false);
  const replay=await dispatch({type:'TRANSLATE_BATCH',mode:'ai',transient:true,
    userInitiated:true,sessionId:sid,texts:['replay']},site);
  assert.equal(replay.ok,false);
  assert.equal(calls,80);
});
