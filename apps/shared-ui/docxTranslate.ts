import JSZip from 'jszip';

export type DocxProgress=(done:number,total:number)=>void;
export type BatchTranslate=(texts:string[])=>Promise<string[]>;
const MAX_FILE_BYTES=12*1024*1024;
const MAX_TOTAL_XML=12*1024*1024;
const MAX_PARAGRAPHS=1500;
const MAX_TEXT_CHARS=180000;

// Keep OOXML package assets, styles, tables, numbering, header/footer and images.
// Paragraph-wide translation necessarily loses *within-paragraph* run styling:
// only the first original w:t keeps the translated paragraph, others are emptied.
// This is a structural preservation prototype, NOT high-fidelity typography.
export async function translateDocx(
  buffer:ArrayBuffer, translator:BatchTranslate,progress:DocxProgress=()=>{}
):Promise<Uint8Array>{
  if(buffer.byteLength===0 || buffer.byteLength>MAX_FILE_BYTES)
    throw Error('DOCX 大小必须介于 1 字节至 12 MiB');
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
    if(xmlBytes>MAX_TOTAL_XML)throw Error('DOCX 解压后的 XML 超出 12 MiB 限制');
    const doc=new DOMParser().parseFromString(xml,'application/xml');
    if(doc.getElementsByTagName('parsererror').length)throw Error('DOCX XML 结构无效：'+name);
    const entries:Entry[]=[];
    for(const paragraph of Array.from(doc.getElementsByTagName('w:p'))){
      const nodes=Array.from(paragraph.getElementsByTagName('w:t'));
      if(!nodes.length)continue;
      const text=nodes.map(n=>n.textContent||'').join('');
      if(!text.trim())continue;
      if(text.length>4500)throw Error('存在超过 4500 字符的单个段落，暂不支持自动拆分');
      entries.push({nodes,text});
      totalEntries++;totalChars+=text.length;
      if(totalEntries>MAX_PARAGRAPHS||totalChars>MAX_TEXT_CHARS)
        throw Error('DOCX 当前最多支持 1500 段、18 万字符');
    }
    fragments.push({name,doc,entries});
  }
  const entries=fragments.flatMap(f=>f.entries);
  let done=0;progress(done,entries.length);
  // Each extension provider call permits at most 10 texts / 12000 chars.
  while(done<entries.length){
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
      entry.nodes[0].textContent=translations[i];
      entry.nodes[0].setAttribute('xml:space','preserve');
      for(const node of entry.nodes.slice(1))node.textContent='';
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
