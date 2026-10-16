import {chooseEmbeddedFrame} from '../lib/frame-route.js';
import {sendToView} from './view-client.js';
import {initSiteDiagnostics} from './site-diagnostics-ui.js';
const el=id=>document.getElementById(id);
const selected=Number(new URLSearchParams(location.search).get('tabId'));
let bound=null;
const say=message=>{el('status').textContent=message;};
const ACTIVE=/^https?:\/\//i;
const CAPTION_FILES=['lib/caption-core.js','lib/platform-captions.js','subtitles.js'];
async function loadTarget(){
  if(!Number.isInteger(selected)||selected<=0)throw Error('请从 KISS 弹窗打开此控制台');
  const tab=await chrome.tabs.get(selected);
  if(!ACTIVE.test(tab?.url||''))throw Error('只能针对 HTTP(S) 网页执行字幕和语音操作');
  bound={id:tab.id,url:tab.url};
  // The platform label is derived locally from the hostname only.
  // The exact hostname/path never leaves this extension in a report.
  const host=new URL(bound.url).hostname.toLowerCase();
  const automatic=
    /(^|\.)youtube\.com$/.test(host)||host==='youtu.be'?'YouTube':
    /(^|\.)bilibili\.com$/.test(host)||host==='b23.tv'?'Bilibili':
    /^missav\./.test(host)||/(^|\.)missav\.com$/.test(host)?'Miss AV':
    /(^|\.)netflix\.com$/.test(host)?'Netflix':
    host.includes('panopto.')?'Panopto':'Other';
  el('diagPlatform').value=automatic;
  el('target').textContent='已绑定网页：'+new URL(bound.url).hostname+
    ' · 关闭或重新导航页面后，需要重新从 KISS 弹窗打开控制台。';
  const check=await globalThis.PITSidecar.send({type:'PIT_ASR_STATUS'});
  if(check?.ok && check.active)
    say(check.tabId===bound.id?'当前目标正在进行语音识别。':'其他网页正在进行语音识别。');
}
async function verified(){
  if(!bound)throw Error('尚未选择目标网页');
  const tab=await chrome.tabs.get(bound.id);
  if(tab?.url!==bound.url)throw Error('目标网页已经跳转，请重新从 KISS 弹窗打开控制台');
  return tab;
}
async function inject(target){
  await chrome.scripting.insertCSS({target,files:['pit/content.css']});
  await chrome.scripting.executeScript({target,files:['pit/bridge-client.js',...CAPTION_FILES.map(p=>'pit/'+p)]});
}
async function visibleFrames(id){
  const result=await chrome.scripting.executeScript({target:{tabId:id},func:()=>
    [...document.querySelectorAll('iframe[src]')].filter(el=>{
      const style=getComputedStyle(el),r=el.getBoundingClientRect();
      return style.visibility!=='hidden'&&style.display!=='none'&&
        Number(style.opacity)>0&&r.width>=120&&r.height>=60
        &&r.right>0&&r.bottom>0&&r.left<innerWidth&&r.top<innerHeight;
    }).slice(0,20).map(el=>el.src)});
  return result?.[0]?.result||[];
}
async function resolveEmbed(id){
  const visible=await visibleFrames(id);
  if(!visible.length)return null;
  return chooseEmbeddedFrame(visible,(await chrome.webNavigation.getAllFrames({tabId:id}))||[]);
}
async function captionAction(start){
  await verified();
  if(!start){
    const prev=(await chrome.storage.session.get('pit_caption_frame_'+bound.id))['pit_caption_frame_'+bound.id];
    await sendToView(bound.id,{type:'PIT_CAPTIONS_STOP'},0).catch(()=>{});
    if(Number.isInteger(prev)&&prev>0)
      await sendToView(bound.id,{type:'PIT_CAPTIONS_STOP'},prev).catch(()=>{});
    await chrome.storage.session.remove('pit_caption_frame_'+bound.id);
    say('增强视频字幕已停止');return;
  }
  const mode=el('mode').value;
  if(mode==='ai'&&!confirm('持续视频字幕将消耗所配置的 Gemini / DeepSeek API 额度。确认由你主动启动吗？'))return;
  let cues=null;
  const file=el('cues').files?.[0];
  if(file){
    if(file.size>2_000_000)throw Error('字幕文件超过 2MB');
    cues=globalThis.PITSubtitleImport.parseSubtitles(await file.text());
    if(!cues.length)throw Error('无法从字幕文件解析字幕时间轴');
  }
  const key='pit_caption_frame_'+bound.id;
  const prev=(await chrome.storage.session.get(key))[key];
  if(Number.isInteger(prev)&&prev>0)
    await sendToView(bound.id,{type:'PIT_CAPTIONS_STOP'},prev).catch(()=>{});
  await chrome.storage.session.remove(key);
  await inject({tabId:bound.id});
  let result=await sendToView(bound.id,{type:'PIT_CAPTIONS_START',
    mode,cues,userInitiated:mode==='ai'},0);
  if(!result?.ok&&!cues?.length){
    const frame=await resolveEmbed(bound.id);
    if(frame){
      if(!confirm('是否启用当前可见嵌入视频的字幕翻译？来源：'+frame.origin))return;
      const checked=await resolveEmbed(bound.id);
      if(!checked||frame.identity!==checked.identity||frame.frameId!==checked.frameId)
        throw Error('嵌入播放器身份发生变化，请重试');
      const frameTarget={tabId:bound.id,frameIds:[frame.frameId]};
      await inject(frameTarget);
      result=await sendToView(bound.id,{
        type:'PIT_CAPTIONS_START',mode,expectedUrl:frame.identity,
        userInitiated:mode==='ai'
      },frame.frameId);
      if(result?.ok)await chrome.storage.session.set({[key]:frame.frameId});
    }
  }
  if(!result?.ok)throw Error(result?.reason||'当前视频没有可读取的字幕');
  say(result.reason||'增强字幕翻译已经开始');
}
async function whisperCheck(){
  await verified();
  const token=el('token').value;
  const response=await globalThis.PITSidecar.send({
    type:'PIT_ASR_PREFLIGHT',token
  });
  if(!response?.ok)throw Error(response?.error||'本机 Whisper 检测失败');
  say(response.message||'本机 Whisper 服务可用');
}
async function asrAction(start){
  if(!start){
    const result=await globalThis.PITSidecar.send({type:'PIT_ASR_STOP'});
    if(!result?.ok)throw Error(result?.error||'停止失败');
    say('音频捕获已停止');return;
  }
  await verified();
  const token=el('token').value;
  if(token.length<16)throw Error('请填写本机 Whisper 服务令牌（至少 16 字符）');
  if(!confirm('开始捕获该网页标签页的声音并使用本机 Whisper 进行识别？识别文字将按普通翻译配置处理。'))return;
  const result=await globalThis.PITSidecar.send({
    type:'PIT_ASR_START',tabId:bound.id,expectedUrl:bound.url,token
  });
  if(!result?.ok)throw Error(result?.error||'本机音频捕获失败');
  say('本机 Whisper 已启动；请在原视频标签页查看双语字幕');
}
for(const [id,fn] of [
 ['captionStart',()=>captionAction(true)],['captionStop',()=>captionAction(false)],
 ['asrCheck',whisperCheck],
 ['asrStart',()=>asrAction(true)],['asrStop',()=>asrAction(false)]
]){
 el(id).addEventListener('click',async()=>{
  el(id).disabled=true;say('处理中…');
  try{await fn();}catch(e){say('操作失败：'+String(e.message||e));}
  finally{el(id).disabled=false;}
 });
}
initSiteDiagnostics(verified);
loadTarget().catch(e=>{
 say('无法绑定网页：'+String(e.message||e));
 el('target').textContent='请从 KISS 原生弹窗打开本页。';
 el('captionStart').disabled=true;el('asrStart').disabled=true;
});