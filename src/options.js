import {normalizeSettings, SETTINGS_KEY} from './lib/settings.js';
const form=document.getElementById('optionsForm');
const status=document.getElementById('status');
const checkboxKeys=['contextAI'];
function viewSettings(settings) {
  for (const el of form.elements) {
    if (!el.name || !Object.hasOwn(settings,el.name)) continue;
    if (el.type === 'checkbox') el.checked=Boolean(settings[el.name]);
    else el.value=settings[el.name] ?? '';
  }
}
function collect() {
  const data={};
  for(const [key] of Object.entries(normalizeSettings())) {
    if (key==='autoAI') continue;
    const el=form.elements.namedItem(key);
    if (!el) continue;
    data[key]=checkboxKeys.includes(key)?el.checked:el.value;
  }
  return normalizeSettings(data);
}
async function requestLibrePermission(settings) {
  if (settings.standardProvider!=='libre') return;
  let url;
  try { url=new URL(settings.libreUrl); }
  catch {throw new Error('LibreTranslate URL 无效');}
  if (url.protocol!=='https:' || url.username || url.password || url.search || url.hash) throw new Error('LibreTranslate 必须使用无内嵌凭据的 HTTPS URL');
  const granted=await chrome.permissions.request({origins:[url.origin+'/*']});
  if(!granted) throw new Error('未授权连接 LibreTranslate 服务器');
}
async function saveSettings() {
  const settings=collect();
  await requestLibrePermission(settings);
  await chrome.storage.local.set({[SETTINGS_KEY]:settings});
  status.textContent='设置已保存。';
  return settings;
}
form.addEventListener('submit',event=>{
  event.preventDefault();
  saveSettings().catch(e=>status.textContent='保存失败：'+e.message);
});
document.getElementById('test').addEventListener('click', async()=>{
  status.textContent='正在发送一段测试文本…';
  try {
    const settings=await saveSettings();
    const mode=confirm(`测试 AI (${settings.aiProvider}) 吗？\n确认 = 测试 AI（可能计费）\n取消 = 测试常规翻译 (${settings.standardProvider})`) ? 'ai':'standard';
    const res=await chrome.runtime.sendMessage({type:'TEST_PROVIDER',mode});
    if(!res.ok) throw new Error(res.error);
    status.textContent=`测试成功：${res.translations[0]}`;
  } catch(e) {status.textContent='测试失败：'+e.message;}
});
document.getElementById('clearCache').addEventListener('click',async()=>{
  const res=await chrome.runtime.sendMessage({type:'CLEAR_CACHE'});
  status.textContent=res.ok?'缓存已清空':'清理失败：'+res.error;
});
chrome.storage.local.get(SETTINGS_KEY).then(r=>viewSettings(normalizeSettings(r[SETTINGS_KEY])));
