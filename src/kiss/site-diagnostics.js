/**
 * On-device, opt-in video capability diagnostics.
 *
 * Absolutely no caption text, DOM text, URLs, account identifiers, API keys,
 * tab IDs, cookies, tokens, screenshots or media source paths in the report.
 * The probe is intentionally self-contained to run in chrome.scripting.executeScript.
 */
export function inspectMediaFrame(){
  const doc=document;
  const videos=[...doc.querySelectorAll('video')].slice(0,20);
  const visible=element=>{
    if(!element?.isConnected || !element.getClientRects?.().length)return false;
    const style=getComputedStyle(element);
    if(style.display==='none'||style.visibility!=='visible'||Number(style.opacity)===0)return false;
    const rect=element.getBoundingClientRect();
    return rect.width>=25 && rect.height>=25;
  };
  const selectors=[
    '.ytp-caption-segment',
    '.player-timedtext [data-uia="subtitle-text"]',
    '.player-timedtext-text-container',
    '.captionText','.caption-text','.transcript-text'
  ];
  // Only count matching visible elements, never access their textContent.
  let candidateCount=0;
  for(const selector of selectors){
    try{
      candidateCount+=Math.min(30,[...doc.querySelectorAll(selector)]
        .filter(visible).length);
    }catch{}
  }
  const tracks={total:0,showing:0,hidden:0,disabled:0};
  let playable=0,visibleVideos=0,playing=0;
  for(const video of videos){
    if(visible(video))visibleVideos++;
    if(video.readyState>0)playable++;
    if(!video.paused && !video.ended)playing++;
    for(const track of [...video.textTracks].slice(0,30)){
      if(!['captions','subtitles'].includes(track.kind))continue;
      tracks.total++;
      if(Object.hasOwn(tracks,track.mode))tracks[track.mode]++;
    }
  }
  let visibleIframes=0;
  for(const iframe of [...doc.querySelectorAll('iframe')].slice(0,100))
    if(visible(iframe))visibleIframes++;
  return {
    videoElements:videos.length,visibleVideos,playableVideos:playable,
    playingVideos:playing,nativeTracks:tracks,
    visibleCaptionNodes:Math.min(candidateCount,180),
    iframeElements:Math.min(doc.querySelectorAll('iframe').length,100),
    visibleIframes
  };
}

const CHECKS=['video','sourceCaptions','translatedCaptions','fullscreen','audioAsr'];
const PLATFORMS=new Set(['O2B','Panopto','YouTube','Netflix','Other']);
const VERDICTS=new Set(['pass','fail','not-tested']);
const num=(value,max=999)=>Number.isFinite(Number(value))
  ?Math.max(0,Math.min(max,Math.floor(Number(value)))):0;
export function buildSiteReport({platform,frameResults=[],knownFrameCount=0,scanMode='full',
  feedback={}}={}){
  const counts={videoElements:0,visibleVideos:0,playableVideos:0,
    playingVideos:0,visibleCaptionNodes:0,iframeElements:0,visibleIframes:0,
    nativeTracks:{total:0,showing:0,hidden:0,disabled:0}};
  for(const frame of Array.isArray(frameResults)?frameResults.slice(0,40):[]){
    if(!frame||typeof frame!=='object')continue;
    for(const field of ['videoElements','visibleVideos','playableVideos',
      'playingVideos','visibleCaptionNodes','iframeElements','visibleIframes']){
      counts[field]=Math.min(1000,counts[field]+num(frame[field],100));
    }
    for(const name of Object.keys(counts.nativeTracks))
      counts.nativeTracks[name]=Math.min(1000,
        counts.nativeTracks[name]+num(frame.nativeTracks?.[name],100));
  }
  const checks=Object.fromEntries(CHECKS.map(k=>[
    k,VERDICTS.has(feedback?.[k])?feedback[k]:'not-tested'
  ]));
  return {
    schema:'pit-real-site-check-v1',timestamp:new Date().toISOString(),
    platform:PLATFORMS.has(platform)?platform:'Other',
    scannedFrames:Math.min(40,Array.isArray(frameResults)?frameResults.length:0),
    knownFrames:num(knownFrameCount,100),
    scanMode:['full','main-frame','failed'].includes(scanMode)?scanMode:'failed',
    counts,checks,
    warnings:[
      'Aggregated capability metadata only; not proof translation succeeded',
      'Frame counts do not imply frame access; site-specific player behavior requires user testing'
    ]
  };
}

export async function scanSite(tabId,chromeApi=chrome){
  if(!Number.isInteger(tabId)||tabId<=0)throw Error('未选择有效网页标签页');
  let frames=[],scanMode='full',knownFrameCount=0;
  try{
    const info=await chromeApi.webNavigation.getAllFrames({tabId});
    knownFrameCount=Array.isArray(info)?info.length:0;
  }catch{}
  try{
    const result=await chromeApi.scripting.executeScript({
      target:{tabId,allFrames:true},func:inspectMediaFrame
    });
    frames=(result||[]).map(x=>x?.result).filter(Boolean);
  }catch{
    scanMode='main-frame';
    try{
      const result=await chromeApi.scripting.executeScript({
        target:{tabId,frameIds:[0]},func:inspectMediaFrame
      });
      frames=(result||[]).map(x=>x?.result).filter(Boolean);
    }catch{
      scanMode='failed';
    }
  }
  return {frames,knownFrameCount,scanMode};
}
