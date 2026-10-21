import React,{useEffect,useRef,useState} from 'react';
import {browser} from '#imports';
import {createRoot} from 'react-dom/client';
import {DocumentLab} from '../../../shared-ui/DocumentLab';
import {BatchFileLab} from '../../../shared-ui/BatchFileLab';
import {SubtitleFileLab} from '../../../shared-ui/SubtitleFileLab';
import {PdfBilingualLab} from '../../../shared-ui/PdfBilingualLab';
import '../../../shared-ui/design.css';
import '../../../shared-ui/document-lab.css';

// One extension-owned workbench, one native background Provider runtime.
// Tabs are internal views; legacy tools stay mounted only when selected.
function FileWorkbench(){
 const [engine,setEngine]=useState('正在检查当前配置…');
 const serviceRequestVersion=useRef(0);
 const [selectedProvider,setSelectedProvider]=useState('browser');
 const [settings,setSettings]=useState<any>(null);
 const [serviceBusy,setServiceBusy]=useState(false);
 const [diagnostic,setDiagnostic]=useState('');
 const names:Record<string,string>={
   browser:'Chrome 本机翻译',mymemory:'MyMemory 在线免 Key',
   cloud:'PIT 自托管云端',microsoft:'Microsoft Translator',
   google:'Google Cloud Translation',deepl:'DeepL',libre:'LibreTranslate'
 };
 const services=['browser','mymemory','microsoft','google','deepl','cloud','libre'];
 async function refreshService(){
   const version=++serviceRequestVersion.current;
   const reply=await browser.runtime.sendMessage({type:'GET_SETTINGS'});
   if(version!==serviceRequestVersion.current)return;
   const s=reply?.settings;
   if(!s)throw Error('无法读取 PIT 全局翻译设置');
   const id=s.fileProviderId&&s.fileProviderId!=='inherit'
     ?s.fileProviderId:s.standardProvider;
   setSettings(s);setSelectedProvider(id);
   const configured=id==='browser'||id==='mymemory'||
     (id==='microsoft'&&Boolean(s.microsoftKey))||
     (id==='google'&&Boolean(s.googleKey))||
     (id==='deepl'&&Boolean(s.deeplKey))||
     (id==='cloud'&&Boolean(s.cloudEndpoint&&s.cloudToken))||
     (id==='libre'&&Boolean(s.libreUrl));
   setEngine('文件翻译服务：'+(names[id]||id)+' · '+(configured
     ?'配置存在，实际可用性仍需检测':'缺少必需配置，暂不可调用')+
     ' · '+s.source+' → '+s.target+
     (s.fileProviderId!=='inherit'?' · 文件专用覆盖':' · 继承全局'));
 }
 async function chooseProvider(id:string){
   if(!services.includes(id)||serviceBusy)return;
   if(id==='mymemory'&&!window.confirm(
     'MyMemory 会将你选择翻译的文档内容发送至第三方在线服务。请勿用它翻译敏感文件；服务有字符额度限制。\\n确认将其设为网页、视频、文件的默认普通翻译服务？'
   ))return;
   setServiceBusy(true);setDiagnostic('');
   try{
     const r=await browser.runtime.sendMessage({
       type:'PATCH_SETTINGS',patch:{standardProvider:id,fileProviderId:'inherit'}
     });
     if(!r?.ok)throw Error(String(r?.error||'保存翻译服务失败'));
     await refreshService();
     setDiagnostic('已同步默认服务；视频专用与网站覆盖规则仍按原配置优先。');
   }catch(e){setDiagnostic('保存失败：'+String(e instanceof Error?e.message:e));}
   finally{setServiceBusy(false);}
 }
 async function testCurrentService(){
   if(serviceBusy||!settings)return;
   if(!['browser','mymemory'].includes(selectedProvider)){
     setDiagnostic('该服务可能产生费用，请在服务中心明确确认后单独测试。');
     return;
   }
   if(selectedProvider==='mymemory'&&!window.confirm(
     '将发送固定公开测试句到 MyMemory（不发送你的文件），确认测试？'
   ))return;
   setServiceBusy(true);setDiagnostic('正在检测当前服务…');
   try{
     const target=settings.target==='en'?'zh':settings.target;
     if(selectedProvider==='browser'){
       const source=settings.source==='auto'||settings.source===target
         ?(target==='en'?'fr':'en'):settings.source;
       const r=await browser.runtime.sendMessage({type:'PIT_BROWSER_STATUS',source,target});
       setDiagnostic('Chrome '+source+' → '+target+'：'+String(r?.status||'unknown')+
         '。仅检查模型状态；请在服务中心运行真实译文测试。'+
         (r?.reason?' '+String(r.reason).slice(0,180):''));
     }else{
       const r=await browser.runtime.sendMessage({
         type:'TEST_PROVIDER',providerId:'mymemory',mode:'standard',
         target,userInitiated:true
       });
       setDiagnostic(r?.ok?'MyMemory 真实公开样句测试成功：'+
         String(r.translationPreview||'').slice(0,120):
         'MyMemory 测试失败：'+String(r?.error||r?.status||'未知错误').slice(0,220));
     }
   }catch(e){setDiagnostic('诊断失败：'+String(e instanceof Error?e.message:e));}
   finally{setServiceBusy(false);}
 }
 const sections=['document-lab','batch-file-lab','subtitle-file-lab','pdf-bilingual-lab'] as const;
 type Section=typeof sections[number];
 const [active,setActive]=useState<Section>(()=>{
   const hash=location.hash.slice(1);
   return sections.find(section=>section===hash)||'document-lab';
 });
 useEffect(()=>{
   const onHash=()=>{
     const section=sections.find(section=>section===location.hash.slice(1));
     if(section)setActive(section);
   };
   window.addEventListener('hashchange',onHash);
   return()=>window.removeEventListener('hashchange',onHash);
 },[]);
 useEffect(()=>{
   let mounted=true;
   const load=()=>{void refreshService().catch(e=>{
     if(mounted)setEngine('读取服务失败：'+String(e instanceof Error?e.message:e));
   });};
   const changed=(changes:Record<string,unknown>,area:string)=>{
     if(area==='local'&&Object.hasOwn(changes,'pit_settings_v1'))load();
   };
   load();
   browser.storage.onChanged.addListener(changed);
   window.addEventListener('focus',load);
   return()=>{mounted=false;serviceRequestVersion.current++;
     browser.storage.onChanged.removeListener(changed);
     window.removeEventListener('focus',load);};
 },[]);
 return <main className="pit-file-workbench">
   <header className="pit-workbench-header">
     <div className="pit-workbench-brand"><span aria-hidden="true">译</span>
       <div><small>PERSONAL IMMERSIVE TRANSLATOR</small>
         <h1>PIT 文件与图片翻译</h1>
         <p>统一工作台 · 原有 DOCX / PDF.js / OCR / BabelDOC 引擎</p>
       </div>
     </div>
     <div className="pit-workbench-actions">
       <a href="/pit-options.html#services" target="_blank" rel="noopener noreferrer">翻译服务及测试</a>
       <a href="/pit-options.html#files" target="_blank" rel="noopener noreferrer">文件引擎设置</a>
       <a href="/pit-options.html#sync" target="_blank" rel="noopener noreferrer">账号与同步</a>
     </div>
   </header>
   <nav aria-label="文件翻译功能" className="pit-workbench-nav">
     {([['document-lab','文档 · 图片 OCR'],['batch-file-lab','多文件批量'],
       ['subtitle-file-lab','SRT / VTT / ASS 字幕'],
       ['pdf-bilingual-lab','双语 PDF · BabelDOC']] as const).map(([id,label])=>
         <a key={id} href={'#'+id} aria-current={active===id?'page':undefined}
           onClick={()=>setActive(id)}>{label}</a>)}
   </nav>
   <section className="pit-workbench-service" aria-label="当前翻译服务管理">
     <div className="pit-workbench-service-controls">
       <label htmlFor="pit-workbench-provider">当前普通翻译服务</label>
       <select id="pit-workbench-provider" value={selectedProvider}
         disabled={serviceBusy||!settings}
         onChange={event=>void chooseProvider(event.target.value)}>
         {services.map(id=><option key={id} value={id}>{names[id]}</option>)}
       </select>
       <button type="button" disabled={serviceBusy||!settings}
         onClick={()=>void testCurrentService()}>
         {serviceBusy?'正在处理…':'检测当前服务'}
       </button>
       <a href={'/pit-options.html#services/'+selectedProvider}
         target="_blank" rel="noopener noreferrer">服务配置与完整测试</a>
     </div>
     <p className="pit-workbench-engine" role="status">{engine}。选择此处默认服务会同步网页、视频和文件的新任务；不会暗中使用付费 AI。</p>
     {diagnostic&&<p className="pit-workbench-diagnostic" role="status">{diagnostic}</p>}
   </section>
   {/* Keep each engine mounted while navigating: unmounting in-flight file
       translation would discard progress/cancel controls and lost PDF state. */}
   <section id="document-lab" className="pit-workbench-module" hidden={active!=='document-lab'}><DocumentLab/></section>
   <section id="batch-file-lab" className="pit-workbench-module" hidden={active!=='batch-file-lab'}><BatchFileLab/></section>
   <section id="subtitle-file-lab" className="pit-workbench-module" hidden={active!=='subtitle-file-lab'}><SubtitleFileLab/></section>
   <section id="pdf-bilingual-lab" className="pit-workbench-module" hidden={active!=='pdf-bilingual-lab'}><PdfBilingualLab/></section>
   <footer>高保真 BabelDOC / Whisper 需要真实就绪的独立服务。普通图片覆盖不等于语义补绘；所有文件处理结果必须由用户审查。</footer>
 </main>;
}
createRoot(document.getElementById('root')!).render(
 <React.StrictMode><FileWorkbench/></React.StrictMode>
);
