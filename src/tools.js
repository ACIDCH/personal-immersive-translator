import {translateImage} from './lib/vision.js';
import {translateBatch} from './lib/providers.js';
import {normalizeSettings,SETTINGS_KEY} from './lib/settings.js';
const $=id=>document.getElementById(id);
let previewUrl=null;
let screenshotFile=null;
$('image').addEventListener('change',()=>{
 if(previewUrl) URL.revokeObjectURL(previewUrl);
 screenshotFile=null;
 const file=$('image').files?.[0];
 if(file){previewUrl=URL.createObjectURL(file);$('imagePreview').src=previewUrl;$('imagePreview').hidden=false;}
 else {$('imagePreview').hidden=true;}
});
function base64(file){
 return new Promise((resolve,reject)=>{
   const reader=new FileReader();
   reader.onerror=()=>reject(new Error('读取图片失败'));
   reader.onload=()=>resolve(String(reader.result).split(',')[1]);
   reader.readAsDataURL(file);
 });
}
$('imageTranslate').addEventListener('click',async()=>{
 const file=screenshotFile||$('image').files?.[0],status=$('imageStatus');
 if(!file){status.textContent='请先选择图片';return;}
 if(file.size>4_400_000){status.textContent='图片超过本阶段 4.4MB 限制';return;}
 if(!confirm('确认将所选图片上传到 Gemini 进行 OCR + 翻译？可能产生 API 费用。'))return;
 $('imageTranslate').disabled=true;status.textContent='正在识别与翻译…';
 try{
  const obj=await chrome.storage.local.get(SETTINGS_KEY);
  const settings=normalizeSettings(obj[SETTINGS_KEY]);
  const result=await translateImage({mime:file.type,data:await base64(file),key:settings.geminiKey,
    model:settings.geminiModel,target:settings.target});
  $('original').textContent=result.original_text;
  $('translated').textContent=result.translated_text;
  status.textContent='图片翻译成功。';
 }catch(error){status.textContent='识别失败：'+String(error.message||error);}
 finally{$('imageTranslate').disabled=false;}
});
$('pdfTranslate').addEventListener('click',async()=>{
 const file=$('pdf').files?.[0],status=$('pdfStatus');
 if(!file){status.textContent='请先选择 PDF';return;}
 if(file.size>25*1024*1024){status.textContent='PDF 超过 25MB 限制';return;}
 if($('source').value===$('target').value){status.textContent='目标语言不得和原文相同';return;}
 const token=$('token').value;
 if(token.length<16){status.textContent='请输入本机服务启动时设置的令牌';return;}
 if(!confirm('PDF 将发送到本机 BabelDOC 服务，并通过你在本机配置的 DeepSeek API 翻译。可能产生费用。继续？'))return;
 $('pdfTranslate').disabled=true;status.textContent='正在启动本机 OCR / BabelDOC 翻译，较长文件可能需要较久…';
 try{
   const ok=await chrome.permissions.request({origins:['http://127.0.0.1/*']});
   if(!ok)throw new Error('未授权访问本机服务');
   const form=new FormData();form.append('pdf',file,file.name);
   form.append('source',$('source').value);form.append('target',$('target').value);
   form.append('ocr',String($('ocr').checked));
   const response=await fetch('http://127.0.0.1:8765/translate',
     {method:'POST',headers:{'X-PIT-Token':token},body:form,signal:AbortSignal.timeout(930000)});
   if(!response.ok)throw new Error('本机服务错误 HTTP '+response.status);
   const pdf=await response.blob();
   if(pdf.type!=='application/pdf')throw new Error('服务未返回 PDF');
   const url=URL.createObjectURL(pdf);
   const link=document.createElement('a');link.href=url;link.download='translated-bilingual.pdf';
   document.body.append(link);link.click();link.remove();
   setTimeout(()=>URL.revokeObjectURL(url),60000);
   status.textContent='已触发双语 PDF 下载。请检查输出是否保留了所需排版。';
 }catch(error){status.textContent='PDF 翻译失败：'+String(error.message||error);}
 finally{$('pdfTranslate').disabled=false;}
});


