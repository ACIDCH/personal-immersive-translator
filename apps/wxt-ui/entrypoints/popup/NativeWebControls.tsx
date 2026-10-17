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
 const [captionFile,setCaptionFile]=useState<File|null>(null);
 const [captionBusy,setCaptionBusy]=useState(false);
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
 async function captions(action:'start'|'stop'){
   if(captionBusy)return;
   if(action==='start' && mode==='ai' &&
      !window.confirm('连续视频字幕将调用自选 AI，可能产生 API 费用。确认启动？'))return;
   setCaptionBusy(true);
   setStatus('正在检测可访问的视频及字幕…');
   try{
     const [tab]=await browser.tabs.query({active:true,currentWindow:true});
     if(!tab?.id||!/^https?:\/\//.test(tab.url||''))throw Error('请打开视频所在的普通网页');
     const tabId=tab.id;
     const sessionKey='pit_caption_frame_'+tabId;
     const former=await browser.storage.session.get(sessionKey);
     const prior=typeof former[sessionKey]==='number' ? former[sessionKey] as number : -1;
     if(action==='stop'){
       await browser.tabs.sendMessage(tabId,{type:'PIT_CAPTIONS_STOP'},{frameId:0}).catch(()=>{});
       if(Number.isInteger(prior)&&prior>0)
         await browser.tabs.sendMessage(tabId,{type:'PIT_CAPTIONS_STOP'},{frameId:prior}).catch(()=>{});
       await browser.storage.session.remove(sessionKey);
       setStatus('字幕观察已停止');
       return;
     }
     if(Number.isInteger(prior)&&prior>0)
       await browser.tabs.sendMessage(tabId,{type:'PIT_CAPTIONS_STOP'},{frameId:prior}).catch(()=>{});
     await browser.storage.session.remove(sessionKey);
     const scripts=['pit-caption-core.js','pit-platform-captions.js','pit-subtitles.js'];
     const target={tabId,frameIds:[0]};
     await browser.scripting.insertCSS({target,files:[rootCss]});
     await browser.scripting.executeScript({target,files:scripts as never});
     // The upstream file parser is intentionally used, not an unrelated parser.
     let cues:unknown[]|undefined;
     if(captionFile){
       if(captionFile.size>2_000_000)throw Error('字幕文件超过 2 MiB');
       await browser.scripting.executeScript({target:{tabId},files:['pit-subtitle-import.js' as never]});
       const raw=await captionFile.text();
       const parsed=await browser.scripting.executeScript({target,func:(source:string)=>{
         const parser=(globalThis as unknown as {PITSubtitleImport?:{parseSubtitles:(s:string)=>unknown[]}}).PITSubtitleImport;
         return parser?.parseSubtitles(source)||[];
       },args:[raw]});
       cues=parsed[0]?.result as unknown[];
       if(!cues?.length)throw Error('SRT/VTT 文件没有可用的时间轴');
     }
     let response=await browser.tabs.sendMessage(tabId,
       {type:'PIT_CAPTIONS_START',mode,cues},{frameId:0});
     if(!response?.ok&&!cues?.length){
       // For user-visible iframe players, only choose an exact HTTPS
       // YouTube/Panopto iframe whose URL matches Chrome navigation frames.
       const visible=await browser.scripting.executeScript({target,func:()=>{
         return [...document.querySelectorAll('iframe')].filter(el=>{
           const rect=el.getBoundingClientRect();
           return rect.width>=240&&rect.height>=120 &&getComputedStyle(el).visibility!=='hidden';
         }).map(el=>el.src).filter(Boolean).slice(0,20);
       }});
       const known=(visible[0]?.result||[]) as string[];
       const frames=await browser.webNavigation.getAllFrames({tabId});
       const allowed=(url:string)=>{try{
         const u=new URL(url);u.hash='';
         return u.protocol==='https:' &&
           (/(^|\.)(youtube\.com|youtube-nocookie\.com|panopto\.com|panopto\.eu)$/i.test(u.hostname))?
           u.href:null;
       }catch{return null;}};
       const matches=(frames||[]).filter(f=>f.frameId>0 &&
         known.some(url=>allowed(url)!==null&&allowed(url)===allowed(f.url)));
       if(matches.length!==1)throw Error(response?.reason||'找不到唯一且可见的受支持视频播放器；请在原视频网站打开播放页');
       const frame=matches[0];
       const embedded={tabId,frameIds:[frame.frameId]};
       await browser.scripting.insertCSS({target:embedded,files:[rootCss]});
       await browser.scripting.executeScript({target:embedded,files:scripts as never});
       response=await browser.tabs.sendMessage(tabId,
         {type:'PIT_CAPTIONS_START',mode,expectedUrl:allowed(frame.url)},{frameId:frame.frameId});
       if(response?.ok)await browser.storage.session.set({[sessionKey]:frame.frameId});
     }
     if(!response?.ok)throw Error(response?.reason||'当前播放器没有可读取字幕轨或可见原文字幕');
     setStatus(response.reason||'视频字幕翻译已开启');
   }catch(error){setStatus('字幕翻译失败：'+String(error instanceof Error?error.message:error));}
   finally{setCaptionBusy(false);}
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
     <button type="button" onClick={()=>void browser.tabs.create({url:browser.runtime.getURL('/file-lab.html')})}>打开本地 DOCX / 图片 OCR 实验台</button>
     <button type="button" onClick={()=>void browser.tabs.create({url:browser.runtime.getURL('pit-tools.html' as never)})}>打开 PDF / 高保真本机工具</button>
     <button type="button" disabled={captionBusy} onClick={()=>void captions('start')}>翻译视频字幕</button>
     <button type="button" disabled={captionBusy} onClick={()=>void captions('stop')}>停止字幕翻译</button>
     <label>可选：导入 SRT / VTT（限 2 MiB）
       <input type="file" accept=".srt,.vtt,text/vtt" onChange={event=>setCaptionFile(event.target.files?.[0]??null)}/>
     </label>
   </div>
   {siteAccessNeeded&&<button type="button" className="grant-site" onClick={()=>void authorizeCurrentSite()}>允许当前网站翻译</button>}
   {progress&&<p role="status" className="native-progress">正文覆盖 {progress.translated}/{progress.eligible}
    （{progress.coveragePercent===null?'暂无':progress.coveragePercent+'%'}）；未处理 {progress.remaining}；
    成功批次 {progress.succeededBatches}，失败批次 {progress.failedBatches}
    {progress.busy?' · 处理中':''}{progress.lastError?' · '+progress.lastError:''}
   </p>}
   <p role="status" aria-live="polite" className="native-status">{status}</p>
   <p className="native-hint">原生网页翻译、已获授权的字幕轨、DOCX 与图片 OCR 均可使用；字幕需视频提供可访问的原文轨或可见字幕，不能绕过 DRM。高保真 PDF 和复杂图像重绘仍需独立处理。</p>
 </div>;
}
