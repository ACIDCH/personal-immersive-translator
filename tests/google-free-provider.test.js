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
   [[calls.length===1?'你的职业选择很重要':'搜索职位',null,null,null]],null,'en'
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
