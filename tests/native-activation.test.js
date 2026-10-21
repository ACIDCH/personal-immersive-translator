import test from 'node:test';
import assert from 'node:assert/strict';
import {ensureNativeTranslator,translateWithNative} from '../src/lib/browser-native.js';

test('Chrome download creates translator synchronously while click activation exists',async()=>{
 let availabilityCalls=0,createCalls=0,listener,progress;
 const api={
  availability:async()=>{availabilityCalls++;return 'downloadable';},
  create:async options=>{
   createCalls++;
   options.monitor?.({addEventListener:(event,fn)=>{assert.equal(event,'downloadprogress');listener=fn;}});
   return {translate:async text=>'译:'+text};
  }
 };
 const task=ensureNativeTranslator('fr','de',{api,allowDownload:true,onDownloadProgress:p=>{progress=p;}});
 assert.equal(createCalls,1,'download must not await availability');
 assert.equal(availabilityCalls,0);
 const translator=await task;
 listener({loaded:0.4,total:1});
 assert.equal(progress.loaded,0.4);
 assert.equal(await translator.translate('bonjour'),'译:bonjour');
});
test('concurrent model requests reuse one in-flight initialization',async()=>{
 let created=0;
 const api={availability:async()=> 'available',create:async()=>{created++;return {translate:async t=>'译:'+t};}};
 const out=await Promise.all([
  translateWithNative(['Bonjour'],{source:'fr',target:'es',api}),
  translateWithNative(['Bonsoir'],{source:'fr',target:'es',api})
 ]);
 assert.deepEqual(out,[['译:Bonjour'],['译:Bonsoir']]);
 assert.equal(created,1);
});
test('native download rejects lost activation with actionable error',async()=>{
 const api={availability:async()=> 'downloadable',create(){const e=new Error('gesture');e.name='NotAllowedError';throw e;}};
 await assert.rejects(ensureNativeTranslator('ko','en',{api,allowDownload:true}),
  e=>e.code==='user_activation_required'&&/点击/.test(e.message));
});
