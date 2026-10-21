import {normalizeSettings, SETTINGS_KEY, portablePreferences, applyPortablePreferences} from './lib/settings.js';
import {validateAIProfile} from './lib/ai-profiles.js';
import {checkNativeTranslator,ensureNativeTranslator} from './lib/browser-native.js';
import {mountProductSettings} from './options-v2.js';
const form=document.getElementById('optionsForm');
const status=document.getElementById('status');
let profiles=[], activeProfileId='',currentSettings=normalizeSettings();
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
  currentSettings=settings;
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
  const data={...currentSettings};
  for(const [key] of Object.entries(normalizeSettings())) {
    if (key==='autoAI') continue;
    const el=form.elements.namedItem(key);
    if (!el) continue;
    data[key]=el.type==='checkbox'?el.checked:el.value;
  }
  data.aiProfiles=profiles;
  data.activeAIProfileId=activeProfileId;
  return normalizeSettings(data);
}
async function requestLibrePermission(settings) {
  if (!['libre','cloud'].includes(settings.standardProvider)) return;
  let url;
  const endpoint=settings.standardProvider==='cloud'?settings.cloudEndpoint:settings.libreUrl;
  // Saving reading preferences must not force an unconfigured free/self-hosted
  // service to exist. Only request host permission once owner enters a URL.
  if(!String(endpoint||'').trim())return;
  try { url=new URL(endpoint); }
  catch {throw new Error('翻译服务 URL 无效');}
  if (url.protocol!=='https:' || url.username || url.password || url.search || url.hash) throw new Error('翻译服务必须使用无内嵌凭据的 HTTPS URL');
  const granted=await chrome.permissions.request({origins:[url.origin+'/*']});
  if(!granted) throw new Error('未授权连接所选翻译服务器');
}
async function requestAIProfilePermission(settings){
  if(settings.aiProvider!=='custom')return;
  const profile=settings.aiProfiles.find(p=>p?.id===settings.activeAIProfileId);
  // An empty custom profile slot can be saved while the owner configures
  // non-AI features. Provider readiness is checked before actual AI calls.
  if(!profile)return;
  const valid=validateAIProfile(profile);
  const granted=await chrome.permissions.request({origins:[new URL(valid.baseUrl).origin+'/*']});
  if(!granted)throw new Error('未授予该 AI 服务商的网络访问权限');
}
async function saveSettings() {
  const settings=collect();
  await requestLibrePermission(settings);
  await requestAIProfilePermission(settings);
  const patch=Object.fromEntries(Object.entries(settings).filter(([key,value])=>JSON.stringify(value)!==JSON.stringify(currentSettings[key])));
  const response=await chrome.runtime.sendMessage({type:'PATCH_SETTINGS',patch});
  if(!response?.ok)throw Error(response?.error||'设置保存失败');
  currentSettings=response.settings;
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
    const res=await chrome.runtime.sendMessage({type:'TEST_PROVIDER',mode,costConfirmed:mode==='ai'||confirm('所选服务可能计费，继续测试吗？')});
    if(!res.ok) throw new Error(res.error);
    status.textContent=`测试成功：${res.translations[0]}`;
  } catch(e) {status.textContent='测试失败：'+e.message;}
});
document.getElementById('clearCache').addEventListener('click',async()=>{
  const res=await chrome.runtime.sendMessage({type:'CLEAR_CACHE'});
  status.textContent=res.ok?'缓存已清空':'清理失败：'+res.error;
});
async function nativeLanguagePack(download){
 const status=pick('nativeModelStatus');
 const source=pick('nativeModelSource').value;
 const target=form.elements.namedItem('target').value;
 status.textContent='正在检查 Chrome 内置翻译模型…';
 if(source===target){status.textContent='原文与目标语言相同，无需下载语言包。';return;}
 try{
  if(!download){
   const state=await checkNativeTranslator(source,target);
   const reply=await chrome.runtime.sendMessage({
     type:'PIT_BROWSER_STATUS',source,target
   });
   const actual=reply?.status||'unavailable';
   const note=reply?.reason||reply?.error||'';
   if(actual==='available'){
     const probe=await chrome.runtime.sendMessage({type:'PIT_BROWSER_PROBE',source,target});
     status.textContent=probe?.ok&&probe.status==='translated'
       ? '离屏实际推理成功：'+String(probe.sampleTranslation||'').slice(0,90)+
         '（'+probe.elapsedMs+' ms，仅固定样本，不代表长文档质量）'
       : '语言包状态显示可用，但 PIT 离屏真实推理失败：'+
         String(probe?.reason||probe?.error||'unknown')+'。请切换在线备用引擎。';
   }else{
     status.textContent='Chrome 设置页：'+state+
       '；离屏执行环境：'+actual+(note?'（'+String(note).slice(0,120)+'）':'')+
       '。如可下载请点击语言包下载，不支持则选择在线备用服务。';
   }
   return;
  }
  const translator=await ensureNativeTranslator(source,target,{allowDownload:true,
    onDownloadProgress:({loaded,total})=>{
     const pct=total>0?Math.round(100*loaded/total):Math.round(100*loaded);
     status.textContent='正在下载 Chrome 语言包：'+Math.max(0,Math.min(100,pct))+'%';
    }
   });
  // Prove a result was produced before reporting model readiness.
  const sample=source==='en'?'Hello, welcome to our class.':'PIT translation test';
  const text=await translator.translate(sample);
  if(!text?.trim())throw Error('模型没有返回译文');
  const checked=await chrome.runtime.sendMessage({
    type:'PIT_BROWSER_STATUS',source,target
  });
  const inference=checked?.ok&&checked?.status==='available'
    ? await chrome.runtime.sendMessage({type:'PIT_BROWSER_PROBE',source,target}):null;
  status.textContent=inference?.ok&&inference.status==='translated'
    ? 'Chrome 模型安装后，PIT 离屏实际翻译已成功：'+
      String(inference.sampleTranslation||'').slice(0,90)+
      '（'+inference.elapsedMs+' ms；仅样例，需继续真实网页验收）'
    : '设置页模型已返回译文，但 PIT 离屏真实推理尚未通过：'+
      String(inference?.reason||inference?.error||checked?.reason||
        checked?.status||'unknown')+'。请改选在线备用服务。';
 }catch(error){status.textContent='内置模型准备失败：'+String(error.message||error);}
}
// Explicit fallback after Chrome denies or cannot download an on-device pack.
// Never send website text to a third party just because a local model failed.
pick('nativeFallbackMyMemory').addEventListener('click',async()=>{
 const output=pick('nativeModelStatus');
 try{
  const provider=form.elements.namedItem('standardProvider');
  if(!provider)throw Error('常规翻译服务选项不存在');
  provider.value='mymemory';
  const saved=await saveSettings();
  if(saved.standardProvider!=='mymemory')throw Error('在线备用翻译设置没有保存');
  output.textContent='已主动切换至 MyMemory 在线备用翻译：翻译原文将发送第三方服务，每日限额 4,500 字符；AI 仍需单独启用。';
 }catch(error){
  output.textContent='备用翻译切换失败：'+String(error?.message||error);
 }
});
pick('nativeModelCheck').addEventListener('click',()=>void nativeLanguagePack(false));
pick('nativeModelDownload').addEventListener('click',()=>void nativeLanguagePack(true));
// Backup is intentionally an allowlisted preference snapshot, never a
// copy of local browser storage. Credentials and custom AI profiles stay local.
pick('exportPreferences').addEventListener('click',async()=>{
 try{
  const saved=await chrome.storage.local.get(SETTINGS_KEY);
  const payload=portablePreferences(saved[SETTINGS_KEY]);
  const bytes=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});
  const link=document.createElement('a');
  const url=URL.createObjectURL(bytes);
  link.href=url;link.download='pit-reading-preferences.json';
  document.body.append(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),2000);
  pick('preferencesStatus').textContent='已导出偏好设置，不包含 API 密钥和翻译历史。';
 }catch(e){pick('preferencesStatus').textContent='导出失败：'+String(e.message||e);}
});
pick('importPreferences').addEventListener('change',async event=>{
 const input=event.currentTarget,file=input.files?.[0];
 if(!file)return;
 try{
  if(file.size>65536||file.size===0)throw Error('请选择不超过 64 KiB 的 PIT 偏好 JSON');
  const data=JSON.parse(await file.text());
  // Preserve credentials already present in the current form. Only the
  // allowlisted portable preferences can override them.
  const settings=applyPortablePreferences(collect(),data);
  viewSettings(settings);
  pick('preferencesStatus').textContent='已预览导入的非敏感偏好；点击页面底部「保存设置」才会写入。';
 }catch(e){pick('preferencesStatus').textContent='导入失败：'+String(e.message||e);}
 finally{input.value='';}
});
// Hold controls until asynchronous saved preferences are rendered. Without
// this, fast users and browser automation can have edits overwritten by init.
form.dataset.ready='0';
const initializingControls=[...form.elements].map(el=>({el,disabled:el.disabled}));
for(const {el} of initializingControls)el.disabled=true;
chrome.storage.local.get(SETTINGS_KEY)
  .then(r=>{viewSettings(normalizeSettings(r[SETTINGS_KEY]));mountProductSettings({form,get:()=>currentSettings,save:saveSettings,view:viewSettings});})
  .catch(error=>{status.textContent='设置读取失败：'+String(error.message||error);})
  .finally(()=>{
    for(const {el,disabled} of initializingControls)el.disabled=disabled;
    form.dataset.ready='1';
  });
