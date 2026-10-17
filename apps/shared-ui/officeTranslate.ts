import JSZip from 'jszip';
import type {BatchTranslate,DocxProgress} from './docxTranslate';

export type OfficeKind='pptx'|'xlsx';
/** Keep DrawingML style runs independently editable. Paragraph text is
 * translated as one context unit then distributed proportionally among
 * existing a:t nodes; semantic emphasis matching still needs alignment.
 */
function fillStyledNodes(nodes:Element[],translated:string):void{
 const lengths=nodes.map(n=>Array.from(n.textContent||'').length);
 const total=lengths.reduce((a,b)=>a+b,0);
 if(!total)return;
 const chars=Array.from(translated);
 let used=0,sourceOffset=0;
 for(let i=0;i<nodes.length;i++){
   sourceOffset+=lengths[i];
   const end=i===nodes.length-1?chars.length:
     Math.min(chars.length,Math.max(used,Math.round(chars.length*sourceOffset/total)));
   nodes[i].textContent=chars.slice(used,end).join('');
   if(nodes[i].textContent)nodes[i].setAttribute('xml:space','preserve');
   used=end;
 }
}
type Part={name:string,doc:Document,nodes:Element[][],strings:string[]};
const MAX_SIZE=48*1024*1024;
const MAX_XML=64*1024*1024;
const MAX_SEGMENTS=20000;
const MAX_CHARACTERS=3000000;
const elementNodes=(e:Element,name:string):Element[]=>
  Array.from(e.getElementsByTagName(name));

function sourceParts(zip:JSZip,kind:OfficeKind):string[]{
  const names=Object.keys(zip.files);
  if(kind==='pptx')return names.filter(n=>/^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a,b)=>Number(a.match(/slide(\d+)/)?.[1])-Number(b.match(/slide(\d+)/)?.[1]));
  const shared=names.includes('xl/sharedStrings.xml')?['xl/sharedStrings.xml']:[];
  return [...shared,...names.filter(n=>/^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort()];
}
function readable(doc:Document,kind:OfficeKind,name:string):Element[][]{
  if(kind==='pptx')return elementNodes(doc.documentElement,'a:p').map(p=>elementNodes(p,'a:t')).filter(a=>a.length);
  if(name.endsWith('sharedStrings.xml'))
    return elementNodes(doc.documentElement,'si').map(p=>elementNodes(p,'t')).filter(a=>a.length);
  // XLSX inline string <c t="inlineStr"><is><t>.. ; never translate formulas.
  return elementNodes(doc.documentElement,'is').map(p=>elementNodes(p,'t')).filter(a=>a.length);
}
async function parse(buffer:ArrayBuffer,kind:OfficeKind):Promise<{zip:JSZip,parts:Part[],strings:string[]}>{
  if(!buffer.byteLength||buffer.byteLength>MAX_SIZE)throw Error('Office 文件不能超过 48 MiB');
  const zip=await JSZip.loadAsync(buffer,{checkCRC32:true});
  const names=sourceParts(zip,kind);
  if(kind==='pptx'&&!names.some(n=>n.startsWith('ppt/slides/slide')))
    throw Error('PPTX 未找到幻灯片结构');
  if(kind==='xlsx'&&!Object.keys(zip.files).includes('xl/workbook.xml'))
    throw Error('XLSX 未找到工作簿结构');
  const parts:Part[]=[];let totalBytes=0;let count=0;let chars=0;
  for(const name of names){
    const xml=await zip.file(name)!.async('string');
    totalBytes+=xml.length;if(totalBytes>MAX_XML)throw Error('解压后的 Office XML 文件过大');
    const doc=new DOMParser().parseFromString(xml,'application/xml');
    if(doc.getElementsByTagName('parsererror').length)throw Error('无法解析 Office XML '+name);
    const nodes=readable(doc,kind,name);
    const filtered=nodes.map(n=>({nodes:n,text:n.map(x=>x.textContent||'').join('')}))
      .filter(x=>x.text.trim());
    for(const item of filtered){
      chars+=item.text.length;count++;
    }
    if(chars>MAX_CHARACTERS||count>MAX_SEGMENTS)throw Error('Office 本次处理超过 20000 段、300 万字符');
    parts.push({name,doc,nodes:filtered.map(x=>x.nodes),strings:filtered.map(x=>x.text)});
  }
  return {zip,parts,strings:parts.flatMap(p=>p.strings)};
}
export async function inspectOfficeText(buffer:ArrayBuffer,kind:OfficeKind):Promise<string>{
  const parsed=await parse(buffer,kind);
  return parsed.strings.join('\n').slice(0,180000);
}
export async function translateOffice(
  buffer:ArrayBuffer,kind:OfficeKind,translator:BatchTranslate,
  progress:DocxProgress=()=>{}
):Promise<Uint8Array>{
  const {zip,parts,strings}=await parse(buffer,kind);
  let done=0;
  progress(0,strings.length);
  const results:string[]=[];
  while(done<strings.length){
    if(strings[done].length>4500){
      const chars=Array.from(strings[done]),pieces:string[]=[];
      for(let offset=0;offset<chars.length;offset+=3400){
        const translated=await translator([chars.slice(offset,offset+3400).join('')]);
        if(translated.length!==1||!translated[0]?.trim())
          throw Error('Office 超长段落翻译失败');
        pieces.push(translated[0]);
      }
      results.push(pieces.join(''));done++;progress(done,strings.length);continue;
    }
    const batch:string[]=[];let sum=0;
    for(let i=done;i<strings.length&&batch.length<8;i++){
      const value=strings[i];
      if(batch.length&&sum+value.length>10500)break;
      batch.push(value);sum+=value.length;
    }
    const values=await translator(batch);
    if(values.length!==batch.length||values.some(v=>typeof v!=='string'||!v.trim()))
      throw Error('翻译服务返回的 Office 文本数量不一致');
    results.push(...values);done+=batch.length;progress(done,strings.length);
  }
  let offset=0;
  const serializer=new XMLSerializer();
  for(const part of parts){
    for(const nodes of part.nodes){
      fillStyledNodes(nodes,results[offset++]);
    }
    if(part.nodes.length)zip.file(part.name,serializer.serializeToString(part.doc));
  }
  return zip.generateAsync({type:'uint8array',compression:'DEFLATE'});
}
