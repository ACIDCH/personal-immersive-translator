import test from 'node:test';
import assert from 'node:assert/strict';
import {translateBatch,parseAIResponse,decodeEntities,TranslationError} from '../src/lib/providers.js';
import {normalizeSettings,hostIsBlocked} from '../src/lib/settings.js';
import {identifyLanguage} from '../src/lib/language-detect.js';
import {createPreferenceBackup,importPreferenceBackup} from '../src/lib/preference-export.js';

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
  assert.equal(normalizeSettings({standardProvider:'other',autoAI:true}).standardProvider,'mymemory');
  assert.equal(normalizeSettings({autoAI:true}).autoAI,false);
  assert.equal(hostIsBlocked('payments.example.com','example.com'),true);
  assert.equal(hostIsBlocked('notexample.com','example.com'),false);
});
test('numeric entity translation is decoded',()=>assert.equal(decodeEntities('&#65; &#x4E2D;'),'A 中'));

test('Corrupted settings reset safely without enabling AI',()=>{
  for(const input of [null,42,'broken',[]]){
    const settings=normalizeSettings(input);
    assert.equal(settings.autoAI,false);
    assert.equal(settings.standardProvider,'mymemory');
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

test('default keyless translation uses documented MyMemory GET with language ID',async()=>{
 const seen=[];
 const transport=async(url,init)=>{
   const target=new URL(url);seen.push(target);
   assert.equal(target.origin,'https://api.mymemory.translated.net');
   assert.equal(target.pathname,'/get');
   assert.equal(init.method,'GET');
   assert.equal(target.searchParams.get('langpair'),'en|zh-CN');
   assert.ok(new TextEncoder().encode(target.searchParams.get('q')).length<=500);
   return {ok:true,status:200,json:async()=>({
      responseStatus:200,responseData:{translatedText:'你好，世界！'}
   })};
 };
 assert.equal(normalizeSettings().standardProvider,'mymemory');
 assert.deepEqual(await translateBatch(['Hello world!'],{
   source:'auto',target:'zh',provider:'mymemory'
 },transport),['你好，世界！']);
 assert.equal(seen.length,1);
});
test('MyMemory splits long multibyte Unicode at valid code point boundaries',async()=>{
 const source='Bonjour le marché et la capacité sont importants. '.repeat(22);
 const sizes=[];
 const transport=async(url)=>{
   const target=new URL(url);
   sizes.push(new TextEncoder().encode(target.searchParams.get('q')).length);
   assert.equal(target.searchParams.get('langpair'),'fr|zh-CN');
   return {ok:true,status:200,json:async()=>({
     responseStatus:200,responseData:{translatedText:'译文'}
   })};
 };
 const output=await translateBatch([source],{source:'fr',target:'zh',provider:'mymemory'},transport);
 assert.ok(sizes.length>=2);
 assert.ok(sizes.every(x=>x>0&&x<=450));
 assert.equal(output.length,1);
 assert.ok(output[0].includes('译文'));
});
test('MyMemory responseStatus is validated rather than trusting HTTP 200',async()=>{
 await assert.rejects(translateBatch(['The company'],{
   provider:'mymemory',source:'en',target:'zh'
 },async()=>({ok:true,status:200,json:async()=>({
   responseStatus:429,responseData:{translatedText:'MYMEMORY WARNING: limit'}
 })})),/额度|错误/);
});
test('heuristic language ID discloses uncertainty and handles common scripts',()=>{
 assert.equal(identifyLanguage('日本語の金融').language,'ja');
 assert.equal(identifyLanguage('한국어의 금융').language,'ko');
 assert.equal(identifyLanguage('金融市场需求').language,'zh');
 assert.equal(identifyLanguage('Bonjour les marchés sont importants').language,'fr');
 assert.equal(identifyLanguage('Die Wirtschaft und der Markt sind').language,'de');
 assert.equal(identifyLanguage('Hola los mercados son importantes').language,'es');
 assert.equal(identifyLanguage('qzx ppt ggg').confidence,'latin-default-uncertain');
});

test('settings export imports only reading options; never leaks API tokens or profiles',()=>{
 const current={microsoftKey:'top-secret',cloudToken:'secret-remote-123',
   geminiKey:'top-secret-ai',aiProfiles:[{apiKey:'hidden'}],
   webDisplay:'translation-only',hoverTranslate:true,blockedHosts:'bank.example'};
 const data=createPreferenceBackup(current);
 const text=JSON.stringify(data);
 for(const forbidden of ['top-secret','secret-remote','apiKey','aiProfiles','cloudToken']){
   assert.equal(text.includes(forbidden),false,forbidden);
 }
 assert.equal(data.preferences.webDisplay,'translation-only');
 const restored=importPreferenceBackup(data,{
   microsoftKey:'keep-my-key',standardProvider:'mymemory',
   webDisplay:'bilingual',blockedHosts:''
 });
 assert.equal(restored.microsoftKey,'keep-my-key');
 assert.equal(restored.webDisplay,'translation-only');
 assert.equal(restored.hoverTranslate,true);
 assert.equal(restored.blockedHosts,'bank.example');
 assert.throws(()=>importPreferenceBackup({
   product:'PIT',schema:1,preferences:{hoverTranslate:{dangerous:true}}
 },{}),/格式/);
 assert.throws(()=>importPreferenceBackup({
   product:'unknown',schema:1,preferences:{}
 },{}),/有效/);
});

test('free MT processes up to three concurrent requests and preserves paragraph order',async()=>{
 let active=0,peak=0;
 const provider=async url=>{
   const q=new URL(url).searchParams.get('q');
   active++;peak=Math.max(active,peak);
   await new Promise(resolve=>setTimeout(resolve,8));
   active--;
   return {ok:true,status:200,json:async()=>({
     responseStatus:200,responseData:{translatedText:'CN:'+q}
   })};
 };
 const texts=Array.from({length:7},(_,i)=>'This economy is about '+i);
 const out=await translateBatch(texts,{
   source:'en',target:'zh',provider:'mymemory'
 },provider);
 assert.deepEqual(out,texts.map(x=>'CN:'+x));
 assert.ok(peak>=2&&peak<=3,'parallelism must be 2..3, actual '+peak);
});
