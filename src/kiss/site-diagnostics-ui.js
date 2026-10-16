import {scanSite,buildSiteReport} from './site-diagnostics.js';

const get=id=>document.getElementById(id);
const fields={
  video:'diagVideo',sourceCaptions:'diagSource',translatedCaptions:'diagTranslate',
  fullscreen:'diagFullscreen',audioAsr:'diagAsr'
};
let report=null;
let busy=false;
function info(text){get('diagStatus').textContent=text;}
function answers(){return Object.fromEntries(
  Object.entries(fields).map(([key,id])=>[key,get(id).value])
);}
function summarize(r){
 return '只收集能力数量：已检查 '+r.scannedFrames+'/'+r.knownFrames+
 ' 个框架；视频 '+r.counts.videoElements+' 个；原生字幕轨 '+
 r.counts.nativeTracks.total+' 条；可见字幕候选节点 '+
 r.counts.visibleCaptionNodes+' 个。不会收集网页地址、课程内容、字幕文本或账号数据。';
}
export function initSiteDiagnostics(verified){
 if(typeof verified!=='function')throw Error('Missing tab verification');
 const scanButton=get('diagScan');
 const exportButton=get('diagExport');
 const platform=get('diagPlatform');
 const reset=()=>{report=null;exportButton.disabled=true;};
 platform.addEventListener('change',reset);
 for(const id of Object.values(fields))get(id).addEventListener('change',()=>{
   if(!report)return;
   // Scan again after changing manual assessments so exported data always
   // corresponds to the visible state and the user's latest selections.
   reset();info('人工测试结果已修改，请重新执行检查后导出。');
 });
 scanButton.addEventListener('click',async()=>{
   if(busy)return;busy=true;scanButton.disabled=true;reset();
   try{
     const tab=await verified();
     const result=await scanSite(tab.id);
     report=buildSiteReport({platform:platform.value,
       frameResults:result.frames,knownFrameCount:result.knownFrameCount,
       scanMode:result.scanMode,feedback:answers()});
     info(summarize(report));
     exportButton.disabled=report.scanMode==='failed';
     if(report.scanMode==='failed')info('浏览器无法读取此页面的播放器结构；可能是受限页面、未授权帧或页面已跳转。');
   }catch(error){info('检查失败：'+String(error.message||error));}
   finally{busy=false;scanButton.disabled=false;}
 });
 exportButton.addEventListener('click',()=>{
   if(!report||exportButton.disabled)return;
   const json=JSON.stringify(report,null,2)+'\n';
   const blob=new Blob([json],{type:'application/json'});
   const url=URL.createObjectURL(blob);
   const a=document.createElement('a');
   a.href=url;a.download='PIT-site-check.json';
   document.body.append(a);a.click();a.remove();
   setTimeout(()=>URL.revokeObjectURL(url),2000);
   info('诊断 JSON 已在本机生成。请自行检查文件内容后，再决定是否分享。');
 });
}
