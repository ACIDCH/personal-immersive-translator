import test from 'node:test';
import assert from 'node:assert/strict';
import {translateBatch,parseAIResponse,decodeEntities,TranslationError} from '../src/lib/providers.js';
import {normalizeSettings,hostIsBlocked,portablePreferences,applyPortablePreferences,isStandardServiceConfigured} from '../src/lib/settings.js';

function mockResponse(output,check) {return async (url,init) => {check?.(url,init);return {ok:true,status:200,json:async()=>output};};}
const config = {target:'zh', source:'en'};
test('Microsoft request maps strings in correct order and uses region header',async()=>{
  const fetcher=mockResponse([{translations:[{text:'你好'}]},{translations:[{text:'世界'}]}],(url,init)=>{
    assert.match(url,/api-version=3.0/);assert.match(url,/to=zh-Hans/);
    assert.equal(init.headers['Ocp-Apim-Subscription-Region'],'australiaeast');
    assert.deepEqual(JSON.parse(init.body),[{Text:'Hello'},{Text:'World'}]);
  });
  assert.deepEqual(await translateBatch(['Hello','World'],{...config,provider:'microsoft',microsoftKey:'test',microsoftRegion:'australiaeast'},fetcher),['你好','世界']);
});
test('Google Cloud API escapes source and decodes text entities safely',async()=>{
  const f=mockResponse({data:{translations:[{translatedText:'A &amp; B &lt; C'}]}},(url,init)=>{
    assert.equal(url,'https://translation.googleapis.com/language/translate/v2');
    assert.ok(!url.includes('fake'),'API key leaked into request URL');
    assert.equal(init.headers['x-goog-api-key'],'fake');
    assert.equal(JSON.parse(init.body).format,'text');
  });
  assert.deepEqual(await translateBatch(['A & B < C'],{...config,provider:'google',googleKey:'fake'},f),['A & B < C']);
});
test('DeepL Free adapter has free endpoint and correct auth',async()=>{
  const f=mockResponse({translations:[{text:'你好'}]},(url,init)=>{
    assert.equal(url,'https://api-free.deepl.com/v2/translate');
    assert.equal(init.headers.Authorization,'DeepL-Auth-Key key');
    assert.equal(JSON.parse(init.body).target_lang,'ZH');
  });
  assert.deepEqual(await translateBatch(['Hello'],{...config,provider:'deepl',deeplKey:'key',deeplPlan:'free'},f),['你好']);
});
test('Gemini parses structured JSON and uses key only in header',async()=>{
  const f=mockResponse({candidates:[{content:{parts:[{text:'{"translations":["译文"]}'}]}}]},(url,init)=>{
    assert.match(url,/gemini-2.5-flash:generateContent/);
    assert.equal(init.headers['x-goog-api-key'],'secret');
    assert.equal(JSON.parse(init.body).generationConfig.responseMimeType,'application/json');
  });
  assert.deepEqual(await translateBatch(['Original'],{...config,provider:'gemini',geminiKey:'secret',geminiModel:'gemini-2.5-flash'},f),['译文']);
});
test('DeepSeek sends JSON object mode with bearer auth',async()=>{
  const f=mockResponse({choices:[{message:{content:'{"translations":["中文"]}'}}]},(url,init)=>{
    assert.equal(url,'https://api.deepseek.com/chat/completions');
    assert.equal(init.headers.Authorization,'Bearer secret');
    assert.equal(JSON.parse(init.body).response_format.type,'json_object');
    assert.equal(JSON.parse(init.body).thinking.type,'disabled');
  });
  assert.deepEqual(await translateBatch(['English'],{...config,provider:'deepseek',deepseekKey:'secret'},f),['中文']);
});
test('LibreTranslate only permits HTTPS and translates one at a time',async()=>{
  let count=0;
  const f=mockResponse({translatedText:'ok'},(url)=>{assert.equal(url,'https://host.example/translate');count++;});
  assert.deepEqual(await translateBatch(['A','B'],{...config,provider:'libre',libreUrl:'https://host.example'},f),['ok','ok']);
  assert.equal(count,2);
  await assert.rejects(translateBatch(['A'],{...config,provider:'libre',libreUrl:'http://example.com'},f),/HTTPS/);
});
test('AI response must match batch count',()=>{
  assert.throws(()=>parseAIResponse('{"translations":["one"]}',2),TranslationError);
  assert.deepEqual(parseAIResponse('```json\n{"translations":["ok"]}\n```',1),['ok']);
});
test('reject oversized segment and missing key before network request',async()=>{
  await assert.rejects(translateBatch(['x'.repeat(5001)],{...config,provider:'microsoft',microsoftKey:'key'}),/超出限制/);
  await assert.rejects(translateBatch(['Hello'],{...config,provider:'microsoft'}),/Microsoft Translator Key/);
});
test('remote HTTP errors are sanitized to avoid leaking server data',async()=>{
  await assert.rejects(translateBatch(['x'],{...config,provider:'microsoft',microsoftKey:'secret'},async()=>({ok:false,status:429})),e=>e.status===429 && !e.message.includes('secret'));
});
test('sanitize settings and block nested sensitive hosts',()=>{
  assert.equal(normalizeSettings({standardProvider:'other',autoAI:true}).standardProvider,'browser');
  assert.equal(normalizeSettings({autoAI:true}).autoAI,false);
  assert.equal(hostIsBlocked('payments.example.com','example.com'),true);
  assert.equal(hostIsBlocked('notexample.com','example.com'),false);
});
test('numeric entity translation is decoded',()=>assert.equal(decodeEntities('&#65; &#x4E2D;'),'A 中'));

