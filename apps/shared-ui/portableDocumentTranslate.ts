import JSZip from 'jszip';
import type {BatchTranslate,DocxProgress} from './docxTranslate';

export type PortableKind='txt'|'md'|'html'|'htm'|'epub';
type Unit={source:string;apply:(translated:string)=>void};
const MAX_FILE=48*1024*1024;
const MAX_UNPACKED=96*1024*1024;
const MAX_CHAPTERS=800;
const MAX_SEGMENTS=20000;
const MAX_CHARS=4000000;
const BLOCKS='title,h1,h2,h3,h4,h5,h6,p,li,blockquote,figcaption,caption,td,th,dt,dd';
const EXCLUDE='script,style,noscript,template,pre,code,svg,math,textarea,select,button,[hidden],[aria-hidden="true"],[translate="no"],[contenteditable="true"]';

function ensureFile(buffer:ArrayBuffer){
  if(!buffer.byteLength||buffer.byteLength>MAX_FILE)throw Error('当前文件大小限制为 1 字节至 48 MiB');
}
function decodeText(buffer:ArrayBuffer):{text:string;encode:(text:string)=>Uint8Array}{
  const bytes=new Uint8Array(buffer);
  const utf16le=bytes[0]===0xff&&bytes[1]===0xfe;
  const utf16be=bytes[0]===0xfe&&bytes[1]===0xff;
  if(utf16le||utf16be){
    const encoding=utf16be?'utf-16be':'utf-16le';
    const text=new TextDecoder(encoding,{fatal:true}).decode(bytes.subarray(2));
    return {text,encode:(value:string)=>{
      const utf8=new TextEncoder().encode(value);
      // Encode UTF-16 bytes without browser-dependent TextEncoder options.
      const out=new Uint8Array(2+value.length*2);
      out.set(utf16be?[0xfe,0xff]:[0xff,0xfe]);
      for(let i=0;i<value.length;i++){
        const unit=value.charCodeAt(i);
        out[2+i*2]=utf16be?unit>>>8:unit&255;
        out[3+i*2]=utf16be?unit&255:unit>>>8;
      }
      return out;
    }};
  }
  const bom=bytes[0]===0xef&&bytes[1]===0xbb&&bytes[2]===0xbf;
  return {text:new TextDecoder('utf-8',{fatal:true}).decode(
    bom?bytes.subarray(3):bytes),
    encode:(text:string)=>{
      const body=new TextEncoder().encode(text);
      if(!bom)return body;
      const out=new Uint8Array(body.length+3);
      out.set([0xef,0xbb,0xbf]);out.set(body,3);return out;
    }};
}
function utf8(buffer:ArrayBuffer):string{return decodeText(buffer).text;}
function xml(raw:string):Document{
  const doc=new DOMParser().parseFromString(raw,'application/xml');
  if(doc.getElementsByTagName('parsererror').length)throw Error('XML/XHTML 文件结构不正确');
  return doc;
}
function add(units:Unit[],source:string,apply:(text:string)=>void){
  if(!source.trim())return;
  if(source.length<=4500){units.push({source,apply});return;}
  // Preserve very long book paragraphs/TXT lines by splitting at nearby
  // sentence/word boundaries rather than rejecting an otherwise valid book.
  // Each request unit stays below the background's 4,500-character ceiling.
  const chunks:string[]=[];
  for(let offset=0;offset<source.length;){
    let end=Math.min(offset+3500,source.length);
    if(end<source.length){
      const boundary=Math.max(source.lastIndexOf('。',end),source.lastIndexOf('. ',end),
        source.lastIndexOf(' ',end),source.lastIndexOf('\n',end));
      if(boundary>offset+2100)end=boundary+1;
      if(end<source.length&&/[\uD800-\uDBFF]/.test(source.charAt(end-1)))end--;
    }
    chunks.push(source.slice(offset,end));offset=end;
  }
  const translated=new Array<string|undefined>(chunks.length).fill(undefined);
  chunks.forEach((text,index)=>units.push({source:text,apply:(value)=>{
    translated[index]=value;
    if(translated.every(s=>s!==undefined))apply(translated.join(''));
  }}));
}
function guard(units:Unit[]){
  if(units.length>MAX_SEGMENTS||units.reduce((n,u)=>n+u.source.length,0)>MAX_CHARS)
    throw Error('当前最多支持 2 万个文本块、400 万字符');
}
function fillTextNodes(nodes:Text[],translated:string){
  const lengths=nodes.map(n=>Array.from(n.data).length);
  const total=lengths.reduce((a,b)=>a+b,0);
  if(!total)return;
  const chars=Array.from(translated);
  let used=0,seen=0;
  for(let i=0;i<nodes.length;i++){
    seen+=lengths[i];
    const end=i===nodes.length-1?chars.length:
      Math.min(chars.length,Math.max(used,Math.round(chars.length*seen/total)));
    nodes[i].data=chars.slice(used,end).join('');
    used=end;
  }
}
function textNodes(element:Element):Text[]{
  const nodes:Text[]=[];
  function visit(node:Node){
    if(node.nodeType===3){
      const text=node as Text;
      if(text.data.trim())nodes.push(text);
      return;
    }
    if(node.nodeType!==1)return;
    const current=node as Element;
    if(current.matches(EXCLUDE))return;
    for(const child of Array.from(current.childNodes))visit(child);
  }
  visit(element);
  return nodes;
}
function markupUnits(doc:Document):Unit[]{
  const units:Unit[]=[];
  for(const item of Array.from(doc.querySelectorAll(BLOCKS))){
    if(item.closest(EXCLUDE))continue;
    // Prefer the innermost text block to avoid translating nested
    // paragraphs twice (notably EPUB lists and HTML block quotes).
    if(item.querySelector(BLOCKS))continue;
    const nodes=textNodes(item);
    const source=nodes.map(node=>node.data).join('');
    add(units,source,(translation)=>fillTextNodes(nodes,translation));
  }
  if(!units.length){
    const root=doc.querySelector('body');
    if(root&&!root.querySelector(BLOCKS)){
      const nodes=textNodes(root);
      add(units,nodes.map(node=>node.data).join(''),(t)=>fillTextNodes(nodes,t));
    }
  }
  guard(units);
  return units;
}
function markdownText(line:string,commit:(line:string)=>void):{source:string;apply:(t:string)=>void}{
  type Token={value:string;editable:boolean};
  const tokens:Token[]=[];
  const push=(value:string,editable:boolean)=>{if(value)tokens.push({value,editable});};
  // Only a limited, explicit subset of Markdown inline syntax is edited.
  // Opaque code spans, images and URL targets retain their original bytes.
  const markup=/(\x60+[^\x60\n]*\x60+|!?\[[^\]\n]*\]\([^)\n]*\)|https?:\/\/[^\s)]+|\*\*|__|~~|\*|_)/g;
  let last=0,match:RegExpExecArray|null;
  while((match=markup.exec(line))){
    push(line.slice(last,match.index),true);
    const token=match[0];
    if(token.startsWith('[')){
      const end=token.indexOf('](');
      push('[',false);push(token.slice(1,end),true);push(token.slice(end),false);
    }else push(token,false);
    last=match.index+token.length;
  }
  push(line.slice(last),true);
  const editable=tokens.filter(t=>t.editable);
  const source=editable.map(t=>t.value).join('');
  return {source,apply:(translation)=>{
    const lengths=editable.map(t=>Array.from(t.value).length);
    const total=lengths.reduce((a,b)=>a+b,0);
    const chars=Array.from(translation);
    let used=0,seen=0;
    editable.forEach((token,index)=>{
      seen+=lengths[index];
      const end=index===editable.length-1?chars.length:
        Math.max(used,Math.min(chars.length,Math.round(chars.length*seen/total)));
      token.value=chars.slice(used,end).join('');used=end;
    });
    commit(tokens.map(t=>t.value).join(''));
  }};
}
function plaintextUnits(source:string,markdown:boolean):{units:Unit[];write:()=>string}{
  // Retain exact original newline delimiters, including CRLF.
  const parts=source.split(/(\r\n|\r|\n)/);
  const units:Unit[]=[];
  let fenced='',frontmatter=false;
  for(let i=0;i<parts.length;i+=2){
    const line=parts[i];
    if(markdown){
      if(i===0&&line.trim()==='---'){frontmatter=true;continue;}
      if(frontmatter){if(/^(---|\.\.\.)\s*$/.test(line))frontmatter=false;continue;}
      const fence=line.match(/^\s{0,3}(\x60{3,}|~{3,})/);
      if(fence){
        if(!fenced)fenced=fence[1];
        else if(fence[1][0]===fenced[0]&&fence[1].length>=fenced.length)fenced='';
        continue;
      }
      if(fenced||/^( {4}|\t| {0,3}!\[| {0,3}\[[^\]]+\]:| {0,3}(?:---+|___+|\*\*\*+)\s*$)/.test(line))continue;
      // Raw HTML and pipe tables need a full Markdown AST to edit safely.
      if(/(<\/?[a-z][^>]*>|\|)/i.test(line))continue;
    }
    const prefix=markdown?(line.match(/^(\s*(?:(?:#{1,6}|>|[-+*]|\d+[.)])\s+))(.*)$/)||[]):[];
    const original=prefix.length?prefix[2]:line;
    if(!original.trim()||/^\s*[\d\W_]+\s*$/.test(original))continue;
    const commit=(translated:string)=>{parts[i]=(prefix.length?prefix[1]:'')+translated;};
    if(markdown){
      const parsed=markdownText(original,commit);
      add(units,parsed.source,parsed.apply);
    }else add(units,original,commit);
  }
  guard(units);
  return {units,write:()=>parts.join('')};
}
async function translateUnits(units:Unit[],translator:BatchTranslate,progress:DocxProgress){
  guard(units);
  let done=0;progress(0,units.length);
  while(done<units.length){
    const batch:Unit[]=[];let chars=0;
    for(let i=done;i<units.length&&batch.length<8;i++){
      const unit=units[i];
      if(batch.length&&chars+unit.source.length>10500)break;
      batch.push(unit);chars+=unit.source.length;
    }
    const translations=await translator(batch.map(u=>u.source));
    if(!Array.isArray(translations)||translations.length!==batch.length||
      translations.some(t=>typeof t!=='string'||!t.trim()))
      throw Error('翻译文本数量不匹配，文件未输出');
    batch.forEach((unit,i)=>unit.apply(translations[i]));
    done+=batch.length;progress(done,units.length);
  }
}
function safePath(path:string):string{
  // Paths are always ZIP-internal. No remote resource loading or filesystem
  // traversal, even when EPUB manifest hrefs have encoded traversal.
  if(!path||/^[\/\\]/.test(path)||/^[a-z][a-z\d+.-]*:/i.test(path)||
      /[?#\\\0]/.test(path))throw Error('EPUB 存在不安全的资源路径');
  let decoded:string;
  try{decoded=decodeURIComponent(path);}catch{throw Error('EPUB 路径编码无效');}
  if(decoded.includes('\\')||decoded.startsWith('/')||decoded.includes('\0'))
    throw Error('EPUB 存在不安全的资源路径');
  const segments:string[]=[];
  for(const bit of decoded.split('/')){
    if(!bit||bit==='.')continue;
    if(bit==='..'){if(!segments.length)throw Error('EPUB 资源路径越界');segments.pop();}
    else segments.push(bit);
  }
  if(!segments.length)throw Error('EPUB 路径不可为空');
  return segments.join('/');
}
function bookChapterNames(zip:JSZip,container:Document):string[]{
  const root=Array.from(container.getElementsByTagNameNS('*','rootfile'))[0];
  const opfPath=safePath(root?.getAttribute('full-path')||'');
  const opfFile=zip.file(opfPath);
  if(!opfFile)throw Error('EPUB 缺少 OPF 包描述文件');
  // This lookup is async at the callsite to keep ZIP reads bounded.
  return [opfPath];
}
async function epubParts(zip:JSZip):Promise<string[]>{
  const mime=zip.file('mimetype');
  if(!mime||(await mime.async('string')).trim()!=='application/epub+zip')
    throw Error('未识别为标准 EPUB 包');
  const first=Object.keys(zip.files).find(k=>!zip.files[k].dir);
  if(first!=='mimetype')throw Error('EPUB 必须把未压缩的 mimetype 放在首项');
  const containerFile=zip.file('META-INF/container.xml');
  if(!containerFile)throw Error('EPUB 缺少 META-INF/container.xml');
  const container=xml(await containerFile.async('string'));
  const opfPath=bookChapterNames(zip,container)[0];
  const packageXml=xml(await zip.file(opfPath)!.async('string'));
  const byId=new Map<string,string>();
  const directory=opfPath.includes('/')?opfPath.slice(0,opfPath.lastIndexOf('/')+1):'';
  for(const item of Array.from(packageXml.getElementsByTagNameNS('*','item'))){
    const id=item.getAttribute('id');
    const href=item.getAttribute('href');
    const media=item.getAttribute('media-type');
    if(!id||!href||!['application/xhtml+xml','text/html'].includes(media||''))continue;
    byId.set(id,safePath(directory+href));
  }
  const chapters:string[]=[];
  for(const item of Array.from(packageXml.getElementsByTagNameNS('*','itemref'))){
    const name=byId.get(item.getAttribute('idref')||'');
    if(name&&!chapters.includes(name)){
      if(!zip.file(name))throw Error('EPUB 正文资源不存在：'+name);
      chapters.push(name);
    }
  }
  if(!chapters.length)throw Error('EPUB 阅读顺序中没有 XHTML 章节');
  if(chapters.length>MAX_CHAPTERS)throw Error('EPUB 超出 800 章限制');
  return chapters;
}
export async function translatePortable(
  buffer:ArrayBuffer,kind:PortableKind,translator:BatchTranslate,
  progress:DocxProgress=()=>{}
):Promise<Uint8Array>{
  ensureFile(buffer);
  const encoder=new TextEncoder();
  if(kind==='txt'||kind==='md'){
    const original=decodeText(buffer);
    const parsed=plaintextUnits(original.text,kind==='md');
    await translateUnits(parsed.units,translator,progress);
    return original.encode(parsed.write());
  }
  if(kind==='html'||kind==='htm'){
    const original=utf8(buffer);
    const doc=new DOMParser().parseFromString(original,'text/html');
    const units=markupUnits(doc);
    await translateUnits(units,translator,progress);
    return encoder.encode((/^\s*<!doctype/i.test(original)?'<!DOCTYPE html>\n':'')+
      doc.documentElement.outerHTML);
  }
  if(kind!=='epub')throw Error('不支持的便携文件类型');
  const zip=await JSZip.loadAsync(buffer,{checkCRC32:true});
  const chapters=await epubParts(zip);
  type Part={path:string;doc:Document;units:Unit[]};
  const parts:Part[]=[];
  let unpacked=0;
  for(const path of chapters){
    const raw=await zip.file(path)!.async('string');
    unpacked+=raw.length;
    if(unpacked>MAX_UNPACKED)throw Error('EPUB 解压正文超过 96 MiB 限制');
    const doc=xml(raw);
    const units=markupUnits(doc);
    parts.push({path,doc,units});
  }
  const units=parts.flatMap(p=>p.units);
  await translateUnits(units,translator,progress);
  for(const part of parts){
    if(part.units.length)
      zip.file(part.path,new XMLSerializer().serializeToString(part.doc));
  }
  // EPUB specification: first ZIP member must remain uncompressed mimetype.
  zip.file('mimetype','application/epub+zip',{compression:'STORE'});
  return zip.generateAsync({type:'uint8array',compression:'DEFLATE'});
}