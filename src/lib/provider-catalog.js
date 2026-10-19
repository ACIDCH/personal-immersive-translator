import {isStandardServiceConfigured} from './settings.js';
import {selectedAIProfile} from './ai-profiles.js';
export const PROVIDERS=Object.freeze([
 {id:'browser',name:'Chrome Translator',category:'本地免 Key',notice:'本机语言包；需 Chrome 支持。原文不出设备。',cost:false},
 {id:'mymemory',name:'MyMemory',category:'在线免 Key',notice:'原文发送 MyMemory；本地每日上限 4,500 字符，服务端另有限额。',cost:false},
 {id:'microsoft',name:'Microsoft Translator',category:'BYOK 标准 MT',notice:'官方 API，需 Key / 区域。免费额度不等于免 Key。',cost:true},
 {id:'google',name:'Google Cloud Translation',category:'BYOK 标准 MT',notice:'官方 Cloud Translation v2，需要 API Key。',cost:true},
 {id:'deepl',name:'DeepL',category:'BYOK 标准 MT',notice:'官方 Free / Pro API，均需 Key。',cost:true},
 {id:'cloud',name:'PIT Worker',category:'自托管',notice:'需部署 HTTPS Worker、令牌及算力额度。',cost:true},
 {id:'libre',name:'LibreTranslate',category:'自托管',notice:'使用你有权访问的 HTTPS 实例；需实例许可与语言模型。',cost:true},
 {id:'gemini',name:'Gemini',category:'AI 模型',notice:'Google AI API；需要 Key，可能产生费用。',cost:true,ai:true},
 {id:'deepseek',name:'DeepSeek',category:'AI 模型',notice:'DeepSeek API；需要 Key，可能产生费用。',cost:true,ai:true}
]);
export function providerCatalog(s){return [...PROVIDERS,...s.aiProfiles.map(p=>({id:'custom',profileId:p.id,name:p.name,category:'AI 模型',notice:p.protocol+' · '+p.model,cost:true,ai:true}))];}
export function probeStatus(e){const m=String(e?.message||e);return e?.status===429?'rate-limited':[401,403].includes(e?.status)?'auth-failed':/超时|timeout/i.test(m)?'timeout':/语言包|download|模型|内置翻译/i.test(m)?'missing-pack':/语言|language/i.test(m)?'unsupported-language':/网络|fetch|network|CORS/i.test(m)?'network-error':'invalid-response';}
export async function probeProvider(s,msg,run){
 const id=msg.providerId||(msg.mode==='ai'?s.aiProvider:s.standardProvider);
 const entry=providerCatalog(s).find(p=>p.id===id&&(!msg.profileId||p.profileId===msg.profileId));
 const started=Date.now(),source='en',target=msg.target||s.target;
 const base={providerId:id,profileId:msg.profileId,source,target,testedAt:new Date().toISOString(),confirmedLive:false,route:id==='browser'?'native':'http'};
 const result=(status,extra={})=>({...base,status,ok:status==='available',elapsedMs:Date.now()-started,...extra});
 if(!entry)return result('invalid-response',{error:'没有对应的服务适配器'});
 if(!['zh','en','fr','ja','ko','de','es'].includes(target)||target===source)return result('unsupported-language',{error:'测试固定英文公开短句，请选择非英文目标语言'});
 const opts={...s,provider:id,source,target,activeAIProfileId:msg.profileId||s.activeAIProfileId};
 try{
  if(entry.ai){if(id==='custom')selectedAIProfile(opts);else if(!String(s[id+'Key']||'').trim())throw Error('缺少 API Key');}
  else if(!isStandardServiceConfigured({...s,standardProvider:id}))throw Error('缺少 Key 或服务地址/令牌');
 }catch{return result('not-configured',{error:'此服务尚未配置；请填写对应凭据或解锁保险库。'});}
 if(entry.cost&&msg.costConfirmed!==true)return result('confirmation-required',{error:'此测试可能计费，需逐次明确确认。'});
 try{
  const translations=await run(['Hello, welcome to our class.'],opts);
  const preview=translations?.[0]?.trim();
  if(!preview||preview==='Hello, welcome to our class.')throw Error('未返回有效目标语译文（为空或与原文相同）');
  return result('available',{translations,translationPreview:preview.slice(0,300),confirmedLive:true});
 }catch(e){return result(probeStatus(e),{error:'服务测试失败：'+String(e?.message||e).slice(0,240),errorCode:String(e?.status||probeStatus(e))});}
}
