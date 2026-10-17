import {useState} from 'react';
import type {ChangeEvent} from 'react';

const MAX_BYTES=12*1024*1024;
type Engine='docx'|'ocr';
type OCRLanguage='eng'|'fra'|'jpn'|'kor'|'chi_sim';
type TranslationMode='standard'|'ai';
type Runtime={id?:string;getURL?:(path:string)=>string;sendMessage?:(message:unknown)=>Promise<{
  ok?:boolean;error?:string;translations?:string[];
}>};
const languages:Record<OCRLanguage,string>={
  eng:'English',fra:'Français',jpn:'日本語',kor:'한국어',chi_sim:'简体中文'
};
function currentRuntime():Runtime|undefined{
  return (globalThis as {chrome?:{runtime?:Runtime}}).chrome?.runtime;
}
function formatError(e:unknown):string{return e instanceof Error?e.message:String(e);}
function downloadFile(bytes:Uint8Array,name:string){
  // A browser-generated Blob never uploads the input document.
  const copy=new Uint8Array(bytes.byteLength);copy.set(bytes);
  const blob=new Blob([copy],{type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'});
  const url=URL.createObjectURL(blob);
  const anchor=document.createElement('a');
  anchor.href=url;anchor.download=name;anchor.style.display='none';document.body.append(anchor);
  anchor.click();anchor.remove();
  setTimeout(()=>URL.revokeObjectURL(url),60000);
}
export function DocumentLab(){
  const [mode,setMode]=useState<Engine>('docx');
  const [file,setFile]=useState<File|null>(null);
  const [language,setLanguage]=useState<OCRLanguage>('eng');
  const [text,setText]=useState('');
  const [message,setMessage]=useState('文件仅在当前浏览器读取；翻译前需自行选择服务。');
  const [busy,setBusy]=useState(false);
  const [translationMode,setTranslationMode]=useState<TranslationMode>('standard');
  const [progress,setProgress]=useState('');
  const runtime=currentRuntime();
  const extensionFileLab=Boolean(runtime?.id&&location.protocol==='chrome-extension:'&&
    location.pathname==='/file-lab.html');
  function onSelect(event:ChangeEvent<HTMLInputElement>){
    const selected=event.target.files?.[0]??null;
    setFile(selected);setText('');setProgress('');
    if(selected&&selected.size>MAX_BYTES)setMessage('文件超过 12 MiB 限制');
    else setMessage(selected?'已选择文件，等待你点击开始处理':'请选择文件');
  }
  async function process(){
    if(!file||busy)return;
    if(file.size>MAX_BYTES)return setMessage('文件过大（最多 12 MiB）');
    if(mode==='docx'&&!/\.docx$/i.test(file.name))return setMessage('请选择 DOCX 文档');
    if(mode==='ocr'&&!/\.(png|jpe?g|webp|bmp)$/i.test(file.name))return setMessage('请选择 PNG/JPG/WEBP/BMP 图片');
    setBusy(true);setText('');setMessage('正在本地处理文件…');
    try{
      if(mode==='docx'){
        const mammoth=await import('mammoth/mammoth.browser');
        const result=await mammoth.extractRawText({arrayBuffer:await file.arrayBuffer()});
        const extracted=result.value.trim();
        setText(extracted);
        setMessage(extracted?'DOCX 正文已提取。':'没有提取到可识别的 DOCX 正文。');
      }else{
        const {createWorker}=await import('tesseract.js');
        const localPaths=runtime?.id&&runtime.getURL?{
          workerPath:runtime.getURL('tesseract/worker.min.js'),
          corePath:runtime.getURL('tesseract/core'),
          workerBlobURL:false
        }:undefined;
        const worker=await createWorker(language,1,localPaths);
        try{
          const result=await worker.recognize(file);
          setText(result.data.text.trim());
          setMessage('OCR 本地识别结束。尚未执行翻译或图片修补。');
        }finally{await worker.terminate();}
      }
    }catch(e){setMessage('处理失败：'+formatError(e));}
    finally{setBusy(false);}
  }
  async function translateAndExport(){
    if(!file||!extensionFileLab||!runtime?.sendMessage||busy||mode!=='docx')return;
    if(translationMode==='ai'&&!confirm('将使用你选择的 AI 模型翻译 DOCX，可能产生 API 费用。确认开始吗？'))return;
    setBusy(true);setProgress('准备 DOCX 翻译…');setMessage('翻译由你配置的服务处理；内容将发送给所选服务商。');
    try{
      const {translateDocx}=await import('./docxTranslate');
      const result=await translateDocx(await file.arrayBuffer(),async texts=>{
        const response=await runtime.sendMessage!({
          type:'TRANSLATE_DOCUMENT',texts,mode:translationMode,userInitiated:true
        });
        if(!response?.ok||!Array.isArray(response.translations))
          throw Error(response?.error||'翻译后台没有返回有效结果');
        return response.translations;
      },(done,total)=>setProgress('翻译进度 '+done+'/'+total+' 段'));
      const base=file.name.replace(/\.docx$/i,'');
      downloadFile(result,base+'-translated.docx');
      setMessage('译文 DOCX 已生成。保留表格、图像和文档结构，但段落内混合字体、复杂排版可能改变；请核对导出文件。');
    }catch(e){setMessage('DOCX 翻译未完成：'+formatError(e));}
    finally{setBusy(false);}
  }
  return <section className="document-lab">
    <h2>文件与图片处理</h2>
    <p>DOCX 内容提取、初步结构保留翻译导出、图片 WASM OCR。复杂学术 PDF 高保真排版属于独立处理模块。</p>
    <div className="native-modes">
      <button type="button" aria-pressed={mode==='docx'} onClick={()=>{setMode('docx');setFile(null);setText('');setProgress('');}}>DOCX 文档</button>
      <button type="button" aria-pressed={mode==='ocr'} onClick={()=>{setMode('ocr');setFile(null);setText('');setProgress('');}}>图片 OCR</button>
    </div>
    <label className="document-field">选择{mode==='docx'?' DOCX':'图片'}文件（最多 12 MiB）
      <input key={mode} type="file" accept={mode==='docx'?'.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document':'image/png,image/jpeg,image/webp,image/bmp'} onChange={onSelect}/>
    </label>
    {mode==='ocr'&&<label className="document-field">识别语言
      <select value={language} onChange={e=>setLanguage(e.target.value as OCRLanguage)}>
        {Object.entries(languages).map(([id,title])=><option value={id} key={id}>{title}</option>)}
      </select>
    </label>}
    <button type="button" disabled={!file||busy||file.size>MAX_BYTES} onClick={()=>void process()}>{busy?'处理中…':'开始本地读取 / 识别'}</button>
    {mode==='docx'&&extensionFileLab&&<>
      <div className="native-modes" aria-label="DOCX 翻译服务">
        <button type="button" aria-pressed={translationMode==='standard'} onClick={()=>setTranslationMode('standard')}>常规翻译</button>
        <button type="button" aria-pressed={translationMode==='ai'} onClick={()=>setTranslationMode('ai')}>自选 AI 精译</button>
      </div>
      <button type="button" disabled={!file||busy||file.size>MAX_BYTES} onClick={()=>void translateAndExport()}>翻译并导出 DOCX</button>
      <p>DOCX 内容将发送至你在插件设置中选择的翻译服务。导出保留原文件结构与表格，但<strong>不保证段落内混合字体与复杂排版完全一致</strong>。</p>
    </>}
    {!extensionFileLab&&mode==='docx'&&<p>在 Chrome 插件「文件处理」页面可以使用翻译并导出功能；网页版仅提供本地读取。</p>}
    {progress&&<p role="status">{progress}</p>}
    <p aria-live="polite">{message}</p>
    {text&&<><h3>提取结果（原文）</h3><pre className="document-result">{text}</pre></>}
    <small>首次 OCR 会按需下载所选语言数据；WASM 和 Worker 已内置于插件。不会自动调用 AI 或将原文件上传到 Pages。</small>
  </section>;
}
