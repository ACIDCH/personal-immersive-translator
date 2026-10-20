import {useEffect,useState} from 'react';
import {browser} from '#imports';
// @ts-ignore Shared JavaScript settings metadata; no second provider runtime.
import {providerCatalog} from '../../../../src/lib/provider-catalog.js';
// @ts-ignore Shared original expert templates.
import {EXPERTS} from '../../../../src/lib/product-settings.js';
export function QuickPreferences({mode,onSelection}:{mode:'standard'|'ai';onSelection:()=>void}){
 const [settings,setSettings]=useState<any>(null),[notice,setNotice]=useState(''),[sync,setSync]=useState('本地就绪');
 useEffect(()=>{
   let alive=true,latest=0;
   const refresh=()=>{
     const version=++latest;
     void browser.runtime.sendMessage({type:'GET_SETTINGS'}).then(r=>{
       if(alive && version===latest && r?.settings)setSettings(r.settings);
     }).catch(()=>{if(alive)setNotice('读取设置失败，请重新打开插件');});
   };
   const refreshSync=()=>void browser.runtime.sendMessage({type:'PIT_SYNC',action:'status'}).then(r=>{
     if(!alive||!r?.ok||!r.status)return;
     setSync(r.status.conflicted?'同步冲突':r.status.queued?'同步排队':
       r.status.lastSyncedAt?'已同步 · '+r.status.vault:r.status.account);
   }).catch(()=>{if(alive)setSync('同步状态不可用');});
   // OCR/file diagnostics frequently write other storage keys. Those must
   // not trigger GET_SETTINGS storms that overwrite a just-edited control.
   const changed=(changes:Record<string,unknown>,area:string)=>{
     if(area!=='local')return;
     if(Object.hasOwn(changes,'pit_settings_v1'))refresh();
     if(Object.hasOwn(changes,'pit_sync_state'))refreshSync();
   };
   refresh();refreshSync();
   browser.storage.onChanged.addListener(changed);
   return()=>{alive=false;latest++;browser.storage.onChanged.removeListener(changed);};
 },[]);
 async function patch(data:Record<string,unknown>){try{const r=await browser.runtime.sendMessage({type:'PATCH_SETTINGS',patch:data});if(!r.ok)throw Error(r.error);setSettings(r.settings);setNotice('已保存');}catch(e){setNotice(String(e));}}
 const open=(hash:string)=>browser.tabs.create({url:browser.runtime.getURL('pit-options.html' as never)+'#'+hash});
 if(!settings)return <p role="status">正在读取设置…</p>;
 const en=settings.uiLanguage==='en';const langs=[['zh','简体中文'],['en','English'],['fr','Français'],['ja','日本語'],['ko','한국어'],['de','Deutsch'],['es','Español']];
 const catalog=providerCatalog(settings).filter((p:any)=>Boolean(p.ai)===(mode==='ai'));
 const selected=mode==='ai'?(settings.aiProvider==='custom'?settings.activeAIProfileId:settings.aiProvider):settings.standardProvider;
 return <section className="pit-quick-preferences" aria-label="翻译偏好">
  <div className="pit-account"><span>{sync}</span><button type="button" onClick={()=>void open('sync')}>{en?'Account & sync':'账号与同步'}</button></div>
  <div className="pit-language-pair">
   <label>{en?'Source':'原文'}<select aria-label="原文语言" value={settings.source} onChange={e=>void patch({source:e.target.value})}><option value="auto">{en?'Auto detect':'自动检测'}</option>{langs.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
   <button type="button" aria-label="交换语言" title={settings.source==='auto'?'自动源语不能交换':'交换语言'} disabled={settings.source==='auto'} onClick={()=>void patch({source:settings.target,target:settings.source})}>⇄</button>
   <label>{en?'Target':'译为'}<select aria-label="目标语言" value={settings.target} onChange={e=>void patch({target:e.target.value})}>{langs.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
  </div>
  <label className="pit-field">{en?'Translation service':'翻译服务'}<select aria-label="翻译服务" value={selected} onChange={e=>{const p=catalog.find((x:any)=>(x.profileId||x.id)===e.target.value);if(p)void patch(p.ai?{aiProvider:p.id,...(p.profileId?{activeAIProfileId:p.profileId}:{})}:{standardProvider:p.id});}}>{catalog.filter((p:any)=>{const id=p.profileId||p.id;return id===selected||(settings.providerPreferences[id]?.visible!==false&&settings.providerPreferences[id]?.enabled!==false);}).map((p:any)=><option key={p.profileId||p.id} value={p.profileId||p.id} disabled={settings.providerPreferences[p.profileId||p.id]?.enabled===false}>{p.name} · {p.category}</option>)}</select></label>
  <button type="button" onClick={()=>void open('services/'+selected)}>{en?'Test this service':'测试此服务 / 诊断'}</button>
  <label className="pit-field">{en?'AI expert':'AI 专家'}<select aria-label="AI 专家" disabled={mode!=='ai'} value={settings.activeExpertId} onChange={e=>void patch({activeExpertId:e.target.value})}><option value="">{mode==='ai'?'不使用专家':'常规 MT 不适用'}</option>{[...EXPERTS,...settings.customExperts].filter((x:any)=>settings.installedExperts.includes(x.id)).map((x:any)=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
  <div className="pit-quick-links"><button type="button" onClick={()=>void browser.tabs.create({url:browser.runtime.getURL('/file-lab.html')})}>{en?'Documents':'文档翻译'}</button><button type="button" onClick={()=>void open('text')}>{en?'Text':'文本翻译'}</button><button type="button" aria-pressed={settings.hoverTranslate} onClick={()=>void patch({hoverTranslate:!settings.hoverTranslate})}>{en?'Hover':'鼠标悬停'} {settings.hoverTranslate?'ON':'OFF'}</button><button type="button" disabled={!settings.selectionTranslate} onClick={onSelection}>{en?'Selection':'翻译当前选区'}</button></div>
  <p role="status" className="native-hint">{notice}</p>
 </section>;
}