test('Corrupted settings reset safely without enabling AI',()=>{
  for(const input of [null,42,'broken',[]]){
    const settings=normalizeSettings(input);
    assert.equal(settings.autoAI,false);
    assert.equal(settings.standardProvider,'browser');
    assert.equal(settings.target,'zh');
  }
});

test('hosted PIT M2M100 adapter uses user-configured HTTPS and bearer token',async()=>{
 const fetcher=mockResponse({translations:['金融市场']},(url,init)=>{
   assert.equal(url,'https://pit-translation.example.workers.dev/v1/translate');
   assert.equal(init.headers.Authorization,'Bearer 123456789abcdefghi');
   assert.deepEqual(JSON.parse(init.body),{texts:['Financial markets'],source:'auto',target:'zh'});
 });
 const answer=await translateBatch(['Financial markets'],{
   ...config,source:'auto',provider:'cloud',
   cloudEndpoint:'https://pit-translation.example.workers.dev',
   cloudToken:'123456789abcdefghi'},fetcher);
 assert.deepEqual(answer,['金融市场']);
 await assert.rejects(translateBatch(['Hi'],{
   ...config,provider:'cloud'},fetcher),/HTTPS 地址/);
 await assert.rejects(translateBatch(['Hi'],{
   ...config,provider:'cloud',cloudEndpoint:'http://pit.example',
   cloudToken:'123456789abcdefghi'},fetcher),/HTTPS/);
});

test('immersive reading settings keep validated controls and never opt in to AI',()=>{
 const settings=normalizeSettings({
   webDisplay:'translation-only',webScope:'full',translationTheme:'highlight',
   hoverTranslate:true,inputTranslate:true,inputTarget:'fr',
   autoTranslateHosts:'docs.example.org',autoAI:true
 });
 assert.equal(settings.webDisplay,'translation-only');
 assert.equal(settings.webScope,'full');
 assert.equal(settings.translationTheme,'highlight');
 assert.equal(settings.hoverTranslate,true);
 assert.equal(settings.inputTranslate,true);
 assert.equal(settings.inputTarget,'fr');
 assert.equal(settings.autoTranslateHosts,'docs.example.org');
 assert.equal(settings.autoAI,false);
 const invalid=normalizeSettings({
   webDisplay:'script',webScope:'everything',translationTheme:'rainbow',
   inputTarget:'unknown'
 });
 assert.equal(invalid.webDisplay,'bilingual');
 assert.equal(invalid.webScope,'smart');
 assert.equal(invalid.translationTheme,'subtle');
 assert.equal(invalid.inputTarget,'en');
});

test('floating translation setting is opt-in and sanitized',()=>{
 assert.equal(normalizeSettings({}).floatingControl,false);
 assert.equal(normalizeSettings({floatingControl:true}).floatingControl,true);
 assert.equal(normalizeSettings({floatingControl:0}).floatingControl,false);
});

