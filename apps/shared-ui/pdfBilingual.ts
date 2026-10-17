/** Browser-only PDF bilingual fallback. Rasterizes original pages beside translations.
 * Original page pixels stay unmodified. NOT BabelDOC and NOT high-fidelity
 * editable typesetting. Used when no separate Python layout engine is available.
 */
export type PdfOcrLanguage='eng'|'fra'|'chi_sim'|'jpn'|'kor';
export type PdfTranslationMode='standard'|'ai';
export type PdfProgress=(done:number,total:number,status:string)=>void;
export type PdfTranslate=(texts:string[])=>Promise<string[]>;
type OcrWorker={recognize:(input:Blob)=>Promise<{data:{text:string}}> ;terminate:()=>Promise<unknown>};
export type OcrSelection=PdfOcrLanguage|'auto';
const MAX_FILE=48*1024*1024;
const MAX_PAGES=300;
const PAGES_PER_PART=12;
const MAX_OUTPUT_BYTES=150*1024*1024;
const MAX_PAGE_PIXELS=2_600_000;


function linesFromText(raw:string):string[]{
 const normalized=raw.replace(/\r/g,'').replace(/[ \t]+/g,' ').trim();
 if(!normalized)return [];
 const segments:string[]=[];
 for(const paragraph of normalized.split(/\n+/)){
   let current='';
   for(const symbol of Array.from(paragraph)){
     if(current.length>=1800){segments.push(current);current='';}
     current+=symbol;
   }
   if(current.trim())segments.push(current);
 }
 if(segments.length>160)throw Error('PDF 原文段落过多，请拆分文档');
 return segments;
}
function splitForProvider(texts:string[]):string[][]{
 const chunks:string[][]=[];
 for(let i=0;i<texts.length;){
   const group:string[]=[];let size=0;
   for(let j=i;j<texts.length&&group.length<8;j++){
     if(group.length&&size+texts[j].length>10500)break;
     group.push(texts[j]);size+=texts[j].length;
   }
   chunks.push(group);i+=group.length;
 }
 return chunks;
}
function blobFromCanvas(canvas:HTMLCanvasElement):Promise<Blob>{
 return new Promise((resolve,reject)=>
   canvas.toBlob(blob=>blob?resolve(blob):reject(Error('无法编码 PDF 页面图像')),'image/png'));
}
function drawSideBySide(original:HTMLCanvasElement,translations:string[]):HTMLCanvasElement{
 const padding=30;
 const panel=Math.min(900,Math.max(480,original.width));
 const canvas=document.createElement('canvas');
 const ctx=canvas.getContext('2d');
 if(!ctx)throw Error('PDF 双栏画布不可用');
 const scratch=document.createElement('canvas').getContext('2d');
 if(!scratch)throw Error('PDF 字体测量失败');
 const fontSize=22,lineHeight=31,maxTextWidth=panel-padding*2;
 scratch.font=`${fontSize}px system-ui,"Noto Sans CJK SC",sans-serif`;
 const lines:string[]=[];
 for(const segment of translations){
   for(const input of segment.split(/\n/)){
     let line='';
     for(const letter of Array.from(input)){
       if(line&&scratch.measureText(line+letter).width>maxTextWidth){
         lines.push(line);line='';
       }
       line+=letter;
     }
     if(line)lines.push(line);
   }
   lines.push('');
 }
 if(lines.length>340)throw Error('单页 PDF 译文过长，请使用本机 BabelDOC');
 const height=Math.max(original.height,100+lines.length*lineHeight+padding);
 const width=original.width+panel+20;
 if(width*height>MAX_PAGE_PIXELS*2.3)throw Error('PDF 双栏页面尺寸过大');
 canvas.width=width;canvas.height=height;
 ctx.fillStyle='#ffffff';ctx.fillRect(0,0,width,height);
 ctx.drawImage(original,0,0);
 ctx.fillStyle='#f1f5f9';ctx.fillRect(original.width+20,0,panel,height);
 ctx.fillStyle='#0f172a';ctx.font='bold 24px system-ui,sans-serif';
 ctx.fillText('译文 / Translation',original.width+20+padding,44);
 ctx.font=`${fontSize}px system-ui,"Noto Sans CJK SC",sans-serif`;
 for(let i=0;i<lines.length;i++){
   ctx.fillText(lines[i],original.width+20+padding,85+i*lineHeight,maxTextWidth);
 }
 return canvas;
}
async function parsePdfSource(buffer:Uint8Array,entry:string):Promise<{
 getDocument:(settings:unknown)=>{promise:Promise<{
  numPages:number;getPage:(index:number)=>Promise<{
   getViewport:(arg:{scale:number})=>{width:number;height:number};
   render:(args:unknown)=>{promise:Promise<unknown>};
   getTextContent:()=>Promise<{items:Array<{str?:string}>}>;
   cleanup:()=>void;
  }>;
 }>;destroy:()=>Promise<unknown>};
 GlobalWorkerOptions:{workerSrc:string};
}>{
 if(!(buffer.length>=5&&new TextDecoder().decode(buffer.slice(0,5))==='%PDF-'))
   throw Error('PDF 文件头无效');
 // The extension serves upstream Mozilla PDF.js from its own package.
 if(!entry.startsWith('chrome-extension://'))throw Error('需要在浏览器扩展内打开 PDF 实验台');
 return await import(/* @vite-ignore */ entry);
}
export async function translateBilingualPdf(
 file:File, translate:PdfTranslate, language:OcrSelection,
 progress:PdfProgress=()=>{},signal?:AbortSignal
):Promise<{pdf?:Uint8Array;archive?:Uint8Array;pages:number;ocrPages:number;parts:number}>{
 const ensureRunning=()=>{if(signal?.aborted)throw Error('用户已取消 PDF 翻译');};
 ensureRunning();
 if(file.size<20||file.size>MAX_FILE||!file.name.toLowerCase().endsWith('.pdf'))
   throw Error('PDF 文件大小不能超过 48 MiB；大型文件应由云端高保真引擎处理');
 const runtime=(globalThis as {chrome?:{runtime?:{
   id?:string;getURL?:(name:string)=>string;
 }}}).chrome?.runtime;
 if(!runtime?.id||!runtime.getURL)throw Error('PDF 转换仅支持已安装的本插件');
 const bytes=new Uint8Array(await file.arrayBuffer());
 const pdfjs=await parsePdfSource(bytes,runtime.getURL('vendor/pdf.mjs'));
 pdfjs.GlobalWorkerOptions.workerSrc=runtime.getURL('vendor/pdf.worker.mjs');
 const documentTask=pdfjs.getDocument({data:bytes,isEvalSupported:false,enableXfa:false,useSystemFonts:true});
 let ocr:OcrWorker|null=null;
 let pageCount=0,ocrPages=0;
 try{
   const source=await documentTask.promise;
   pageCount=source.numPages;
   if(pageCount<1||pageCount>MAX_PAGES)
     throw Error('每份 PDF 最多处理 300 页；更大文档应交给独立云端文档任务');
   const {PDFDocument}=await import('pdf-lib');
   const {default:JSZip}=await import('jszip');
   const parts=new JSZip();
   let out=await PDFDocument.create();
   let emitted=0,totalBytes=0;
   const completePart=async(lastPage:number)=>{
     const exported=new Uint8Array(await out.save({useObjectStreams:false}));
     totalBytes+=exported.byteLength;
     if(totalBytes>MAX_OUTPUT_BYTES)throw Error('PDF 输出总量超过浏览器内 150 MiB 上限，请使用云端文档处理');
     const partIndex=++emitted;
     parts.file('bilingual-'+String(partIndex).padStart(3,'0')+
       '-pages-'+String(lastPage-out.getPageCount()+1)+'-'+String(lastPage)+'.pdf',exported);
     out=await PDFDocument.create();
   };
   for(let index=1;index<=pageCount;index++){
     ensureRunning();
     const page=await source.getPage(index);
     try{
       const nativeViewport=page.getViewport({scale:1});
       const scale=Math.min(1.8,Math.sqrt(MAX_PAGE_PIXELS/(nativeViewport.width*nativeViewport.height)));
       const viewport=page.getViewport({scale:scale});
       const canvas=document.createElement('canvas');
       canvas.width=Math.round(viewport.width);canvas.height=Math.round(viewport.height);
       const ctx=canvas.getContext('2d',{alpha:false});
       if(!ctx)throw Error('PDF 渲染 Canvas 不可用');
       progress(index-1,pageCount,`渲染第 ${index}/${pageCount} 页`);
       await page.render({canvas,canvasContext:ctx,viewport}).promise;
       const raw=(await page.getTextContent()).items.map(x=>x.str||'').join('\n').trim();
       let text=raw;
       if(text.replace(/\s/g,'').length<30){
         progress(index-1,pageCount,`第 ${index} 页无文本层，执行本机 OCR`);
         if(!ocr){
           const {createWorker}=await import('tesseract.js');
           const config={
             workerPath:runtime.getURL('tesseract/worker.min.js'),
             corePath:runtime.getURL('tesseract/core'),
             workerBlobURL:false
           };
           // Explicit auto mode loads CJK and Latin language models into
           // one Tesseract worker. Language packs may download on first use.
           const ocrLanguages=language==='auto'
             ? ['eng','fra','chi_sim','jpn','kor']:language;
           ocr=await createWorker(ocrLanguages,1,config) as OcrWorker;
         }
         text=(await ocr.recognize(await blobFromCanvas(canvas))).data.text.trim();
         ocrPages++;
       }
       const segments=linesFromText(text);
       if(!segments.length)throw Error('第 '+index+' 页缺少可翻译的文字');
       if(segments.join('').length>18000)
         throw Error('单页文字超过浏览器内 PDF 翻译上限');
       const translations:string[]=[];
       for(const batch of splitForProvider(segments)){
         ensureRunning();
         const batchResults=await translate(batch);
         if(batchResults.length!==batch.length||
           batchResults.some(x=>typeof x!=='string'||!x.trim()))
           throw Error('PDF 翻译服务没有返回完整的段落');
         translations.push(...batchResults);
       }
       ensureRunning();
       const composite=drawSideBySide(canvas,translations);
       const imageBytes=new Uint8Array(await (await blobFromCanvas(composite)).arrayBuffer());
       const image=await out.embedPng(imageBytes);
       // PDF page is rasterized from the original and the translation panel.
       // It intentionally does not claim a retained selectable text layer.
       const width=composite.width*.6,height=composite.height*.6;
       const newPage=out.addPage([width,height]);
       newPage.drawImage(image,{x:0,y:0,width,height});
       progress(index,pageCount,'已完成第 '+index+'/'+pageCount+' 页');
       composite.width=0;composite.height=0;
       if(index%PAGES_PER_PART===0||index===pageCount){
         ensureRunning();
         await completePart(index);
       }
       canvas.width=0;canvas.height=0;
     }finally{page.cleanup();}
   }
   ensureRunning();
   ensureRunning();
   if(emitted===1){
     const only=Object.values(parts.files)[0];
     const exported=new Uint8Array(await only.async('uint8array'));
     return {pdf:exported,pages:pageCount,ocrPages,parts:1};
   }
   const archive=new Uint8Array(await parts.generateAsync({
     type:'uint8array',compression:'DEFLATE',compressionOptions:{level:3}
   }));
   ensureRunning();
   return {archive,pages:pageCount,ocrPages,parts:emitted};
 }finally{
   if(ocr)await ocr.terminate().catch(()=>{});
   await documentTask.destroy();
 }
}
