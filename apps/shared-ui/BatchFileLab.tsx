import {useState} from 'react';
import type {ChangeEvent} from 'react';
import JSZip from 'jszip';
import {bilingualImagePng,splitOcrLines} from './imageTranslate';

type Mode='standard'|'ai';
type Lang='eng'|'fra'|'chi_sim'|'jpn'|'kor';
const MAX_FILES=8,MAX_FILE=12*1024*1024,MAX_BATCH=48*1024*1024;
const accepted=/\.(docx|pptx|xlsx|png|jpe?g|webp|bmp)$/i;
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
 const [lang,setLang]=useState<Lang>('eng');
 const [busy,setBusy]=useState(false);
 const [progress,setProgress]=useState('');
 const [status,setStatus]=useState('一次最多 8 个文件，合计不超过 48 MiB，单个不超过 12 MiB。');
 if(!available)return null;
 const handle=(event:ChangeEvent<HTMLInputElement>)=>{
   const files=Array.from(event.target.files||[]);
   const total=files.reduce((sum,file)=>sum+file.size,0);
   if(!files.length){setItems([]);setStatus('请选择文件');return;}
   if(files.length>MAX_FILES||total>MAX_BATCH||files.some(f=>!accepted.test(f.name)||f.size>MAX_FILE)){
     setItems([]);
     setStatus('文件数量、类型或大小超出上限；PDF 请使用独立高保真工具。');
   }else{
     setItems(files);setStatus('已选择 '+files.length+' 个文件。');
   }
 };
 async function runBatch(){
   if(busy||!items.length||!runtime?.sendMessage)return;
   if(mode==='ai'&&!window.confirm('批量调用你配置的 AI 翻译服务，可能产生费用。确认开始吗？'))return;
   setBusy(true);setStatus('正在处理文件，请勿关闭此页面');
   let completed=0;
   let ocrWorker:Awaited<ReturnType<(typeof import('tesseract.js'))['createWorker']>>|null=null;
   try{
     const out=new JSZip();
     const translate=async (texts:string[]):Promise<string[]>=>{
       const response=await runtime.sendMessage!({
         type:'TRANSLATE_DOCUMENT',texts,mode,userInitiated:true
       });
       if(!response?.ok||!Array.isArray(response.translations)||
          response.translations.length!==texts.length||
          response.translations.some(s=>typeof s!=='string'||!s.trim()))
         throw Error(response?.error||'翻译服务返回了无效的分段数据');
       return response.translations;
     };
     for(const [i,file] of items.entries()){
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
       }else{
         if(!ocrWorker){
           const {createWorker}=await import('tesseract.js');
           const paths=runtime.getURL?{
             workerPath:runtime.getURL('tesseract/worker.min.js'),
             corePath:runtime.getURL('tesseract/core'),workerBlobURL:false
           }:undefined;
           ocrWorker=await createWorker(lang,1,paths);
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
     const archive=await out.generateAsync({type:'uint8array',compression:'DEFLATE'});
     downloadZip(archive);
     setStatus('已完成 '+completed+' 个文件并生成 ZIP。原文件仅在浏览器内读取；识别后的文字会发给所选翻译服务。');
   }catch(error){
     setStatus('批处理停止于第 '+(completed+1)+' 个文件：'+friendly(error)+'。没有输出不完整的 ZIP。');
   }finally{
     if(ocrWorker)await ocrWorker.terminate().catch(()=>{});
     setBusy(false);
   }
 }
 return <section className="document-lab batch-file-lab">
   <h2>批量多格式翻译</h2>
   <p>同时选择 DOCX、PPTX、XLSX 或图片；逐个解析并翻译，一次下载 ZIP。需要高保真 PDF 时请使用独立 PDF 工具。</p>
   <label className="document-field">选择文件（最多 8 个）
     <input type="file" multiple accept=".docx,.pptx,.xlsx,image/png,image/jpeg,image/webp,image/bmp" onChange={handle}/>
   </label>
   <div className="native-modes" role="group" aria-label="批量翻译服务">
     <button type="button" aria-pressed={mode==='standard'} onClick={()=>setMode('standard')}>常规翻译</button>
     <button type="button" aria-pressed={mode==='ai'} onClick={()=>setMode('ai')}>自选 AI</button>
   </div>
   <label className="document-field">批量图片的 OCR 语言
     <select value={lang} onChange={e=>setLang(e.target.value as Lang)}>
       <option value="eng">英语</option><option value="fra">法语</option>
       <option value="chi_sim">简体中文</option><option value="jpn">日语</option>
       <option value="kor">韩语</option>
     </select>
   </label>
   <button type="button" disabled={busy||items.length===0} onClick={()=>void runBatch()}>
     {busy?'批量处理中…':'翻译全部并打包 ZIP'}
   </button>
   {items.length>0&&<p>待处理：{items.map(x=>x.name).join('、')}</p>}
   {progress&&<p role="status">{progress}</p>}
   <p aria-live="polite">{status}</p>
 </section>;
}
