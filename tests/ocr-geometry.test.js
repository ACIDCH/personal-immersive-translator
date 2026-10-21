import test from 'node:test';
import assert from 'node:assert/strict';
import {validateOcrOverlayRegions} from '../src/lib/ocr-geometry.js';

const region=(x0,y0,x1,y1,confidence=90)=>({bbox:{x0,y0,x1,y1},confidence});
test('OCR flat-background replacement validates disjoint high-confidence text boxes',()=>{
 const boxes=validateOcrOverlayRegions([region(12,20,180,48),region(12,60,180,90)],220,120);
 assert.deepEqual(boxes,[{x0:10,y0:18,x1:182,y1:50},{x0:10,y0:58,x1:182,y1:92}]);
});
test('OCR low-confidence region cannot erase the source image',()=>{
 assert.throws(()=>validateOcrOverlayRegions([region(20,20,200,60,12)],300,200),/置信度/);
});
test('OCR overlapping text detection rejects unsafe overlays before drawing',()=>{
 assert.throws(()=>validateOcrOverlayRegions([
  region(10,20,130,50),region(20,24,120,46)
 ],180,100),/重叠/);
});
test('OCR minor overlap from pixel rounding and edge-clipped captions remain allowed',()=>{
 assert.equal(validateOcrOverlayRegions([
  region(2,2,90,28),region(2,30,90,54)
 ],110,70).length,2);
 assert.equal(validateOcrOverlayRegions([
  region(-1,10,100,50)
 ],110,70).length,1);
 assert.throws(()=>validateOcrOverlayRegions([
  region(-30,10,100,50)
 ],110,70),/超出/);
});
