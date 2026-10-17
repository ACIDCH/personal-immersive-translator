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
// Serialize user START/STOP, automatic track-end and tab lifecycle actions.
// Without this lock, concurrent extension popups can close a newer capture.
let asrTransition=Promise.resolve();
function withAsrTransition(operation){
  const result=asrTransition.then(operation,operation);
  asrTransition=result.catch(()=>{});
  return result;
}
async function stopLiveAsr() {
  const session=await chrome.storage.session.get(['pit_live_asr_tab','pit_live_asr_session']);
  // Invalidate before teardown, so old offscreen callbacks are ignored.
  await chrome.storage.session.remove(['pit_live_asr_tab','pit_live_asr_session']);
  try {if(await chrome.offscreen.hasDocument()){
    await chrome.runtime.sendMessage({target:'offscreen',type:'PIT_OFFSCREEN_STOP'});
    await chrome.offscreen.closeDocument();
  }}catch {}
  if(session.pit_live_asr_tab) {
    await chrome.tabs.sendMessage(session.pit_live_asr_tab,{type:'PIT_ASR_VIEW_STOP',sessionId:session.pit_live_asr_session}).catch(()=>{});
  }
}
async function startLiveAsr(message){
  const token=String(message.token||'');
  if(token.length<16) throw new TranslationError('缺少本机 Whisper 服务令牌');
  const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
  if(!tab?.id || tab.id!==message.tabId || !/^https?:\/\//.test(tab.url||'')) throw new TranslationError('只有当前活动视频标签页才能启动录音');
  await stopLiveAsr();
  await chrome.offscreen.createDocument({url:'src/offscreen.html',reasons:['USER_MEDIA'],
    justification:'用户明确启动的本机实时音频字幕识别'});
  try{
    const streamId=await chrome.tabCapture.getMediaStreamId({targetTabId:tab.id});
    const sessionId=crypto.randomUUID();
    await chrome.storage.session.set({pit_live_asr_tab:tab.id,pit_live_asr_session:sessionId});
    const started=await chrome.runtime.sendMessage({
      target:'offscreen',type:'PIT_OFFSCREEN_START',streamId,tabId:tab.id,token,sessionId
    });
    if(!started?.ok)throw Error(started?.error||'音频捕获失败');
    const still=await chrome.storage.session.get(['pit_live_asr_tab','pit_live_asr_session']);
    if(still.pit_live_asr_tab!==tab.id || still.pit_live_asr_session!==sessionId)
      throw Error('音频会话已提前结束，无法标记为录制中');
    await chrome.tabs.sendMessage(tab.id,{type:'PIT_ASR_VIEW_START',sessionId});
    return {started:true};
  }catch(error) {
    await stopLiveAsr();
    throw new TranslationError('实时语音捕获启动失败：'+String(error.message||error));
  }
}

async function handle(message, sender) {
  if (!message || typeof message.type !== 'string') throw new TranslationError('无效的请求');
  ensureSource(sender, message.type);
  if(message.type==='PIT_ASR_START'){
    if(sender.tab)throw new TranslationError('只能从插件控制面板启动实时音频');
    return await withAsrTransition(()=>startLiveAsr(message));
  }
  if(message.type==='PIT_ASR_STOP'){
    if(sender.tab)throw new TranslationError('只能从插件控制面板停止录音');
    return await withAsrTransition(async()=>{await stopLiveAsr();return {stopped:true};});
  }
  if(['PIT_ASR_RESULT','PIT_ASR_ERROR','PIT_ASR_METRICS','PIT_ASR_STREAM_ENDED'].includes(message.type)){
    if(sender.url!==chrome.runtime.getURL('src/offscreen.html'))throw new TranslationError('无效的本机 ASR 来源');
    const session=await chrome.storage.session.get(['pit_live_asr_tab','pit_live_asr_session']);
    if(!session.pit_live_asr_tab || session.pit_live_asr_tab!==message.tabId ||
       !session.pit_live_asr_session || session.pit_live_asr_session!==message.sessionId)
      return {ignored:true};
    if(message.type==='PIT_ASR_STREAM_ENDED'){
      return await withAsrTransition(async()=>{
        // A queued end notification must check the session again after
        // another user action has completed.
        const active=await chrome.storage.session.get(['pit_live_asr_tab','pit_live_asr_session']);
        if(active.pit_live_asr_tab!==message.tabId ||
           active.pit_live_asr_session!==message.sessionId) return {ignored:true};
        const tabId=active.pit_live_asr_tab;
        await stopLiveAsr();
        const replacement=await chrome.storage.session.get('pit_live_asr_session');
        if(!replacement.pit_live_asr_session)
          await chrome.tabs.sendMessage(tabId,{
            type:'PIT_ASR_INTERRUPTED_VIEW',sessionId:message.sessionId
          }).catch(()=>{});
        return {stopped:true,reason:'capture-ended'};
      });
    }
    const type=message.type==='PIT_ASR_RESULT'?'PIT_ASR_TEXT_VIEW'
      :message.type==='PIT_ASR_ERROR'?'PIT_ASR_ERROR_VIEW':'PIT_ASR_METRICS_VIEW';
    const payload={type,sessionId:message.sessionId};
    if(type==='PIT_ASR_TEXT_VIEW'){
      payload.text=String(message.text||'').slice(0,5000);
      payload.capturedAt=Number(message.capturedAt)||Date.now();
      payload.segmentMs=Math.min(6000,Math.max(0,Number(message.segmentMs)||0));
      payload.asrMs=Math.max(0,Number(message.asrMs)||0);
    }else if(type==='PIT_ASR_ERROR_VIEW')payload.message=String(message.message||'').slice(0,300);
    else {
      const m=message.metrics||{};
      payload.metrics={
        requests:Number(m.requests)||0,dropped:Number(m.dropped)||0,
        errors:Number(m.errors)||0,p50Ms:Number(m.p50Ms)||0,p95Ms:Number(m.p95Ms)||0
      };
    }
    await chrome.tabs.sendMessage(message.tabId,payload).catch(()=>{});
    return {forwarded:true};
  }
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
    // In a cross-origin video iframe, sender.tab.url is the LMS parent, while
    // sender.url is the real embedded player. Respect the denylist for BOTH.
    for(const pageUrl of [sender.tab.url,sender.url]){
      if(!pageUrl)continue;
      try{
        const host=new URL(pageUrl).hostname;
        if(hostIsBlocked(host,settings.blockedHosts))
          throw new TranslationError('当前页面或嵌入播放器已加入禁止翻译列表');
      }catch(e){if(e instanceof TranslationError)throw e;}
    }
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
  const model = isAI ? (provider==='gemini'?settings.geminiModel:provider==='deepseek'?settings.deepseekModel:settings.activeAIProfileId) : '';
  const context = isAI && settings.contextAI ? String(message.context || '').slice(0,1600) : '';
  if(message.transient===true) {
    if(message.mode!=='standard' || !sender.tab) throw new TranslationError('临时字幕只允许网页内标准翻译');
    const session=await chrome.storage.session.get(['pit_live_asr_tab','pit_live_asr_session']);
    if(session.pit_live_asr_tab!==sender.tab.id ||
       !session.pit_live_asr_session || message.sessionId!==session.pit_live_asr_session)
      throw new TranslationError('语音字幕会话已经结束，请重新启动。');
    const translations=await translateBatch(texts,{...settings,provider,source,target,context});
    return {translations,provider,cached:false,transient:true};
  }
  const payloads = texts.map(text => ({text, provider, source,target,model,glossary: isAI ? settings.glossary : '',context}));
  // Local cache is an optimization, never a prerequisite for translating.
  // Storage quota exhaustion should not discard a successful provider result.
  const values = await Promise.all(payloads.map(p=>cachedTranslation(chrome.storage.local,p).catch(()=>null)));
  const missing = texts.map((text,index)=>({text,index})).filter(({index})=>values[index]===null);
  if (missing.length) {
    const newly = await translateBatch(missing.map(x=>x.text), {...settings, provider, source,target,context});
    for (let j=0;j<newly.length;j++) {
      const i=missing[j].index;
      values[i]=newly[j];
      await saveTranslation(chrome.storage.local,payloads[i],newly[j]).catch(()=>{
        console.warn('PIT translation cache unavailable; returning provider result without caching');
      });
    }
  }
  return {translations:values,provider,cached:missing.length===0};
}
chrome.runtime.onMessage.addListener((message,sender,sendResponse) => {
  if(message?.target==='offscreen')return false;
  handle(message,sender).then(result=>sendResponse({ok:true,...result}))
    .catch(error=>sendResponse({ok:false,error: error instanceof TranslationError ? error.message : '内部错误，请检查扩展日志'}));
  return true;
});

async function stopTabCaptureIfUnchanged(tabId){
  const observed=await chrome.storage.session.get(['pit_live_asr_tab','pit_live_asr_session']);
  if(observed.pit_live_asr_tab!==tabId || !observed.pit_live_asr_session)return;
  await withAsrTransition(async()=>{
    const latest=await chrome.storage.session.get(['pit_live_asr_tab','pit_live_asr_session']);
    if(latest.pit_live_asr_tab===tabId &&
       latest.pit_live_asr_session===observed.pit_live_asr_session)await stopLiveAsr();
  });
}
chrome.tabs.onRemoved.addListener(tabId=>{
  void stopTabCaptureIfUnchanged(tabId).catch(()=>{});
});
chrome.tabs.onUpdated.addListener((tabId,changeInfo)=>{
  if(changeInfo.status==='loading')
    void stopTabCaptureIfUnchanged(tabId).catch(()=>{});
});
