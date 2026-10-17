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
