import test from 'node:test';
import assert from 'node:assert/strict';
import {translateBatch,TranslationError} from '../src/lib/providers.js';
import {normalizeSettings,isStandardServiceConfigured} from '../src/lib/settings.js';
import {probeProvider,providerCatalog} from '../src/lib/provider-catalog.js';

test('Google free adapter uses the MIT-compatible public endpoint without any key',async()=>{
 const calls=[];
 const mock=async(uri,opts)=>{
  const url=new URL(uri);
  assert.equal(url.origin,'https://translate.googleapis.com');
  assert.equal(url.pathname,'/translate_a/single');
  assert.equal(url.searchParams.get('client'),'gtx');
  assert.equal(url.searchParams.get('sl'),'auto');
  assert.equal(url.searchParams.get('tl'),'zh-CN');
  assert.equal(url.searchParams.get('dt'),'t');
  assert.equal(opts.method,'GET');
  calls.push(url.searchParams.get('q'));
  return {ok:true,status:200,json:async()=>[
   [[url.searchParams.get('q').includes('career')
     ?'你的职业选择很重要':'搜索职位',null,null,null]],null,'en'
  ]};
 };
 const settings={provider:'google-free',source:'auto',target:'zh'};
 assert.deepEqual(await translateBatch(['What you choose to do with your career matters','Search Jobs'],settings,mock),
  ['你的职业选择很重要','搜索职位']);
 assert.deepEqual(calls,['What you choose to do with your career matters','Search Jobs']);
});
test('Google free service is selectable for website, file and subtitle defaults',()=>{
 assert.equal(normalizeSettings({}).standardProvider,'google-free');
 assert.equal(isStandardServiceConfigured({standardProvider:'google-free'}),true);
 const p=normalizeSettings({standardProvider:'google-free',
  videoSettings:{providerId:'google-free'},fileProviderId:'google-free'});
 assert.equal(p.videoSettings.providerId,'google-free');
 assert.equal(p.fileProviderId,'google-free');
 const entry=providerCatalog(p).find(x=>x.id==='google-free');
 assert.ok(entry&&!entry.cost&&!entry.ai);
});
test('failed or rate-limited Google-free results never count as translations',async()=>{
 const config={provider:'google-free',source:'en',target:'zh'};
 await assert.rejects(translateBatch(['Search Jobs'],config,async()=>({ok:false,status:429})),
  err=>err instanceof TranslationError&&err.status===429);
 await assert.rejects(translateBatch(['Search Jobs'],config,async()=>({
  ok:true,status:200,json:async()=>({not:'Google output'})
 })),/结构无效/);
 await assert.rejects(translateBatch(['Search Jobs'],config,async()=>({
  ok:true,status:200,json:async()=>[[[null,null]],null,'en']
 })),/空译文/);
 const settings=normalizeSettings({standardProvider:'browser'});
 const probe=await probeProvider(settings,{providerId:'google-free'},async()=>['欢迎来到课堂。']);
 assert.equal(probe.ok,true);
 assert.equal(settings.standardProvider,'browser');
});
test('Google free adapter keeps multiple translated pieces in response order',async()=>{
 const result=await translateBatch(['Hello world'],{provider:'google-free',source:'en',target:'fr'},
  async()=>({ok:true,status:200,json:async()=>[[['Bonjour', 'Hello'],[' le monde',' world']],null,'en']}));
 assert.deepEqual(result,['Bonjour le monde']);
});

test('large identical paragraphs dispatch only once with bounded concurrency',async()=>{
 const seen=[];let active=0,maxActive=0;
 const repeated='A'.repeat(2600);
 const out=await translateBatch([repeated,repeated,'Second text'],{
  provider:'google-free',source:'en',target:'fr'
 },async uri=>{
  const u=new URL(uri);
  active++;maxActive=Math.max(maxActive,active);
  seen.push(u.searchParams.get('q'));
  await new Promise(r=>setTimeout(r,2));
  active--;
  return {ok:true,status:200,json:async()=>[[['FR',null]],null,'en']};
 });
 assert.deepEqual(out,['FRFR','FRFR','FR']);
 assert.equal(seen.length,3,'2600 chars split twice, duplicate input never sent again');
 assert.ok(maxActive>=2&&maxActive<=3,'Three concurrent requests at most');
});
test('a free-provider 429 rejects the entire batch without silently replacing missing output',async()=>{
 await assert.rejects(translateBatch(['Hello','World'],{
  provider:'google-free',source:'en',target:'zh'
 },async uri=>({
  ok:!uri.includes('World'),status:429,
  json:async()=>[[['你好']]]
 })),e=>e.status===429);
});

test('long multilingual phrases split on natural UTF-8 boundaries without losing source characters',async()=>{
 const source=('The financial markets and international trade influence companies. '+
 '今天学习市场策略和国际贸易。\n').repeat(30);
 const seen=[];
 const out=await translateBatch([source],{
  provider:'google-free',source:'auto',target:'fr'
 },async url=>{
  const q=new URL(url).searchParams.get('q');
  seen.push(q);
  assert.ok(new TextEncoder().encode(q).length<=1300,'Provider chunk must remain under UTF-8 limit');
  return {ok:true,status:200,json:async()=>[[[q,null]],null,'en']};
 });
 assert.equal(seen.join(''),source,'Sentence chunking must preserve every original character');
 assert.equal(out[0],source,'Identity fixture proves order and Unicode safety');
 assert.ok(seen.length>=3);
 assert.ok(seen.slice(0,-1).every(q=>/[\s.,;:!?。！？，；]\s*$/u.test(q)),
  'Chunks should prefer sentence or word boundaries instead of splitting words');
});
test('Latin-language translation pieces retain spaces when provider trims boundary whitespace',async()=>{
 const source=('This is a long descriptive explanation of the company career page. ').repeat(28);
 const out=await translateBatch([source],{
  provider:'google-free',source:'en',target:'fr'
 },async url=>{
  const q=new URL(url).searchParams.get('q');
  return {ok:true,status:200,json:async()=>[[[q.trim().replace(/\s+/g,' '),null]],null,'en']};
 });
 assert.ok(/company career page\. This is/u.test(out[0]),
  'Translated French/English segments must not merge words across split boundaries');
});

test('public 429 retry-after header is exposed as bounded metadata',async()=>{
 await assert.rejects(translateBatch(['Hello'],{
  provider:'google-free',source:'en',target:'zh'
 },async()=>({
  ok:false,status:429,headers:{get(name){return name==='retry-after'?'4':null;}}
 })),error=>error instanceof TranslationError&&error.status===429&&
  error.retryAfterMs===4000);
});
