import {useEffect,useRef,useState} from 'react';
import {browser} from '#imports';

type Mode='standard'|'ai';
type Progress={
  eligible:number;translated:number;remaining:number;coveragePercent:number|null;
  succeededBatches:number;failedBatches:number;busy:boolean;lastError:string;
};
const rootFile='pit-native.js';
const rootCss='pit-native.css';

export function NativeWebControls(){
 const [mode,setMode]=useState<Mode>('standard');
 const [status,setStatus]=useState('打开普通网页后点击翻译。');
 const [progress,setProgress]=useState<Progress|null>(null);
 const [working,setWorking]=useState(false);
 const [siteAccessNeeded,setSiteAccessNeeded]=useState(false);
 const [tabId,setTabId]=useState<number|null>(null);
 const timer=useRef<ReturnType<typeof setInterval>|null>(null);
 const latest=useRef(0);

 useEffect(()=>{
   if(tabId===null)return;
   let alive=true;
   let count=0;
   const update=async()=>{
     try{
       const answer=await browser.tabs.sendMessage(tabId,{type:'PIT_GET_PROGRESS'});
       if(alive && answer?.ok && answer.progress)setProgress(answer.progress);
     }catch{
       if(alive)setStatus('无法读取当前标签页的翻译进度；可能已离开该网页。');
     }
     if(++count>=80 && timer.current){clearInterval(timer.current);timer.current=null;}
   };
   void update();
   timer.current=setInterval(()=>void update(),1500);
   return()=>{alive=false;if(timer.current)clearInterval(timer.current);timer.current=null;};
 },[tabId]);

 async function run(action:'PIT_START'|'PIT_CONTINUE'|'PIT_SELECTION'|'PIT_RESTORE'){
   if(working)return;
   if(mode==='ai' && (action==='PIT_START'||action==='PIT_SELECTION')){
     if(!window.confirm('此操作会使用你配置的 AI 模型，可能消耗额度或产生费用。继续吗？'))return;
   }
   const token=++latest.current;
   setWorking(true);setStatus('正在与网页通信…');setSiteAccessNeeded(false);
   try{
     const [tab]=await browser.tabs.query({active:true,currentWindow:true});
     if(!tab?.id || !/^https?:\/\//.test(tab.url||''))throw Error('请先打开可访问的普通网页');
     if(action==='PIT_START'||action==='PIT_SELECTION'||action==='PIT_RESTORE'||action==='PIT_CONTINUE'){
       // Installed HTTP(S) site access enables normal page injection without
       // repeated per-domain prompts; Chrome internal pages remain blocked.
       await browser.scripting.insertCSS({target:{tabId:tab.id},files:[rootCss]});
       // WXT's generated pathname union enumerates listed entrypoints only;
       // this static public asset is verified byte-for-byte by the output test.
       await browser.scripting.executeScript({target:{tabId:tab.id},files:[rootFile as never]});
     }
     const answer=await browser.tabs.sendMessage(tab.id,{type:action,mode});
     if(!answer?.ok)throw Error(answer?.reason||'原生翻译核心未接受请求');
     if(token!==latest.current)return;
     setTabId(tab.id);
     setStatus('已发送操作，以下方实际覆盖率为准，不代表所有段落均完成。');
   }catch(error){
     if(token===latest.current){
       const detail=String(error instanceof Error?error.message:error);
       const missingPermission=/Cannot access|Missing host permission|permission|permissions|未授权|没有访问权限|无法访问此页面/i.test(detail);
       setSiteAccessNeeded(missingPermission);
       setStatus(missingPermission?'当前网站尚未授权，请点击「允许当前网站翻译」后重试。':'操作失败：'+detail);
     }
   }finally{if(token===latest.current)setWorking(false);}
 }
 async function authorizeCurrentSite(){
   // The permission prompt must be initiated by a real user click.
   // Never request access to every site without an explicit user decision.
   try{
     const [tab]=await browser.tabs.query({active:true,currentWindow:true});
     if(!tab?.url || !/^https?:\/\//.test(tab.url))throw Error('无法识别当前网站地址');
     const url=new URL(tab.url);
     const granted=await browser.permissions.request({origins:[url.origin+'/*']});
     if(!granted){
       setStatus('未授予此网站权限；你仍可在浏览器工具栏正常启动扩展重试。');
       return;
     }
     setSiteAccessNeeded(false);
     setStatus('已授权 '+url.hostname+'，现在点击「翻译当前网页」即可。');
   }catch(error){
     setStatus('授权失败：'+String(error instanceof Error?error.message:error));
   }
 }
 return <div className="native-web">
   <div className="native-modes" role="group" aria-label="翻译模式">
     <button type="button" aria-pressed={mode==='standard'} onClick={()=>setMode('standard')}>常规翻译</button>
     <button type="button" aria-pressed={mode==='ai'} onClick={()=>setMode('ai')}>自选 AI 精译</button>
   </div>
   <div className="native-actions">
     <button type="button" disabled={working} onClick={()=>void run('PIT_START')}>翻译当前网页</button>
     <button type="button" disabled={working} onClick={()=>void run('PIT_CONTINUE')}>继续翻译</button>
     <button type="button" disabled={working} onClick={()=>void run('PIT_SELECTION')}>翻译选中内容</button>
     <button type="button" disabled={working} onClick={()=>void run('PIT_RESTORE')}>恢复原文</button>
     <button type="button" onClick={()=>void browser.runtime.openOptionsPage()}>配置翻译服务 / AI 模型</button>
     <button type="button" onClick={()=>void browser.tabs.create({url:browser.runtime.getURL('file-lab.html')})}>打开本地 DOCX / 图片 OCR 实验台</button>
   </div>
   {siteAccessNeeded&&<button type="button" className="grant-site" onClick={()=>void authorizeCurrentSite()}>允许当前网站翻译</button>}
   {progress&&<p role="status" className="native-progress">正文覆盖 {progress.translated}/{progress.eligible}
    （{progress.coveragePercent===null?'暂无':progress.coveragePercent+'%'}）；未处理 {progress.remaining}；
    成功批次 {progress.succeededBatches}，失败批次 {progress.failedBatches}
    {progress.busy?' · 处理中':''}{progress.lastError?' · '+progress.lastError:''}
   </p>}
   <p role="status" aria-live="polite" className="native-status">{status}</p>
   <p className="native-hint">本构建仅验证原生网页翻译接入。视频、图片、PDF 功能尚未迁入 WXT。</p>
 </div>;
}
