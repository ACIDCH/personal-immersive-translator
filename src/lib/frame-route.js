/** Select only user-visible, known video hosts; never cross origin boundaries
 * without a separate Chrome site permission grant. Data-only module, safe for
 * browser UI and unit tests. No credentials, private player endpoints or DRM.
 */
const allowed=(host)=>/(^|\.)(youtube\.com|youtube-nocookie\.com)$/.test(host) ||
  /(^|\.)(panopto\.com|panopto\.eu)$/.test(host);
export function approvedOrigin(input){
  try {
    const url=new URL(input);
    if(url.protocol!=='https:'||url.username||url.password||!allowed(url.hostname.toLowerCase()))return null;
    return url.origin;
  }catch{return null;}
}
export function chooseEmbeddedFrame(visibleEmbeds,navigationFrames){
  if(!Array.isArray(visibleEmbeds)||!Array.isArray(navigationFrames))return null;
  const origins=new Set(visibleEmbeds.slice(0,20).map(x=>approvedOrigin(x)).filter(Boolean));
  if(!origins.size)return null;
  const matching=navigationFrames.filter(frame=>
    Number.isInteger(frame.frameId) && frame.frameId>0 && 
    origins.has(approvedOrigin(frame.url)));
  if(!matching.length)return null;
  matching.sort((a,b)=>a.frameId-b.frameId);
  return {frameId:matching[0].frameId,origin:approvedOrigin(matching[0].url)};
}
