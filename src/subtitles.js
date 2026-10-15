/* Native HTML5 TextTrack subtitles. No network scraping or audio capture. */
(() => {
  if (globalThis.__PIT_CAPTION_V1__) return;
  globalThis.__PIT_CAPTION_V1__ = true;
  const core = globalThis.PITCaptionCore;
  if (!core) return;
  const state = {active:false, generation:0, timer:null, video:null, track:null, originalMode:null, mode:'standard', overlay:null, cache:new core.CaptionCache(),busy:false,failedAt:0,seenAny:false};
  function allVideos(root, depth=0, output=[]) {
    if (!root || depth>3 || output.length>30) return output;
    const videos=root.querySelectorAll?.('video')||[];
    for(const video of videos) output.push(video);
    const elems=root.querySelectorAll?.('*')||[];
    for(const element of elems) if(element.shadowRoot) allVideos(element.shadowRoot,depth+1,output);
    return output;
  }
  function pickVideo() {
    const videos=allVideos(document);
    return videos.filter(v=>v.isConnected && v.readyState>0)
      .sort((a,b)=>(b.clientWidth*b.clientHeight)-(a.clientWidth*a.clientHeight))[0] || videos[0] || null;
  }
  function chooseTrack(video) {
    const tracks=[...video.textTracks].filter(t=>t.kind==='subtitles'||t.kind==='captions');
    return tracks.find(t=>t.mode==='showing') || tracks.find(t=>t.mode==='hidden') || tracks[0] || null;
  }
  function render(text, cueText='') {
    if(!state.overlay) return;
    if(state.overlay.parentNode!== (document.fullscreenElement || document.documentElement)) {
      (document.fullscreenElement || document.documentElement).append(state.overlay);
    }
    state.overlay.replaceChildren();
    if(!text) { state.overlay.style.display='none'; return; }
    state.overlay.style.display='block';
    const line=document.createElement('div');
    line.className='pit-caption-translated';
    line.textContent=text;
    state.overlay.append(line);
    // Original native CC is normally already visible. Never duplicate it in the overlay.
  }
  function createOverlay() {
    const overlay=document.createElement('div');
    overlay.className='pit-caption-overlay';
    overlay.setAttribute('role','status');
    overlay.setAttribute('aria-live','off');
    (document.fullscreenElement || document.documentElement).append(overlay);
    return overlay;
  }
  async function fetchBatch(texts, generation) {
    const response=await chrome.runtime.sendMessage({type:'TRANSLATE_BATCH',texts,mode:state.mode,userInitiated:state.mode==='ai',context:''});
    if(!response?.ok) throw new Error(response?.error || '字幕翻译失败');
    if(generation!==state.generation || !state.active) return response.translations;
    return response.translations;
  }
  async function tick() {
    if(!state.active || !state.video || !state.track) return;
    const generation=state.generation;
    const video=state.video, track=state.track;
    let raw=[];
    try { raw=track.cues ? [...track.cues] : []; } catch {}
    const cues=core.normalizeCues(raw,video.currentTime);
    if(!cues.length) {
      if(!state.seenAny) render('正在等待原生字幕轨加载；若网站使用自绘字幕或无字幕，则此模块无法抓取。');
      return;
    }
    state.seenAny=true;
    const now=video.currentTime;
    const current=core.currentCue(cues,now);
    render(current ? (state.cache.get(current.key) || '正在翻译…') : '');
    if(state.busy || Date.now()-state.failedAt < 3000) return;
    const upcoming=core.upcomingCues(cues,now,video.playbackRate,5);
    if(!upcoming.length) return;
    state.busy=true;
    try {
      await state.cache.prefetch(upcoming,texts=>fetchBatch(texts,generation));
      if(generation===state.generation && state.active) {
        const fresh=core.currentCue(cues,video.currentTime);
        render(fresh ? (state.cache.get(fresh.key) || '正在翻译…') : '');
      }
    } catch(error) {
      state.failedAt=Date.now();
      if(generation===state.generation) render('字幕翻译暂时失败，请检查服务或额度');
    } finally {state.busy=false;}
  }
  function stop() {
    state.active=false;state.generation++;
    clearInterval(state.timer);state.timer=null;
    if(state.track && state.originalMode!==null && state.track.mode==='hidden') state.track.mode=state.originalMode;
    state.overlay?.remove();state.overlay=null;
    state.video=null;state.track=null;state.originalMode=null;state.cache.clear();state.busy=false;state.failedAt=0;state.seenAny=false;
  }
  function start(mode) {
    stop();
    const video=pickVideo();
    if(!video) return {ok:false,reason:'当前页面没有可访问的 HTML5 视频元素。嵌入式跨域播放器需另行适配。'};
    const track=chooseTrack(video);
    if(!track) return {ok:false,reason:'未发现浏览器原生字幕轨。该网站可能没有字幕，或使用了独立的字幕绘制系统。'};
    state.active=true;state.mode=mode;state.video=video;state.track=track;
    state.originalMode=track.mode;
    // Hidden activates disabled native tracks without displaying a second set of original subtitles.
    if(track.mode==='disabled') track.mode='hidden';
    state.overlay=createOverlay();state.cache=new core.CaptionCache(350);
    state.timer=setInterval(()=>{void tick();},450);
    void tick();
    return {ok:true,reason:'原生字幕翻译已启动；如网站只提供自绘字幕，需要平台专用适配器。'};
  }
  chrome.runtime.onMessage.addListener((msg,_sender,respond)=>{
    if(msg?.type==='PIT_CAPTIONS_START' && ['standard','ai'].includes(msg.mode)) respond(start(msg.mode));
    else if(msg?.type==='PIT_CAPTIONS_STOP'){stop();respond({ok:true});}
  });
})();