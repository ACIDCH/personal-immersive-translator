/* Native HTML5 TextTrack subtitles. No network scraping or audio capture. */
(() => {
  if (globalThis.__PIT_CAPTION_V1__) return;
  globalThis.__PIT_CAPTION_V1__ = true;
  const core = globalThis.PITCaptionCore;
  const platform = globalThis.PITPlatformCaptions;
  if (!core) return;
  const state = {active:false, generation:0, timer:null, video:null, track:null, originalMode:null, mode:'standard', overlay:null, cache:new core.CaptionCache(),busy:false,failedAt:0,seenAny:false,domMode:false,latestDomText:'',requestCount:0,domPending:false,importedCues:null};
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
    if (!state.active) return;
    if (state.domMode) {
      if (!platform) return;
      const info=platform.readVisibleCaptions(document,location.hostname);
      const text=info.text;
      if(!text){render('');return;}
      state.latestDomText=text;
      const key='dom:'+text;
      if(state.cache.has(key)){render(state.cache.get(key));return;}
      const budget=state.mode==='ai'?80:1200;
      if(state.requestCount>=budget){render('本次翻译已达到安全请求上限，请停止后重新开始。');return;}
      render('正在翻译…');
      if(state.domPending || Date.now()-state.failedAt<2500) return;
      state.requestCount++;state.domPending=true;
      const generation=state.generation;
      try {
        const translations=await fetchBatch([text],generation);
        state.cache.put(key,translations[0]);
        if(state.active && generation===state.generation && state.latestDomText===text) render(translations[0]);
      } catch {
        state.failedAt=Date.now();
        if(generation===state.generation) render('字幕翻译失败，可暂停重试或检查 API 配额');
      } finally {state.domPending=false;}
      return;
    }
    if(!state.video || (!state.track && !state.importedCues)) return;
    const generation=state.generation;
    const video=state.video, track=state.track;
    let raw=[];
    try { raw=track?.cues ? [...track.cues] : []; } catch {}
    const cues=core.normalizeCues(state.importedCues || raw,video.currentTime);
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
    if(!upcoming.length || !upcoming.some(c=>!state.cache.has(c.key))) return;
    const budget=state.mode==='ai'?80:1200;
    if(state.requestCount>=budget){render('本次字幕翻译已达到安全请求上限');return;}
    state.requestCount++;
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
    state.video=null;state.track=null;state.originalMode=null;state.cache.clear();state.busy=false;state.failedAt=0;state.seenAny=false;state.domMode=false;state.latestDomText='';state.requestCount=0;state.domPending=false;state.importedCues=null;
  }
  function start(mode, suppliedCues=[]) {
    stop();
    const video=pickVideo();
    const adapter=platform?.identify(location.hostname);
    const visible=adapter && adapter.id!=='generic'
      ? platform.readVisibleCaptions(document,location.hostname) : null;
    // Some authorized players paint captions into DOM while their actual
    // video element is inaccessible. Observable CC still works without it.
    if(!video && !visible?.text) return {ok:false,reason:'没有可访问的视频元素或已显示的字幕。请打开原文字幕，或在支持的播放器中导入字幕文件。'};
    const imported=Array.isArray(suppliedCues) && suppliedCues.length
      ? suppliedCues.slice(0,5000) : null;
    const validImport=imported?.length
      ? core.normalizeCues(imported,video.currentTime).length>0 : false;
    if(validImport && !video)return {ok:false,reason:'导入 SRT/VTT 需要可访问的视频时间轴，当前播放器不提供。'};
    const track=validImport ? null : video ? chooseTrack(video) : null;
    if(!track && !validImport && !visible?.text) return {ok:false,reason:'当前页面没有原生字幕轨，也没有已验证的站点字幕适配器。可使用字幕文件或授权的 ASR。'};
    state.active=true;state.mode=mode;state.video=video;state.track=track;
    state.originalMode=track?.mode ?? null;
    state.domMode=!track && !validImport;
    state.importedCues=validImport ? imported : null;
    // Hidden activates disabled native tracks without displaying a second set of original subtitles.
    if(track?.mode==='disabled') track.mode='hidden';
    state.overlay=createOverlay();state.cache=new core.CaptionCache(350);
    state.timer=setInterval(()=>{void tick();},450);
    void tick();
    return {ok:true,reason:state.importedCues?'已加载你提供的 SRT/VTT 字幕，并按视频时间轴进行翻译。':state.domMode?'已开启可见字幕观察。请打开播放器原文字幕；适配器可能随网站更新而失效。':'原生字幕翻译已启动。'};
  }
  chrome.runtime.onMessage.addListener((msg,_sender,respond)=>{
    if(msg?.type==='PIT_CAPTIONS_START' && ['standard','ai'].includes(msg.mode)) respond(start(msg.mode,msg.cues));
    else if(msg?.type==='PIT_CAPTIONS_STOP'){stop();respond({ok:true});}
  });
})();