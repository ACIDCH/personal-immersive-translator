import test from 'node:test';
import assert from 'node:assert/strict';
import {checkNativeTranslator,ensureNativeTranslator,translateWithNative}
 from '../src/lib/browser-native.js';

test('Native Chrome Translator explicitly rejects unsupported browsers and language pairs',async()=>{
 await assert.rejects(checkNativeTranslator('en','zh',undefined),/Chrome|提供/);
 await assert.rejects(checkNativeTranslator('not-a-language','zh',{}),/原文/);
 const unavailable={availability:async()=> 'unavailable',create:async()=>({})};
 await assert.rejects(translateWithNative(['Economics'],{source:'en',target:'fr',api:unavailable}),
  /不支持/);
});
test('Native Translator never downloads a language pack implicitly',async()=>{
 let created=0;
 const native={availability:async()=> 'downloadable',create:async()=>{created++;return {
   translate:async text=>'TR:'+text
 };}};
 await assert.rejects(translateWithNative(['Financial systems'],{
  source:'en',target:'fr',api:native
 }),/下载/);
 assert.equal(created,0);
 const ready=await ensureNativeTranslator('en','fr',{allowDownload:true,api:native});
 assert.equal(await ready.translate('Hello'),'TR:Hello');
 assert.equal(created,1);
});
test('Native Translator calls the browser model and preserves every text segment',async()=>{
 let count=0;
 const native={availability:async()=> 'available',create:async options=>{
  count++;assert.equal(options.sourceLanguage,'ja');
  assert.equal(options.targetLanguage,'zh');
  return {translate:async text=>'中文:'+text};
 }};
 const first=await translateWithNative(['日本語の講義','経済の授業'],{
  source:'ja',target:'zh',api:native
 });
 const second=await translateWithNative(['研究会'],{
  source:'ja',target:'zh',api:native
 });
 assert.deepEqual(first,['中文:日本語の講義','中文:経済の授業']);
 assert.deepEqual(second,['中文:研究会']);
 assert.equal(count,1,'translation sessions should be reused across chunks');
 assert.deepEqual(await translateWithNative(['中文原文'],{
  source:'zh',target:'zh',api:native
 }),['中文原文']);
});
test('Native Translator accepts only bounded user text',async()=>{
 await assert.rejects(translateWithNative([''],{source:'en',target:'zh'}),/最多/);
 await assert.rejects(translateWithNative(['a'.repeat(4001)],{
  source:'en',target:'zh'}),/4000/);
});
