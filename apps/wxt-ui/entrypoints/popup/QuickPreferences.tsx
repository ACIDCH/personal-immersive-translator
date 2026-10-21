import {useEffect,useState} from 'react';
import {browser} from '#imports';
// @ts-ignore Shared JavaScript settings metadata; no second provider runtime.
import {providerCatalog} from '../../../../src/lib/provider-catalog.js';
// @ts-ignore Shared original expert templates.
import {EXPERTS} from '../../../../src/lib/product-settings.js';
export function QuickPreferences({mode,onSelection}:{mode:'standard'|'ai';onSelection:()=>void}){
 const [settings,setSettings]=useState<any>(null),[notice,setNotice]=useState(''),[sync,setSync]=useState('本地就绪');
 const [probeBusy,setProbeBusy]=useState(false),[probeResult,setProbeResult]=useState('');
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
 async function checkFreeProvider(){
   if(probeBusy||!settings)return;
   const provider=settings.standardProvider;
   if(!['browser','mymemory','google-free'].includes(provider)){
     setProbeResult('当前选择的服务需要在设置中心进行独立诊断；不会暗中切换免费或付费服务。');
     return;
   }
   if(provider==='mymemory'&&!window.confirm(
     '确认用一条公开测试短句请求 MyMemory 在线服务吗？短句将发送至第三方，不会上传当前网页。'
   ))return;
   setProbeBusy(true);setProbeResult('正在检查 '+provider+'…');
   try{
     if(provider==='browser'){
       // canTranslate() / actual inference are distinct. Never start a
       // model download or wait indefinitely from a narrow popup control.
       const sampleSource=settings.source==='auto'?'en':settings.source;
       const sampleTarget=settings.target===sampleSource
         ?(sampleSource==='en'?'zh':'en'):settings.target;
       let timeout:ReturnType<typeof setTimeout>|undefined;
       const answer=await Promise.race([
         browser.runtime.sendMessage({
           type:'PIT_BROWSER_STATUS',source:sampleSource,target:sampleTarget
         }),
         new Promise<never>((_,reject)=>{timeout=setTimeout(
           ()=>reject(Error('Chrome 语言包状态检查超时')),12000);})
       ]).finally(()=>clearTimeout(timeout));
       setProbeResult(answer?.status==='available'
         ?'Chrome 本地语言包可用（'+sampleSource+'→'+sampleTarget+'）；真正翻译仍需单独试译确认。'
         :'Chrome 本地模型未就绪：'+String(answer?.reason||answer?.code||answer?.status||'请在设置中心下载语言包').slice(0,160));
       return;
     }
     const result=await browser.runtime.sendMessage({
       type:'TEST_PROVIDER',mode:'standard',providerId:provider,
       userInitiated:true,costConfirmed:false
     });
     setProbeResult(result?.ok
       ?'服务实际试译成功 · '+String(result.translationPreview||result.status||'已响应').slice(0,160)
       :'服务未就绪 · '+String(result?.error||result?.reason||result?.status||'未获得有效译文').slice(0,170));
   }catch(error){
     setProbeResult('服务诊断失败：'+String(error instanceof Error?error.message:error).slice(0,170));
   }finally{setProbeBusy(false);}
 }
 async function chooseOnlineFree(provider:'google-free'|'mymemory'='google-free'){
   if(probeBusy||!settings||!window.confirm(
     '先用公开短句测试 '+(provider==='google-free'?'Google 公共免费翻译':'MyMemory')+'，确认可用后才切换。实际网页和字幕内容会发送至该在线服务；公共接口可能限流或失效。继续？'
   ))return;
   setProbeBusy(true);setProbeResult('正在对 '+provider+' 进行真实连通性和译文检查…');
   try{
     const target=settings.target==='en'?'zh':settings.target;
     let timer:ReturnType<typeof setTimeout>|undefined;
     const result=await Promise.race([
       browser.runtime.sendMessage({
         type:'TEST_PROVIDER',mode:'standard',providerId:provider,
         target,userInitiated:true,costConfirmed:false
       }),
       new Promise<never>((_,reject)=>{timer=setTimeout(
         ()=>reject(Error('15 秒仍未得到有效试译结果')),15000);})
     ]).finally(()=>clearTimeout(timer));
     if(!result?.ok)throw Error(String(result?.error||result?.status||'服务未返回有效译文'));
     const saved=await browser.runtime.sendMessage({
       type:'PATCH_SETTINGS',patch:{standardProvider:provider}
     });
     if(!saved?.ok)throw Error(String(saved?.error||'无法保存翻译服务'));
     setSettings(saved.settings);
     setNotice('已切换至真实试译成功的免 Key 服务；新网页和视频任务将使用该服务，除非设有覆盖规则。');
     setProbeResult('在线翻译试译成功：'+String(result.translationPreview||'').slice(0,140));
   }catch(error){
     setProbeResult('未切换服务：'+String(error instanceof Error?error.message:error).slice(0,180));
   }finally{setProbeBusy(false);}
 }
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
  <div className="pit-service-actions">
   <button type="button" disabled={probeBusy}
     onClick={()=>{if(mode==='standard'&&['browser','mymemory','google-free'].includes(settings.standardProvider))void checkFreeProvider();else void open('services/'+selected);}}>
     {probeBusy?'检测中…':en?'Test selected service':'测试当前翻译服务'}
   </button>
   <button type="button" onClick={()=>void open('services/'+selected)}>
     {en?'All providers & settings':'全部服务与诊断'}
   </button>
  </div>
  {settings.standardProvider==='browser'&&mode==='standard'&&
   <div className="pit-service-readiness">
     <p>Chrome 本地模型需要在本机安装语言包。若当前无法翻译，不会自动把网页发往在线翻译或付费 AI。</p>
     <button type="button" onClick={()=>void chooseOnlineFree('google-free')}>检测并切换 Google 免费在线翻译</button>
     <button type="button" onClick={()=>void chooseOnlineFree('mymemory')}>检测并切换 MyMemory 备用翻译</button>
   </div>}
  {probeResult&&<p role="status" className="native-hint">{probeResult}</p>}
  <label className="pit-field">{en?'AI expert':'AI 专家'}<select aria-label="AI 专家" disabled={mode!=='ai'} value={settings.activeExpertId} onChange={e=>void patch({activeExpertId:e.target.value})}><option value="">{mode==='ai'?'不使用专家':'常规 MT 不适用'}</option>{[...EXPERTS,...settings.customExperts].filter((x:any)=>settings.installedExperts.includes(x.id)).map((x:any)=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
  <div className="pit-quick-links"><button type="button" onClick={()=>void browser.tabs.create({url:browser.runtime.getURL('/file-lab.html')})}>{en?'Documents':'文档翻译'}</button><button type="button" onClick={()=>void open('text')}>{en?'Text':'文本翻译'}</button><button type="button" aria-pressed={settings.hoverTranslate} onClick={()=>void patch({hoverTranslate:!settings.hoverTranslate})}>{en?'Hover':'鼠标悬停'} {settings.hoverTranslate?'ON':'OFF'}</button><button type="button" disabled={!settings.selectionTranslate} onClick={onSelection}>{en?'Selection':'翻译当前选区'}</button></div>
  <p role="status" className="native-hint">{notice}</p>
 </section>;
}
