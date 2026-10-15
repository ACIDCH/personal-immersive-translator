import test from 'node:test';
import assert from 'node:assert/strict';
import {translateImage,parseVisionResponse,validateImage,VisionError} from '../src/lib/vision.js';
const image='a'.repeat(100);
test('image OCR only accepts supported formats and bounded contents',()=>{
 assert.throws(()=>validateImage({mime:'image/svg+xml',data:image}),VisionError);
 assert.throws(()=>validateImage({mime:'image/png',data:'123'}),VisionError);
 validateImage({mime:'image/png',data:image});
});
test('Gemini multimodal OCR preserves original and translated strings',async()=>{
 const data=await translateImage({mime:'image/png',data:image,key:'private',target:'fr'},async(url,options)=>{
  assert.ok(url.includes('generateContent'));
  assert.equal(options.headers['x-goog-api-key'],'private');
  const parts=JSON.parse(options.body).contents[0].parts;
  assert.equal(parts[1].inline_data.data,image);
  return {ok:true,json:async()=>({candidates:[{content:{parts:[{text:JSON.stringify({original_text:'Hello',translated_text:'Bonjour'})}]}}]})};
 });
 assert.deepEqual(data,{original_text:'Hello',translated_text:'Bonjour'});
});
test('vision parser rejects hallucinated or missing response fields',()=>{
 assert.throws(()=>parseVisionResponse('{"translated_text":"Hello"}'),VisionError);
});