$('localOCR').addEventListener('click',async()=>{
 const file=screenshotFile||$('image').files?.[0],status=$('imageStatus'),token=$('token').value;
 if(!file){status.textContent='先选择需要 OCR 的图片';return;}
 if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>8_000_000){status.textContent='只支持不超过 8MB 的 PNG/JPEG/WebP';return;}
 if(token.length<16){status.textContent='先在右侧填写本机服务令牌';return;}
 if(!confirm('确认发送图片到当前电脑的 OCR 服务，然后使用你配置的机器翻译 API 翻译识别出的文字？'))return;
 $('localOCR').disabled=true;status.textContent='正在执行本地 OCR…';
 try{
  const granted=await chrome.permissions.request({origins:['http://127.0.0.1/*']});
  if(!granted)throw new Error('未授权本地 OCR 服务');
  const form=new FormData();form.append('image',file,file.name);form.append('source',$('imageSource').value);
  const response=await fetch('http://127.0.0.1:8765/ocr-image',
   {method:'POST',headers:{'X-PIT-Token':token},body:form,signal:AbortSignal.timeout(110000)});
  if(!response.ok)throw new Error('OCR 服务响应 HTTP '+response.status);
  const result=await response.json();
  const original=String(result.original_text||'').slice(0,12000);
  if(!original.trim())throw new Error('没有检测到可识别的文字');
  $('original').textContent=original;
  status.textContent='识别完成，正在调用常规翻译服务…';
  const settings=normalizeSettings((await chrome.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY]);
  const fragments=original.match(/[\s\S]{1,950}/g)||[];
  const out=[];
  for(let i=0;i<fragments.length;i+=8){
   const translated=await translateBatch(fragments.slice(i,i+8),{
     ...settings,provider:settings.standardProvider,source:$('imageSource').value,target:settings.target});
   out.push(...translated);
  }
  $('translated').textContent=out.join('');
  status.textContent='已完成本地 OCR + 常规翻译。';
 }catch(error){status.textContent='本地 OCR 失败：'+String(error.message||error);}
 finally{$('localOCR').disabled=false;}
});

if(new URLSearchParams(location.search).get('screenshot')==='1'){
 chrome.storage.session.get('pit_ocr_screenshot').then(async obj=>{
  await chrome.storage.session.remove('pit_ocr_screenshot');
  const data=obj.pit_ocr_screenshot;
  if(!data || !data.startsWith('data:image/png;base64,'))return;
  const bytes=Uint8Array.from(atob(data.slice(data.indexOf(',')+1)),c=>c.charCodeAt(0));
  screenshotFile=new File([bytes],'visible-page.png',{type:'image/png'});
  if(previewUrl)URL.revokeObjectURL(previewUrl);
  previewUrl=URL.createObjectURL(screenshotFile);
  $('imagePreview').src=previewUrl;$('imagePreview').hidden=false;
  $('imageStatus').textContent='已载入当前网页截图。请选择 Gemini 或本机 OCR 开始识别。';
 }).catch(e=>$('imageStatus').textContent=String(e.message||e));
}


$('pdf').addEventListener('change',async()=>{
  const file=$('pdf').files?.[0],status=$('pdfPreviewStatus');
  $('pdfPreview').replaceChildren();
  if(!file){status.textContent='';return;}
  status.textContent='正在用 Mozilla PDF.js 在本地解析第一页…';
  try{
    const {previewPdf}=await import('./pdf-preview.js');
    const result=await previewPdf(file,$('pdfPreview'));
    status.textContent=result.needsOCR?'首页可能为扫描页，建议启用 OCR':'首页可读取文字；若包含扫描附件仍建议选择 OCR';
  }catch(error){status.textContent='预览失败：'+String(error.message||error);}
});


$('checkLocalEngines').addEventListener('click',async()=>{
  const token=$('token').value,status=$('localEnginesStatus');
  if(token.length<16){status.textContent='请先输入本机服务令牌';return;}
  status.textContent='正在检测本机服务…';
  try{
    const permission=await chrome.permissions.request({origins:['http://127.0.0.1/*']});
    if(!permission)throw Error('未授权访问本机服务');
    const response=await fetch('http://127.0.0.1:8765/health',{
      headers:{'X-PIT-Token':token},signal:AbortSignal.timeout(6000)
    });
    if(!response.ok)throw Error('服务返回 HTTP '+response.status);
    const capabilities=await response.json();
    const value=key=>capabilities[key]?'已就绪':'未就绪';
    status.textContent='BabelDOC 翻译：'+value('ready')+
      '；扫描 PDF OCR：'+value('pdf_ocr')+
      '；图片 Tesseract：'+value('image_ocr')+
      '；本机 Whisper：'+value('speech_asr')+
      '。未就绪的模块需要依照安装文档补齐依赖和模型。';
  }catch(error){
    status.textContent='无法检测本机引擎：'+String(error.message||error)+
      '。请确认服务已启动于 127.0.0.1:8765，并检查令牌和依赖。';
  }
});
