/**
 * OCR overlay geometry guard (inspired by high-star Tesseract OCR and
 * manga-image-translator's confidence/region pipeline, not copied source).
 * Fail without painting when a wrongly placed translated box risks erasing
 * unrelated image text. User can still choose lossless side-by-side output.
 */
export function validateOcrOverlayRegions(regions,width,height,{
 minConfidence=35,padding=2
}={}){
 if(!Array.isArray(regions)||!regions.length||regions.length>200||
    !Number.isFinite(width)||!Number.isFinite(height)||width<1||height<1)
  throw Error('无效的图片尺寸或 OCR 行坐标');
 const boxes=regions.map((r,index)=>{
  const b=r?.bbox;
  if(!b||![b.x0,b.y0,b.x1,b.y1].every(x=>Number.isFinite(x))||
    b.x1<=b.x0||b.y1<=b.y0)throw Error('OCR 区域 '+(index+1)+' 坐标无效');
  // Confidence is reported as 0..100 by Tesseract.js. Some external OCR
  // engines do not provide it: zero/undefined means unknown, not low.
  const confidence=Number(r.confidence);
  if(Number.isFinite(confidence)&&confidence>0&&confidence<minConfidence)
   throw Error('第 '+(index+1)+' 行 OCR 置信度过低，请校正识别内容或改用双栏模式');
  const x0=Math.max(0,Math.floor(b.x0)-padding);
  const y0=Math.max(0,Math.floor(b.y0)-padding);
  const x1=Math.min(width,Math.ceil(b.x1)+padding);
  const y1=Math.min(height,Math.ceil(b.y1)+padding);
  if(x1-x0<12||y1-y0<9)
   throw Error('第 '+(index+1)+' 行区域过小，无法安全覆盖');
  // A badly placed OCR rectangle whose majority is out of bounds is not
  // equivalent to a legitimate cropped caption touching an image edge.
  const full=(b.x1-b.x0)*(b.y1-b.y0);
  const inside=Math.max(0,Math.min(b.x1,width)-Math.max(b.x0,0))*
    Math.max(0,Math.min(b.y1,height)-Math.max(b.y0,0));
  if(inside/full<.85)throw Error('OCR 文本框大部分超出图片边界，拒绝覆盖');
  return {x0,y0,x1,y1};
 });
 for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){
  const a=boxes[i],b=boxes[j];
  const overlap=Math.max(0,Math.min(a.x1,b.x1)-Math.max(a.x0,b.x0))*
    Math.max(0,Math.min(a.y1,b.y1)-Math.max(a.y0,b.y0));
  const small=Math.min((a.x1-a.x0)*(a.y1-a.y0),
    (b.x1-b.x0)*(b.y1-b.y0));
  if(overlap>small*.25)
    throw Error('OCR 文本框互相重叠；请改用双栏译文，避免擦除其他文字');
 }
 return boxes;
}
