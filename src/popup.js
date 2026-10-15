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
$('settings').onclick=()=>chrome.runtime.openOptionsPage();
chrome.storage.local.get(SETTINGS_KEY).then(r=>{settings=normalizeSettings(r[SETTINGS_KEY]);show();}).catch(e=>status(e.message));
