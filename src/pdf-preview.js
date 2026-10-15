/* Mozilla PDF.js from pinned Apache-2.0 npm release, packaged locally.
 * Viewer only: BabelDOC remains separate for translated layout reconstruction.
 */
export async function previewPdf(file,view){
  if(!file)throw Error('请选择 PDF');
  if(file.size>25*1024*1024)throw Error('PDF 超过 25MB');
  const pdfjs=await import('./vendor/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc=chrome.runtime.getURL('src/vendor/pdf.worker.mjs');
  const bytes=new Uint8Array(await file.arrayBuffer());
  if(bytes.length<5 || new TextDecoder().decode(bytes.slice(0,5))!=='%PDF-')throw Error('PDF 文件头无效');
  const task=pdfjs.getDocument({data:bytes,isEvalSupported:false,enableXfa:false,useSystemFonts:true});
  let doc=null,page=null;
  try{
    doc=await task.promise;
    if(doc.numPages<1 || doc.numPages>300)throw Error('仅支持 1–300 页的 PDF');
    page=await doc.getPage(1);
    const initial=page.getViewport({scale:1});
    const width=Math.min(650,Math.max(250,view.clientWidth||550));
    const viewport=page.getViewport({scale:width/initial.width});
    const canvas=globalThis.document.createElement('canvas');
    canvas.width=Math.max(1,Math.round(viewport.width));
    canvas.height=Math.max(1,Math.round(viewport.height));
    await page.render({canvasContext:canvas.getContext('2d',{alpha:false}),canvas,viewport}).promise;
    const items=(await page.getTextContent()).items;
    const text=items.map(x=>typeof x.str==='string'?x.str:'').join(' ').trim();
    view.replaceChildren(canvas);
    const summary=globalThis.document.createElement('p');
    summary.className='muted';
    summary.textContent='Mozilla PDF.js 预览：'+doc.numPages+' 页 · 首页 '+text.length+' 字符'+
      (text.length<30?' · 疑似扫描件，需要 OCR':'');
    view.append(summary);
    return {pages:doc.numPages,firstPageTextLength:text.length,needsOCR:text.length<30};
  }finally{
    page?.cleanup();
    if(doc)await doc.destroy();
    else await task.destroy();
  }
}
