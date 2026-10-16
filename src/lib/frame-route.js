/** Select only user-visible, known video hosts; never cross origin boundaries
 * without a separate Chrome site permission grant. Data-only module, safe for
 * browser UI and unit tests. No credentials, private player endpoints or DRM.
 */
const allowed=(host)=>/(^|\.)(youtube\.com|youtube-nocookie\.com)$/.test(host) ||
  /(^|\.)(panopto\.com|panopto\.eu)$/.test(host);
function approvedFrameUrl(input){
  try{
    const url=new URL(input);
    if(url.protocol!=='https:' || url.username || url.password ||
       !allowed(url.hostname.toLowerCase()))return null;
    url.hash='';
    return url.href;
  }catch{return null;}
}
export function approvedOrigin(input){
  const address=approvedFrameUrl(input);
  return address?new URL(address).origin:null;
}
export function chooseEmbeddedFrame(visibleEmbeds,navigationFrames){
  if(!Array.isArray(visibleEmbeds) || !Array.isArray(navigationFrames))return null;
  // Exact URL (including query) is essential: different Panopto recordings
  // under one origin may expose different course subtitles. Never print URLs.
  const visible=new Set(visibleEmbeds.slice(0,20).map(approvedFrameUrl).filter(Boolean));
  if(!visible.size)return null;
  const matches=navigationFrames.filter(frame=>
    Number.isInteger(frame.frameId) && frame.frameId>0 &&
    visible.has(approvedFrameUrl(frame.url)));
  // Ambiguous iframe identity is not permission to read a random recording.
  if(matches.length!==1)return null;
  return {frameId:matches[0].frameId,origin:approvedOrigin(matches[0].url)};
}
