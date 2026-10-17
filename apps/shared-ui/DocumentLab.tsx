import {useEffect,useState} from 'react';
import type {ChangeEvent} from 'react';
import type {OcrRegion} from './imageTranslate';

const MAX_BYTES=12*1024*1024;
type Engine='docx'|'pptx'|'xlsx'|'ocr';
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
  const blob=new Blob([copy],{type:name.endsWith('.pptx')?'application/vnd.openxmlformats-officedocument.presentationml.presentation':name.endsWith('.xlsx')?'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'application/vnd.openxmlformats-officedocument.wordprocessingml.document'});
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
  const [ocrRegions,setOcrRegions]=useState<OcrRegion[]>([]);
  const [imageLayout,setImageLayout]=useState<'side'|'overlay'>('side');
  const runtime=currentRuntime();
  const extensionFileLab=Boolean(runtime?.id&&location.protocol==='chrome-extension:'&&
    location.pathname==='/file-lab.html');
  useEffect(()=>{
    if(!extensionFileLab)return;
    let mounted=true;
    const session=(globalThis as {chrome?:{storage?:{session?:{
      get:(key:string)=>Promise<Record<string,unknown>>;
      remove:(key:string)=>Promise<void>;
    }}}}).chrome?.storage?.session;
    if(!session)return;
    void (async()=>{
      const screenshot='pit_ocr_screenshot',imageUrlKey='pit_ocr_image_url';
      const stored=await session.get(screenshot);
      const encoded=stored?.[screenshot];
      if(typeof encoded==='string'&&encoded.startsWith('data:image/png;base64,')&&
         encoded.length<=6_000_000){
        await session.remove(screenshot);
        const raw=atob(encoded.slice(encoded.indexOf(',')+1));
        const bytes=new Uint8Array(raw.length);
        for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);
        if(!mounted)return;
        setMode('ocr');
        setFile(new File([bytes],'captured-webpage.png',{type:'image/png'}));
        setOcrRegions([]);setText('');
        setMessage('已载入可见网页截图，请选择 OCR 语言后开始识别。');
        return;
      }
      const imageStored=await session.get(imageUrlKey);
      const requested=imageStored?.[imageUrlKey];
      if(typeof requested!=='string')return;
      await session.remove(imageUrlKey);
      let url:URL;
      try{
        url=new URL(requested);
        if(!['https:','http:'].includes(url.protocol)||url.username||url.password)
          throw Error('图片网址协议或认证方式不受支持');
      }catch{throw Error('右键选中的图片地址无效');}
      // Fetch in the extension page, after the user explicitly picked this
      // image from a context menu. Never forward site cookies or file URLs.
      const response=await fetch(url.toString(),{
        credentials:'omit',signal:AbortSignal.timeout(20000)
      });
      if(!response.ok)throw Error('图片服务 HTTP '+response.status+
        '，可能需要网站登录或防盗链；可以另存图片再选择文件');
      const size=Number(response.headers.get('content-length')||0);
      if(size>MAX_BYTES)throw Error('图片超过 12 MiB');
      const mime=(response.headers.get('content-type')||'').split(';')[0].trim();
      if(!['image/png','image/jpeg','image/webp','image/bmp'].includes(mime))
        throw Error('当前图片不是可用的 PNG/JPEG/WebP/BMP；请保存后手动上传');
      const bytes=new Uint8Array(await response.arrayBuffer());
      if(bytes.length>MAX_BYTES||bytes.length<12)throw Error('图片大小不支持');
      if(!mounted)return;
      const extension=mime==='image/png'?'png':mime==='image/webp'?'webp':
        mime==='image/bmp'?'bmp':'jpg';
      setMode('ocr');
      setFile(new File([bytes],'selected-image.'+extension,{type:mime}));
      setOcrRegions([]);setText('');
      setMessage('已从右键菜单导入真实图片，接下来可进行 OCR 与翻译。');
    })().catch(error=>{
      if(mounted)setMessage('截图加载失败：'+formatError(error));
    });
    return ()=>{mounted=false;};
  },[extensionFileLab]);
  function onSelect(event:ChangeEvent<HTMLInputElement>){
    const selected=event.target.files?.[0]??null;
    setFile(selected);setText('');setProgress('');setOcrRegions([]);
    if(selected&&selected.size>MAX_BYTES)setMessage('文件超过 12 MiB 限制');
    else setMessage(selected?'已选择文件，等待你点击开始处理':'请选择文件');
  }
  async function process(){
    if(!file||busy)return;
    if(file.size>MAX_BYTES)return setMessage('文件过大（最多 12 MiB）');
    if(mode!=='ocr'&&!file.name.toLowerCase().endsWith('.'+mode))return setMessage('文件扩展名与所选格式不一致');
    if(mode==='ocr'&&!/\.(png|jpe?g|webp|bmp)$/i.test(file.name))return setMessage('请选择 PNG/JPG/WEBP/BMP 图片');
    setBusy(true);setText('');setOcrRegions([]);setMessage('正在本地处理文件…');
    try{
      if(mode==='docx'){
        const mammoth=await import('mammoth/mammoth.browser');
        const result=await mammoth.extractRawText({arrayBuffer:await file.arrayBuffer()});
        const extracted=result.value.trim();
        setText(extracted);
        setMessage(extracted?'DOCX 正文已提取。':'没有提取到可识别的 DOCX 正文。');
      }else if(mode==='pptx'||mode==='xlsx'){
        const {inspectOfficeText}=await import('./officeTranslate');
        const extracted=await inspectOfficeText(await file.arrayBuffer(),mode);
        setText(extracted);
        setMessage(extracted?'Office 文字已读取；公式、图表和单元格数值保持原样。':'没有检测到可翻译的文本。');
      }else{
        const {createWorker}=await import('tesseract.js');
        const localPaths=runtime?.id&&runtime.getURL?{
          workerPath:runtime.getURL('tesseract/worker.min.js'),
          corePath:runtime.getURL('tesseract/core'),
          workerBlobURL:false
        }:undefined;
        const worker=await createWorker(language,1,localPaths);
        try{
          const result=await worker.recognize(file,{}, {blocks:true});
          const {ocrLinesFromBlocks}=await import('./imageTranslate');
          const regions=ocrLinesFromBlocks(result.data.blocks);
          setOcrRegions(regions);
          setText(result.data.text.trim());
          setMessage(regions.length
            ?'OCR 识别结束，含 '+regions.length+' 个原文文字区域，可选择原位文字覆盖或双栏译文。'
            :'OCR 完成但没有可靠文字坐标，只能使用双栏译文。');
        }finally{await worker.terminate();}
      }
    }catch(e){setMessage('处理失败：'+formatError(e));}
    finally{setBusy(false);}
  }
  async function translateRecognizedImage(){
    if(mode!=='ocr'||!file||!text.trim()||busy||!extensionFileLab||!runtime?.sendMessage)return;
    if(translationMode==='ai'&&!confirm('将向自选 AI 模型发送图片识别文本，可能产生 API 费用。确认？'))return;
    setBusy(true);setMessage('正在使用所选服务翻译识别文字…');
    try{
      const {splitOcrLines,bilingualImagePng,inplaceImagePng}=await import('./imageTranslate');
      const {createRecoverableTranslator}=await import('./translationRecovery');
      const translateLines=createRecoverableTranslator(async texts=>{
        const res=await runtime.sendMessage!({type:'TRANSLATE_DOCUMENT',texts,mode:translationMode,userInitiated:true});
        if(!res?.ok||!res.translations)throw Error(res?.error||'图片翻译服务响应失败');
        return res.translations;
      },{onRetry:info=>setProgress('图片 API 暂时不可用，重试 '+info.attempt+' 次')});
      const overlay=imageLayout==='overlay';
      if(overlay&&!ocrRegions.length)throw Error('缺少 OCR 坐标，无法原位覆盖；请改用双栏导出');
      const lines=overlay?ocrRegions.map(x=>x.text):splitOcrLines(text);
      if(!lines.length)throw Error('没有可翻译的 OCR 文本');
      const output:string[]=[];
      for(let i=0;i<lines.length;i+=8){
        output.push(...await translateLines(lines.slice(i,i+8)));
        setProgress('图片文字翻译 '+Math.min(i+8,lines.length)+'/'+lines.length+' 行');
      }
      const png=overlay?await inplaceImagePng(file,ocrRegions,output):await bilingualImagePng(file,text,output);
      const url=URL.createObjectURL(png);
      const link=document.createElement('a');
      link.href=url;link.download=file.name.replace(/\.[^.]+$/,'')+(overlay?'-overlay.png':'-bilingual.png');
      document.body.append(link);link.click();link.remove();
      setTimeout(()=>URL.revokeObjectURL(url),60000);
      setMessage(overlay
        ?'原位译文 PNG 已导出：仅覆盖 OCR 文字框，适用于颜色基本均匀的背景；并非照片级修复。'
        :'双语图片已导出：左侧原图保留，右侧展示译文。');
    }catch(error){setMessage('图片翻译失败：'+formatError(error));}
    finally{setBusy(false);}
  }
  async function translateAndExport(){
    if(!file||!extensionFileLab||!runtime?.sendMessage||busy||mode==='ocr')return;
    if(translationMode==='ai'&&!confirm('将使用你选择的 AI 模型翻译当前 Office 文件，可能产生 API 费用。确认开始吗？'))return;
    setBusy(true);setProgress('准备 Office 翻译…');setMessage('翻译由你配置的服务处理；内容将发送给所选服务商。');
    try{
      const {createRecoverableTranslator}=await import('./translationRecovery');
      const translate=createRecoverableTranslator(async (texts:string[])=>{
        const response=await runtime.sendMessage!({
          type:'TRANSLATE_DOCUMENT',texts,mode:translationMode,userInitiated:true
        });
        if(!response?.ok||!Array.isArray(response.translations))
          throw Error(response?.error||'翻译后台没有返回有效结果');
        return response.translations;
      },{onRetry:info=>setProgress('暂时限流/超时，Office 翻译重试 '+info.attempt+' 次')});
      const onProgress=(done:number,total:number)=>setProgress('翻译进度 '+done+'/'+total+' 段/单元格');
      const result=mode==='docx'
        ? await (await import('./docxTranslate')).translateDocx(await file.arrayBuffer(),translate,onProgress)
        : await (await import('./officeTranslate')).translateOffice(await file.arrayBuffer(),mode,translate,onProgress);
      const base=file.name.replace(/\.(docx|pptx|xlsx)$/i,'');
      downloadFile(result,base+'-translated.'+mode);
      setMessage('Office 文件已生成。保留原文件的非文字部件及结构；段落内混合样式、幻灯片文本溢出和单元格尺寸需自行核对。');
    }catch(e){setMessage('Office 翻译未完成：'+formatError(e));}
    finally{setBusy(false);}
  }
  return <section className="document-lab">
    <h2>文件与图片处理</h2>
    <p>DOCX、PPTX、XLSX 文档文字提取与结构保留翻译；图片 WASM OCR 和双语 PNG。学术 PDF 保真需独立处理服务。</p>
    <div className="native-modes">
      <button type="button" aria-pressed={mode==='docx'} onClick={()=>{setMode('docx');setFile(null);setText('');setProgress('');}}>DOCX 文档</button>
      <button type="button" aria-pressed={mode==='pptx'} onClick={()=>{setMode('pptx');setFile(null);setText('');setProgress('');}}>PPTX 演示文稿</button>
      <button type="button" aria-pressed={mode==='xlsx'} onClick={()=>{setMode('xlsx');setFile(null);setText('');setProgress('');}}>XLSX 表格</button>
      <button type="button" aria-pressed={mode==='ocr'} onClick={()=>{setMode('ocr');setFile(null);setText('');setProgress('');}}>图片 OCR</button>
    </div>
    <label className="document-field">选择{mode==='ocr'?'图片':mode.toUpperCase()}文件（最多 12 MiB）
      <input key={mode} type="file" accept={mode==='ocr'?'image/png,image/jpeg,image/webp,image/bmp':'.'+mode} onChange={onSelect}/>
    </label>
    {mode==='ocr'&&<label className="document-field">识别语言
      <select value={language} onChange={e=>setLanguage(e.target.value as OCRLanguage)}>
        {Object.entries(languages).map(([id,title])=><option value={id} key={id}>{title}</option>)}
      </select>
    </label>}
    <button type="button" disabled={!file||busy||file.size>MAX_BYTES} onClick={()=>void process()}>{busy?'处理中…':'开始本地读取 / 识别'}</button>
    {mode==='ocr'&&extensionFileLab&&text.trim()&&<>
      <div className="native-modes" aria-label="图片文字翻译服务">
        <button type="button" aria-pressed={translationMode==='standard'} onClick={()=>setTranslationMode('standard')}>常规翻译</button>
        <button type="button" aria-pressed={translationMode==='ai'} onClick={()=>setTranslationMode('ai')}>自选 AI 精译</button>
      </div>
      <div className="native-modes" role="group" aria-label="图片译文排版">
        <button type="button" aria-pressed={imageLayout==='side'} onClick={()=>setImageLayout('side')}>左右双栏（保留原图）</button>
        <button type="button" aria-pressed={imageLayout==='overlay'} disabled={!ocrRegions.length} onClick={()=>setImageLayout('overlay')}>原位覆盖（纯色背景）</button>
      </div>
      <button type="button" disabled={busy} onClick={()=>void translateRecognizedImage()}>翻译识别文本并导出 PNG</button>
    </>}
    {mode!=='ocr'&&extensionFileLab&&<>
      <div className="native-modes" aria-label="Office 翻译服务">
        <button type="button" aria-pressed={translationMode==='standard'} onClick={()=>setTranslationMode('standard')}>常规翻译</button>
        <button type="button" aria-pressed={translationMode==='ai'} onClick={()=>setTranslationMode('ai')}>自选 AI 精译</button>
      </div>
      <button type="button" disabled={!file||busy||file.size>MAX_BYTES} onClick={()=>void translateAndExport()}>翻译并导出 Office</button>
      <p>Office 文字将发送至你配置的翻译服务，公式、图像等非文本部件保留。<strong>不保证复杂排版、单元格宽度或幻灯片文本框自动适配</strong>。</p>
    </>}
    {!extensionFileLab&&mode!=='ocr'&&<p>在 Chrome 插件「文件处理」页面可以使用翻译并导出功能；网页版仅提供本地读取。</p>}
    {progress&&<p role="status">{progress}</p>}
    <p aria-live="polite">{message}</p>
    {text&&<><h3>提取结果（原文）</h3><pre className="document-result">{text}</pre></>}
    <small>首次 OCR 会按需下载所选语言数据；WASM 和 Worker 已内置于插件。不会自动调用 AI 或将原文件上传到 Pages。</small>
  </section>;
}
