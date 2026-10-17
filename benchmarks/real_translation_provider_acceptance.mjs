/** Explicitly opted-in LIVE vendor integration check.
 * Requires user-owned API credentials from environment, never prints the key,
 * response text, request content or account metadata. Exercises production
 * providers.js, not a fake HTTP response.
 *
 * Example:
 *   PIT_TEST_GOOGLE_KEY=... node benchmarks/real_translation_provider_acceptance.mjs \
 *     --provider google --acknowledge-billed-requests
 *   PIT_TEST_GEMINI_KEY=... node ... --provider gemini --acknowledge-billed-requests
 *
 * At most 3 English-to-Chinese probes per command. Unit/mock tests and
 * this live network validation must never be reported interchangeably.
 */
import {writeFileSync} from 'node:fs';
import {performance} from 'node:perf_hooks';
import {translateBatch} from '../src/lib/providers.js';

const selected=process.argv[process.argv.indexOf('--provider')+1]||'';
const approved=process.argv.includes('--acknowledge-billed-requests');
const configs={
  google:{provider:'google',googleKey:process.env.PIT_TEST_GOOGLE_KEY},
  microsoft:{provider:'microsoft',microsoftKey:process.env.PIT_TEST_MICROSOFT_KEY,
             microsoftRegion:process.env.PIT_TEST_MICROSOFT_REGION||''},
  deepl:{provider:'deepl',deeplKey:process.env.PIT_TEST_DEEPL_KEY,deeplPlan:'free'},
  gemini:{provider:'gemini',geminiKey:process.env.PIT_TEST_GEMINI_KEY,
          geminiModel:process.env.PIT_TEST_GEMINI_MODEL||'gemini-2.5-flash'},
  deepseek:{provider:'deepseek',deepseekKey:process.env.PIT_TEST_DEEPSEEK_KEY,
            deepseekModel:process.env.PIT_TEST_DEEPSEEK_MODEL||'deepseek-chat'}
};
if(!Object.hasOwn(configs,selected)){
  console.error('Specify --provider google|microsoft|deepl|gemini|deepseek');
  process.exit(2);
}
if(!approved){
  console.error('Live vendor billing consent is required: --acknowledge-billed-requests');
  process.exit(2);
}
const config=configs[selected];
const key=Object.entries(config).find(([k])=>/Key$/.test(k))?.[1];
if(typeof key!=='string'||!key.trim()){
  console.error('No provider credential in an explicitly configured PIT_TEST_* environment variable');
  process.exit(2);
}
const cases=[
  'Financial markets can become volatile when demand exceeds capacity.',
  'The bank revised its inflation forecast after the interest rate decision.',
  'A transportation network must balance demand, capacity and resilience.'
];
const observations=[];
const latencies=[];
for(let index=0;index<cases.length;index++){
  const started=performance.now();
  try{
    const translated=await translateBatch([cases[index]],{
      source:'en',target:'zh',...config,
      // This is an explicitly billed short integration probe; context is
      // controlled and contains no user documents.
      glossary:'',context:''
    });
    const elapsed=Math.round(performance.now()-started);
    const output=translated?.[0];
    observations.push({sample:index+1,status:
      typeof output==='string'&&output.trim()&&output!==cases[index]
        ?'translated_nonidentical':'empty_or_identity',
      chars:typeof output==='string'?Array.from(output).length:0,
      elapsed_ms:elapsed});
    latencies.push(elapsed);
  }catch(error){
    // Do not print response body, provider error raw text, keys or inputs.
    observations.push({sample:index+1,status:'provider_request_failed',
      error_type:error?.name||'Error',elapsed_ms:Math.round(performance.now()-started)});
  }
}
const times=[...latencies].sort((a,b)=>a-b);
const at=p=>times.length?times[Math.ceil(times.length*p)-1]:null;
const report={
  test_kind:'ACTUAL external translation provider, user-authorized requests',
  provider:selected,language_pair:'en-zh',max_requests:3,
  successful_nonidentity:observations.filter(x=>x.status==='translated_nonidentical').length,
  attempted:observations.length,p50_ms:at(.5),p95_ms:at(.95),
  semantic_adequacy_approved:false,
  back_translation_or_human_review_required:true,
  samples:observations
};
writeFileSync('real-vendor-probe.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({provider:report.provider,attempted:report.attempted,
   valid:report.successful_nonidentity,p95_ms:report.p95_ms,
   semantic_adequacy_approved:false}));
if(report.successful_nonidentity!==cases.length)process.exitCode=1;
