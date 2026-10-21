import test from 'node:test';
import assert from 'node:assert/strict';
import {chooseDetectedLanguage,normalizeDetectedLanguage,detectLanguages,detectLanguagesWithContext,detectCaptionSampleLanguage}
  from '../src/lib/language-detection.js';
import {translateBatch} from '../src/lib/providers.js';

test('Chrome CLD recognizes real English, French, German, Spanish and Korean language codes',()=>{
 for(const [input,code] of [
  ['fr','fr'],['fr-FR','fr'],['de-DE','de'],['es','es'],
  ['zh-Hans','zh'],['ko-KR','ko'],['en-US','en'],['ja','ja']]){
  assert.equal(normalizeDetectedLanguage(input),code);
 }
 assert.equal(normalizeDetectedLanguage('und'),null);
});
test('CLD short or low-confidence/mixed segments fail closed to auto',()=>{
 assert.deepEqual(chooseDetectedLanguage({isReliable:true,languages:[{language:'fr',percentage:99}]},
   'Bonjour'),{language:'auto',confidence:'unreliable'});
 assert.equal(chooseDetectedLanguage({isReliable:false,
   languages:[{language:'fr',percentage:100}]},'Bonjour mes chers étudiants').language,'auto');
 assert.equal(chooseDetectedLanguage({isReliable:true,
   languages:[{language:'de',percentage:54},{language:'en',percentage:46}]},
   'Die wirtschaftlichen Veränderungen sind wichtig').language,'auto');
 assert.deepEqual(chooseDetectedLanguage({isReliable:true,
   languages:[{language:'fr',percentage:92},{language:'en',percentage:4}]},
   'Bonjour mes amis, je suis très heureux de vous voir'),
   {language:'fr',confidence:'chrome-cld'});
});
test('Chrome detector errors and absent native API do not cause fabricated language labels',async()=>{
 const sentences=['Bonjour mes chers étudiants, nous allons étudier la finance',
   'Die wirtschaftlichen Entwicklungen haben Auswirkungen auf den Handel'];
 const absent=await detectLanguages(sentences,null);
 assert.ok(absent.every(x=>x.language==='auto'));
 const failed=await detectLanguages(sentences,async()=>{throw new Error('browser not supported')});
 assert.ok(failed.every(x=>x.language==='auto'));
});
test('real provider adapter passes per-paragraph CLD source hints without leaking detector output into page',async()=>{
 const oldChrome=globalThis.chrome;
 globalThis.chrome={i18n:{detectLanguage:async text=>{
  if(text.includes('Bonjour'))return {isReliable:true,
   languages:[{language:'fr',percentage:90},{language:'en',percentage:4}]};
  if(text.includes('Wirtschaft'))return {isReliable:true,
   languages:[{language:'de',percentage:88},{language:'en',percentage:3}]};
  return {isReliable:false,languages:[{language:'en',percentage:51}]};
 }}};
 try{
  const inputs=['Bonjour les amis et bienvenue dans notre classe de finance.',
    'Die Wirtschaft in Deutschland wächst in diesem Jahr weiter.',
    'A mixed language question en español and in English'];
  let observed;
  const result=await translateBatch(inputs,{
   provider:'cloud',source:'auto',target:'zh',
   cloudEndpoint:'https://pit.example.workers.dev',
   cloudToken:'long-cloud-token-12345'
  },async(url,request)=>{
   observed=JSON.parse(request.body);
   assert.equal(url,'https://pit.example.workers.dev/v1/translate');
   return {ok:true,json:async()=>({translations:['你好','经济','混合语']})};
  });
  assert.deepEqual(result,['你好','经济','混合语']);
  assert.deepEqual(observed.sources,['fr','de','auto']);
 }finally{globalThis.chrome=oldChrome;}
});

test('Chrome CLD propagates a reliable group language to short English and French headings',async()=>{
 const detector=async text=>{
  const french=text.includes('Nous étudions la finance internationale');
  if(text.length<18)return {isReliable:false,languages:[]};
  return {isReliable:true,languages:[{language:french?'fr':'en',percentage:92}]};
 };
 const result=await detectLanguagesWithContext([
  'Bonjour','Nous étudions la finance internationale et le commerce mondial.'
 ],detector);
 assert.deepEqual(result.map(x=>x.language),['fr','fr']);
 assert.equal(result[0].confidence,'group-cld');
});
test('group-level language does not overwrite text confidently detected in another language',async()=>{
 const detector=async text=>{
  if(text==='Hola')return {isReliable:false,languages:[]};
  if(text.startsWith('Bonjour les étudiants'))
   return {isReliable:true,languages:[{language:'fr',percentage:94}]};
  if(text.startsWith('Die wirtschaftlichen'))
   return {isReliable:true,languages:[{language:'de',percentage:93}]};
  return {isReliable:true,languages:[{language:'fr',percentage:90}]};
 };
 const output=await detectLanguagesWithContext([
  'Bonjour les étudiants et professeurs à notre université',
  'Die wirtschaftlichen Veränderungen sind sehr wichtig für uns',
  'Hola'
 ],detector);
 assert.deepEqual(output.map(x=>x.language),['fr','de','auto']);
});

test('caption-only source inference uses reliable bounded CLD rather than page UI language',async()=>{
 let called=0,last='';
 const detector=async text=>{
  called++;last=text;
  return {isReliable:true,languages:[
   {language:'en',percentage:91},{language:'fr',percentage:3}
  ]};
 };
 assert.equal(await detectCaptionSampleLanguage('Short cue',detector),null);
 assert.equal(called,0,'Do not invent a language from short subtitle fragments');
 const sample='We are studying the financial markets and international trade today.';
 assert.equal(await detectCaptionSampleLanguage(sample,detector),'en');
 assert.equal(last,sample);
 assert.equal(await detectCaptionSampleLanguage('A'.repeat(2000),detector),'en');
 assert.equal(last.length,1200,'Only the Chrome CLD input cap is inspected');
 const uncertain=async()=>({isReliable:false,languages:[{language:'fr',percentage:99}]});
 assert.equal(await detectCaptionSampleLanguage(sample,uncertain),null,
   'Unknown CC source must not be silently guessed or sent to a free provider');
 assert.equal(await detectCaptionSampleLanguage(null,detector),null);
});
