import JSZip from 'jszip';

export type DocxProgress=(done:number,total:number)=>void;
export type BatchTranslate=(texts:string[])=>Promise<string[]>;
const MAX_FILE_BYTES=48*1024*1024;
const MAX_TOTAL_XML=64*1024*1024;
const MAX_PARAGRAPHS=12000;
const MAX_TEXT_CHARS=3000000;

// Keep OOXML package assets, styles, tables, numbering, header/footer and images.
// Translate each paragraph once for coherent context, then spread text across
// existing run boundaries proportionally. This preserves w:rPr nodes and avoids
// collapsing all translated text into the first styled run. It cannot infer
// semantic emphasis alignment or guarantee Word's final rendered line breaks.
function preserveStyledRuns(nodes:Element[],translation:string){
  const source=nodes.map(n=>n.textContent||'');
  const total=source.reduce((n,s)=>n+Array.from(s).length,0);
  if(!total)return;
  const chars=Array.from(translation);
  let used=0;
  let sourceSeen=0;
  nodes.forEach((node,i)=>{
    sourceSeen+=Array.from(source[i]).length;
    const boundary=i===nodes.length-1?chars.length:
      Math.min(chars.length,Math.max(used,Math.round(chars.length*sourceSeen/total)));
    node.textContent=chars.slice(used,boundary).join('');
    if(node.textContent)node.setAttribute('xml:space','preserve');
    used=boundary;
  });
}
export async function translateDocx(
  buffer:ArrayBuffer, translator:BatchTranslate,progress:DocxProgress=()=>{}
):Promise<Uint8Array>{
  if(buffer.byteLength===0 || buffer.byteLength>MAX_FILE_BYTES)
    throw Error('DOCX 大小必须介于 1 字节至 48 MiB');
  const zip=await JSZip.loadAsync(buffer,{checkCRC32:true});
  const names=Object.keys(zip.files).filter(name=>
    /^word\/(?:document|header\d+|footer\d+|footnotes|endnotes)\.xml$/.test(name)
  ).sort((a,b)=>a==='word/document.xml'?-1:b==='word/document.xml'?1:a.localeCompare(b));
  if(!names.includes('word/document.xml'))throw Error('DOCX 缺少 word/document.xml');
  type Entry={nodes:Element[],text:string};
  const fragments:{name:string,doc:Document,entries:Entry[]}[]=[];
  let xmlBytes=0,totalChars=0,totalEntries=0;
  for(const name of names){
    const xml=await zip.file(name)!.async('string');
    xmlBytes+=xml.length;
    if(xmlBytes>MAX_TOTAL_XML)throw Error('DOCX 解压后的 XML 超出 64 MiB 限制');
    const doc=new DOMParser().parseFromString(xml,'application/xml');
    if(doc.getElementsByTagName('parsererror').length)throw Error('DOCX XML 结构无效：'+name);
    const entries:Entry[]=[];
    for(const paragraph of Array.from(doc.getElementsByTagName('w:p'))){
      const nodes=Array.from(paragraph.getElementsByTagName('w:t'));
      if(!nodes.length)continue;
      const text=nodes.map(n=>n.textContent||'').join('');
      if(!text.trim())continue;
      entries.push({nodes,text});
      totalEntries++;totalChars+=text.length;
      if(totalEntries>MAX_PARAGRAPHS||totalChars>MAX_TEXT_CHARS)
        throw Error('DOCX 当前最多支持 12000 段、300 万字符');
    }
    fragments.push({name,doc,entries});
  }
  const entries=fragments.flatMap(f=>f.entries);
  let done=0;progress(done,entries.length);
  // Each extension provider call permits at most 10 texts / 12000 chars.
  while(done<entries.length){
    if(entries[done].text.length>4500){
      // Translate oversize paragraphs as bounded Unicode chunks. Keep the
      // paragraph/runs intact instead of aborting a 100-page course book.
      const entry=entries[done];
      const chars=Array.from(entry.text),translated:string[]=[];
      for(let offset=0;offset<chars.length;offset+=3400){
        const result=await translator([chars.slice(offset,offset+3400).join('')]);
        if(result.length!==1||!result[0]?.trim())
          throw Error('DOCX 超长段落翻译失败');
        translated.push(result[0]);
      }
      preserveStyledRuns(entry.nodes,translated.join(''));
      done++;progress(done,entries.length);continue;
    }
    const chunk:Entry[]=[];let chars=0;
    for(let i=done;i<entries.length&&chunk.length<8;i++){
      const entry=entries[i];
      if(chunk.length&&chars+entry.text.length>10500)break;
      chunk.push(entry);chars+=entry.text.length;
    }
    const translations=await translator(chunk.map(x=>x.text));
    if(translations.length!==chunk.length||translations.some(x=>typeof x!=='string'||!x.trim()))
      throw Error('翻译服务返回的段落数量不正确，DOCX 未导出');
    for(let i=0;i<chunk.length;i++){
      const entry=chunk[i];
      preserveStyledRuns(entry.nodes,translations[i]);
    }
    done+=chunk.length;progress(done,entries.length);
  }
  const serializer=new XMLSerializer();
  for(const f of fragments){
    if(f.entries.length)zip.file(f.name,serializer.serializeToString(f.doc));
  }
  // Original ZIP structure/other assets untouched; only selected XML parts changed.
  return await zip.generateAsync({type:'uint8array',compression:'DEFLATE'});
}
