import {useState} from 'react';
import type {ChangeEvent} from 'react';

const MAX_BYTES=12*1024*1024;
type Engine='docx'|'ocr';
type OCRLanguage='eng'|'fra'|'jpn'|'kor'|'chi_sim';
const languages:Record<OCRLanguage,string>={
  eng:'English',fra:'Français',jpn:'日本語',kor:'한국어',chi_sim:'简体中文'
};
function formatError(e:unknown):string{
  return e instanceof Error?e.message:String(e);
}
export function DocumentLab(){
  const [mode,setMode]=useState<Engine>('docx');
  const [file,setFile]=useState<File|null>(null);
  const [language,setLanguage]=useState<OCRLanguage>('eng');
  const [text,setText]=useState('');
  const [message,setMessage]=useState('文件仅在本机浏览器内处理。尚未连接翻译或云端上传服务。');
  const [busy,setBusy]=useState(false);
  function onSelect(event:ChangeEvent<HTMLInputElement>){
    const selected=event.target.files?.[0]??null;
    setFile(selected);setText('');
    if(selected && selected.size>MAX_BYTES)setMessage('文件超过 12 MiB 限制');
    else setMessage(selected?'已选择文件，等待你点击开始处理':'请选择文件');
  }
  async function process(){
    if(!file || busy)return;
    if(file.size>MAX_BYTES)return setMessage('文件过大（最多 12 MiB）');
    if(mode==='docx' && !/\.docx$/i.test(file.name))return setMessage('请选择 DOCX 文档');
    if(mode==='ocr' && !/\.(png|jpe?g|webp|bmp)$/i.test(file.name))return setMessage('请选择 PNG/JPG/WEBP/BMP 图片');
    setBusy(true);setText('');setMessage('正在本地处理文件…');
    try{
      if(mode==='docx'){
        // Mammoth extracts semantic text, NOT round-trip OOXML layout.
        const mammoth=await import('mammoth/mammoth.browser');
        const data=await file.arrayBuffer();
        const result=await mammoth.extractRawText({arrayBuffer:data});
        const extracted=result.value.trim();
        setText(extracted);
        setMessage(extracted
          ?'DOCX 正文已提取。标题层次、表格精确布局和图片需独立管线处理。'
          :'没有提取到可识别的 DOCX 正文。');
      } else {
        // WASM runs locally; the browser may download runtime/selected language assets.
        const {createWorker}=await import('tesseract.js');
        const worker=await createWorker(language);
        try{
          const result=await worker.recognize(file);
          setText(result.data.text.trim());
          setMessage('OCR 本地识别结束。结果为识别文字，尚未经过翻译或图片修补。');
        }finally{await worker.terminate();}
      }
    }catch(e){setMessage('处理失败：'+formatError(e));}
    finally{setBusy(false);}
  }
  return <section className="document-lab">
    <h2>文件与图片解析实验台</h2>
    <p>多模态翻译基础模块：DOCX 文本提取 + WASM 图片 OCR。当前只读取/识别，不伪称已翻译。</p>
    <div className="native-modes">
      <button type="button" aria-pressed={mode==='docx'} onClick={()=>{setMode('docx');setFile(null);setText('');}}>DOCX 阅读</button>
      <button type="button" aria-pressed={mode==='ocr'} onClick={()=>{setMode('ocr');setFile(null);setText('');}}>图片 OCR</button>
    </div>
    <label className="document-field">选择{mode==='docx'?' DOCX':'图片'}文件（最多 12 MiB）
      <input key={mode} type="file" accept={mode==='docx'?'.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document':'image/png,image/jpeg,image/webp,image/bmp'} onChange={onSelect}/>
    </label>
    {mode==='ocr'&&<label className="document-field">识别语言
      <select value={language} onChange={e=>setLanguage(e.target.value as OCRLanguage)}>
        {Object.entries(languages).map(([id,title])=><option value={id} key={id}>{title}</option>)}
      </select>
    </label>}
    <button type="button" disabled={!file||busy||file.size>MAX_BYTES} onClick={()=>void process()}>{busy?'处理中…':'开始本地处理'}</button>
    <p aria-live="polite">{message}</p>
    {text&&<><h3>识别结果（未翻译）</h3><pre className="document-result">{text}</pre></>}
    <small>仅选取指定语言进行 OCR；首次处理可能下载 Tesseract 模型。不会自动调用 AI API，不在 Pages 存储原始文件或识别结果。</small>
  </section>;
}
