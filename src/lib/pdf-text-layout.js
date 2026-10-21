/**
 * PDF.js TextContent reading-flow reconstruction (Apache-2.0 PDF.js API).
 *
 * PDF.js emits positioned text runs, not semantic paragraphs. Treating each
 * run as its own paragraph fractures words, formulas and bullet points. This
 * conservative adapter respects PDF.js item order, hasEOL and line geometry;
 * it does NOT pretend to reconstruct arbitrary multi-column academic layout.
 * BabelDOC remains the opt-in, separately deployed high-fidelity path.
 */
function adjacentCjk(a,b){
 return /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]$/u.test(a)&&
  /^[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/u.test(b);
}
export function pdfTextLines(content){
 const items=Array.isArray(content?.items)?content.items:[];
 const result=[];
 let line='',previous=null;
 const flush=()=>{
  if(line.trim())result.push(line.trim().replace(/[ \t]+/g,' '));
  line='';previous=null;
 };
 for(const item of items.slice(0,150000)){
  if(!item||typeof item.str!=='string')continue;
  const raw=item.str;
  if(!raw.trim()){
   if(item.hasEOL)flush();
   else if(line&&!line.endsWith(' '))line+=' ';
   continue;
  }
  const transform=item.transform;
  const geom=Array.isArray(transform)&&transform.length>=6&&
   Number.isFinite(transform[4])&&Number.isFinite(transform[5]);
  const x=geom?Number(transform[4]):null,y=geom?Number(transform[5]):null;
  const fontHeight=Math.max(6,Math.abs(Number(item.height)||0));
  if(previous&&geom&&previous.x!==null){
   const changedRow=Math.abs(y-previous.y)>Math.max(4,fontHeight*.42);
   const movedBack=x<previous.x-2;
   if(changedRow||movedBack)flush();
  }
  if(line){
   const prevText=previous?.raw||'';
   // Some PDF.js writers already include whitespace in their spans.
   // Only add spaces for actual visual gaps; never space adjacent CJK.
   const prevEnd=previous?.x!==null&&previous?.x!==undefined?
     previous.x+Math.max(0,previous.width):null;
   const gap=geom&&prevEnd!==null?x-prevEnd:null;
   const explicit=raw.startsWith(' ')||line.endsWith(' ');
   const separated=gap!==null&&gap>Math.max(1.5,fontHeight*.18);
   const unknownGap=gap===null&&!previous?.geom;
   if(!explicit&&!adjacentCjk(line,raw)&&(separated||unknownGap)&&
      !/^[,.;:!?。，；！？)}\]]/.test(raw))line+=' ';
  }
  line+=raw;
  previous={x,y,geom,raw,width:Math.max(0,Number(item.width)||0)};
  if(item.hasEOL)flush();
 }
 flush();
 return result;
}
