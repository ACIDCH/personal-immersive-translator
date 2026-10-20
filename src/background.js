import {translateBatch, TranslationError} from './lib/providers.js';
import {SETTINGS_KEY, normalizeSettings, hostIsBlocked, AI_PROVIDERS, STANDARD_PROVIDERS, isStandardServiceConfigured} from './lib/settings.js';
import {cachedTranslation, saveTranslation, clearTranslations} from './lib/cache.js';
import {detectLanguagesWithContext,normalizeDetectedLanguage} from './lib/language-detection.js';
import {probeProvider} from './lib/provider-catalog.js';
import {PRODUCT_DEFAULTS,siteRule,effectiveVideo,expertPrompt,readingStyle} from './lib/product-settings.js';
import * as syncRuntime from './lib/sync.js';

let settingsWrite=Promise.resolve();
function patchSettings(patch){
 const next=settingsWrite.then(async()=>{
  const settings=normalizeSettings({...await getSettings(),...patch});
  await chrome.storage.local.set({[SETTINGS_KEY]:settings});
  return settings;
 });settingsWrite=next.catch(()=>{});return next;
}
const probeTimes=new Map();
// MV3 service workers prohibit dynamic import(); SDK initialization stays lazy.
const syncModule=()=>Promise.resolve(syncRuntime);
chrome.alarms?.create('pit-sync',{periodInMinutes:1});
chrome.alarms?.onAlarm.addListener(alarm=>{if(alarm.name==='pit-sync')void chrome.storage.local.get('pit_sync_state').then(r=>{if(r.pit_sync_state?.enabled)return syncModule().then(m=>m.backgroundSync());}).catch(()=>{});});
chrome.storage.onChanged?.addListener((changes,area)=>{
 if(area!=='local'||!changes[SETTINGS_KEY])return;
 void chrome.storage.local.get('pit_sync_state').then(r=>{if(r.pit_sync_state?.enabled)return syncModule().then(m=>m.backgroundSync());}).catch(()=>{});
 if(changes[SETTINGS_KEY].newValue?.contextMenuEnabled!==changes[SETTINGS_KEY].oldValue?.contextMenuEnabled)void refreshMenus();
 void chrome.tabs.query({}).then(tabs=>{for(const tab of tabs)if(tab.id)void chrome.tabs.sendMessage(tab.id,{type:'PIT_PREFERENCES_CHANGED'}).catch(()=>{});}).catch(()=>{});
});

