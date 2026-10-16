/**
 * One-click owner-initiated diagnostics -> GitHub Issue.
 * Browser token: one fixed repo, fine-grained Issues:write ONLY.
 * Never uploads screenshots, URLs, captions, DOM text, cookies, auth state
 * or arbitrary page-provided values. Every outgoing field is allowlisted.
 */
export const GITHUB_TOKEN_KEY='pit_github_issues_pat_v1';
export const GITHUB_ISSUES_URL=
 'https://api.github.com/repos/ACIDCH/personal-immersive-translator/issues';
const ISSUE_PAGE='https://github.com/ACIDCH/personal-immersive-translator/issues/';
const PLATFORMS=new Set(['YouTube','Bilibili','Miss AV','Netflix','Panopto','O2B','Other']);
const CHECKS=[
 'video','sourceCaptions','translatedCaptions','fullscreen','audioAsr',
 'webTranslation','imageOcr','pdfPreview','pdfLayout'
];
const METRICS=['videoElements','visibleVideos','playableVideos','playingVideos',
 'visibleCaptionNodes','iframeElements','visibleIframes'];
const TRACKS=['total','showing','hidden','disabled'];
const VERDICTS=new Set(['pass','fail','not-tested']);
const metric=value=>Number.isFinite(value)?Math.max(0,Math.min(1000,Math.floor(value))):0;

export function safeDiagnosticReport(report){
 if(report?.schema!=='pit-real-site-check-v1')throw Error('诊断报告版本无效，请重新检查网页');
 const timestamp=typeof report.timestamp==='string'&&
  /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(report.timestamp)
    ?report.timestamp:new Date().toISOString();
 const counts=Object.fromEntries(METRICS.map(key=>[key,metric(report.counts?.[key])]));
 counts.nativeTracks=Object.fromEntries(TRACKS.map(key=>
  [key,metric(report.counts?.nativeTracks?.[key])]));
 return {
  schema:'pit-real-site-check-v1',
  timestamp,
  platform:PLATFORMS.has(report.platform)?report.platform:'Other',
  scannedFrames:metric(report.scannedFrames),
  knownFrames:metric(report.knownFrames),
  scanMode:['full','main-frame','failed'].includes(report.scanMode)
   ?report.scanMode:'failed',
  counts,
  checks:Object.fromEntries(CHECKS.map(key=>[
   key,VERDICTS.has(report.checks?.[key])?report.checks[key]:'not-tested'
  ]))
 };
}
export function validateIssueToken(value){
 return typeof value==='string'&&value.length>=20&&value.length<=255&&
  /^[a-zA-Z0-9_]+$/.test(value);
}
export function makeIssuePayload(report){
 const clean=safeDiagnosticReport(report);
 const title='[PIT 兼容性诊断] '+clean.platform+' · '+clean.timestamp.slice(0,10);
 const fence=String.fromCharCode(96,96,96);
 const body=[
  '<!-- PIT_AUTOMATED_DIAGNOSTIC_V1 -->',
  '## 个人插件兼容性诊断（自动提交）',
  '',
  '用户点击“诊断并上传 GitHub”后，从当前选中的网页生成。',
  '平台和功能结果由用户选择；网页结构来自本机能力检查。',
  '不包含网页链接、账号资料、字幕正文、音视频或 API Key。',
  '',
  fence+'json',
  JSON.stringify(clean,null,2),
  fence,
  '',
  '> 该报告仅说明浏览器结构与人工测试状态；不能替代完整实机验证。'
 ].join('\n');
 return {title,body};
}
export async function createGitHubDiagnosticIssue(report,token,fetchFn=fetch){
 if(!validateIssueToken(token))
  throw Error('请先保存该仓库专用的 GitHub Fine-grained Token');
 const payload=makeIssuePayload(report);
 let response;
 try{
  response=await fetchFn(GITHUB_ISSUES_URL,{
   method:'POST',
   headers:{
    Authorization:'Bearer '+token,
    Accept:'application/vnd.github+json',
    'X-GitHub-Api-Version':'2022-11-28',
    'Content-Type':'application/json'
   },
   body:JSON.stringify(payload),
   redirect:'error',
   cache:'no-store',
   signal:AbortSignal.timeout(15000)
  });
 }catch{
  // Never reflect browser error text: it might include an auth header.
  throw Error('无法连接 GitHub，请检查网络；报告仍可本地导出');
 }
 if(!response.ok){
  if(response.status===401)throw Error('GitHub Token 无效或已过期，请重新配置');
  if(response.status===403)throw Error('GitHub 禁止写入：检查 Token 的 Issues Read and write 权限或 API 限额');
  if(response.status===404)throw Error('目标仓库无法写入 Issue，请检查 Token 是否仅授权给 ACIDCH/personal-immersive-translator');
  if(response.status===422)throw Error('GitHub 拒绝诊断报告格式，请重新检测');
  throw Error('GitHub 上传失败（HTTP '+response.status+'）');
 }
 let data;
 try{data=await response.json();}catch{throw Error('GitHub Issue 创建响应无效');}
 const number=data?.number;
 if(!Number.isInteger(number)||number<1||number>999999999)
  throw Error('GitHub Issue 创建响应没有有效编号');
 // Reconstruct URL from constant repo and validated ID, never follow redirects.
 return {number,url:ISSUE_PAGE+number};
}
