// User-controlled BYOK model profiles. Only HTTPS endpoints are enabled;
// no remote executable code, credentials in query strings, or implicit fallback.
export const AI_PROTOCOLS = Object.freeze(['openai-chat', 'anthropic-messages']);
const CONTROL = /[\u0000-\u001f\u007f]/;

export function validateAIProfile(candidate) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) throw new Error('AI 配置无效');
  const id=String(candidate.id??'').trim();
  const name=String(candidate.name??'').trim();
  const protocol=String(candidate.protocol??'openai-chat');
  const model=String(candidate.model??'').trim();
  const apiKey=String(candidate.apiKey??'').trim();
  if(!/^[\w-]{3,70}$/.test(id)) throw new Error('AI 配置 ID 无效');
  if(!name || name.length>80 || CONTROL.test(name)) throw new Error('AI 配置名称无效');
  if(!AI_PROTOCOLS.includes(protocol)) throw new Error('不支持的 AI 接口协议');
  if(!model || model.length>160 || CONTROL.test(model)) throw new Error('模型 ID 无效');
  if(!apiKey || apiKey.length>500 || CONTROL.test(apiKey)) throw new Error('缺少或无效的 API Key');
  const endpoint=String(candidate.baseUrl??'').trim();
  let url;
  try {url=new URL(endpoint);} catch {throw new Error('API Base URL 无效');}
  if(url.protocol!=='https:' || !url.hostname || url.username || url.password || url.search || url.hash ||
      url.port || endpoint.length>500 || CONTROL.test(endpoint)) {
    throw new Error('AI 接口仅支持无凭据、无查询参数的 HTTPS 地址');
  }
  if(url.hostname==='localhost' || url.hostname.endsWith('.localhost') ||
      /^(?:127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(url.hostname) ||
      url.hostname.startsWith('[')) {
    throw new Error('本地服务需单独配置本机适配器，不能作为云端 URL');
  }
  if(!/^\/[\w./-]*$/.test(url.pathname) || url.pathname.includes('..')) throw new Error('API 路径无效');
  return {id,name,protocol,model,apiKey,baseUrl:url.href.replace(/\/$/,'')};
}

export function selectedAIProfile(settings) {
  const candidates=Array.isArray(settings.aiProfiles)?settings.aiProfiles:[];
  const profile=candidates.find(p=>p?.id===settings.activeAIProfileId);
  if(!profile)throw new Error('请在「自定义 AI」中添加并选择一个模型');
  return validateAIProfile(profile);
}
