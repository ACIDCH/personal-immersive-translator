/** This probe calls ONE actual public free MT service, not a test mock.
 * Inconclusive network blocking is recorded as BLOCKED, never PASS.
 * Public synthetic English input only; no private text, account or secrets.
 */
import {writeFileSync} from 'node:fs';
import {performance} from 'node:perf_hooks';
import {translateBatch} from '../src/lib/providers.js';
const started=performance.now();
const result={
  endpoint:'https://api.mymemory.translated.net/get',
  type:'external live HTTP; no intercept or mock',
  pairs:'en|zh-CN',requested_segments:1,request_chars:45,
  status:'BLOCKED',reason:null,elapsed_ms:0
};
try{
 const translations=await translateBatch(
  ['International logistics improve delivery reliability.'],
  {provider:'mymemory',source:'en',target:'zh'},fetch
 );
 const value=translations[0]||'';
 result.status=value.trim()&&value!=='International logistics improve delivery reliability.'&&
   /[\u3400-\u9fff]/.test(value)?'LIVE_TRANSLATION_RETURNED':'INVALID_LIVE_OUTPUT';
 result.received_valid_chinese=Boolean(/[\u3400-\u9fff]/.test(value));
}catch(error){
 // Don't log remote translation content or arbitrary vendor response body.
 result.reason=error?.name||'Error';
 result.http_status=Number(error?.status)||null;
}
result.elapsed_ms=Math.round(performance.now()-started);
writeFileSync('live-mymemory-observation.json',JSON.stringify(result,null,2)+'\n');
console.log('PUBLIC LIVE MT PROBE:',JSON.stringify(result));
if(result.status!=='LIVE_TRANSLATION_RETURNED')process.exitCode=2;
