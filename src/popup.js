import {normalizeSettings, SETTINGS_KEY, hostIsBlocked} from './lib/settings.js';
import {chooseEmbeddedFrame} from './lib/frame-route.js';
const $=id=>document.getElementById(id);
let mode='standard';
let settings=normalizeSettings();
function show() {
  $('standard').classList.toggle('selected',mode==='standard');
  $('ai').classList.toggle('selected',mode==='ai');
  $('modeHint').textContent=mode==='standard'?'常规翻译优先，不消耗所配置的 AI 模型额度。':'AI 按需翻译，可能产生模型调用费用。';
  const providers={microsoft:'Microsoft Translator',google:'Google Cloud',deepl:'DeepL',
    libre:'LibreTranslate',gemini:'Gemini',deepseek:'DeepSeek',custom:'自定义 AI'};
  const name=mode==='standard'?settings.standardProvider:settings.aiProvider;
  $('providerInfo').textContent='当前翻译服务：'+(name==='custom'?(settings.aiProfiles.find(p=>p?.id===settings.activeAIProfileId)?.name||'未选择自定义模型'):(providers[name]||name));
  const key=name==='microsoft'?'microsoftKey':name==='google'?'googleKey':
    name==='deepl'?'deeplKey':name==='libre'?'libreUrl':
    name==='gemini'?'geminiKey':name==='custom'?'activeAIProfileId':'deepseekKey';
  const ready=Boolean(String(settings[key]||'').trim());
  $('setupStatus').classList.toggle('ready',ready);
  $('setupStatus').textContent=ready
    ? '● 已填写服务配置（尚未验证 API 连通性）'
    : '○ 尚未配置当前服务，请点击右上角「设置」';
}
function status(msg) {$('status').textContent=msg;}
let progressTimer=null;
let progressEpoch=0;
async function watchCoverage(tabId){
  clearInterval(progressTimer);
  const epoch=++progressEpoch;
  let attempts=0;
  const check=async()=>{
    if(epoch!==progressEpoch)return;
    try{
      const result=await chrome.tabs.sendMessage(tabId,{type:'PIT_GET_PROGRESS'});
      if(!result?.ok||!result?.progress)return;
      const p=result.progress;
      const percent=p.coveragePercent===null?'—':p.coveragePercent+'%';
      const state=p.lastError?'，错误：'+p.lastError:
        p.busy?'（处理中）':p.remaining>0?'（仍有未处理内容）':'';
      $('translationProgress').textContent='实际正文覆盖：'+p.translated+'/'+p.eligible+
        ' 段（'+percent+'） · 未处理 '+p.remaining+
        ' 段 · 成功批次 '+p.succeededBatches+
        ' · 失败批次 '+p.failedBatches+state;
      if(p.failedBatches>0)status('网页翻译未完全成功，请查看正文覆盖率与错误信息');
    }catch(e){
      $('translationProgress').textContent='无法读取正文翻译进度：'+String(e?.message||e);
    }
    attempts++;
    if(attempts>=80||epoch!==progressEpoch)clearInterval(progressTimer);
  };
  await check();
  progressTimer=setInterval(check,1500);
}
async function send(type) {
  if (mode==='ai' && !['PIT_RESTORE','PIT_CONTINUE'].includes(type) && !confirm('即将调用 AI API，可能产生费用。是否确认本次翻译？（单次全文最多处理 30 段）')) return;
  status('处理中…');
  try {
    const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
    if (!tab?.id || !/^https?:\/\//.test(tab.url||'')) throw new Error('请打开普通网页后重试（浏览器设置页和商店页面不可注入）');
    await chrome.scripting.insertCSS({target:{tabId:tab.id},files:['src/content.css']});
    await chrome.scripting.executeScript({target:{tabId:tab.id},files:['src/content.js']});
    const res=await chrome.tabs.sendMessage(tab.id,{type,mode});
    if (!res?.ok) throw new Error(res?.reason||'发送翻译操作失败');
    status('操作请求已发送；以实际网页覆盖率与失败批次为准，不等同于翻译成功。');
    if(['PIT_START','PIT_CONTINUE','PIT_RESTORE'].includes(type))
      void watchCoverage(tab.id);
  } catch(e) {status('操作失败：'+(e?.message||String(e)));}
}
$('standard').onclick=()=>{mode='standard';show();};
$('ai').onclick=()=>{mode='ai';show();};
$('translate').onclick=()=>send('PIT_START');
$('continue').onclick=()=>send('PIT_CONTINUE');
$('selection').onclick=()=>send('PIT_SELECTION');
$('restore').onclick=()=>send('PIT_RESTORE');
// Only inspect visible iframe URLs in the active tab, then request the
// specific provider origin; never silently request global site permissions.
async function embeddedFrame(tabId){
  const found=await chrome.scripting.executeScript({
    target:{tabId},func:()=>[...document.querySelectorAll('iframe[src]')]
      .filter(el=>{
        const style=getComputedStyle(el),box=el.getBoundingClientRect();
        return style.display!=='none' && style.visibility==='visible' &&
          Number(style.opacity)>0 && box.width>=120 && box.height>=60 &&
          box.bottom>0 && box.right>0 &&
          box.left<innerWidth && box.top<innerHeight;
      })
      .slice(0,20).map(el=>el.src)
  });
  const visible=found?.[0]?.result||[];
  if(!visible.length)return null;
  const frames=await chrome.webNavigation.getAllFrames({tabId});
  return chooseEmbeddedFrame(visible,frames||[]);
}
async function startEmbeddedCaptions(tabId,mode){
  const frame=await embeddedFrame(tabId);
  if(!frame)return {ok:false,reason:'无法找到唯一匹配的 YouTube/Panopto 嵌入播放器；请检查播放画面是否可见，或打开原播放器页面。'};
  const stored=await chrome.storage.local.get(SETTINGS_KEY);
  const rule=normalizeSettings(stored[SETTINGS_KEY]).blockedHosts;
  const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
  if(tab?.id!==tabId || !tab.url) return {ok:false,reason:'活动标签页已切换，请重新开始。'};
  if(hostIsBlocked(new URL(tab.url).hostname,rule) ||
     hostIsBlocked(new URL(frame.origin).hostname,rule))
    return {ok:false,reason:'课程页面或嵌入播放器已加入禁止翻译列表。'};
  if(!confirm('检测到独立嵌入的视频来源：'+frame.origin+
    '\\n是否只为该站点授予字幕读取权限？不会读取私人接口、下载媒体或绕过 DRM。')) {
    return {ok:false,reason:'未授予嵌入播放器访问权限'};
  }
  const allowed=await chrome.permissions.request({origins:[frame.origin+'/*']});
  if(!allowed)return {ok:false,reason:'未取得嵌入播放器站点权限'};
  // The frame may navigate while Chrome presents a permission prompt.
  // Re-resolve against the still-visible iframe URL before any injection.
  const before=await embeddedFrame(tabId);
  if(!before || before.frameId!==frame.frameId || before.origin!==frame.origin ||
     before.identity!==frame.identity)
    return {ok:false,reason:'播放器在授权过程中发生跳转，请重新点击开始。'};
  const target={tabId,frameIds:[frame.frameId]};
  await chrome.scripting.insertCSS({target,files:['src/content.css']});
  await chrome.scripting.executeScript({target,files:[
    'src/lib/caption-core.js','src/lib/platform-captions.js','src/subtitles.js'
  ]});
  // Recheck after asynchronous script injection: do not start reading
  // captions in a different recording that reused this same frame ID.
  const after=await embeddedFrame(tabId);
  if(!after || after.frameId!==frame.frameId || after.origin!==frame.origin ||
     after.identity!==frame.identity)
    return {ok:false,reason:'播放器在启动前切换了录制内容，请重试。'};
  const started=await chrome.tabs.sendMessage(tabId,{
    type:'PIT_CAPTIONS_START',mode,expectedUrl:frame.identity
  },{frameId:frame.frameId});
  if(started?.ok){
    await chrome.storage.session.set({['pit_caption_frame_'+tabId]:frame.frameId});
    return {...started,reason:'已在授权的嵌入播放器中启动字幕翻译。'+(started.reason||'')};
  }
  return {ok:false,reason:started?.reason||'嵌入播放器没有可读取的字幕轨'};
}
async function subtitleAction(type){
  if (type==='PIT_CAPTIONS_START' && mode==='ai' &&
      !confirm('即将持续为当前视频字幕请求 Gemini / DeepSeek，可能产生费用。确认开启，结束后请点击停止。')) return;
  status('正在检测当前页面播放器和字幕轨…');
  try {
    const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
    if(!tab?.id || !/^https?:\/\//.test(tab.url||'')) throw new Error('请在普通视频网站页面使用');
    if(type==='PIT_CAPTIONS_START'){
      // A previous child frame can keep an active subtitle interval even if
      // a new start request succeeds in the top document. Explicitly stop it.
      const key='pit_caption_frame_'+tab.id;
      const previous=(await chrome.storage.session.get(key))[key];
      if(Number.isInteger(previous)&&previous>0)
        await chrome.tabs.sendMessage(tab.id,{type:'PIT_CAPTIONS_STOP'},
          {frameId:previous}).catch(()=>{});
      await chrome.storage.session.remove(key);
      await chrome.scripting.insertCSS({target:{tabId:tab.id},files:['src/content.css']});
      await chrome.scripting.executeScript({target:{tabId:tab.id},
        files:['src/lib/caption-core.js','src/lib/platform-captions.js','src/subtitles.js']});
    }
    const file=$('captionFile').files?.[0];
    let cues;
    if(type==='PIT_CAPTIONS_START' && file){
      if(file.size>2_000_000)throw new Error('字幕文件超过 2MB');
      cues=globalThis.PITSubtitleImport.parseSubtitles(await file.text());
      if(!cues.length)throw new Error('无法从字幕文件解析出有效时间轴');
    }
    let res;
    if(type==='PIT_CAPTIONS_STOP'){
      // Main-frame and selected child player may both hold state.
      await chrome.tabs.sendMessage(tab.id,{type}, {frameId:0}).catch(()=>{});
      const key='pit_caption_frame_'+tab.id;
      const saved=await chrome.storage.session.get(key);
      const frameId=saved[key];
      if(Number.isInteger(frameId)&&frameId>0)
        await chrome.tabs.sendMessage(tab.id,{type},{frameId}).catch(()=>{});
      await chrome.storage.session.remove(key);
      res={ok:true,reason:'字幕翻译已停止'};
    }else {
      res=await chrome.tabs.sendMessage(tab.id,{type,mode,cues},{frameId:0});
      if(!res?.ok && !cues?.length)
        res=await startEmbeddedCaptions(tab.id,mode);
    }
    if(!res?.ok)throw new Error(res?.reason||'字幕操作失败');
    status(res.reason||(type==='PIT_CAPTIONS_START'?'字幕翻译已启动':'字幕翻译已停止'));
  } catch(e){status('字幕操作失败：'+String(e?.message||e));}
}
$('captionsStart').onclick=()=>subtitleAction('PIT_CAPTIONS_START');
$('captionsStop').onclick=()=>subtitleAction('PIT_CAPTIONS_STOP');
$('settings').onclick=()=>chrome.runtime.openOptionsPage();
chrome.storage.local.get(SETTINGS_KEY).then(r=>{settings=normalizeSettings(r[SETTINGS_KEY]);show();}).catch(e=>status(e.message));

$('fileTools').onclick=()=>chrome.tabs.create({url:chrome.runtime.getURL('src/tools.html')});

$('captureImage').onclick=async()=>{
 if(!confirm('将捕获当前网页可见区域截图，并暂存于浏览器会话中供 OCR 使用。图片不会自动上传；继续？'))return;
 status('正在截取当前可见画面…');
 try{
  const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
  if(!tab?.id || !/^https?:\/\//.test(tab.url||''))throw Error('该页面不能截图');
  const data=await chrome.tabs.captureVisibleTab(tab.windowId,{format:'png'});
  if(data.length>6_000_000)throw Error('截图超过暂存大小限制，请缩小窗口或使用本地图片');
  await chrome.storage.session.set({pit_ocr_screenshot:data});
  await chrome.tabs.create({url:chrome.runtime.getURL('src/tools.html?screenshot=1')});
  status('已打开截图 OCR 页面');
 }catch(e){status('截图失败：'+String(e.message||e));}
};

async function liveAsr(type) {
  if(type==='PIT_ASR_START' && !confirm('即将捕获当前活动标签页的声音并送往本机 Whisper 服务进行识别。不会保存录音，也不会自动启用 AI API。确认开始？'))return;
  const token=$('asrToken').value;
  if(type==='PIT_ASR_START' && token.length<16){status('请先填写本机 ASR 服务令牌');return;}
  status(type==='PIT_ASR_START'?'正在启动实时字幕…':'正在停止录音…');
  try{
    const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
    if(type==='PIT_ASR_START') {
      if(!tab?.id || !/^https?:\/\//.test(tab.url||''))throw Error('请打开普通视频网页');
      const allowed=await chrome.permissions.request({origins:['http://127.0.0.1/*']});
      if(!allowed)throw Error('未授予访问本机识别服务的权限');
      await chrome.scripting.insertCSS({target:{tabId:tab.id},files:['src/content.css']});
      await chrome.scripting.executeScript({target:{tabId:tab.id},files:['src/live-captions.js']});
    }
    const res=await chrome.runtime.sendMessage({type,tabId:tab?.id,token:type==='PIT_ASR_START'?token:undefined});
    if(!res?.ok)throw Error(res?.error||'操作失败');
    status(type==='PIT_ASR_START'?'实时音频捕获已请求启动，请观察页面字幕。':'已停止实时音频捕获。');
    $('asrToken').value='';
  }catch(e){status('实时音频操作失败：'+String(e.message||e));}
}
$('asrStart').onclick=()=>liveAsr('PIT_ASR_START');
$('asrStop').onclick=()=>liveAsr('PIT_ASR_STOP');
