/** Create a bilingual side-by-side PNG without removing or inventing pixels
 * from the original. High-quality inpainting is a separate future engine.
 */
export async function bilingualImagePng(file:File,original:string,translations:string[]):Promise<Blob>{
  if(!file.type.startsWith('image/')||file.size>12*1024*1024)throw Error('图片格式或大小不受支持');
  if(!translations.length||translations.some(s=>!s.trim()))throw Error('缺少译文');
  const image=await createImageBitmap(file);
  try{
    const maxWidth=1400;
    const scale=Math.min(1,maxWidth/image.width);
    const iw=Math.max(1,Math.ceil(image.width*scale));
    const ih=Math.max(1,Math.ceil(image.height*scale));
    const panel=Math.max(480,Math.min(1000,iw));
    const spacing=30;const pad=28;const lineHeight=30;
    const scratch=document.createElement('canvas').getContext('2d');
    if(!scratch)throw Error('Canvas 不可用');
    scratch.font='22px system-ui, sans-serif';
    const lines:string[]=[];
    const wrap=(str:string)=>{
      for(const para of String(str).split(/\n/)){
        let row='';
        for(const ch of para){
          if(row && scratch.measureText(row+ch).width>panel-pad*2){
            lines.push(row);row='';
          }
          row+=ch;
        }
        lines.push(row||' ');
      }
    };
    for(let i=0;i<translations.length;i++){
      if(i)lines.push(' ');
      wrap(translations[i]);
    }
    if(lines.length>450)throw Error('译文过长，不能直接生成图片');
    const height=Math.max(ih,70+lines.length*lineHeight+pad);
    if((iw+panel+spacing)*height>25_000_000)throw Error('图片像素过大，请先缩小原图');
    const canvas=document.createElement('canvas');
    canvas.width=iw+panel+spacing;canvas.height=height;
    const ctx=canvas.getContext('2d');
    if(!ctx)throw Error('无法绘制双语图片');
    ctx.fillStyle='#ffffff';ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.drawImage(image,0,0,iw,ih);
    ctx.fillStyle='#edf2f7';ctx.fillRect(iw+spacing,0,panel,height);
    ctx.fillStyle='#1f2937';ctx.font='bold 25px system-ui, sans-serif';
    ctx.fillText('Translated text / 译文',iw+spacing+pad,45,panel-pad*2);
    ctx.font='22px system-ui, sans-serif';
    lines.forEach((line,i)=>ctx.fillText(line,iw+spacing+pad,80+i*lineHeight,panel-pad*2));
    return await new Promise<Blob>((resolve,reject)=>{
      canvas.toBlob(b=>b?resolve(b):reject(Error('PNG 导出失败')),'image/png');
    });
  }finally{image.close();}
}

export type Rect={x0:number;y0:number;x1:number;y1:number};
export type OcrRegion={text:string;bbox:Rect;confidence:number};

/** Tesseract.js v6 only produces position data when blocks:true is requested.
 * Blocks/paragraphs/lines are not guaranteed to be present on every image.
 */
export function ocrLinesFromBlocks(blocks:unknown):OcrRegion[]{
  if(!Array.isArray(blocks))return [];
  const out:OcrRegion[]=[];
  for(const block of blocks.slice(0,250)){
    const paragraphs=block?.paragraphs;
    if(!Array.isArray(paragraphs))continue;
    for(const paragraph of paragraphs.slice(0,150)){
      if(!Array.isArray(paragraph?.lines))continue;
      for(const line of paragraph.lines.slice(0,150)){
        const text=String(line?.text||'').trim().replace(/\s+/g,' ');
        const bbox=line?.bbox;
        if(!text||text.length>4500||!bbox)continue;
        const {x0,y0,x1,y1}=bbox;
        if(![x0,y0,x1,y1].every(v=>typeof v==='number'&&Number.isFinite(v)) ||
           x0<0||y0<0||x1<=x0||y1<=y0)continue;
        const confidence=typeof line.confidence==='number'?line.confidence:0;
        out.push({text,bbox:{x0,y0,x1,y1},confidence});
        if(out.length>=300)return out;
      }
    }
  }
  return out;
}
function median(values:number[]):number{
  const sorted=values.sort((a,b)=>a-b);
  return sorted[Math.floor(sorted.length/2)]||0;
}
/** A conservative in-place replacement for flat backgrounds. Pixels outside
 * OCR rectangles are preserved verbatim. We reject patterned/photo regions;
 * this is NOT semantic image inpainting.
 */
