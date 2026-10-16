import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSiteReport,scanSite,inspectMediaFrame} from '../src/kiss/site-diagnostics.js';

test('exported report refuses URLs, tokens, DOM captions, login details and unknown keys',()=>{
 const report=buildSiteReport({
  platform:'O2B',knownFrameCount:2,
  frameResults:[{videoElements:1,visibleVideos:1,playableVideos:1,
    nativeTracks:{total:2,showing:1,disabled:1},
    visibleCaptionNodes:2,iframeElements:1,
    url:'https://private.example/course/secret?token=abc',
    subtitles:'MY PRIVATE LECTURE',cookie:'private_cookie'}],
  feedback:{video:'pass',translatedCaptions:'fail',audioAsr:'not-tested',
    notes:'PRIVATE_ACCOUNT_NUMBER',token:'HIDDEN'}
 });
 const json=JSON.stringify(report);
 assert.equal(report.platform,'O2B');
 assert.equal(report.counts.nativeTracks.showing,1);
 assert.equal(report.checks.video,'pass');
 assert.equal(report.checks.translatedCaptions,'fail');
 for(const secret of ['private.example','PRIVATE','cookie','token','notes',
   'course','account']) assert.equal(json.includes(secret),false,secret);
 assert.equal(report.scannedFrames,1);
});
test('invalid user feedback and arbitrary platform strings never enter report',()=>{
 const report=buildSiteReport({platform:'https://private.example/room?pass=SECRET',
   feedback:{video:'Hello from private classroom',fullscreen:'pass'},
   frameResults:[{videoElements:-1,visibleCaptionNodes:1000000,nativeTracks:{total:'NaN'}}]});
 assert.equal(report.platform,'Other');
 assert.equal(report.checks.video,'not-tested');
 assert.equal(report.checks.fullscreen,'pass');
 assert.equal(report.counts.visibleCaptionNodes,100);
 assert.equal(report.counts.videoElements,0);
 assert.ok(!JSON.stringify(report).includes('SECRET'));
});
test('scan uses owner selected tab and gracefully limits cross-origin frames',async()=>{
 let attempts=0;
 const api={
  webNavigation:{getAllFrames:async()=>[{frameId:0},{frameId:2}]},
  scripting:{executeScript:async args=>{
   attempts++;
   assert.equal(args.target.tabId,12);
   assert.equal(args.func,inspectMediaFrame);
   if(args.target.allFrames)throw Error('Cross origin frame restriction');
   assert.deepEqual(args.target.frameIds,[0]);
   return [{result:{videoElements:1,visibleCaptionNodes:0}}];
  }}
 };
 const scan=await scanSite(12,api);
 assert.equal(attempts,2);
 assert.equal(scan.scanMode,'main-frame');
 assert.equal(scan.knownFrameCount,2);
 assert.equal(buildSiteReport({frameResults:scan.frames}).counts.videoElements,1);
 await assert.rejects(scanSite(0,api),/有效/);
});
