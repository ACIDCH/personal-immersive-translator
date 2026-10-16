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
    // Checking only page one misses mixed PDFs where lecture scans appear
    // after an introductory digital-text section. Sample at most 20 pages
    // (including the first and last) to keep preview responsive.
    const positions=doc.numPages<=20
      ? Array.from({length:doc.numPages},(_,i)=>i+1)
      : [...new Set(Array.from({length:20},(_,i)=>
          1+Math.round(i*(doc.numPages-1)/19)))];
    const suspected=[];
    for(const index of positions){
      let characters=text.length;
      if(index!==1){
        const sampled=await doc.getPage(index);
        try{
          characters=(await sampled.getTextContent()).items
            .reduce((sum,item)=>sum+(typeof item.str==='string'?item.str.trim().length:0),0);
        }finally{sampled.cleanup?.();}
      }
      if(characters<30)suspected.push(index);
    }
    view.replaceChildren(canvas);
    const summary=globalThis.document.createElement('p');
    summary.className='muted';
    summary.textContent='Mozilla PDF.js 预览：'+doc.numPages+' 页 · 抽查 '+positions.length+
      ' 页 · 首页 '+text.length+' 字符'+
      (suspected.length?' · 部分页面缺少可提取文字（页码：'+suspected.slice(0,6).join('、')+'），可能需要 OCR':'');
    view.append(summary);
    return {pages:doc.numPages,firstPageTextLength:text.length,
      scannedCandidates:suspected,sampledPages:positions.length,needsOCR:suspected.length>0};
  }finally{
    page?.cleanup?.();
    // LoadingTask.destroy is the stable upstream API; always tear down
    // the matching worker, including on partial failures.
    await task.destroy();
  }
}