export async function inplaceImagePng(
  file:File,regions:OcrRegion[],translations:string[]
):Promise<Blob>{
  if(file.size>12*1024*1024||!file.type.startsWith('image/'))throw Error('图片格式或大小无效');
  if(!regions.length||regions.length!==translations.length||regions.length>200)
    throw Error('OCR 坐标与翻译行不匹配；请改用双栏模式');
  const bitmap=await createImageBitmap(file);
  try{
    const width=bitmap.width,height=bitmap.height;
    if(width*height>25_000_000)throw Error('图片像素过大');
    const canvas=document.createElement('canvas');
    canvas.width=width;canvas.height=height;
    const ctx=canvas.getContext('2d',{willReadFrequently:true});
    if(!ctx)throw Error('Canvas 不可用');
    ctx.drawImage(bitmap,0,0);
    const original=ctx.getImageData(0,0,width,height);
    const boxes=regions.map((region,i)=>{
      const b=region.bbox;
      const x0=Math.max(0,Math.floor(b.x0)-2),y0=Math.max(0,Math.floor(b.y0)-2);
      const x1=Math.min(width,Math.ceil(b.x1)+2),y1=Math.min(height,Math.ceil(b.y1)+2);
      if(x1-x0<12||y1-y0<9||!translations[i]?.trim())throw Error('文字区域过小或译文为空');
      return {x0,y0,x1,y1,text:translations[i]};
    });
    const boxColors:{box:typeof boxes[number];background:number[];size:number}[]=[];
    // Validate every region *before* painting anything; the output is atomic.
    for(const box of boxes){
      const colors:[number[],number[],number[]]=[[],[],[]];
      const samples:number[][]=[];
      const stride=Math.max(1,Math.floor(Math.min(box.x1-box.x0,box.y1-box.y0)/16));
      const sample=(x:number,y:number)=>{
        if(x<0||y<0||x>=width||y>=height)return;
        const p=(y*width+x)*4;
        const v=[original.data[p],original.data[p+1],original.data[p+2]];
        samples.push(v);for(let i=0;i<3;i++)colors[i].push(v[i]);
      };
      for(let x=box.x0;x<box.x1;x+=stride){
        sample(x,box.y0-3);sample(x,box.y1+2);
      }
      for(let y=box.y0;y<box.y1;y+=stride){
        sample(box.x0-3,y);sample(box.x1+2,y);
      }
      if(samples.length<4)throw Error('OCR 区域靠近图片边缘，无法可靠确定背景颜色');
      const background=colors.map(median);
      const noise=samples.reduce((sum,v)=>sum+v.reduce((z,c,i)=>z+Math.abs(c-background[i]),0)/3,0)/samples.length;
      if(noise>28)throw Error('检测到复杂纹理或照片背景，请改用双栏译文，不进行粗糙覆盖');
      const w=box.x1-box.x0,h=box.y1-box.y0;
      if(w<24||h<12)throw Error('翻译框太小，无法合理排版');
      // Fit translated text into the detected original line box without enlarging it.
      let size=Math.min(48,Math.max(9,Math.floor(h*.77)));
      ctx.textBaseline='middle';
      do{
        ctx.font=`600 ${size}px system-ui,"Noto Sans CJK SC",sans-serif`;
        if(ctx.measureText(box.text).width<=w-6)break;
        size--;
      }while(size>=9);
      if(size<9||ctx.measureText(box.text).width>w-6)
        throw Error('译文无法容纳在原位置，请改用双栏模式');
      boxColors.push({box,background,size});
    }
    for(const {box,background,size} of boxColors){
      ctx.fillStyle=`rgb(${background.join(',')})`;
      ctx.fillRect(box.x0,box.y0,box.x1-box.x0,box.y1-box.y0);
      ctx.font=`600 ${size}px system-ui,"Noto Sans CJK SC",sans-serif`;
      ctx.textBaseline='middle';
      const brightness=.2126*background[0]+.7152*background[1]+.0722*background[2];
      ctx.fillStyle=brightness>=130?'#111827':'#f8fafc';
      ctx.fillText(box.text,box.x0+3,(box.y0+box.y1)/2);
    }
    return await new Promise<Blob>((resolve,reject)=>
      canvas.toBlob(blob=>blob?resolve(blob):reject(Error('无法导出原位置图片')),'image/png'));
  }finally{bitmap.close();}
}

export function splitOcrLines(raw:string):string[]{
  const lines=raw.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  if(!lines.length)return [];
  const blocks:string[]=[];
  for(const line of lines){
    if(line.length<=4500)blocks.push(line);
    else for(let i=0;i<line.length;i+=4300)blocks.push(line.slice(i,i+4300));
  }
  return blocks.slice(0,300);
}
