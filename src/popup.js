import {normalizeSettings, SETTINGS_KEY} from './lib/settings.js';
const $=id=>document.getElementById(id);
let mode='standard';
let settings=normalizeSettings();
function show() {
  $('standard').classList.toggle('selected',mode==='standard');
  $('ai').classList.toggle('selected',mode==='ai');
  $('modeHint').textContent=mode==='standard'?'常规服务优先，不消耗 Gemini / DeepSeek Token。':'AI 按需翻译，可能产生模型调用费用。';
  $('providerInfo').textContent='当前翻译服务：'+(mode==='standard'? settings.standardProvider:settings.aiProvider);
}
function status(msg) {$('status').textContent=msg;}
async function send(type) {
  if (mode==='ai' && type!=='PIT_RESTORE' && !confirm('即将调用 AI API，可能产生费用。是否确认本次翻译？（单次全文最多处理 30 段）')) return;
  status('处理中…');
  try {
    const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
    if (!tab?.id || !/^https?:\/\//.test(tab.url||'')) throw new Error('请打开普通网页后重试（浏览器设置页和商店页面不可注入）');
    await chrome.scripting.insertCSS({target:{tabId:tab.id},files:['src/content.css']});
    await chrome.scripting.executeScript({target:{tabId:tab.id},files:['src/content.js']});
    const res=await chrome.tabs.sendMessage(tab.id,{type,mode});
    if (!res?.ok) throw new Error('发送翻译操作失败');
    status('请求已发送，请在网页查看结果。');
  } catch(e) {status('操作失败：'+(e?.message||String(e)));}
}
$('standard').onclick=()=>{mode='standard';show();};
$('ai').onclick=()=>{mode='ai';show();};
$('translate').onclick=()=>send('PIT_START');
$('selection').onclick=()=>send('PIT_SELECTION');
$('restore').onclick=()=>send('PIT_RESTORE');
async function subtitleAction(type){
  if (type==='PIT_CAPTIONS_START' && mode==='ai' &&
      !confirm('即将持续为当前视频字幕请求 Gemini / DeepSeek，可能产生费用。确认开启，结束后请点击停止。')) return;
  status('正在检测当前页面播放器和字幕轨…');
  try {
    const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
    if(!tab?.id || !/^https?:\/\//.test(tab.url||'')) throw new Error('请在普通视频网站页面使用');
    if(type==='PIT_CAPTIONS_START'){
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
    const res=await chrome.tabs.sendMessage(tab.id,{type,mode,cues});
    if(!res?.ok) throw new Error(res?.reason||'字幕操作失败');
    status(res.reason||(type==='PIT_CAPTIONS_START'?'字幕翻译已启动':'字幕翻译已停止'));
  } catch(e){status('字幕操作失败：'+String(e?.message||e));}
}
$('captionsStart').onclick=()=>subtitleAction('PIT_CAPTIONS_START');
$('captionsStop').onclick=()=>subtitleAction('PIT_CAPTIONS_STOP');
$('settings').onclick=()=>chrome.runtime.openOptionsPage();
chrome.storage.local.get(SETTINGS_KEY).then(r=>{settings=normalizeSettings(r[SETTINGS_KEY]);show();}).catch(e=>status(e.message));

$('fileTools').onclick=()=>chrome.tabs.create({url:chrome.runtime.getURL('src/tools.html')});
