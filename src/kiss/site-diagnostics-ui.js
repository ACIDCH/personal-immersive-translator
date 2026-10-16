import {scanSite,buildSiteReport} from './site-diagnostics.js';
import {GITHUB_TOKEN_KEY,validateIssueToken,createGitHubDiagnosticIssue}
 from './github-diagnostics.js';

const get=id=>document.getElementById(id);
const fields={
 video:'diagVideo',sourceCaptions:'diagSource',translatedCaptions:'diagTranslate',
 fullscreen:'diagFullscreen',audioAsr:'diagAsr',webTranslation:'diagWebTranslation',
 imageOcr:'diagImageOcr',pdfPreview:'diagPdfPreview',pdfLayout:'diagPdfLayout'
};
let report=null,busy=false;
const info=message=>{get('diagStatus').textContent=message;};
const githubInfo=message=>{get('diagGithubStatus').textContent=message;};
const answers=()=>Object.fromEntries(
 Object.entries(fields).map(([key,id])=>[key,get(id).value])
);
function summary(r){
 return '已检查 '+r.scannedFrames+'/'+r.knownFrames+' 个框架；视频 '+
  r.counts.videoElements+' 个；原生字幕轨 '+r.counts.nativeTracks.total+
  ' 条；可见字幕节点 '+r.counts.visibleCaptionNodes+
  ' 个。结果仅包含所选平台和能力数字。';
}
function clearIssueLink(){
 const a=get('diagIssueLink');a.hidden=true;a.removeAttribute('href');a.textContent='';
}
async function updateTokenState(){
 const saved=(await chrome.storage.local.get(GITHUB_TOKEN_KEY))[GITHUB_TOKEN_KEY];
 githubInfo(validateIssueToken(saved)
   ?'GitHub 授权已配置；可直接一键诊断并上传。'
   :'尚未配置 GitHub 授权。请先保存仅有 Issues 写入权限的 Token。');
}
function reset(){
 report=null;get('diagExport').disabled=true;clearIssueLink();
}
async function scan(verified){
 const tab=await verified();
 const result=await scanSite(tab.id);
 report=buildSiteReport({
  platform:get('diagPlatform').value,frameResults:result.frames,
  knownFrameCount:result.knownFrameCount,scanMode:result.scanMode,
  feedback:answers()
 });
 get('diagExport').disabled=report.scanMode==='failed';
 if(report.scanMode==='failed')
  throw Error('无法读取当前网页结构。请检查页面权限或重新从插件弹窗打开控制台。');
 info(summary(report));
 return report;
}
async function run(action){
 if(busy)return;
 busy=true;
 get('diagScan').disabled=true;get('diagUpload').disabled=true;
 try{await action();}
 catch(e){info('操作失败：'+String(e.message||e));}
 finally{
  busy=false;get('diagScan').disabled=false;get('diagUpload').disabled=false;
 }
}
export function initSiteDiagnostics(verified){
 if(typeof verified!=='function')throw Error('Missing tab verification');
 const platform=get('diagPlatform');
 const exportButton=get('diagExport');
 platform.addEventListener('change',reset);
 for(const id of Object.values(fields))get(id).addEventListener('change',()=>{
  if(!report)return;reset();info('验收结果已修改，请重新检查后上传。');
 });
 get('diagScan').addEventListener('click',()=>run(async()=>{
  reset();await scan(verified);
 }));
 get('diagUpload').addEventListener('click',()=>run(async()=>{
  reset();
  const settings=await chrome.storage.local.get(GITHUB_TOKEN_KEY);
  const token=settings[GITHUB_TOKEN_KEY];
  if(!validateIssueToken(token))
   throw Error('尚未配置 GitHub Issues 专用 Token，请先保存授权');
  // The scan always runs on the CURRENT tab, never reuses stale results.
  const latest=await scan(verified);
  info(summary(latest)+' 正在创建 GitHub Issue…');
  const issue=await createGitHubDiagnosticIssue(latest,token);
  const link=get('diagIssueLink');
  link.href=issue.url;link.textContent='打开 GitHub Issue #'+issue.number;
  link.hidden=false;
  info('诊断报告已成功上传到 GitHub Issue #'+issue.number+
   '。把这个 Issue 编号告诉我，即可继续定位和修复。');
 }));
 get('diagGithubSave').addEventListener('click',()=>run(async()=>{
  const field=get('diagGithubToken');
  const value=field.value.trim();
  if(!validateIssueToken(value))
   throw Error('请输入 GitHub Fine-grained Token（至少 20 个字母、数字或下划线）');
  await chrome.storage.local.set({[GITHUB_TOKEN_KEY]:value});
  field.value='';
  await updateTokenState();
  info('GitHub 授权保存成功。之后直接使用“一键诊断并上传”。');
 }));
 get('diagGithubClear').addEventListener('click',()=>run(async()=>{
  await chrome.storage.local.remove(GITHUB_TOKEN_KEY);
  get('diagGithubToken').value='';
  reset();await updateTokenState();
  info('本机保存的 Token 已清除；如需彻底撤销权限，可在 GitHub 中撤销该 Token。');
 }));
 exportButton.addEventListener('click',()=>{
  if(!report||exportButton.disabled)return;
  const blob=new Blob([JSON.stringify(report,null,2)+'\n'],{type:'application/json'});
  const url=URL.createObjectURL(blob),link=document.createElement('a');
  link.href=url;link.download='PIT-site-check.json';
  document.body.append(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),2000);
  info('诊断 JSON 已在本机保存，可以自行检查内容。');
 });
 void updateTokenState().catch(()=>githubInfo('无法读取 GitHub 授权配置'));
}
