import test from 'node:test';
import assert from 'node:assert/strict';
import '../src/lib/subtitle-import.js';
const {seconds,parseSubtitles}=globalThis.PITSubtitleImport;
test('converts SRT and VTT timestamp formats',()=>{
 assert.equal(seconds('01:02:03,500'),3723.5);
 assert.equal(seconds('00:01.250'),1.25);
});
test('parses SRT with numeric cue indexes',()=>{
 const text='1\n00:00:00,500 --> 00:00:02,000\nHello!\n\n2\n00:00:03,000 --> 00:00:04,500\nBonjour';
 assert.deepEqual(parseSubtitles(text).map(x=>x.text),['Hello!','Bonjour']);
});
test('parses WEBVTT with cue IDs',()=>{
 const text='WEBVTT\n\nintro\n00:00:00.100 --> 00:00:01.900 position:50%\n<i>Bonjour</i>\n';
 assert.deepEqual(parseSubtitles(text),[{startTime:.1,endTime:1.9,text:'Bonjour'}]);
});
test('rejects maliciously large subtitle content',()=>{
 assert.throws(()=>parseSubtitles('a'.repeat(2000001)),/2MB/);
});
