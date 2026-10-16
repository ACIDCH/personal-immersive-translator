import test from 'node:test';
import assert from 'node:assert/strict';
import {approvedOrigin,chooseEmbeddedFrame} from '../src/lib/frame-route.js';
test('accepts only exact eligible HTTPS video player origins',()=>{
 for(const url of [
  'https://www.youtube.com/embed/abc','https://www.youtube-nocookie.com/embed/id',
  'https://university.hosted.panopto.com/Panopto/Pages/Embed.aspx?id=1',
  'https://panopto.eu/Pages/Embed.aspx']) assert.ok(approvedOrigin(url),url);
 for(const url of [
  'http://www.youtube.com/embed/abc','https://youtube.com.evil.net/embed',
  'https://panopto.com.evil.org/','https://evilpanopto.com',
  'https://example.com/player','javascript:alert(1)', 'https://user:pass@panopto.com/'
 ]) assert.equal(approvedOrigin(url),null,url);
});
test('frame IDs are chosen only when an explicitly visible embed origin matches',()=>{
 const visible=['https://school.hosted.panopto.com/Panopto/Pages/Embed.aspx?course=private'];
 const frame=[
  {frameId:0,url:'https://lms.example.edu/course'},
  {frameId:2,url:'https://www.youtube.com/watch?v=unrelated'},
  {frameId:11,url:'https://school.hosted.panopto.com/Panopto/Pages/Embed.aspx?course=private'}
 ];
 assert.deepEqual(chooseEmbeddedFrame(visible,frame),
  {frameId:11,origin:'https://school.hosted.panopto.com'});
 assert.equal(chooseEmbeddedFrame(['https://www.google.com/'],frame),null);
 assert.equal(chooseEmbeddedFrame([],frame),null);
 assert.equal(chooseEmbeddedFrame(visible,[frame[0],frame[1]]),null);
});
