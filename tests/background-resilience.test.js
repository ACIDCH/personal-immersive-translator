import test from 'node:test';
import assert from 'node:assert/strict';

// Complete MV3 service-worker message path: a provider response must still
// reach the webpage when optional local cache has hit Chrome storage quota.
test('provider results survive cache quota and cache read errors',async()=>{
  let receiver=null,networkCalls=0;
  globalThis.chrome={
    runtime:{
      id:'pit-test-extension',
      onInstalled:{addListener(){}},
      onMessage:{addListener(fn){receiver=fn;}}
    },
    storage:{
      local:{
        setAccessLevel:async()=>{},
        async get(key){
          if(key==='pit_settings_v1')return {
            pit_settings_v1:{standardProvider:'microsoft',microsoftKey:'test-key',source:'en',target:'zh'}
          };
          if(key===null)return {};
          if(typeof key==='string' && key.startsWith('pit_cache_')){
            throw new Error('Storage read failed');
          }
          return {};
        },
        async set(){throw new Error('QUOTA_BYTES exceeded');},
        async remove(){}
      },
      session:{async get(){return {}},async remove(){}}
    },
    tabs:{onRemoved:{addListener(){}},onUpdated:{addListener(){}}}
  };
  globalThis.fetch=async(url,request)=>{
    networkCalls++;
    assert.equal(url.startsWith('https://api.cognitive.microsofttranslator.com/'),true);
    assert.equal(request.headers['Ocp-Apim-Subscription-Key'],'test-key');
    return {ok:true,status:200,json:async()=>[{translations:[{text:'你好，世界！'}]}]};
  };
  await import('../src/background.js');
  assert.equal(typeof receiver,'function');
  const result=await new Promise(resolve=>{
    receiver(
      {type:'TRANSLATE_BATCH',mode:'standard',texts:['Hello world!']},
      {id:'pit-test-extension',tab:{url:'https://example.org/article'}},
      resolve
    );
  });
  assert.equal(networkCalls,1);
  assert.equal(result.ok,true,JSON.stringify(result));
  assert.deepEqual(result.translations,['你好，世界！']);
  assert.equal(result.cached,false);
});
