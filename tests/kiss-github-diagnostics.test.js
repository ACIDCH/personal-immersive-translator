import test from 'node:test';
import assert from 'node:assert/strict';
import {GITHUB_ISSUES_URL,createGitHubDiagnosticIssue,makeIssuePayload,
 safeDiagnosticReport,validateIssueToken} from '../src/kiss/github-diagnostics.js';
const token='github_pat_TEST_SCOPED_TOKEN_0123456789';
const fakeReport={
 schema:'pit-real-site-check-v1',timestamp:'2026-10-17T02:00:00.000Z',
 platform:'Miss AV',scanMode:'full',scannedFrames:1,knownFrames:2,
 counts:{videoElements:1,visibleCaptionNodes:2,nativeTracks:{total:1,showing:1},
  url:'https://secret.invalid/video?p=PASSWORD',secret:'COURSE_CAPTIONS_SECRET'},
 checks:{video:'pass',webTranslation:'fail',imageOcr:'not-tested',
  evil:'UNEXPECTED_COOKIE_SECRET'},
 url:'https://secret.invalid/',secret:'PASSWORD_BEARER_TOKEN',cookie:'a=b',
 subtitles:'PRIVATE_SUBTITLE_TEXT'
};
test('sanitized GitHub Issue stores strictly allowlisted fields',()=>{
 const payload=makeIssuePayload(fakeReport),json=JSON.stringify(payload);
 assert.match(payload.title,/Miss AV/);
 const safe=safeDiagnosticReport(fakeReport);
 assert.equal(safe.checks.webTranslation,'fail');
 assert.equal(safe.checks.pdfLayout,'not-tested');
 assert.equal(safe.platform,'Miss AV');
 assert.equal(safe.counts.videoElements,1);
 for(const raw of ['secret.invalid','PASSWORD','COURSE_CAPTIONS_SECRET',
  'UNEXPECTED_COOKIE_SECRET','PRIVATE_SUBTITLE_TEXT','Bearer','cookie'])
   assert.ok(!json.includes(raw),raw);
 assert.ok(json.includes('pit-real-site-check-v1'));
});
test('one-click upload POST creates issue with owner repo, no unexpected URL or token in body',async()=>{
 let calls=0;
 const fakeFetch=async(url,opts)=>{
  calls++;
  assert.equal(url,GITHUB_ISSUES_URL);
  assert.equal(opts.method,'POST');
  assert.equal(opts.headers.Authorization,'Bearer '+token);
  assert.ok(!opts.body.includes(token));
  assert.ok(!opts.body.includes('secret.invalid'));
  const body=JSON.parse(opts.body);
  assert.equal(body.title,'[PIT 兼容性诊断] Miss AV · 2026-10-17');
  return {ok:true,status:201,json:async()=>({
   number:123,html_url:'https://malicious.example/not-our-github'
  })};
 };
 const issue=await createGitHubDiagnosticIssue(fakeReport,token,fakeFetch);
 assert.equal(calls,1);
 assert.equal(issue.number,123);
 assert.equal(issue.url,'https://github.com/ACIDCH/personal-immersive-translator/issues/123');
});
test('never sends missing token; treats GitHub permission/network errors distinctly',async()=>{
 assert.equal(validateIssueToken(token),true);
 assert.equal(validateIssueToken('short'),false);
 let called=false;
 await assert.rejects(createGitHubDiagnosticIssue(fakeReport,'bad',()=>{
  called=true;throw Error('should never run');
 }),/GitHub Fine-grained Token/);
 assert.equal(called,false);
 await assert.rejects(createGitHubDiagnosticIssue(fakeReport,token,
  async()=>({ok:false,status:401})),/Token 无效/);
 await assert.rejects(createGitHubDiagnosticIssue(fakeReport,token,
  async()=>({ok:false,status:403})),/Issues Read and write/);
 await assert.rejects(createGitHubDiagnosticIssue(fakeReport,token,
  async()=>{throw Error('bad secret token:'+token);}),/无法连接 GitHub/);
});
test('malformed report rejected before API call',async()=>{
 let called=false;
 await assert.rejects(createGitHubDiagnosticIssue({schema:'wrong'},token,async()=>{
  called=true;return {};
 }),/报告版本无效/);
 assert.equal(called,false);
});
