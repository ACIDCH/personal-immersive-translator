/**
 * PIT first-party primary navigation. KISS is preserved as the mature web
 * translation backend, not rebranded as the user's custom control panel.
 * Directly uses the upstream's documented 'toggle_translate' content action,
 * while PIT file/video/Whisper/diagnostic modules remain independent.
 */
const el=id=>document.getElementById(id);
const status=text=>{el('pitStatus').textContent=text;};
let selectedTab=null;
const isWeb=tab=>Number.isInteger(tab?.id)&&/^https?:\/\//.test(tab?.url||'');
function displayTarget(tab){
 el('targetTab').textContent=tab?new URL(tab.url).hostname:'当前未选中普通网页';
 el('targetLabel').textContent=tab?'可操作':'请先打开网页';
}
async function findTarget(){
 const [active]=await chrome.tabs.query({active:true,lastFocusedWindow:true});
 if(isWeb(active))return active;
 // When launched from extension's own options page, the active tab is
 // often extension://. Use the most recently touched web tab instead.
 const tabs=await chrome.tabs.query({});
 const matches=tabs.filter(isWeb).sort((a,b)=>(b.lastAccessed||0)-(a.lastAccessed||0));
 return matches[0]||null;
}
async function getTarget(){
 const tab=selectedTab ? await chrome.tabs.get(selectedTab.id).catch(()=>null):null;
 if(isWeb(tab)&&tab.url===selectedTab.url)return tab;
 selectedTab=await findTarget();
 displayTarget(selectedTab);
 if(!selectedTab)throw Error('请先打开 YouTube、Bilibili 或其他普通网页');
 return selectedTab;
}
const actions={
 webTranslate:async()=>{
  const tab=await getTarget();
  status('正在切换 '+new URL(tab.url).hostname+' 的双语翻译…');
  // Canonical KISS v2.1.1 content bus, no competing PIT onMessage
  // listener, no paid AI path or provider settings are changed.
  const response=await chrome.tabs.sendMessage(tab.id,{action:'toggle_translate'},
    {frameId:0});
  if(response?.error)throw Error('KISS 网页翻译未就绪，请在引擎设置中检查服务');
  status('网页翻译指令已发送。请切换回原网页查看原文和译文。');
 },
 videoControl:async()=>{
  const tab=await getTarget();
  await chrome.tabs.create({url:chrome.runtime.getURL(
   'pit/control.html?tabId='+encodeURIComponent(tab.id))});
  status('已打开 PIT 视频字幕与 Whisper 控制台。');
 },
 githubReport:async()=>{
  const tab=await getTarget();
  // User explicitly requested upload by pressing this action.
  await chrome.tabs.create({url:chrome.runtime.getURL(
   'pit/control.html?tabId='+encodeURIComponent(tab.id)+'&autoScan=1')});
  status('已打开当前页面诊断：检查完成后自动提交 GitHub Issue。');
 },
 fileTools:async()=>{
  await chrome.tabs.create({url:chrome.runtime.getURL('pit/tools.html')});
  status('已打开 PIT PDF 与 OCR 文件翻译工具。');
 },
 pitSettings:async()=>{
  await chrome.tabs.create({url:chrome.runtime.getURL('pit/options.html')});
  status('已打开 PIT 独立普通翻译与 AI 服务配置。');
 },
 kissSettings:async()=>{
  const response=await fetch(chrome.runtime.getURL('pit/KISS-UI-PATHS.json'));
  if(!response.ok)throw Error('无法读取 KISS 引擎 UI 路径');
  const config=await response.json();
  const path=config.settings;
  if(typeof path!=='string'||!path.endsWith('.html')||
     path.includes('..')||path.startsWith('/'))throw Error('KISS 设置页面路径无效');
  await chrome.tabs.create({url:chrome.runtime.getURL(path)});
  status('已打开保留的 KISS 网页翻译引擎高级设置。');
 },
 openDashboard:async()=>{
  await chrome.tabs.create({url:chrome.runtime.getURL('pit/dashboard.html')});
  status('完整 PIT 控制台已在新标签页打开。');
 }
};
for(const [id,run] of Object.entries(actions)){
 const btn=el(id);
 if(!btn)throw Error('Missing PIT control '+id);
 btn.addEventListener('click',async()=>{
  btn.disabled=true;status('处理中…');
  try{await run();}
  catch(e){status('操作失败：'+String(e?.message||e));}
  finally{btn.disabled=false;}
 });
}
findTarget().then(tab=>{selectedTab=tab;displayTarget(tab);
 if(tab)status('当前网页已绑定。现在可直接启动 PIT 功能。');
}).catch(e=>status(String(e?.message||e)));