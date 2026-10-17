// Cloudflare Worker scaffold. No remote AI calls, no database writes.
// Do not deploy a public unauthenticated BYOK relay: real requests require
// signed authorization, provider allowlisting, quotas and secret handling.
const reply=(body,status=200)=>new Response(JSON.stringify(body),{
 status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}
});
export default {
 async fetch(request){
  const u=new URL(request.url);
  if(request.method==='GET' && u.pathname==='/health')
   return reply({ok:true,service:'multimodal-translate-api',stage:'scaffold'});
  if(request.method==='GET' && u.pathname==='/v1/capabilities')
   return reply({ready:false,protocols:['openai-chat','anthropic-messages'],
     routes:{translate:'not-connected',ocr:'not-connected',asr:'not-connected'}});
  if(u.pathname.startsWith('/v1/'))return reply({error:'not_implemented'},501);
  return reply({error:'not_found'},404);
 }
};
