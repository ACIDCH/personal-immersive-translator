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

test('ASS file extracts visible dialogue using declared field order and keeps commas',()=>{
 const ass='[Script Info]\nTitle: Personal fixture\n\n[Events]\n'+
  'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n'+
  'Dialogue: 0,0:00:01.25,0:00:03.50,Default,,0,0,0,,{\\i1}Bonjour, world\\Nnext line\n'+
  'Comment: 0,0:00:03.60,0:00:04.00,Default,,0,0,0,,Do not translate\n';
 assert.deepEqual(parseSubtitles(ass),[
   {startTime:1.25,endTime:3.5,text:'Bonjour, world next line'}
 ]);
});
