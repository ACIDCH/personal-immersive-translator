import {translateImage} from './lib/vision.js';
import {normalizeSettings,SETTINGS_KEY} from './lib/settings.js';
const $=id=>document.getElementById(id);
let previewUrl=null;
$('image').addEventListener('change',()=>{
 if(previewUrl) URL.revokeObjectURL(previewUrl);
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
 const file=$('image').files?.[0],status=$('imageStatus');
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
