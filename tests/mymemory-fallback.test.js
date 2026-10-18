import test from 'node:test';
import assert from 'node:assert/strict';
import {translateBatch} from '../src/lib/providers.js';
import {normalizeSettings,isStandardServiceConfigured} from '../src/lib/settings.js';

test('MyMemory is opt-in and Chrome remains the default',()=>{
 assert.equal(normalizeSettings().standardProvider,'browser');
 assert.equal(normalizeSettings({standardProvider:'mymemory'}).standardProvider,'mymemory');
 assert.equal(isStandardServiceConfigured({standardProvider:'mymemory'}),true);
});
test('MyMemory sends ordered bounded UTF-8 GET segments without a key',async()=>{
 const requests=[];
 const output=await translateBatch(['Bonjour','日本語の講義資料'.repeat(90)],{
  provider:'mymemory',source:'fr',target:'en'
 },async(u,options)=>{
  const url=new URL(u),q=url.searchParams.get('q');
  requests.push(q);
  assert.equal(options.method,'GET');
  assert.equal(url.host,'api.mymemory.translated.net');
  assert.equal(url.searchParams.get('langpair'),'fr|en');
  assert.ok(new TextEncoder().encode(q).length<=450);
  return {ok:true,json:async()=>({responseStatus:200,responseData:{translatedText:'T:'+q}})};
 });
 assert.equal(output.length,2);
 assert.ok(output[0].startsWith('T:Bonjour'));
 assert.ok(requests.length>2);
});
test('MyMemory does not send unknown short source text',async()=>{
 let sent=0;
 await assert.rejects(translateBatch(['Hi'],{
  provider:'mymemory',source:'auto',target:'zh'
 },async()=>{sent++;throw Error('unexpected');}),/手动选择/);
 assert.equal(sent,0);
});
