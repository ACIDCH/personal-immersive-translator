import {writeFileSync} from 'node:fs';
import {translateBatch} from '../src/lib/providers.js';

const started=Date.now();
const verdict={provider:'google-free',transport:'actual-public-HTTP',
  source:'en',target:'zh',status:'NOT_EXECUTED',live:false};
try{
 const output=await translateBatch(
  ['What you choose to do with your career matters.'],
  {provider:'google-free',source:'en',target:'zh'}
 );
 const text=output?.[0]||'';
 if(/[\u3400-\u9fff]/u.test(text)&&text!== 'What you choose to do with your career matters.'){
  verdict.status='PASS';verdict.live=true;
  verdict.outputCharacters=text.length;
 }else{
  verdict.status='INVALID_TRANSLATION';
 }
}catch(error){
 verdict.status=Number(error?.status)===429?'RATE_LIMITED':'UNAVAILABLE';
 verdict.httpStatus=Number(error?.status)||null;
 verdict.errorCategory=error?.name||'Error';
}
verdict.elapsedMs=Date.now()-started;
writeFileSync('live-google-free-observation.json',JSON.stringify(verdict,null,2)+'\n');
console.log('ACTUAL GOOGLE-FREE MT VERDICT:',JSON.stringify(verdict));
