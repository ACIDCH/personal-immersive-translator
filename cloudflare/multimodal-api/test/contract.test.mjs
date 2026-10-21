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
function pcmWav(sampleCount=16000){
 const wav=new Uint8Array(44+sampleCount*2),data=new DataView(wav.buffer);
 const ascii=(at,text)=>{for(let i=0;i<text.length;i++)wav[at+i]=text.charCodeAt(i);};
 ascii(0,'RIFF');data.setUint32(4,wav.length-8,true);ascii(8,'WAVE');
 ascii(12,'fmt ');data.setUint32(16,16,true);
 data.setUint16(20,1,true);data.setUint16(22,1,true);
 data.setUint32(24,16000,true);data.setUint32(28,32000,true);
 data.setUint16(32,2,true);data.setUint16(34,16,true);
 ascii(36,'data');data.setUint32(40,sampleCount*2,true);
 return wav;
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
 assert.equal(detectSource('Bonjour je suis étudiant').language,'fr');
 assert.equal(detectSource('Die Wirtschaft und der Markt sind stabil').language,'de');
 assert.equal(detectSource('Hola las universidades son importantes para estudiantes').language,'es');
 assert.equal(detectSource('English word').confidence,'latin-fallback-unverified');
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
 const wav=pcmWav();
 const calls=[];
 const config={PIT_ACCESS_TOKEN:secret,AI:{run:async(name,params)=>{
  calls.push({name,params});return {text:'Bonjour, bienvenue au cours',
   transcription_info:{language:'fr',language_probability:0.97}};
 }}};
 const req=new Request('https://demo.workers.dev/v1/asr',{
  method:'POST',headers:{authorization:'Bearer '+secret,'content-type':'audio/wav'},
  body:wav
 });
 const response=await api.fetch(req,config);
 assert.equal(response.status,200);
 const transcript=await response.json();
 assert.equal(transcript.text,'Bonjour, bienvenue au cours');
 assert.equal(transcript.language,'fr');
 assert.equal(transcript.languageConfidence,0.97);
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

test('Workers ASR validates actual PCM structure before invoking a model',async()=>{
 const {validAsrWav}=await import('../src/index.mjs');
 let count=0;
 const bound={PIT_ACCESS_TOKEN:secret,AI:{run:async()=>{count++;return {text:'bad'};}}};
 const fromBytes=async(wav)=>api.fetch(new Request('https://demo.workers.dev/v1/asr',{
  method:'POST',headers:{authorization:'Bearer '+secret,'content-type':'audio/wav'},
  body:wav
 }),bound);
 const valid=pcmWav();
 assert.equal(validAsrWav(valid),true);
 const changes=[
  wav=>{new DataView(wav.buffer).setUint32(24,48000,true);},
  wav=>{new DataView(wav.buffer).setUint16(22,2,true);},
  wav=>{new DataView(wav.buffer).setUint32(40,8,true);},
  wav=>{new DataView(wav.buffer).setUint32(4,40,true);},
  wav=>{wav[36]=88;},
  wav=>{new DataView(wav.buffer).setUint16(34,8,true);}
 ];
 for(const change of changes){
  const wav=valid.slice();change(wav);
  assert.equal(validAsrWav(wav),false);
  assert.equal((await fromBytes(wav)).status,400);
 }
 assert.equal(count,0,'malformed WAV never consumes Workers AI inference');
});
test('Whisper omits unsupported and low-confidence source languages',async()=>{
 const wav=pcmWav(1600);
 const wire=()=>new Request('https://demo.workers.dev/v1/asr',{
  method:'POST',headers:{authorization:'Bearer '+secret,'content-type':'audio/wav'},
  body:wav
 });
 for(const info of [
  {language:'fr',language_probability:0.32},
  {language:'ru',language_probability:0.99},
  {language:'en',language_probability:NaN}
 ]){
  const bound={PIT_ACCESS_TOKEN:secret,AI:{run:async()=>({
   text:'Bonjour',transcription_info:info
  })}};
  const response=await api.fetch(wire(),bound);
  assert.equal(response.status,200);
  const body=await response.json();
  assert.equal(body.language,null);
  assert.equal(body.languageConfidence,null);
 }
 const bound={PIT_ACCESS_TOKEN:secret,AI:{run:async()=>({
   text:'短句',transcription_info:{language:'zh-CN',language_probability:0.96}
 })}};
 const response=await api.fetch(wire(),bound);
 assert.equal((await response.json()).language,'zh');
});
test('real extension cross-origin CORS preflight permits bearer and JSON',async()=>{
 const preflight=await api.fetch(new Request('https://demo.workers.dev/v1/translate',{
  method:'OPTIONS',
  headers:{Origin:'chrome-extension://abcdefghijklmnopabcdefghijklmnop',
   'Access-Control-Request-Method':'POST',
   'Access-Control-Request-Headers':'authorization,content-type'}}),env);
 assert.equal(preflight.status,204);
 assert.match(preflight.headers.get('access-control-allow-headers'),/Authorization/);
 assert.match(preflight.headers.get('access-control-allow-methods'),/POST/);
 assert.equal(preflight.headers.get('access-control-allow-origin'),'*');
});

test('accepts Chrome per-segment language hints for French and German without false English guess',async()=>{
 const recorded=[];
 const bound={PIT_ACCESS_TOKEN:secret,AI:{
  run:async(model,payload)=>{recorded.push(payload);return {translated_text:'有效译文'};}
 }};
 const res=await api.fetch(request('/v1/translate','POST',{
  texts:['Bonjour mes chers étudiants, bienvenue à notre cours',
         'Die Wirtschaftsleistung und die Beschäftigung sind gestiegen'],
  source:'auto',target:'zh',sources:['fr','de']}),bound);
 assert.equal(res.status,200);
 const body=await res.json();
 assert.deepEqual(body.translations,['有效译文','有效译文']);
 assert.deepEqual(body.detected.map(d=>d.confidence),['chrome-cld','chrome-cld']);
 assert.deepEqual(recorded.map(x=>x.source_lang),['fr','de']);
 assert.equal(body.autoWarning,false);
});
test('rejects malformed or unauthorized per-segment language claims',async()=>{
 for(const sources of [['xx'],['de','fr'],['zh','en']]){
  const x=await api.fetch(request('/v1/translate','POST',{
   texts:['Bonjour les étudiants et les professeurs'],source:'auto',target:'zh',sources
  }),env);
  assert.equal(x.status,400);
 }
 const y=await api.fetch(request('/v1/translate','POST',{
  texts:['Financial systems'],source:'en',target:'zh',sources:['en']
 }),env);
 assert.equal(y.status,400);
});
