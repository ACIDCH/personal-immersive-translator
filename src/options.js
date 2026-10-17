import {normalizeSettings, SETTINGS_KEY} from './lib/settings.js';
import {validateAIProfile} from './lib/ai-profiles.js';
import {createPreferenceBackup,importPreferenceBackup} from './lib/preference-export.js';
const form=document.getElementById('optionsForm');
const status=document.getElementById('status');
const checkboxKeys=['contextAI','hoverTranslate','inputTranslate'];
let profiles=[], activeProfileId='';
const pick=id=>document.getElementById(id);
function profileMessage(message) {pick('profileStatus').textContent=message;}
function renderProfiles(){
  const list=pick('profileList');
  list.replaceChildren();
  const empty=document.createElement('option');
  empty.value='';empty.textContent='选择配置';list.append(empty);
  for(const profile of profiles){
    const option=document.createElement('option');
    option.value=profile.id;option.textContent=profile.name+' — '+profile.model;
    list.append(option);
  }
  if(!profiles.some(p=>p.id===activeProfileId))activeProfileId='';
  list.value=activeProfileId;
  editProfile();
}
function editProfile(){
  const p=profiles.find(x=>x.id===pick('profileList').value);
  pick('profileName').value=p?.name||'';
  pick('profileProtocol').value=p?.protocol||'openai-chat';
  pick('profileBaseUrl').value=p?.baseUrl||'';
  pick('profileModel').value=p?.model||'';
  pick('profileApiKey').value=p?.apiKey||'';
}
function readProfile(id){
  return validateAIProfile({
    id,
    name:pick('profileName').value,
    protocol:pick('profileProtocol').value,
    baseUrl:pick('profileBaseUrl').value,
    model:pick('profileModel').value,
    apiKey:pick('profileApiKey').value
  });
}
pick('profileList').addEventListener('change',()=>{
  activeProfileId=pick('profileList').value;editProfile();
  profileMessage('已选择配置。点击页面底部保存设置后生效。');
});
pick('profileAdd').addEventListener('click',()=>{
  try {
    if(profiles.length>=20)throw Error('最多保存 20 个 AI 配置');
    const id='ai-'+crypto.randomUUID();
    const p=readProfile(id); profiles.push(p);activeProfileId=id;
    renderProfiles();profileMessage('已添加配置，记得点击页面底部「保存设置」。');
  } catch(e){profileMessage('添加失败：'+e.message);}
});
pick('profileUpdate').addEventListener('click',()=>{
  try {
    if(!activeProfileId)throw Error('请先选择要更新的配置');
    const p=readProfile(activeProfileId);
    profiles=profiles.map(old=>old.id===p.id?p:old);
    renderProfiles();profileMessage('已更新配置，记得点击页面底部「保存设置」。');
  }catch(e){profileMessage('更新失败：'+e.message);}
});
pick('profileDelete').addEventListener('click',()=>{
  if(!activeProfileId)return profileMessage('请先选择要删除的配置');
  profiles=profiles.filter(p=>p.id!==activeProfileId);
  activeProfileId=profiles[0]?.id||'';renderProfiles();
  profileMessage('已移除配置，记得点击页面底部「保存设置」。');
});
function viewSettings(settings) {
  profiles=Array.isArray(settings.aiProfiles)?settings.aiProfiles.slice(0,20):[];
  activeProfileId=settings.activeAIProfileId||'';
  renderProfiles();
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
  data.aiProfiles=profiles;
  data.activeAIProfileId=activeProfileId;
  return normalizeSettings(data);
}
async function requestLibrePermission(settings) {
  if (!['libre','cloud'].includes(settings.standardProvider)) return;
  let url;
  try { url=new URL(settings.standardProvider==='cloud'?settings.cloudEndpoint:settings.libreUrl); }
  catch {throw new Error('翻译服务 URL 无效');}
  if (url.protocol!=='https:' || url.username || url.password || url.search || url.hash) throw new Error('翻译服务必须使用无内嵌凭据的 HTTPS URL');
  const granted=await chrome.permissions.request({origins:[url.origin+'/*']});
  if(!granted) throw new Error('未授权连接所选翻译服务器');
}
async function requestAIProfilePermission(settings){
  if(settings.aiProvider!=='custom')return;
  const profile=settings.aiProfiles.find(p=>p?.id===settings.activeAIProfileId);
  const valid=validateAIProfile(profile);
  const granted=await chrome.permissions.request({origins:[new URL(valid.baseUrl).origin+'/*']});
  if(!granted)throw new Error('未授予该 AI 服务商的网络访问权限');
}
async function saveSettings() {
  const settings=collect();
  await requestLibrePermission(settings);
  await requestAIProfilePermission(settings);
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
document.getElementById('exportPreferences').addEventListener('click',async()=>{
 try{
  const data=await chrome.storage.local.get(SETTINGS_KEY);
  const backup=createPreferenceBackup(data[SETTINGS_KEY]);
  const blob=new Blob([JSON.stringify(backup,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob);
  const link=document.createElement('a');
  link.href=url;link.download='pit-reading-preferences.json';
  document.body.append(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),60000);
  status.textContent='已导出阅读与站点设置，不包含 API 密钥、云端令牌或历史翻译。';
 }catch(error){status.textContent='导出设置失败：'+String(error.message||error);}
});
document.getElementById('importPreferences').addEventListener('click',()=>{
 document.getElementById('preferenceFile').click();
});
document.getElementById('preferenceFile').addEventListener('change',async event=>{
 const file=event.target.files?.[0];
 if(!file)return;
 try{
  if(file.size>120000)throw Error('设置文件太大，最大 120 KB');
  const data=JSON.parse(await file.text());
  const current=await chrome.storage.local.get(SETTINGS_KEY);
  const updated=importPreferenceBackup(data,current[SETTINGS_KEY]);
  if(!confirm('将覆盖当前语言、阅读样式、自动翻译和站点规则设置，不修改 API Key。继续？'))return;
  await chrome.storage.local.set({[SETTINGS_KEY]:updated});
  viewSettings(updated);
  status.textContent='阅读设置导入成功。翻译服务密钥和自定义模型未修改。';
 }catch(error){status.textContent='阅读设置导入失败：'+String(error.message||error);}
 finally{event.target.value='';}
});
document.getElementById('clearCache').addEventListener('click',async()=>{
  const res=await chrome.runtime.sendMessage({type:'CLEAR_CACHE'});
  status.textContent=res.ok?'缓存已清空':'清理失败：'+res.error;
});
// Hold controls until asynchronous saved preferences are rendered. Without
// this, fast users and browser automation can have edits overwritten by init.
form.dataset.ready='0';
for(const el of form.elements)el.disabled=true;
chrome.storage.local.get(SETTINGS_KEY)
  .then(r=>viewSettings(normalizeSettings(r[SETTINGS_KEY])))
  .catch(error=>{status.textContent='设置读取失败：'+String(error.message||error);})
  .finally(()=>{
    for(const el of form.elements)el.disabled=false;
    form.dataset.ready='1';
  });
