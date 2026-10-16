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
  'https://panopto.com.evil.org/','https://evilpanopto.com','https://university.panopto.evil.org/',
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
  {frameId:11,origin:'https://school.hosted.panopto.com',identity:visible[0]});
 assert.equal(chooseEmbeddedFrame(['https://www.google.com/'],frame),null);
 assert.equal(chooseEmbeddedFrame([],frame),null);
 assert.equal(chooseEmbeddedFrame(visible,[frame[0],frame[1]]),null);
});

test('strict video URL matching never selects unrelated recording on same Panopto host',()=>{
  const frame=[
    {frameId:22,url:'https://school.panopto.com/Panopto/Pages/Embed.aspx?id=private-recording'},
    {frameId:23,url:'https://school.panopto.com/Panopto/Pages/Embed.aspx?id=visible-recording'}
  ];
  const chosen=chooseEmbeddedFrame([
    'https://school.panopto.com/Panopto/Pages/Embed.aspx?id=visible-recording'
  ],frame);
  assert.deepEqual(chosen,{frameId:23,origin:'https://school.panopto.com',identity:'https://school.panopto.com/Panopto/Pages/Embed.aspx?id=visible-recording'});
  assert.equal(chooseEmbeddedFrame([
    'https://school.panopto.com/Panopto/Pages/Embed.aspx?id=missing'
  ],frame),null);
});
test('ambiguous identical player frames fail closed rather than selecting arbitrary frame',()=>{
  const target='https://www.youtube.com/embed/fixture?autoplay=1';
  const duplicate=[
    {frameId:3,url:target},
    {frameId:6,url:target}
  ];
  assert.equal(chooseEmbeddedFrame([target],duplicate),null);
  // A fragment is not sent to the HTTP server: strip it when identifying frames.
  assert.deepEqual(chooseEmbeddedFrame([target+'#t=4'],[duplicate[0]]),
    {frameId:3,origin:'https://www.youtube.com',identity:target});
});
test('same frameId and origin must still carry exact recording identity',()=>{
 const a='https://school.panopto.com/Panopto/Pages/Embed.aspx?id=recording-a';
 const b='https://school.panopto.com/Panopto/Pages/Embed.aspx?id=recording-b';
 const before=chooseEmbeddedFrame([a],[{frameId:7,url:a}]);
 const after=chooseEmbeddedFrame([b],[{frameId:7,url:b}]);
 assert.equal(before.frameId,after.frameId);
 assert.equal(before.origin,after.origin);
 assert.notEqual(before.identity,after.identity);
});
test('unapproved or downgraded URL origins are never selected',()=>{
 const candidates=[
  {frameId:5,url:'http://www.youtube.com/embed/id'},
  {frameId:6,url:'https://youtube.com.evil.tld/embed/id'}
 ];
 assert.equal(chooseEmbeddedFrame(['https://www.youtube.com/embed/id'],candidates),null);
});