test('portable preference snapshot removes all API secrets and AI service credentials',()=>{
 const saved=normalizeSettings({
  target:'fr',source:'en',webDisplay:'translation-only',hoverTranslate:true,
  blockedHosts:'bank.example',glossary:'forward rate = 远期汇率',
  cloudToken:'secret-token-1234567',cloudPdfToken:'doc-token-1234567',
  microsoftKey:'ms-token-456',geminiKey:'gm-token-123',
  aiProfiles:[{id:'model-a',apiKey:'secret-A',baseUrl:'https://private.example/v1'}]
 });
 const exported=portablePreferences(saved);
 assert.equal(exported.kind,'pit-preferences');
 assert.equal(exported.version,1);
 assert.equal(exported.settings.target,'fr');
 assert.ok(!JSON.stringify(exported).includes('secret'));
 assert.ok(!JSON.stringify(exported).includes('private.example'));
 const restored=applyPortablePreferences({...saved,target:'zh'},exported);
 assert.equal(restored.target,'fr');
 assert.equal(restored.hoverTranslate,true);
 assert.equal(restored.cloudToken,'secret-token-1234567');
 assert.equal(restored.geminiKey,'gm-token-123');
 assert.equal(restored.aiProfiles[0].apiKey,'secret-A');
});
test('portable preference import is allowlisted and version checked',()=>{
 const base=normalizeSettings({cloudToken:'keep-secret',target:'en'});
 assert.throws(()=>applyPortablePreferences(base,{kind:'other',version:1,settings:{}}),/受支持/);
 assert.throws(()=>applyPortablePreferences(base,{kind:'pit-preferences',version:7,settings:{}}),/受支持/);
 const restored=applyPortablePreferences(base,{
  kind:'pit-preferences',version:1,
  settings:{target:'ko',cloudToken:'override',aiProfiles:[{apiKey:'bad'}],
    standardProvider:'malicious-provider'}
 });
 assert.equal(restored.target,'ko');
 assert.equal(restored.cloudToken,'keep-secret');
 assert.deepEqual(restored.aiProfiles,[]);
 assert.equal(restored.standardProvider,'browser');
});

test('site auto-translate only activates with a configured standard MT engine',()=>{
 assert.equal(isStandardServiceConfigured({}),true);
 assert.equal(isStandardServiceConfigured({standardProvider:'cloud',cloudEndpoint:'https://pit.example',cloudToken:'123'}),false);
 assert.equal(isStandardServiceConfigured({standardProvider:'cloud',cloudEndpoint:'http://pit.example',cloudToken:'long-fake-token-12345'}),false);
 assert.equal(isStandardServiceConfigured({standardProvider:'cloud',cloudEndpoint:'https://pit.example',cloudToken:'long-fake-token-12345'}),true);
 assert.equal(isStandardServiceConfigured({standardProvider:'google',googleKey:'abcdef'}),true);
 assert.equal(isStandardServiceConfigured({standardProvider:'libre',libreUrl:'http://localhost:5000'}),false);
 assert.equal(isStandardServiceConfigured({standardProvider:'libre',libreUrl:'https://mt.example'}),true);
});

test('Current Gemini/DeepSeek defaults are distinct, and AI remains opt-in',()=>{
  const settings=normalizeSettings();
  assert.equal(settings.geminiModel,'gemini-3.5-flash-lite');
  assert.equal(settings.deepseekModel,'deepseek-flash');
  assert.equal(settings.aiProvider,'gemini');
  assert.equal(settings.autoAI,false);
});
test('DeepSeek Flash model is passed to the official endpoint without using Hermes as an API model',async()=>{
  const f=mockResponse({choices:[{message:{content:'{"translations":["您好"]}'}}]},(url,init)=>{
    assert.equal(url,'https://api.deepseek.com/chat/completions');
    assert.equal(JSON.parse(init.body).model,'deepseek-flash');
  });
  assert.deepEqual(await translateBatch(['Hello'],{...config,provider:'deepseek',deepseekKey:'secret',deepseekModel:'deepseek-flash'},f),['您好']);
});
