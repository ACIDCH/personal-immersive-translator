import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeAsrResult} from '../src/lib/asr-response.js';

test('Whisper plain-text result remains compatible with existing live subtitles',()=>{
 assert.deepEqual(normalizeAsrResult({
  text:' Hello    everyone  ',language:'en',languageConfidence:.92
 }),{text:'Hello everyone',language:'en',languageConfidence:.92});
});
test('faster-whisper segment-only gateway becomes one bounded transcript',()=>{
 assert.deepEqual(normalizeAsrResult({
  segments:[{start:0,end:1,text:'Welcome'},{start:1,end:2,text:' to the lecture'}],
  info:{language:'fr',language_probability:.88}
 }),{text:'Welcome to the lecture',language:'fr',languageConfidence:.88});
});
test('unreliable ASR language metadata never poisons webpage or subtitle language',()=>{
 const out=normalizeAsrResult({text:'Hello',info:{language:'zh',language_probability:.23}});
 assert.equal(out.language,null);
 assert.equal(out.languageConfidence,null);
});
test('invalid and oversized ASR data is rejected or bounded without code execution',()=>{
 assert.throws(()=>normalizeAsrResult(null),/结构/);
 const out=normalizeAsrResult({segments:[{start:3,end:2,text:'wrong'},{
  start:0,end:1,text:'Valid'
 },{text:'X'.repeat(10000)}],language:'bad'},{
  maxChars:100
 });
 assert.ok(out.text.startsWith('Valid'));
 assert.ok(out.text.length<=100);
 assert.equal(out.language,null);
});
