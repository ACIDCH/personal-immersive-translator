import {useRef,useState} from 'react';
import type {ChangeEvent} from 'react';
import type {OcrSelection,PdfTranslationMode} from './pdfBilingual';

type MessageResult={ok?:boolean;error?:string;translations?:string[];settings?:{cloudPdfEndpoint?:string;cloudPdfToken?:string;source?:string;target?:string}};
type BrowserRuntime={id?:string;sendMessage?:(arg:unknown)=>Promise<MessageResult>};
const getRuntime=():BrowserRuntime|undefined=>
 (globalThis as {chrome?:{runtime?:BrowserRuntime}}).chrome?.runtime;
export function PdfBilingualLab(){
 const runtime=getRuntime();
 const available=Boolean(runtime?.id&&runtime.sendMessage&&location.protocol==='chrome-extension:'&&
   location.pathname==='/file-lab.html');
 const [file,setFile]=useState<File|null>(null);
 const [ocrLang,setOcrLang]=useState<OcrSelection>('auto');
 // Cloud BabelDOC's auto detection is necessarily uncertain for short Latin
 // extracts and low-quality scans; the user must be able to override it.
 const [cloudSource,setCloudSource]=useState('auto');
 const [mode,setMode]=useState<PdfTranslationMode>('standard');
 const [busy,setBusy]=useState(false);
 const currentAbort=useRef<AbortController|null>(null);
 const [progress,setProgress]=useState('');
 const [status,setStatus]=useState('使用 PDF.js 提取文本；扫描页自动使用本机 Tesseract WASM。');
 if(!available)return null;
 const onSelect=(e:ChangeEvent<HTMLInputElement>)=>{
   setFile(e.target.files?.[0]||null);setProgress('');
 };
 async function runCloud(){
   if(!file||busy||!runtime?.sendMessage)return;
   const config=await runtime.sendMessage({type:'GET_SETTINGS'});
   const setting=config.settings||{};
   const secret=String(setting.cloudPdfToken||'');
   let url:URL;
   try{
     url=new URL(String(setting.cloudPdfEndpoint||''));
     if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)
       throw Error('bad endpoint');
   }catch{
     setStatus('云端 PDF 服务未配置。必须先部署 BabelDOC 云容器并在插件设置填写 HTTPS 地址。');
     return;
   }
   if(secret.length<16){
     setStatus('未配置 PDF 云端访问令牌；请先打开插件设置。');
     return;
   }
   if(file.size>25*1024*1024){
     setStatus('云端单个 PDF 上限 25 MiB，请选择更小文件或分卷。');
     return;
   }
   if(cloudSource!=='auto' && cloudSource===setting.target){
     setStatus('云端 PDF 原文语言与目标语言相同，请先更改其中一项。');
     return;
   }
   if(!window.confirm('将上传选中的 PDF 到你配置的独立云端 BabelDOC 服务，并调用该云端配置的翻译模型。云服务及 AI 可能产生费用。确认继续？'))return;
   const controller=new AbortController();currentAbort.current=controller;
   setBusy(true);setStatus('正在验证云端 BabelDOC 引擎状态（不会上传文件）…');
   try{
     const healthUrl=new URL(url.toString());
     healthUrl.pathname=healthUrl.pathname.replace(/\/$/,'')+'/health';
     const preflight=await fetch(healthUrl.toString(),{
       method:'GET',headers:{Authorization:'Bearer '+secret},
       signal:AbortSignal.any([controller.signal,AbortSignal.timeout(8000)])
     });
     if(!preflight.ok)throw Error('云端 PDF 健康检查 HTTP '+preflight.status+
       '；请检查 HTTPS 地址、访问令牌和服务部署');
     const health=await preflight.json();
     if(health?.ready!==true)
       throw Error('云端 BabelDOC 服务尚未就绪（CLI 或模型凭据未配置），文件未上传。');
     if(typeof health.max_file_bytes==='number' && file.size>health.max_file_bytes)
       throw Error('文件超过云端服务允许的大小，文件未上传。');
     setStatus('云端环境预检通过；正在上传 PDF…');
     const body=new FormData();
     body.set('pdf',file,file.name);
     body.set('source',cloudSource);
     body.set('target',setting.target||'zh');
     body.set('ocr','true');
     const authHeaders={Authorization:'Bearer '+secret};
     let response:Response;
     let detectedFromJob='';
     let confidenceFromJob='';
     if(health.async_jobs===true){
       // A long academic paper cannot depend on one open HTTP request.
       // This is only an in-memory single-container queue; server restarts
       // invalidate IDs and users must upload again.
       const jobsUrl=new URL(url.toString());
       jobsUrl.pathname=jobsUrl.pathname.replace(/\/$/,'')+'/v1/pdf/jobs';
       const submitted=await fetch(jobsUrl.toString(),{
         method:'POST',headers:authHeaders,body,signal:controller.signal
       });
       if(submitted.status!==202)
         throw Error('云端文档任务提交失败 HTTP '+submitted.status);
       const initial=await submitted.json();
       const jobId=String(initial?.jobId||'');
       if(!/^[A-Za-z0-9_-]{16,80}$/.test(jobId))
         throw Error('云端未返回有效文档任务 ID');
       const stateUrl=new URL(jobsUrl.toString());
       stateUrl.pathname+='/'+jobId;
       let complete=false;
       for(let attempt=0;attempt<600;attempt++){
         if(controller.signal.aborted)throw Error('已停止等待云端 PDF');
         const stateResponse=await fetch(stateUrl.toString(),{
           method:'GET',headers:authHeaders,
           signal:AbortSignal.any([controller.signal,AbortSignal.timeout(10000)])
         });
         if(!stateResponse.ok)
           throw Error('文档任务状态查询失败 HTTP '+stateResponse.status+
             '，任务可能已经过期或服务已重启');
         const state=await stateResponse.json();
         if(state?.jobId!==jobId ||
            !['queued','running','completed','failed'].includes(state?.status))
           throw Error('云端返回了不可信的任务状态');
         detectedFromJob=String(state.detectedSource||'');
         confidenceFromJob=String(state.detectionConfidence||'');
         if(state.status==='failed')throw Error('BabelDOC 服务端处理失败，请检查部署和模型设置');
         if(state.status==='completed'){complete=true;break;}
         setStatus('云端文档任务'+(state.status==='running'?'正在排版翻译':'正在排队')+
           '；任务号 '+jobId.slice(0,8)+'…（服务重启可能丢失任务）');
         await new Promise<void>((resolve,reject)=>{
           const onAbort=()=>{clearTimeout(timer);reject(Error('已停止等待云端 PDF'));};
           const timer=setTimeout(()=>{
             controller.signal.removeEventListener('abort',onAbort);resolve();
           },1800);
           controller.signal.addEventListener('abort',onAbort,{once:true});
         });
       }
       if(!complete)throw Error('云端文档处理超过 18 分钟，请核查服务器任务状态');
       const resultUrl=new URL(stateUrl.toString());
       resultUrl.pathname+='/result';
       response=await fetch(resultUrl.toString(),{
         method:'GET',headers:authHeaders,signal:controller.signal
       });
     }else{
       // Backward compatible with owners running older PDF containers.
       url.pathname=url.pathname.replace(/\/$/,'')+'/v1/pdf/translate';
       response=await fetch(url.toString(),{
         method:'POST',headers:authHeaders,body,signal:controller.signal
       });
     }
     if(!response.ok)throw Error('云端高保真 PDF HTTP '+response.status+
       '；请检查部署、语言识别、BabelDOC 和 AI 服务额度');
     const blob=await response.blob();
     // A proxy/server error body may be 200 with a PDF MIME type. Validate
     // at least the real PDF signature before creating a user download.
     const pdfHeader=await blob.slice(0,5).text();
     if(blob.type.split(';')[0].trim()!=='application/pdf'||
        blob.size<100||pdfHeader!=='%PDF-')
       throw Error('云端服务没有返回有效的 PDF 文件，已阻止下载。');
     const objectUrl=URL.createObjectURL(blob);
     const a=document.createElement('a');
     a.href=objectUrl;a.download=file.name.replace(/\.pdf$/i,'')+'-babeldoc.pdf';
     document.body.append(a);a.click();a.remove();
     setTimeout(()=>URL.revokeObjectURL(objectUrl),60000);
     const detected=response.headers.get('X-PIT-Detected-Source')||detectedFromJob||'unknown';
     const confidence=response.headers.get('X-PIT-Detection-Confidence')||confidenceFromJob||'unreported';
     setStatus('已下载 BabelDOC PDF；原文语言：'+detected+
       '（依据：'+confidence+'）。请检查双栏、公式、表格和字体排版，不能仅凭下载成功判断质量。');
   }catch(error){
     setStatus(controller.signal.aborted
       ?'已停止等待云端 PDF；服务端任务可能仍在执行并产生费用。当前任务为临时内存任务，尚无跨重启恢复。'
       :'云端 PDF 任务失败：'+String(error instanceof Error?error.message:error));
   }finally{currentAbort.current=null;setBusy(false);}
 }
 async function run(){
   if(!file||busy||!runtime?.sendMessage)return;
   if(mode==='ai'&&!confirm('将把提取的 PDF 文字发送给所选 AI 模型，可能产生费用。确认？'))return;
   const controller=new AbortController();currentAbort.current=controller;
   setBusy(true);setStatus('正在处理 PDF…');
   try{
     const {translateBilingualPdf}=await import('./pdfBilingual');
     const {createRecoverableTranslator}=await import('./translationRecovery');
     const translate=createRecoverableTranslator(async texts=>{
       const response=await runtime.sendMessage!({
         type:'TRANSLATE_DOCUMENT',texts,mode,userInitiated:true
       });
       if(!response.ok||!Array.isArray(response.translations))
         throw Error(response.error||'PDF 翻译服务未返回译文');
       return response.translations;
     },{signal:controller.signal,onRetry:info=>setProgress('PDF 翻译暂时限流/超时，重试 '+info.attempt+' 次')});
     const result=await translateBilingualPdf(file,translate,ocrLang,(done,total,stage)=>setProgress(`${done}/${total} 页 · ${stage}`),controller.signal);
     if(controller.signal.aborted)throw Error('用户已取消 PDF 翻译');
     const payload=result.archive||result.pdf;
     if(!payload)throw Error('PDF 输出为空');
     const copy=new Uint8Array(payload.byteLength);copy.set(payload);
     const isZip=Boolean(result.archive);
     const url=URL.createObjectURL(new Blob([copy],{type:isZip?'application/zip':'application/pdf'}));
     const a=document.createElement('a');
     a.href=url;a.download=file.name.replace(/\.pdf$/i,'')+(isZip?'-bilingual-parts.zip':'-bilingual.pdf');
     document.body.append(a);a.click();a.remove();
     setTimeout(()=>URL.revokeObjectURL(url),60000);
     setStatus('处理 '+result.pages+' 页，OCR '+result.ocrPages+' 页，共 '+result.parts+
       ' 份输出。超过 12 页自动分卷 ZIP；原版文字层不保留。');
   }catch(error){
     setStatus('PDF 处理失败：'+String(error instanceof Error?error.message:error));
   }finally{currentAbort.current=null;setBusy(false);}
 }
 return <section className="document-lab pdf-bilingual-lab">
   <h2>浏览器内 PDF / 扫描件双语翻译</h2>
   <p>不用安装 Python 即可处理小型 PDF。原页面与译文并排，扫描件自动 OCR；支持最多 300 页、48 MiB；超过 12 页生成多份双语 PDF 的 ZIP。OCR 支持自动多语种识别；本模式仍是栅格导出，复杂论文需要尚未上线的云端高保真引擎。</p>
   <label className="document-field">选择 PDF 文件
     <input type="file" accept="application/pdf,.pdf" onChange={onSelect}/>
   </label>
   <label className="document-field">扫描页识别语言
     <select value={ocrLang} onChange={e=>setOcrLang(e.target.value as OcrSelection)}>
       <option value="auto">自动识别（英法日韩中 OCR）</option><option value="eng">英语</option><option value="fra">法语</option>
       <option value="chi_sim">简体中文</option><option value="jpn">日语</option>
       <option value="kor">韩语</option>
     </select>
   </label>
   <label className="document-field">云端 BabelDOC 原文语言
     <select aria-label="云端 PDF 原文语言" value={cloudSource}
       onChange={e=>setCloudSource(e.target.value)}>
       <option value="auto">自动识别（短文字/扫描件可能误判）</option>
       <option value="en">English</option><option value="fr">Français</option>
       <option value="de">Deutsch</option><option value="es">Español</option>
       <option value="zh">中文</option><option value="ja">日本語</option>
       <option value="ko">한국어</option>
     </select>
   </label>
   <div className="native-modes" role="group" aria-label="PDF 翻译服务">
     <button type="button" aria-pressed={mode==='standard'} onClick={()=>setMode('standard')}>常规翻译</button>
     <button type="button" aria-pressed={mode==='ai'} onClick={()=>setMode('ai')}>自选 AI 精译</button>
   </div>
   <button type="button" disabled={!file||busy} onClick={()=>void runCloud()}>
     云端高保真 BabelDOC（需部署并配置）
   </button>
   <button type="button" disabled={!file||busy} onClick={()=>void run()}>
     {busy?'正在处理…':'翻译并导出双语 PDF'}
   </button>
   {busy&&<button type="button" onClick={()=>{currentAbort.current?.abort();setStatus('取消请求已提交，当前 OCR / API 操作结束后停止。');}}>取消 PDF 处理</button>}
   {progress&&<p role="status">{progress}</p>}
   <p aria-live="polite">{status}</p>
 </section>;
}
