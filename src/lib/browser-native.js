/**
 * Keyless Chrome Translator API standard machine translation.
 * Chrome 138+ supports Translator in extension document contexts.
 * Browser language packs may require an explicit click to download; this
 * engine NEVER silently downloads models as part of an automatic page view.
 * Translation is on device once the browser has downloaded the packs.
 */
export class NativeTranslationUnavailable extends Error{
 constructor(message,code='unavailable'){super(message);this.name='NativeTranslationUnavailable';this.code=code;}
}
const sessions=new Map();
function pair(source,target){
 if(!/^[a-z]{2}(?:-[A-Z]{2})?$/.test(source)||
    !/^[a-z]{2}(?:-[A-Z]{2})?$/.test(target))
  throw new NativeTranslationUnavailable('请选择可识别的原文和目标语言','invalid_language');
 return {sourceLanguage:source,targetLanguage:target};
}
export async function checkNativeTranslator(source,target,
 api=globalThis.Translator){
 const options=pair(source,target);
 if(typeof api?.availability!=='function'||typeof api?.create!=='function')
  throw new NativeTranslationUnavailable(
   '当前浏览器未提供 Chrome 内置翻译 API。请使用 Chrome 138+ 或改选云端翻译。','unsupported');
 const status=await api.availability(options);
 if(!['available','downloadable','downloading','unavailable'].includes(status))
  throw new NativeTranslationUnavailable('浏览器没有返回有效的语言包状态','unexpected_status');
 return status;
}
export async function ensureNativeTranslator(source,target,{
 allowDownload=false,api=globalThis.Translator
}={}){
 const options=pair(source,target),key=source+'>'+target;
 if(sessions.has(key))return sessions.get(key);
 const state=await checkNativeTranslator(source,target,api);
 if(state==='unavailable')
  throw new NativeTranslationUnavailable('浏览器不支持该语言对，请改用在线翻译服务','unsupported_language_pair');
 if(state!=='available'&&!allowDownload)
  throw new NativeTranslationUnavailable(
   'Chrome 尚未下载此语言对的离线翻译包。请在 PIT 设置中点击「下载浏览器语言包」后重试。',
   'download_required');
 try{
  const translator=await api.create(options);
  if(!translator||typeof translator.translate!=='function')
   throw Error('Translator model did not initialize');
  if(sessions.size>=8){
   const old=sessions.keys().next().value;
   try{sessions.get(old)?.destroy?.();}catch{}
   sessions.delete(old);
  }
  sessions.set(key,translator);
  return translator;
 }catch(error){
  throw new NativeTranslationUnavailable(
   'Chrome 内置模型初始化失败（浏览器许可、磁盘空间或用户手势可能不足）。请在设置页主动下载。',
   'model_setup_failed');
 }
}
export async function translateWithNative(texts,{source,target,api=globalThis.Translator}={}){
 if(!Array.isArray(texts)||!texts.length||texts.length>10||
    texts.some(t=>typeof t!=='string'||!t.trim()||t.length>4000))
  throw new NativeTranslationUnavailable('浏览器内置翻译一次最多支持 10 段、每段最多 4000 字符','invalid_batch');
 if(source===target)return [...texts];
 const translator=await ensureNativeTranslator(source,target,{api});
 const translations=[];
 for(const item of texts){
  try{
   const translation=await translator.translate(item);
   if(typeof translation!=='string'||!translation.trim())
    throw Error('Empty translation');
   translations.push(translation);
  }catch(error){
   throw new NativeTranslationUnavailable('浏览器内置翻译执行失败，请重试或切换在线服务','translate_failed');
  }
 }
 return translations;
}
