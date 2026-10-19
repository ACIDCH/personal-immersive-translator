import {useRef,useState} from 'react';
import type {ChangeEvent,DragEvent} from 'react';
import JSZip from 'jszip';
import {bilingualImagePng,splitOcrLines} from './imageTranslate';

type Mode='standard'|'ai';
type Lang='auto'|'eng'|'fra'|'chi_sim'|'jpn'|'kor';
const MAX_FILES=20,MAX_FILE=48*1024*1024,MAX_BATCH=160*1024*1024;
const accepted=/\.(docx|pptx|xlsx|epub|txt|md|html?|pdf|srt|vtt|ass|png|jpe?g|webp|bmp)$/i;
type ChromeRuntime={
 id?:string;
 getURL?:(name:string)=>string;
 sendMessage?:(m:unknown)=>Promise<{ok?:boolean;error?:string;translations?:string[]}>;
};
function extensionRuntime():ChromeRuntime|undefined{
 return (globalThis as {chrome?:{runtime?:ChromeRuntime}}).chrome?.runtime;
}
function friendly(error:unknown){return error instanceof Error?error.message:String(error);}
function downloadZip(bytes:Uint8Array){
 const copy=new Uint8Array(bytes.length);copy.set(bytes);
 const url=URL.createObjectURL(new Blob([copy],{type:'application/zip'}));
 const a=document.createElement('a');
 a.href=url;a.download='multimodal-translated-batch.zip';document.body.append(a);a.click();a.remove();
 setTimeout(()=>URL.revokeObjectURL(url),60000);
}
export function BatchFileLab(){
 const runtime=extensionRuntime();
 const available=Boolean(runtime?.id&&runtime?.sendMessage&&
   location.protocol==='chrome-extension:'&&location.pathname==='/file-lab.html');
 const [items,setItems]=useState<File[]>([]);
 const [mode,setMode]=useState<Mode>('standard');
 const [lang,setLang]=useState<Lang>('auto');
 const [busy,setBusy]=useState(false);
 const currentAbort=useRef<AbortController|null>(null);
 const [progress,setProgress]=useState('');
 const [status,setStatus]=useState('一次最多 20 个文件，合计 160 MiB，单个 48 MiB。');
 if(!available)return null;
 const acceptFiles=(files:File[])=>{
   const total=files.reduce((sum,file)=>sum+file.size,0);
   if(!files.length){setItems([]);setStatus('请选择文件');return;}
   if(files.length>MAX_FILES||total>MAX_BATCH||files.some(f=>!accepted.test(f.name)||f.size>MAX_FILE)){
     setItems([]);
     setStatus('文件数量、类型或大小超出上限。PDF 最多 300 页，长文档会分卷。');
   }else{
     setItems(files);setStatus('已选择 '+files.length+' 个文件。');
   }
 };
 const handle=(event:ChangeEvent<HTMLInputElement>)=>acceptFiles(Array.from(event.target.files||[]));
 const onDrop=(event:DragEvent<HTMLDivElement>)=>{
   event.preventDefault();
   acceptFiles(Array.from(event.dataTransfer.files||[]));
 };
 async function runBatch(){
   if(busy||!items.length||!runtime?.sendMessage)return;
   if(mode==='ai'&&!window.confirm('批量调用你配置的 AI 翻译服务，可能产生费用。确认开始吗？'))return;
   const controller=new AbortController();currentAbort.current=controller;
   setBusy(true);setStatus('正在处理文件，请勿关闭此页面');
   let completed=0;
   let ocrWorker:Awaited<ReturnType<(typeof import('tesseract.js'))['createWorker']>>|null=null;
   try{
     const out=new JSZip();
     const {createRecoverableTranslator}=await import('./translationRecovery');
     const translate=createRecoverableTranslator(async (texts:string[]):Promise<string[]>=>{
       const response=await runtime.sendMessage!({
         type:'TRANSLATE_DOCUMENT',texts,mode,userInitiated:true
       });
       if(!response?.ok||!Array.isArray(response.translations)||
          response.translations.length!==texts.length||
          response.translations.some(s=>typeof s!=='string'||!s.trim()))
         throw Error(response?.error||'翻译服务返回了无效的分段数据');
       return response.translations;
     },{signal:controller.signal,maxRetries:mode==='ai'?0:2,onRetry:info=>setProgress('批量翻译暂时受限，重试 '+info.attempt+' 次')});
     for(const [i,file] of items.entries()){
       if(controller.signal.aborted)throw Error('用户已取消翻译');
       const type=file.name.split('.').at(-1)!.toLowerCase();
       const original=file.name.replace(/[^a-zA-Z0-9.\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af_-]/g,'_');
       const base=original.replace(/\.[^.]+$/,'');
       let result:Uint8Array;
       let ext=type;
       setProgress('文件 '+(i+1)+'/'+items.length+'：'+original);
       if(type==='docx'){
         const {translateDocx}=await import('./docxTranslate');
         result=await translateDocx(await file.arrayBuffer(),translate,(done,total)=>
           setProgress('文件 '+(i+1)+'/'+items.length+'：DOCX '+done+'/'+total+' 段'));
       }else if(type==='pptx'||type==='xlsx'){
         const {translateOffice}=await import('./officeTranslate');
         result=await translateOffice(await file.arrayBuffer(),type,translate,(done,total)=>
           setProgress('文件 '+(i+1)+'/'+items.length+'：Office '+done+'/'+total+' 段'));
       }else if(type==='pdf'){
         const {translateBilingualPdf}=await import('./pdfBilingual');
         const output=await translateBilingualPdf(file,translate,lang,(done,total,stage)=>
           setProgress('文件 '+(i+1)+'/'+items.length+'：PDF '+done+'/'+total+' 页 · '+stage),controller.signal);
         result=output.archive||output.pdf||new Uint8Array();
         if(!result.byteLength)throw Error('PDF 输出为空');
         ext=output.archive?'zip':'pdf';
       }else if(['srt','vtt','ass'].includes(type)){
         // Reuse the same tested ASS/SRT/VTT parsing and bilingual SRT
         // serializer as the standalone subtitle file lab.
         const {parseSubtitleFile,formatBilingualSrt}=await import('./subtitleExport');
         const cues=parseSubtitleFile(await file.text());
         const translated:string[]=[];
         for(let j=0;j<cues.length;){
           if(controller.signal.aborted)throw Error('用户已取消字幕翻译');
           const chunk:typeof cues=[];let chars=0;
           for(let k=j;k<cues.length&&chunk.length<8;k++){
             if(chunk.length&&chars+cues[k].text.length>10500)break;
             chunk.push(cues[k]);chars+=cues[k].text.length;
           }
           translated.push(...await translate(chunk.map(c=>c.text)));
           j+=chunk.length;
           setProgress('文件 '+(i+1)+'/'+items.length+'：字幕 '+j+'/'+cues.length+' 条');
         }
         result=new TextEncoder().encode(formatBilingualSrt(cues,translated));
         ext='srt';
       }else if(['epub','txt','md','html','htm'].includes(type)){
         const {translatePortable}=await import('./portableDocumentTranslate');
         result=await translatePortable(await file.arrayBuffer(),type as 'epub'|'txt'|'md'|'html'|'htm',translate,(done,total)=>
           setProgress('文件 '+(i+1)+'/'+items.length+'：'+type.toUpperCase()+' '+done+'/'+total+' 段'));
       }else{
         if(!ocrWorker){
           const {createWorker}=await import('tesseract.js');
           const paths=runtime.getURL?{
             workerPath:runtime.getURL('tesseract/worker.min.js'),
             corePath:runtime.getURL('tesseract/core'),workerBlobURL:false
           }:undefined;
           ocrWorker=await createWorker(lang==='auto'
             ? ['eng','fra','chi_sim','jpn','kor']:lang,1,paths);
         }
         const ocr=await ocrWorker.recognize(file);
         const lines=splitOcrLines(ocr.data.text.trim());
         if(!lines.length)throw Error(original+' 未检测到可翻译文字');
         const translated:string[]=[];
         for(let j=0;j<lines.length;j+=8)
           translated.push(...await translate(lines.slice(j,j+8)));
         const blob=await bilingualImagePng(file,ocr.data.text,translated);
         result=new Uint8Array(await blob.arrayBuffer());
         ext='png';
       }
       out.file('translated/'+String(i+1).padStart(2,'0')+'-'+base+'-translated.'+ext,result);
       completed++;setProgress('已处理 '+completed+'/'+items.length+' 个文件');
     }
     if(controller.signal.aborted)throw Error('用户已取消翻译');
     const archive=await out.generateAsync({type:'uint8array',compression:'DEFLATE'});
     if(controller.signal.aborted)throw Error('用户已取消翻译');
     downloadZip(archive);
     setStatus('已完成 '+completed+' 个文件并生成 ZIP。原文件仅在浏览器内读取；识别后的文字会发给所选翻译服务。');
   }catch(error){
     setStatus('批处理停止于第 '+(completed+1)+' 个文件：'+friendly(error)+'。没有输出不完整的 ZIP。');
   }finally{
     if(ocrWorker)await ocrWorker.terminate().catch(()=>{});
     currentAbort.current=null;
     setBusy(false);
   }
 }
 return <section className="document-lab batch-file-lab">
   <h2>批量多格式翻译</h2>
   <p>支持 DOCX、PPTX、XLSX、EPUB、TXT、Markdown、HTML、SRT/VTT/ASS 字幕、图片及 PDF 批量输入和 ZIP 下载。PDF 最高 300 页、48 MiB，超过 12 页分卷输出；自动多语言 OCR；复杂 PDF 高保真云端引擎尚未上线。</p>
   <div className="document-drop" role="group" aria-label="选择或拖入批量文件"
        onDragOver={event=>event.preventDefault()} onDrop={onDrop}>
     <label className="document-field">选择文件（最多 20 个），或把文件拖入此区域
       <input type="file" multiple accept=".docx,.pptx,.xlsx,.epub,.txt,.md,.html,.htm,.pdf,.srt,.vtt,.ass,image/png,image/jpeg,image/webp,image/bmp" onChange={handle}/>
     </label>
   </div>
   <div className="native-modes" role="group" aria-label="批量翻译服务">
     <button type="button" aria-pressed={mode==='standard'} onClick={()=>setMode('standard')}>常规翻译</button>
     <button type="button" aria-pressed={mode==='ai'} onClick={()=>setMode('ai')}>自选 AI</button>
   </div>
   <label className="document-field">批量图片的 OCR 语言
     <select value={lang} onChange={e=>setLang(e.target.value as Lang)}>
       <option value="auto">自动识别（多语种 OCR）</option><option value="eng">英语</option><option value="fra">法语</option>
       <option value="chi_sim">简体中文</option><option value="jpn">日语</option>
       <option value="kor">韩语</option>
     </select>
   </label>
   <button type="button" disabled={busy||items.length===0} onClick={()=>void runBatch()}>
     {busy?'批量处理中…':'翻译全部并打包 ZIP'}
   </button>
   {busy&&<button type="button" onClick={()=>{currentAbort.current?.abort();setStatus('取消请求已发出，当前操作结束后停止。');}}>取消批量处理</button>}
   {items.length>0&&<p>待处理：{items.map(x=>x.name).join('、')}</p>}
   {progress&&<p role="status">{progress}</p>}
   <p aria-live="polite">{status}</p>
 </section>;
}
