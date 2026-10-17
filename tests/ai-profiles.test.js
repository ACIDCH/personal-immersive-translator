import test from 'node:test';
import assert from 'node:assert/strict';
import {translateBatch} from '../src/lib/providers.js';
import {normalizeSettings} from '../src/lib/settings.js';
import {selectedAIProfile,validateAIProfile} from '../src/lib/ai-profiles.js';

const example={id:'ai-demo',name:'My Chat Provider',protocol:'openai-chat',baseUrl:'https://api.example.com/v1',model:'demo-model',apiKey:'local-secret'};
const config={source:'en',target:'zh',provider:'custom',aiProfiles:[example],activeAIProfileId:example.id};
test('AI profiles can store and select multiple configured services',()=>{
  const saved=normalizeSettings({aiProvider:'custom',aiProfiles:[example,{...example,id:'ai-other',name:'Another'}],activeAIProfileId:'ai-other'});
  assert.equal(saved.aiProvider,'custom');
  assert.equal(saved.aiProfiles.length,2);
  assert.equal(selectedAIProfile(saved).name,'Another');
});
test('custom OpenAI-compatible translation sends model and API key in headers',async()=>{
  const output=await translateBatch(['Hello'],config,async(url,init)=>{
    assert.equal(url,'https://api.example.com/v1/chat/completions');
    assert.equal(init.headers.Authorization,'Bearer local-secret');
    const body=JSON.parse(init.body);
    assert.equal(body.model,'demo-model');
    assert.equal(body.stream,false);
    return {ok:true,json:async()=>({choices:[{message:{content:'{"translations":["你好"]}'}}]})};
  });
  assert.deepEqual(output,['你好']);
});
test('Anthropic Messages adapter parses a real Messages-style envelope',async()=>{
  const profile={...example,protocol:'anthropic-messages',baseUrl:'https://api.anthropic.com/v1'};
  const out=await translateBatch(['Hello'],{...config,aiProfiles:[profile]},async(url,init)=>{
    assert.equal(url,'https://api.anthropic.com/v1/messages');
    assert.equal(init.headers['x-api-key'],'local-secret');
    assert.equal(init.headers['anthropic-version'],'2023-06-01');
    assert.equal(JSON.parse(init.body).max_tokens,4096);
    return {ok:true,json:async()=>({content:[{type:'text',text:'{"translations":["你好"]}'}]})};
  });
  assert.deepEqual(out,['你好']);
});
test('bad endpoints and profile identifiers are rejected before network calls',async()=>{
  for(const bad of [
    'http://api.example.com/v1','https://user:pass@api.example.com/v1',
    'https://api.example.com/v1?key=private', 'https://localhost:8765/v1',
    'https://127.0.0.1/v1','https://api.example.com/v1#fragment'
  ])assert.throws(()=>validateAIProfile({...example,baseUrl:bad}),/无效|仅支持|本地服务/);
  assert.throws(()=>validateAIProfile({...example,protocol:'unsupported'}),/协议/);
  assert.throws(()=>selectedAIProfile({...config,activeAIProfileId:'missing'}),/选择/);
});
test('custom provider never silently falls back to another model',async()=>{
  await assert.rejects(translateBatch(['Hello'],{...config,aiProfiles:[{...example,apiKey:''}]},async()=>{throw Error('must not fetch');}),/API Key/);
});
