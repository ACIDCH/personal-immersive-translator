import test from 'node:test';
import assert from 'node:assert/strict';
import '../src/lib/platform-captions.js';
const {identify,compact,readVisibleCaptions,captionChanged}=globalThis.PITPlatformCaptions;
test('selects explicit YouTube, Bilibili, Netflix, Panopto providers by hostname',()=>{
 assert.equal(identify('www.youtube.com').id,'youtube');
 assert.equal(identify('www.bilibili.com').id,'bilibili');
 assert.equal(identify('netflix.com').id,'netflix');
 assert.equal(identify('uni.au.panopto.com').id,'panopto');
 assert.equal(identify('evilnetflix.com').id,'generic');
 assert.equal(identify('bilibili.com.evil.com').id,'generic');
});
test('does not scrape unrelated pages or arbitrary website text',()=>{
 const document={querySelectorAll(){throw Error('should not inspect')}}; 
 assert.equal(readVisibleCaptions(document,'example.com').reason,'no-adapter');
});
test('deduplicates visible subtitle fragments and ignores hidden nodes',()=>{
 const shown={textContent:'Hello  World',closest:()=>null},dup={textContent:'Hello World',closest:()=>null},hidden={textContent:'secret',closest:()=>null};
 const mock={querySelectorAll(selector){return selector.includes('ytp-caption')?[shown,dup,hidden]:[];}};
 const result=readVisibleCaptions(mock,'youtube.com',node=>node!==hidden);
 assert.equal(result.text,'Hello World');
 assert.equal(captionChanged('Hello World',result.text),false);
 assert.equal(captionChanged('',result.text),true);
});
test('normalizes whitespace and bounds data size',()=>assert.equal(compact(' A\n    B '),'A B'));

test('PIT defaults to caption text replacement with in-player fallback, not a detached subtitle panel',async()=>{
 const {VIDEO_DEFAULTS,normalizeProduct}=await import('../src/lib/product-settings.js');
 assert.equal(VIDEO_DEFAULTS.subtitleRenderMode,'replace-track');
 const settings=normalizeProduct({});
 assert.equal(settings.videoSettings.subtitleRenderMode,'replace-track');
 // Previously saved user preference is not silently overwritten on upgrade.
 assert.equal(normalizeProduct({videoSettings:{subtitleRenderMode:'in-player'}}).videoSettings.subtitleRenderMode,'in-player');
});
