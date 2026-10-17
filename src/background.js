import {translateBatch, TranslationError} from './lib/providers.js';
import {SETTINGS_KEY, normalizeSettings, hostIsBlocked, AI_PROVIDERS, STANDARD_PROVIDERS} from './lib/settings.js';
import {cachedTranslation, saveTranslation, clearTranslations} from './lib/cache.js';

chrome.runtime.onInstalled.addListener(async () => {
  try {
    await chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});
    const data = await chrome.storage.local.get(SETTINGS_KEY);
    if (!data[SETTINGS_KEY]) await chrome.storage.local.set({[SETTINGS_KEY]: normalizeSettings()});
  } catch (error) { console.warn('PIT setup failed', error); }
});
chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'}).catch(()=>{});
async function getSettings() {
  const item = await chrome.storage.local.get(SETTINGS_KEY);
  return normalizeSettings(item[SETTINGS_KEY]);
}
function ensureSource(sender, type) {
  if (sender.id !== chrome.runtime.id) throw new TranslationError('无效的消息来源');
  if (type === 'TRANSLATE_BATCH' && !sender.tab) throw new TranslationError('网页翻译请求必须来自当前网页');
}
async function handle(message, sender) {
  if (!message || typeof message.type !== 'string') throw new TranslationError('无效的请求');
  ensureSource(sender, message.type);
  if (message.type === 'GET_SETTINGS') {
    if (sender.tab) throw new TranslationError('网页不允许读取 API 配置');
    return {settings: await getSettings()};
  }
  if (message.type === 'CLEAR_CACHE') {
    if (sender.tab) throw new TranslationError('仅设置界面可以清除缓存');
    await clearTranslations(chrome.storage.local); return {ok:true};
  }
  if (message.type !== 'TRANSLATE_BATCH' && message.type !== 'TEST_PROVIDER') throw new TranslationError('不支持的请求');
  if (message.type === 'TEST_PROVIDER' && sender.tab) throw new TranslationError('仅设置界面可测试 API');
  const settings = await getSettings();
  if (sender.tab) {
    const url = sender.tab.url || '';
    try {
      if (hostIsBlocked(new URL(url).hostname, settings.blockedHosts)) throw new TranslationError('当前网站已加入禁止翻译列表');
    } catch (e) { if (e instanceof TranslationError) throw e; }
  }
  const isAI = message.mode === 'ai';
  if (message.mode !== 'standard' && message.mode !== 'ai') throw new TranslationError('翻译模式无效');
  const provider = isAI ? settings.aiProvider : settings.standardProvider;
  if (!(isAI ? AI_PROVIDERS : STANDARD_PROVIDERS).includes(provider)) throw new TranslationError('翻译服务配置无效');
  if (isAI && message.type !== 'TEST_PROVIDER' && message.userInitiated !== true) {
    throw new TranslationError('必须由用户明确启用 AI 翻译');
  }
  const texts = message.type === 'TEST_PROVIDER' ? ['Hello, world!'] : message.texts;
  if (!Array.isArray(texts) || texts.length < 1 || texts.length > 10 || texts.some(t => typeof t !== 'string' || t.length > 5000 || t.length < 1)) throw new TranslationError('翻译文本无效');
  const source = settings.source;
  const target = settings.target;
  const model = isAI ? ({gemini: settings.geminiModel, deepseek: settings.deepseekModel, openrouter: settings.openrouterModel}[provider] || '') : '';
  const context = isAI && settings.contextAI ? String(message.context || '').slice(0,1600) : '';
  const payloads = texts.map(text => ({text, provider, source,target,model,glossary: isAI ? settings.glossary : '',context}));
  const values = await Promise.all(payloads.map(p=>cachedTranslation(chrome.storage.local,p)));
  const missing = texts.map((text,index)=>({text,index})).filter(({index})=>values[index]===null);
  if (missing.length) {
    const newly = await translateBatch(missing.map(x=>x.text), {...settings, provider, source,target,context});
    for (let j=0;j<newly.length;j++) {
      const i=missing[j].index;
      values[i]=newly[j];
      await saveTranslation(chrome.storage.local,payloads[i],newly[j]);
    }
  }
  return {translations:values,provider,cached:missing.length===0};
}
chrome.runtime.onMessage.addListener((message,sender,sendResponse) => {
  handle(message,sender).then(result=>sendResponse({ok:true,...result}))
    .catch(error=>sendResponse({ok:false,error: error instanceof TranslationError ? error.message : '内部错误，请检查扩展日志'}));
  return true;
});
