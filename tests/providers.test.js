import test from 'node:test';
import assert from 'node:assert/strict';
import {translateBatch,parseAIResponse,decodeEntities,TranslationError} from '../src/lib/providers.js';
import {normalizeSettings,hostIsBlocked} from '../src/lib/settings.js';

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
    assert.ok(url.startsWith('https://translation.googleapis.com/'));
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
  assert.equal(normalizeSettings({standardProvider:'other',autoAI:true}).standardProvider,'microsoft');
  assert.equal(normalizeSettings({autoAI:true}).autoAI,false);
  assert.equal(hostIsBlocked('payments.example.com','example.com'),true);
  assert.equal(hostIsBlocked('notexample.com','example.com'),false);
});
test('numeric entity translation is decoded',()=>assert.equal(decodeEntities('&#65; &#x4E2D;'),'A 中'));