chrome.runtime.onInstalled.addListener(async () => {
  try {
    await chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});
    const data = await chrome.storage.local.get(SETTINGS_KEY);
    if (!data[SETTINGS_KEY]){
      await chrome.storage.local.set({[SETTINGS_KEY]: normalizeSettings()});
    }else if(data[SETTINGS_KEY]?.standardProvider==='cloud' &&
             !String(data[SETTINGS_KEY].cloudEndpoint||'').trim() &&
             !String(data[SETTINGS_KEY].cloudToken||'').trim()){
      // Earlier PIT builds defaulted to an undeployed empty Worker and could
      // never translate. Migrate only this unusable legacy selection to local
      // Chrome; retain actual configured cloud accounts and every other pref.
      await chrome.storage.local.set({[SETTINGS_KEY]: {
        ...normalizeSettings(data[SETTINGS_KEY]),standardProvider:'browser'
      }});
    }
  } catch (error) { console.warn('PIT setup failed', error); }
});
chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'}).catch(()=>{});
async function getSettings() {
  const item = await chrome.storage.local.get(SETTINGS_KEY);
  return normalizeSettings(item[SETTINGS_KEY]);
}
let publicMtLock=Promise.resolve();
function limitPublicMT(texts,task){
 const next=publicMtLock.then(async()=>{
  const key='pit_mymemory_usage_'+new Date().toISOString().slice(0,10);
  const saved=await chrome.storage.local.get(key);
  const used=Math.max(0,Number(saved[key])||0);
  const added=texts.reduce((n,t)=>n+t.length,0);
  if(used+added>4500)throw new TranslationError(
   'MyMemory 免费在线备用服务已达每日 4,500 字符本地限额',429);
  // Reserving first prevents repeated partial failures from evading the cap.
  await chrome.storage.local.set({[key]:used+added});
  return task();
 });
 publicMtLock=next.catch(()=>{});
 return next;
}
// Chrome's free on-device Translator API runs in an extension document,
// not in our MV3 network service worker. The existing ASR offscreen document
// is reused, so neither feature needs the owner's Python installation.
async function hasPITOffscreen(){
 if(typeof chrome.offscreen.hasDocument==='function')
   return chrome.offscreen.hasDocument();
 // Chrome 116–149: hasDocument() does not exist but runtime.getContexts()
 // is supported. This is needed because Translator shipped in Chrome 138.
 if(typeof chrome.runtime.getContexts==='function'){
   const contexts=await chrome.runtime.getContexts({
     contextTypes:['OFFSCREEN_DOCUMENT'],
     documentUrls:[chrome.runtime.getURL('src/offscreen.html')]
   });
   return Array.isArray(contexts)&&contexts.length>0;
 }
 return false;
}
let nativeDocOpening=null;
async function nativeOffscreenReady(){
 if(!await hasPITOffscreen()){
  if(!nativeDocOpening){
   nativeDocOpening=chrome.offscreen.createDocument({
    url:'src/offscreen.html',reasons:['DOM_PARSER'],
    justification:'Perform owner-selected Chrome built-in translation in a document context'
   }).finally(()=>{nativeDocOpening=null;});
  }
  await nativeDocOpening;
 }
 // A module-script import graph can still be initializing when
 // offscreen.createDocument() resolves. Do not interpret no response as
 // model unavailable, and do not send source texts before listener is ready.
 for(let attempt=0;attempt<12;attempt++){
  const pong=await chrome.runtime.sendMessage({
   target:'offscreen',type:'PIT_OFFSCREEN_PING'
  }).catch(()=>null);
  if(pong?.ok&&pong?.ready)return pong;
  await new Promise(resolve=>setTimeout(resolve,120));
 }
 throw new TranslationError('PIT 离屏翻译执行模块没有响应；请在扩展管理页重新加载插件并查看后台日志。');
}
function fallbackNativeSource(text,pageSource){
 const s=String(text||'');
 if(/[ぁ-ヿ]/u.test(s))return 'ja';
 if(/[가-힣]/u.test(s))return 'ko';
 if(/[㐀-鿿]/u.test(s))return 'zh';
 // Use Chrome's whole-tab language only for otherwise inconclusive
 // paragraphs. A French "Bonjour" must NOT silently become English.
 if(pageSource&&pageSource!=='auto')return pageSource;
 throw new TranslationError('无法可靠识别此段原文语言。请打开 PIT 设置手动选择原文语种，或使用支持自动检测的在线服务。');
}
async function tabLanguageHint(sender){
 if(!sender?.tab?.id||typeof chrome.tabs?.detectLanguage!=='function'||
    !/^https?:\/\//.test(sender.url||sender.tab.url||''))return null;
 try{
  return normalizeDetectedLanguage(await chrome.tabs.detectLanguage(sender.tab.id));
 }catch{return null;}
}
async function runStandardProvider(texts,opts){
 if(opts.provider==='mymemory')return limitPublicMT(texts,()=>translateBatch(texts,opts));
 if(opts.provider!=='browser')return translateBatch(texts,opts);
 const hints=opts.source==='auto'?await detectLanguagesWithContext(texts):
   texts.map(()=>({language:opts.source,confidence:'explicit'}));
 const out=new Array(texts.length);
 for(let i=0;i<texts.length;){
  const source=hints[i]?.language&&hints[i].language!=='auto'?
   hints[i].language:fallbackNativeSource(texts[i],opts.pageSource);
  let n=i+1;
  while(n<texts.length){
   const other=hints[n]?.language&&hints[n].language!=='auto'?
     hints[n].language:fallbackNativeSource(texts[n],opts.pageSource);
   if(other!==source||n-i>=6)break;
   n++;
  }
  const part=texts.slice(i,n);
  if(source===opts.target)out.splice(i,part.length,...part);
  else{
   await nativeOffscreenReady();
   const result=await chrome.runtime.sendMessage({
     target:'offscreen',type:'PIT_OFFSCREEN_BROWSER_TRANSLATE',
     texts:part,source,target:opts.target
   });
   if(!result?.ok||!Array.isArray(result.translations)||result.translations.length!==part.length)
    throw new TranslationError(result?.error||'Chrome 内置翻译服务暂不可用，请在 PIT 设置下载语言包或切换服务商');
   out.splice(i,part.length,...result.translations);
  }
  i=n;
 }
 return out;
}
function ensureSource(sender, type) {
  if (sender.id !== chrome.runtime.id) throw new TranslationError('无效的消息来源');
  if (type === 'TRANSLATE_BATCH' && !sender.tab) throw new TranslationError('网页翻译请求必须来自当前网页');
}
// MV3 options pages normally open as their own browser tabs. sender.tab is
// therefore NOT a security boundary: only sender.url identifies the exact
// extension-owned page, unlike messages from a regular page content script.
function isTrustedOptionsPage(sender) {
  const url=String(sender.url||'').split(/[?#]/)[0];
  return url === chrome.runtime.getURL('src/options.html') ||
         url === chrome.runtime.getURL('pit-options.html');
}
function isTrustedDocumentPage(sender) {
  // The integrated File Workbench uses in-page #module navigation. A fragment
  // does not change the trusted extension document identity, and must not
  // revoke access to TRANSLATE_DOCUMENT after the user selects a file tab.
  const url=String(sender.url||'').split(/[?#]/)[0];
  return url===chrome.runtime.getURL('file-lab.html');
}
function isTrustedExtensionPage(sender) {
  return typeof sender.url === 'string' &&
         sender.url.startsWith(chrome.runtime.getURL('')) &&
         !sender.url.includes('/../');
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
  await chrome.storage.session.remove(['pit_live_asr_tab','pit_live_asr_session','pit_live_asr_mode','pit_live_ai_requests']);
  // The offscreen document is also the owner-selected Chrome built-in
  // translator. Do not terminate it when no ASR session was running.
  try {if(session.pit_live_asr_session&&await hasPITOffscreen()){
    await chrome.runtime.sendMessage({target:'offscreen',type:'PIT_OFFSCREEN_STOP'});
    await chrome.offscreen.closeDocument();
  }}catch {}
  if(session.pit_live_asr_tab) {
    await chrome.tabs.sendMessage(session.pit_live_asr_tab,{type:'PIT_ASR_VIEW_STOP',sessionId:session.pit_live_asr_session}).catch(()=>{});
  }
}
async function verifyLocalAsr(token){
  let response;
  try{
    response=await fetch('http://127.0.0.1:8765/health',{
      headers:{'X-PIT-Token':token},redirect:'error',
      signal:AbortSignal.timeout(3000)
    });
  }catch{
    throw new TranslationError('无法连接本机 Whisper 8765 服务；请先启动并加载模型');
  }
  if(!response.ok)throw new TranslationError(
    response.status===401?'本机 Whisper 服务令牌不匹配':'本机 Whisper 健康检查失败');
  let status;
  try{status=await response.json();}catch{
    throw new TranslationError('本机 Whisper 健康检查返回了无效数据');
  }
  if(!status || typeof status!=='object' || status.speech_asr!==true)
    throw new TranslationError('本机 Whisper 模型尚未就绪，请检查 /health 中的 speech_asr');
  if(status.speech_asr_requires_risk_ack)
    throw new TranslationError('当前本机 Whisper 服务使用未经批准的实验模式');
}
async function verifyCloudAsr(settings){
 const raw=String(settings.cloudEndpoint||''),token=String(settings.cloudToken||'');
 if(token.length<16)throw new TranslationError('先在插件设置中配置 PIT 云端访问令牌');
 let url;
 try{url=new URL(raw);}catch{
  throw new TranslationError('云端语音需要先部署 PIT Cloudflare Worker 并填写 HTTPS 地址');
 }
 if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)
  throw new TranslationError('云端语音服务只接受已配置的纯 HTTPS 地址');
 url.pathname=url.pathname.replace(/\/$/,'')+'/v1/asr';
 const health=new URL(raw);health.pathname=health.pathname.replace(/\/$/,'')+'/v1/capabilities';
 try{
  const response=await fetch(health.toString(),{
   headers:{Authorization:'Bearer '+token},
   signal:AbortSignal.timeout(5000)
  });
  if(!response.ok)throw Error('HTTP '+response.status);
  const capabilities=await response.json();
  if(!capabilities.ready||capabilities.routes?.asr!=='ready')
   throw Error('ASR model unavailable');
 }catch{
  throw new TranslationError('PIT 云端语音模型不可用：请确认 Worker 已部署、AI 已绑定、访问令牌正确');
 }
 return {endpoint:url.toString(),token};
}
async function startLiveAsr(message){
  const cloud=message.asrBackend==='cloud';
  const token=String(message.token||'');
  if(!cloud&&token.length<16) throw new TranslationError('缺少本机 Whisper 服务令牌');
  if(cloud&&message.userInitiated!==true)
    throw new TranslationError('云端语音会上传音频并消耗云端推理额度，必须由用户确认');
  const mode=message.mode==='ai'?'ai':'standard';
  if(mode==='ai' && message.userInitiated!==true)
    throw new TranslationError('本机实时字幕使用 AI 必须明确确认计费风险');
  const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
  if(!tab?.id || tab.id!==message.tabId || !/^https?:\/\//.test(tab.url||'')) throw new TranslationError('只有当前活动视频标签页才能启动录音');
  // Establish actual local model readiness before opening any audio track.
  // A configured port or a successfully created recorder is not proof that
  // Whisper inference can run. This is only a readiness gate, not a quality test.
  const remote=cloud?await verifyCloudAsr(await getSettings()):null;
  if(!cloud)await verifyLocalAsr(token);
  await stopLiveAsr();
  // A free Chrome Translator session may have opened this offscreen
  // document using DOM_PARSER. Recreate it specifically for user-approved
  // tab capture so Chrome does not reject a second offscreen document.
  if(await hasPITOffscreen())await chrome.offscreen.closeDocument();
  await chrome.offscreen.createDocument({url:'src/offscreen.html',reasons:['USER_MEDIA'],
    justification:'用户明确启动的本机实时音频字幕识别'});
  try{
    const streamId=await chrome.tabCapture.getMediaStreamId({targetTabId:tab.id});
    const sessionId=crypto.randomUUID();
    await chrome.storage.session.set({pit_live_asr_tab:tab.id,pit_live_asr_session:sessionId,
      pit_live_asr_mode:mode,pit_live_ai_requests:0});
    const started=await chrome.runtime.sendMessage({
      target:'offscreen',type:'PIT_OFFSCREEN_START',streamId,tabId:tab.id,
      token:remote?.token||token,sessionId,
      asrBackend:cloud?'cloud':'local',cloudEndpoint:remote?.endpoint||''
    });
    if(!started?.ok)throw Error(started?.error||'音频捕获失败');
    const still=await chrome.storage.session.get(['pit_live_asr_tab','pit_live_asr_session']);
    if(still.pit_live_asr_tab!==tab.id || still.pit_live_asr_session!==sessionId)
      throw Error('音频会话已提前结束，无法标记为录制中');
    await chrome.tabs.sendMessage(tab.id,{type:'PIT_ASR_VIEW_START',sessionId,mode});
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
      // Only validated ASR language tags go to the UI. In automatic source
      // mode they outrank unreliable short-utterance CLD guesses.
      const spoken=normalizeDetectedLanguage(message.language);
      if(spoken){
        payload.language=spoken;
        const probability=Number(message.languageConfidence);
        if(Number.isFinite(probability)&&probability>=0.65&&probability<=1)
          payload.languageConfidence=probability;
      }
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
  if(message.type==='PIT_PUBLIC_PREFERENCES'){
    if(!sender.tab)throw new TranslationError('只允许网站的原生内容脚本读取非敏感阅读偏好');
    const settings=await getSettings();
    let standardReady=isStandardServiceConfigured(settings);
    let browserModelStatus=null;
    if(settings.standardProvider==='browser'&&standardReady){
      try{
        const host=new URL(sender.url||sender.tab.url).hostname;
        // Check language pack readiness only for sites the owner explicitly
        // added to auto-translate: page loads must not download models.
        if(hostIsBlocked(host,settings.autoTranslateHosts)&&
           !hostIsBlocked(host,settings.blockedHosts)){
          const source=settings.source==='auto'
            ? (await tabLanguageHint(sender))||
              normalizeDetectedLanguage(message.pageLanguage)
            : settings.source;
          if(!source||source===settings.target){
            standardReady=false;
            browserModelStatus=source===settings.target
              ? 'already_target_language':'source_unknown';
          }else{
            await nativeOffscreenReady();
            const probe=await chrome.runtime.sendMessage({
              target:'offscreen',type:'PIT_OFFSCREEN_BROWSER_STATUS',
              source,target:settings.target
            });
            browserModelStatus=probe?.ok?probe.status:'unavailable';
            standardReady=browserModelStatus==='available';
          }
        }
      }catch{standardReady=false;browserModelStatus='diagnostic_failed';}
    }
    return {preferences:{
      readingStyle:readingStyle(settings),
      ...Object.fromEntries(Object.keys(PRODUCT_DEFAULTS).filter(k=>!['customExperts','installedExperts','activeExpertId'].includes(k)).map(k=>[k,settings[k]])),
      webDisplay:settings.webDisplay,webScope:settings.webScope,
      sourceLanguage:settings.source,targetLanguage:settings.target,
      translationTheme:settings.translationTheme,hoverTranslate:settings.hoverTranslate,
      floatingControl:settings.floatingControl,
      inputTranslate:settings.inputTranslate,inputTarget:settings.inputTarget,
      autoTranslateHosts:settings.autoTranslateHosts,
      // No API keys or provider auth tokens are returned to content scripts.
      blockedHosts:settings.blockedHosts,
      standardProvider:settings.standardProvider,
      standardReady,browserModelStatus
    }};
  }
  if(message.type==='PIT_BROWSER_STATUS'){
    if(!isTrustedExtensionPage(sender))
      throw new TranslationError('只有插件设置/弹窗可以查询浏览器模型状态');
    const source=normalizeDetectedLanguage(message.source);
    const target=normalizeDetectedLanguage(message.target);
    if(!source||!target)throw new TranslationError('请选择支持的原文与目标语言');
    if(source===target)return {status:'available',equalLanguage:true};
    const ping=await nativeOffscreenReady();
    if(ping?.translatorApi!=='function'){
      return {status:'unavailable',runtime:'offscreen',
        code:'web_api_absent',reason:'Chrome Translator API 在 PIT 离屏执行环境中不可用'};
    }
    const reply=await chrome.runtime.sendMessage({
      target:'offscreen',type:'PIT_OFFSCREEN_BROWSER_STATUS',source,target
    });
    if(!reply?.ok)return {status:'unavailable',runtime:'offscreen',
      reason:String(reply?.error||'离屏语言包状态请求没有返回结果').slice(0,200),
      code:String(reply?.code||(reply===undefined?'no_response':'unavailable'))};
    return {status:reply.status,runtime:'offscreen',code:'ok'};
  }
  if(message.type==='PIT_BROWSER_PROBE'){
    if(!isTrustedOptionsPage(sender))
      throw new TranslationError('只有设置页可以执行内置模型推理诊断');
    const source=normalizeDetectedLanguage(message.source);
    const target=normalizeDetectedLanguage(message.target);
    if(!source||!target||source===target)
      throw new TranslationError('请选择不同的有效测试语言对');
    const ping=await nativeOffscreenReady();
    if(ping?.translatorApi!=='function')
      return {status:'failed',code:'web_api_absent',
        reason:'实际离屏环境没有 Chrome Translator API'};
    const answer=await chrome.runtime.sendMessage({
      target:'offscreen',type:'PIT_OFFSCREEN_BROWSER_PROBE',source,target
    });
    if(!answer?.ok||typeof answer.translation!=='string'||!answer.translation.trim())
      return {status:'failed',code:String(answer?.code||'probe_failed'),
        reason:String(answer?.error||'未得到真实模型译文').slice(0,240)};
    return {status:'translated',sampleTranslation:answer.translation.slice(0,200),
      elapsedMs:Number(answer.elapsedMs)||0,runtime:'offscreen'};
  }
  if (message.type === 'GET_SETTINGS') {
    if (!isTrustedExtensionPage(sender)) throw new TranslationError('网页不允许读取 API 配置');
    return {settings: await getSettings()};
  }
  if(message.type==='PIT_SYNC'){
    if(!isTrustedOptionsPage(sender)&&!(message.action==='status'&&isTrustedExtensionPage(sender)))throw new TranslationError('同步仅允许扩展设置页操作');
    try{return await (await syncModule()).syncAction(message);}catch(e){throw new TranslationError(e.message);}
  }
  if(message.type==='PATCH_SETTINGS'){
    if(!isTrustedExtensionPage(sender))throw new TranslationError('仅扩展界面可以保存配置');
    if(!message.patch||typeof message.patch!=='object'||Array.isArray(message.patch))throw new TranslationError('配置格式无效');
    return {settings:await patchSettings(message.patch)};
  }
  if(message.type==='PIT_TEMPORARY_AUTO'){
    if(!sender.tab||!/^https?:/.test(sender.url||''))throw new TranslationError('仅允许网页记录临时偏好');
    const s=await getSettings(),host=new URL(sender.url).hostname;
    if(s.temporaryAutoTranslateMinutes>0&&!hostIsBlocked(host,s.blockedHosts))await patchSettings({temporaryAutoTranslateUntil:{...s.temporaryAutoTranslateUntil,[host]:Date.now()+s.temporaryAutoTranslateMinutes*60000}});
    return {};
  }
  if(message.type==='TEST_PROVIDER'){
    // A popup is part of this installed extension and may probe only the two
    // free standard-MT paths. Paid/custom diagnostic requests stay in Options.
    const popupFree=isTrustedExtensionPage(sender) &&
      message.mode==='standard' && message.userInitiated===true &&
      ['browser','mymemory'].includes(message.providerId);
    if(!isTrustedOptionsPage(sender)&&!popupFree)
      throw new TranslationError('付费/自定义服务的诊断仅允许从设置中心进行');
    const settings=await getSettings();
    const id=message.providerId||(message.mode==='ai'?settings.aiProvider:settings.standardProvider);
    if(id==='mymemory'){
      const saved=(await chrome.storage.local.get('pit_probe_mymemory')).pit_probe_mymemory;
      const last=Math.max(probeTimes.get(id)||0,Date.parse(saved?.testedAt)||0);
      if(Date.now()-last<60000)return {ok:false,status:'rate-limited',confirmedLive:false,error:'请等待一分钟再测试 MyMemory。'};
      probeTimes.set(id,Date.now());
    }
    const result=await probeProvider(settings,message,runStandardProvider);
    // Only the fixed public probe and sanitized diagnostic are persisted.
    await chrome.storage.local.set({['pit_probe_'+(message.profileId||id)]:result}).catch(()=>{});
    return result;
  }
  if (message.type === 'CLEAR_CACHE') {
    if (!isTrustedOptionsPage(sender)) throw new TranslationError('仅设置界面可以清除缓存');
    await clearTranslations(chrome.storage.local); return {ok:true};
  }
  if (!['TRANSLATE_BATCH','TEST_PROVIDER','TRANSLATE_DOCUMENT','TRANSLATE_TEXT'].includes(message.type)) throw new TranslationError('不支持的请求');
  if(message.type==='TRANSLATE_TEXT'&&!isTrustedExtensionPage(sender))throw new TranslationError('文本工具仅供扩展界面使用');
  // TEST_PROVIDER is handled above, before text/document routing.
  if (message.type === 'TRANSLATE_DOCUMENT' && !isTrustedDocumentPage(sender))
    throw new TranslationError('仅插件文件处理页允许翻译本地文件');
  let settings = await getSettings();
  const host=(()=>{try{return new URL(sender.url||sender.tab?.url).hostname;}catch{return '';}})();
  const rule=siteRule(settings,host);
  const video=effectiveVideo(settings,host);
  if(message.pageContext==='video'&&!video.enabled)throw new TranslationError('当前平台字幕已禁用');
  const scene=message.pageContext==='video'?video.providerId:message.type==='TRANSLATE_DOCUMENT'?settings.fileProviderId:'inherit';
  const override=rule?.providerId!=='inherit'&&rule?.providerId?rule.providerId:scene;
  settings={...settings,standardProvider:override&&override!=='inherit'?override:settings.standardProvider,
    source:message.pageContext==='video'&&video.source!=='auto'?video.source:settings.source,
    target:rule?.target&&rule.target!=='inherit'?rule.target:message.pageContext==='video'&&video.target!=='inherit'?video.target:settings.target};
  // Pin provider/languages/credentials to an explicitly started task. Changing
  // the popup default affects the next task, not later batches of this one.
  if(sender.tab&&typeof message.taskId==='string'&&/^[a-z0-9-]{1,100}$/i.test(message.taskId)){
    const key='pit_task_'+sender.tab.id+'_'+(sender.frameId||0)+'_'+message.taskId;
    const saved=(await chrome.storage.session.get(key))[key];
    if(saved&&Date.now()-saved.at<3600000)settings={...saved.settings,blockedHosts:settings.blockedHosts,providerPreferences:settings.providerPreferences};
    else{
      const all=await chrome.storage.session.get(null);
      const expired=Object.entries(all).filter(([k,v])=>k.startsWith('pit_task_')&&Date.now()-(v?.at||0)>3600000).map(([k])=>k);
      const entries=Object.entries(all).filter(([k])=>k.startsWith('pit_task_')).sort((a,b)=>(a[1]?.at||0)-(b[1]?.at||0));
      await chrome.storage.session.remove([...new Set([...expired,...entries.slice(0,Math.max(0,entries.length-49)).map(([k])=>k)])]);
      await chrome.storage.session.set({[key]:{at:Date.now(),settings}});
    }
  }
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
  if(settings.providerPreferences[isAI&&provider==='custom'?settings.activeAIProfileId:provider]?.enabled===false)throw new TranslationError('此翻译服务已停用，请在服务中心启用或选择其他服务');
  if (!(isAI ? AI_PROVIDERS : STANDARD_PROVIDERS).includes(provider)) throw new TranslationError('翻译服务配置无效');
  if (isAI && message.type !== 'TEST_PROVIDER' && message.userInitiated !== true) {
    throw new TranslationError('必须由用户明确启用 AI 翻译');
  }
  const texts = message.type === 'TEST_PROVIDER' ? ['Hello, world!'] : message.texts;
  if (!Array.isArray(texts) || texts.length < 1 || texts.length > 10 || texts.some(t => typeof t !== 'string' || t.length > 5000 || t.length < 1)) throw new TranslationError('翻译文本无效');
  const captionLang=message.type==='TRANSLATE_BATCH'&&(settings.source==='auto'||message.pageContext==='video')
    ? normalizeDetectedLanguage(message.captionSourceLanguage):null;
  const source=message.type==='TEST_PROVIDER'?'en':(captionLang||settings.source);
  // A tab's page language describes article prose; it does not necessarily
  // describe Netflix/YouTube captions, media SRT or input-box text.
  const pageSource=source==='auto'&&['browser','mymemory'].includes(settings.standardProvider)&&
    message.pageContext==='article' ? await tabLanguageHint(sender):null;
  // Input enhancement is standard-MT only, explicitly user-triggered,
  // with target selected by the owner in extension options.
  const target = message.inputEnhancement===true && message.type==='TRANSLATE_BATCH' && !isAI
    ? settings.inputTarget:settings.target;
  const model = isAI ? (provider==='gemini'?settings.geminiModel:provider==='deepseek'?settings.deepseekModel:(()=>{const p=settings.aiProfiles.find(p=>p?.id===settings.activeAIProfileId);return [p?.id,p?.model,p?.baseUrl].join(':');})()) : '';
  const context = isAI && settings.contextAI ? String(message.context || '').slice(0,1600) : '';
  if(message.transient===true) {
    if(!sender.tab)throw new TranslationError('临时字幕必须来自有效网页');
    const session=await chrome.storage.session.get(
      ['pit_live_asr_tab','pit_live_asr_session','pit_live_asr_mode','pit_live_ai_requests']);
    if(session.pit_live_asr_tab!==sender.tab.id ||
       !session.pit_live_asr_session || message.sessionId!==session.pit_live_asr_session)
      throw new TranslationError('语音字幕会话已经结束，请重新启动。');
    if(message.mode!==(session.pit_live_asr_mode||'standard'))
      throw new TranslationError('实时字幕翻译模式与授权会话不匹配');
    if(isAI){
      const count=Math.max(0,Number(session.pit_live_ai_requests)||0);
      if(count>=80)throw new TranslationError('本次实时 AI 字幕达到 80 次请求上限，请停止并明确重新启动');
      await chrome.storage.session.set({pit_live_ai_requests:count+1});
    }
    const translations=await runStandardProvider(texts,{...settings,provider,source,target,context,pageSource});
    return {translations,provider,cached:false,transient:true};
  }
  // A short ambiguous label (e.g. "Menu") can be French on one site and
  // English on another. The browser model uses the detected page language as
  // a fallback; the cache must encode that same hint or silently replay the
  // wrong translation in another tab.
  const cacheSource=source==='auto'&&pageSource?'auto:'+pageSource:source;
  const payloads = texts.map(text => ({text, provider, source:cacheSource,target,model,glossary: isAI ? settings.glossary+'\n'+expertPrompt(settings) : '',context}));
  // Local cache is an optimization, never a prerequisite for translating.
  // Storage quota exhaustion should not discard a successful provider result.
  const values = await Promise.all(payloads.map(p=>cachedTranslation(chrome.storage.local,p).catch(()=>null)));
  const missing = texts.map((text,index)=>({text,index})).filter(({index})=>values[index]===null);
  if (missing.length) {
    const newly = await runStandardProvider(missing.map(x=>x.text), {...settings, provider, source,target,context,pageSource});
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

/** Toolbar shortcut parity: Alt+A toggles article translation / source;
 * Alt+W explicitly requests full readable page scope.
 * Uses only the bundled PIT script and the user's configured standard MT.
 */
async function handleKeyboardCommand(command){
 if(!['pit-toggle-translation','pit-translate-whole-page'].includes(command))return;
 const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
 if(!tab?.id||!/^https?:\/\//.test(tab.url||''))return;
 const settings=await getSettings();
 const hostname=new URL(tab.url).hostname;
 if(hostIsBlocked(hostname,settings.blockedHosts))return;
 if(settings.standardProvider==='cloud'&&(!settings.cloudEndpoint||!settings.cloudToken))return;
 try{
  await chrome.scripting.insertCSS({target:{tabId:tab.id},files:['pit-native.css']});
  await chrome.scripting.executeScript({target:{tabId:tab.id},files:['pit-native.js']});
  const progress=await chrome.tabs.sendMessage(tab.id,{type:'PIT_GET_PROGRESS'}).catch(()=>null);
  const restore=command==='pit-toggle-translation'&&progress?.progress?.active;
  await chrome.tabs.sendMessage(tab.id,restore?
   {type:'PIT_RESTORE'}:{type:'PIT_START',mode:'standard',
      scope:command==='pit-translate-whole-page'?'full':settings.webScope,
      display:settings.webDisplay,theme:settings.translationTheme});
 }catch{}
}

// Chrome-owned context menus provide native discoverability without copying
// another translator's UI and never read selection through an extension page.
const PIT_CONTEXT_ACTIONS=[
 ['pit-context-page','PIT · Translate page',['page']],
 ['pit-context-selection','PIT · Translate selection',['selection']],
 ['pit-context-restore','PIT · Restore original text',['page']]
];
function registerTranslationMenus(){
 if(!chrome.contextMenus?.create)return;
 for(const [id,title,contexts] of PIT_CONTEXT_ACTIONS){
  chrome.contextMenus.create({id,title,contexts,documentUrlPatterns:[
   'http://*/*','https://*/*'
  ]},()=>{void chrome.runtime.lastError;});
 }
}
async function refreshMenus(){
 if(chrome.contextMenus?.removeAll)await chrome.contextMenus.removeAll();
 if((await getSettings()).contextMenuEnabled)registerTranslationMenus();
}
chrome.runtime.onInstalled.addListener(refreshMenus);
chrome.contextMenus?.onClicked?.addListener((info,tab)=>{
 if(!PIT_CONTEXT_ACTIONS.some(item=>item[0]===info.menuItemId))return;
 void (async()=>{
  if(!tab?.id||!/^https?:\/\//.test(tab.url||''))return;
  const settings=await getSettings();
  if(!settings.contextMenuEnabled)return;
  if(hostIsBlocked(new URL(tab.url).hostname,settings.blockedHosts))return;
  if(info.menuItemId!=='pit-context-restore'&&
    settings.standardProvider==='cloud'&&
    (!settings.cloudEndpoint||!settings.cloudToken))return;
  await chrome.scripting.insertCSS({target:{tabId:tab.id},files:['pit-native.css']});
  await chrome.scripting.executeScript({target:{tabId:tab.id},files:['pit-native.js']});
  const payload=info.menuItemId==='pit-context-restore'?{type:'PIT_RESTORE'}:
    info.menuItemId==='pit-context-selection'?{type:'PIT_SELECTION',mode:'standard'}:
    {type:'PIT_START',mode:'standard',scope:settings.webScope,
      display:settings.webDisplay,theme:settings.translationTheme};
  await chrome.tabs.sendMessage(tab.id,payload);
 })().catch(()=>{});
});
chrome.commands?.onCommand?.addListener(command=>{
 void handleKeyboardCommand(command).catch(()=>{});
});
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
