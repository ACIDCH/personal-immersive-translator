import test from 'node:test';
import assert from 'node:assert/strict';
import api,{detectSource} from '../src/index.mjs';

const secret='temporary-test-secret-min-16';
function request(path,method='GET',body=null,token=secret){
 const headers={};
 if(token)headers.authorization='Bearer '+token;
 if(body!==null)headers['content-type']='application/json';
 return new Request('https://demo.workers.dev'+path,{
   method,headers,...(body!==null?{body:JSON.stringify(body)}:{})
 });
}
let calls=[];
const env={PIT_ACCESS_TOKEN:secret,AI:{async run(name,params){
 calls.push({name,params});
 return {translated_text:'译文:'+params.text};
}}};
test('health only reports configured status, never claims deployed OCR or ASR',async()=>{
 const raw=await api.fetch(request('/health'),env);
 assert.equal(raw.status,200);
 assert.equal((await raw.json()).configured,true);
 const caps=await api.fetch(request('/v1/capabilities'),env);
 const data=await caps.json();
 assert.equal(data.routes.translate,'ready');
 assert.equal(data.routes.ocr,'not-deployed');
});
test('unconfigured/no token fails closed without executing AI',async()=>{
 calls=[];
 const body={texts:['Hello'],source:'en',target:'zh'};
 assert.equal((await api.fetch(request('/v1/translate','POST',body,null),env)).status,401);
 assert.equal((await api.fetch(request('/v1/translate','POST',body),{AI:env.AI})).status,401);
 assert.equal((await api.fetch(request('/v1/translate','POST',body),{PIT_ACCESS_TOKEN:secret})).status,503);
 assert.equal(calls.length,0);
});
test('calls REAL Workers AI binding contract with bounded translated strings',async()=>{
 calls=[];
 const x=await api.fetch(request('/v1/translate','POST',
  {texts:['Financial networks','Economic performance'],source:'en',target:'zh'}),env);
 assert.equal(x.status,200);
 assert.deepEqual((await x.json()).translations,['译文:Financial networks','译文:Economic performance']);
 assert.equal(calls.length,2);
 assert.equal(calls[0].name,'@cf/meta/m2m100-1.2b');
 assert.equal(calls[0].params.source_lang,'en');
});
test('distinguishes CJK script auto detection from uncertain Latin text',async()=>{
 assert.deepEqual(detectSource('这是中文金融市场'),{language:'zh',confidence:'script'});
 assert.equal(detectSource('日本語の授業').language,'ja');
 assert.equal(detectSource('한국어 강의').language,'ko');
 assert.equal(detectSource('Bonjour je suis étudiant').confidence,'latin-fallback-unverified');
 const x=await api.fetch(request('/v1/translate','POST',{
  texts:['Bonjour je suis étudiant'],source:'auto',target:'zh'}),env);
 assert.equal((await x.json()).autoWarning,true);
});
test('rejects unsupported language, oversize batch and malformed model output',async()=>{
 assert.equal((await api.fetch(request('/v1/translate','POST',
  {texts:['hello'],source:'en',target:'xx'}),env)).status,400);
 assert.equal((await api.fetch(request('/v1/translate','POST',
  {texts:['x'.repeat(4001)],source:'auto',target:'zh'}),env)).status,400);
 const broken={PIT_ACCESS_TOKEN:secret,AI:{run:async()=>({translation:'bad schema'})}};
 assert.equal((await api.fetch(request('/v1/translate','POST',
  {texts:['hello'],source:'en',target:'zh'}),broken)).status,502);
});

test('hosted Whisper uses real Workers AI binding with actual PCM WAV bytes',async()=>{
 const wav=new Uint8Array(32044);
 wav.set([82,73,70,70],0);wav.set([87,65,86,69],8);
 const calls=[];
 const config={PIT_ACCESS_TOKEN:secret,AI:{run:async(name,params)=>{
  calls.push({name,params});return {text:'This is a transcribed lecture'};
 }}};
 const req=new Request('https://demo.workers.dev/v1/asr',{
  method:'POST',headers:{authorization:'Bearer '+secret,'content-type':'audio/wav'},
  body:wav
 });
 const response=await api.fetch(req,config);
 assert.equal(response.status,200);
 assert.equal((await response.json()).text,'This is a transcribed lecture');
 assert.equal(calls[0].name,'@cf/openai/whisper-large-v3-turbo');
 assert.equal(calls[0].params.task,'transcribe');
 assert.equal(typeof calls[0].params.audio,'string');
 assert.ok(calls[0].params.audio.length>1000);
 assert.equal((await api.fetch(new Request('https://demo.workers.dev/v1/asr',{
  method:'POST',headers:{'content-type':'audio/wav'},body:wav}),config)).status,401);
});
test('hosted Whisper rejects oversized and invalid audio without inference',async()=>{
 let calls=0;
 const config={PIT_ACCESS_TOKEN:secret,AI:{run:async()=>{calls++;return {text:'bad'};}}};
 const bad=new Request('https://demo.workers.dev/v1/asr',{
  method:'POST',headers:{authorization:'Bearer '+secret,'content-type':'audio/wav'},
  body:new Uint8Array(200)
 });
 assert.equal((await api.fetch(bad,config)).status,400);
 const oversize=new Request('https://demo.workers.dev/v1/asr',{
  method:'POST',headers:{authorization:'Bearer '+secret,'content-type':'audio/wav'},
  body:new Uint8Array(350001)
 });
 assert.equal((await api.fetch(oversize,config)).status,413);
 assert.equal(calls,0);
});
