/** Real hosted standard MT for PIT. Deployment needs a Cloudflare Workers AI
 * binding named AI plus owner PIT_ACCESS_TOKEN secret (min 16 chars).
 * Uploaded files never reach this endpoint: only extracted text chunks.
 * Actual model charges/quotas are governed by Cloudflare's Workers AI plan.
 */
const MODEL='@cf/meta/m2m100-1.2b';
const LANGUAGES=new Set(['en','zh','ja','ko','fr','de','es']);
function json(data,status=200){
 return new Response(JSON.stringify(data),{status,headers:{
  'content-type':'application/json; charset=utf-8','cache-control':'no-store',
  'access-control-allow-origin':'*',
  'access-control-allow-methods':'GET, POST, OPTIONS',
  'access-control-allow-headers':'Authorization, Content-Type',
  'access-control-max-age':'600','x-content-type-options':'nosniff'}});
}
export function detectSource(text){
 const s=String(text||'').slice(0,6000);
 const count=re=>(s.match(re)||[]).length;
 const cjk=count(/[\u3400-\u9fff]/g),kana=count(/[\u3040-\u30ff]/g),hangul=count(/[\uac00-\ud7af]/g);
 if(hangul>=2&&hangul>kana)return {language:'ko',confidence:'script'};
 if(kana>=1)return {language:'ja',confidence:'script'};
 if(cjk>=2)return {language:'zh',confidence:'script'};
 return {language:'en',confidence:'latin-fallback-unverified'};
}
function authorized(request,env){
 const secret=env?.PIT_ACCESS_TOKEN;
 return typeof secret==='string'&&secret.length>=16&&
  request.headers.get('authorization')==='Bearer '+secret;
}
export default {
 async fetch(request,env){
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{
   'access-control-allow-origin':'*',
   'access-control-allow-methods':'GET, POST, OPTIONS',
   'access-control-allow-headers':'Authorization, Content-Type',
   'access-control-max-age':'600'
  }});
  const u=new URL(request.url);
  if(request.method==='GET'&&u.pathname==='/health')
   return json({ok:true,service:'pit-cloud-translator',
    configured:Boolean(env?.AI&&typeof env?.PIT_ACCESS_TOKEN==='string'&&env.PIT_ACCESS_TOKEN.length>=16),
    stage:'native-mt-implementation'});
  if(request.method==='GET'&&u.pathname==='/v1/capabilities'){
   if(!authorized(request,env))return json({error:'unauthorized'},401);
   return json({ready:Boolean(env?.AI),model:MODEL,
    routes:{translate:env?.AI?'ready':'ai-binding-missing',ocr:'not-deployed',
            asr:env?.AI?'ready':'ai-binding-missing',pdf:'not-deployed'},
    languages:[...LANGUAGES],auto_detection:'CJK script; Latin fallback unverified'});
  }
  if(u.pathname==='/v1/asr'){
   if(request.method!=='POST')return json({error:'method_not_allowed'},405);
   if(!authorized(request,env))return json({error:'unauthorized'},401);
   if(!env?.AI?.run)return json({error:'workers_ai_binding_missing'},503);
   if(!/^audio\/wav(?:\s*;.*)?$/i.test(request.headers.get('content-type')||''))
    return json({error:'wav_required'},415);
   if(Number(request.headers.get('content-length')||0)>350000)
    return json({error:'audio_too_large'},413);
   let wav;
   try{wav=new Uint8Array(await request.arrayBuffer());}
   catch{return json({error:'invalid_audio'},400);}
   if(wav.length>350000)return json({error:'audio_too_large'},413);
   if(wav.length<44||
      String.fromCharCode(...wav.slice(0,4))!=='RIFF'||
      String.fromCharCode(...wav.slice(8,12))!=='WAVE')
    return json({error:'invalid_wav'},400);
   // The model expects a base64 audio blob, not a model-download URI or
   // a fetch of arbitrary user-provided URLs. Avoid remote SSRF entirely.
   let base64='';
   for(let i=0;i<wav.length;i+=8192){
    base64+=String.fromCharCode(...wav.subarray(i,i+8192));
   }
   const encoded=btoa(base64);
   try{
    const answer=await env.AI.run('@cf/openai/whisper-large-v3-turbo',{
     audio:encoded,task:'transcribe',vad_filter:true,
     condition_on_previous_text:false
    });
    const text=answer?.text;
    if(typeof text!=='string')return json({error:'invalid_asr_output'},502);
    return json({text:text.trim().slice(0,5000),
      engine:'@cf/openai/whisper-large-v3-turbo'});
   }catch(error){
    return json({error:'cloud_asr_unavailable'},Number(error?.status)===429?429:503);
   }
  }
  if(u.pathname==='/v1/translate'){
   if(request.method!=='POST')return json({error:'method_not_allowed'},405);
   if(!authorized(request,env))return json({error:'unauthorized'},401);
   if(!env?.AI?.run)return json({error:'workers_ai_binding_missing'},503);
   if(Number(request.headers.get('content-length')||0)>18000)
    return json({error:'request_too_large'},413);
   let body;
   try{body=await request.json();}catch{return json({error:'invalid_json'},400);}
   const texts=body?.texts,source=body?.source||'auto',target=body?.target;
   if(!Array.isArray(texts)||!texts.length||texts.length>10||
      texts.some(x=>typeof x!=='string'||!x.trim()||x.length>4000)||
      texts.reduce((n,x)=>n+x.length,0)>12000)
    return json({error:'invalid_segments'},400);
   if(!LANGUAGES.has(target)||!(source==='auto'||LANGUAGES.has(source)))
    return json({error:'unsupported_language'},400);
   const translations=[],detected=[];
   try{
    for(const text of texts){
     const choice=source==='auto'?detectSource(text):{language:source,confidence:'explicit'};
     detected.push(choice);
     if(choice.language===target){translations.push(text);continue;}
     const answer=await env.AI.run(MODEL,{
       text,source_lang:choice.language,target_lang:target
     });
     if(typeof answer?.translated_text!=='string'||!answer.translated_text.trim())
      return json({error:'invalid_model_output'},502);
     translations.push(answer.translated_text);
    }
    return json({translations,detected,model:MODEL,
      autoWarning:detected.some(x=>x.confidence==='latin-fallback-unverified')});
   }catch(err){
    // Never surface raw provider exceptions, source texts or private token.
    return json({error:'cloud_model_unavailable'},Number(err?.status)===429?429:503);
   }
  }
  if(u.pathname.startsWith('/v1/'))return json({error:'not_implemented'},501);
  return json({error:'not_found'},404);
 }
};
