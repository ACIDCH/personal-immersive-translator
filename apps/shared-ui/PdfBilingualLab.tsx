import {useRef,useState} from 'react';
import type {ChangeEvent} from 'react';
import type {PdfOcrLanguage,PdfTranslationMode} from './pdfBilingual';

type MessageResult={ok?:boolean;error?:string;translations?:string[]};
type BrowserRuntime={id?:string;sendMessage?:(arg:unknown)=>Promise<MessageResult>};
const getRuntime=():BrowserRuntime|undefined=>
 (globalThis as {chrome?:{runtime?:BrowserRuntime}}).chrome?.runtime;
export function PdfBilingualLab(){
 const runtime=getRuntime();
 const available=Boolean(runtime?.id&&runtime.sendMessage&&location.protocol==='chrome-extension:'&&
   location.pathname==='/file-lab.html');
 const [file,setFile]=useState<File|null>(null);
 const [ocrLang,setOcrLang]=useState<PdfOcrLanguage>('eng');
 const [mode,setMode]=useState<PdfTranslationMode>('standard');
 const [busy,setBusy]=useState(false);
 const currentAbort=useRef<AbortController|null>(null);
 const [progress,setProgress]=useState('');
 const [status,setStatus]=useState('使用 PDF.js 提取文本；扫描页自动使用本机 Tesseract WASM。');
 if(!available)return null;
 const onSelect=(e:ChangeEvent<HTMLInputElement>)=>{
   setFile(e.target.files?.[0]||null);setProgress('');
 };
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
     const copy=new Uint8Array(result.pdf.byteLength);copy.set(result.pdf);
     const url=URL.createObjectURL(new Blob([copy],{type:'application/pdf'}));
     const a=document.createElement('a');
     a.href=url;a.download=file.name.replace(/\.pdf$/i,'')+'-bilingual.pdf';
     document.body.append(a);a.click();a.remove();
     setTimeout(()=>URL.revokeObjectURL(url),60000);
     setStatus('生成双语 PDF 共 '+result.pages+' 页，使用 OCR '+result.ocrPages+
       ' 页。原页视觉保留，译文排在右侧；输出为栅格页面而非可编辑原版。');
   }catch(error){
     setStatus('PDF 处理失败：'+String(error instanceof Error?error.message:error));
   }finally{currentAbort.current=null;setBusy(false);}
 }
 return <section className="document-lab pdf-bilingual-lab">
   <h2>浏览器内 PDF / 扫描件双语翻译</h2>
   <p>不用安装 Python 即可处理小型 PDF。原页面与译文并排，扫描件自动 OCR；每次最多 8 页、16 MiB。论文公式排版需要保真的情况请改用本机 BabelDOC。</p>
   <label className="document-field">选择 PDF 文件
     <input type="file" accept="application/pdf,.pdf" onChange={onSelect}/>
   </label>
   <label className="document-field">扫描页识别语言
     <select value={ocrLang} onChange={e=>setOcrLang(e.target.value as PdfOcrLanguage)}>
       <option value="eng">英语</option><option value="fra">法语</option>
       <option value="chi_sim">简体中文</option><option value="jpn">日语</option>
       <option value="kor">韩语</option>
     </select>
   </label>
   <div className="native-modes" role="group" aria-label="PDF 翻译服务">
     <button type="button" aria-pressed={mode==='standard'} onClick={()=>setMode('standard')}>常规翻译</button>
     <button type="button" aria-pressed={mode==='ai'} onClick={()=>setMode('ai')}>自选 AI 精译</button>
   </div>
   <button type="button" disabled={!file||busy} onClick={()=>void run()}>
     {busy?'正在处理…':'翻译并导出双语 PDF'}
   </button>
   {busy&&<button type="button" onClick={()=>{currentAbort.current?.abort();setStatus('取消请求已提交，当前 OCR / API 操作结束后停止。');}}>取消 PDF 处理</button>}
   {progress&&<p role="status">{progress}</p>}
   <p aria-live="polite">{status}</p>
 </section>;
}
