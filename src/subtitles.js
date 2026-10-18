/* Native HTML5 TextTrack subtitles. No network scraping or audio capture. */
(() => {
  if (globalThis.__PIT_CAPTION_V1__) return;
  globalThis.__PIT_CAPTION_V1__ = true;
  const core = globalThis.PITCaptionCore;
  const platform = globalThis.PITPlatformCaptions;
  if (!core) return;
  const state = {active:false, generation:0, timer:null, video:null, track:null, originalMode:null, mode:'standard', overlay:null, cache:new core.CaptionCache(),busy:false,failedAt:0,seenAny:false,domMode:false,latestDomText:'',requestCount:0,domPending:false,importedCues:null,boundUrl:null,mediaUrl:null,contextHistory:[],manualSource:''};
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
  function releaseTrack(track, originalMode) {
    // Only undo a mode change that this extension made. A user's new
    // language choice must never be reverted by restoring an old track.
    if(track && originalMode==='disabled' && track.mode==='hidden')
      track.mode='disabled';
  }
  function refreshPlaybackSource() {
    if(state.video && !state.video.isConnected) {
      // A player can replace <video> without navigating. Never keep showing
      // subtitles from the removed player or silently attach to another video.
      stop();return false;
    }
    if(state.video && state.mediaUrl &&
       (state.video.currentSrc || state.video.src || '')!==state.mediaUrl) {
      // A source swap within the same video element is a new recording.
      stop();return false;
    }
    if(!state.video || state.importedCues) return true;
    const next=chooseTrack(state.video);
    if(next===state.track) return true;
    // Track switching must invalidate both previously cached subtitles and
    // any provider response that was started for the old language.
    releaseTrack(state.track,state.originalMode);
    state.track=next;
    state.originalMode=next?.mode ?? null;
    if(next?.mode==='disabled')next.mode='hidden';
    state.generation++;
    state.cache=new core.CaptionCache(350);
    state.busy=false;state.domPending=false;state.failedAt=0;
    state.seenAny=false;state.latestDomText='';state.contextHistory=[];
    state.domMode=!next;
    render('');
    return true;
  }
  function currentRecordingUrl(){
    try {const url=new URL(location.href);url.hash='';return url.href;}
    catch {return '';}
  }
  function render(text, cueText='') {
    if(state.boundUrl && currentRecordingUrl()!==state.boundUrl){stop();return;}
    if(!state.overlay) return;
    if(state.overlay.parentNode!== (document.fullscreenElement || document.documentElement)) {
      (document.fullscreenElement || document.documentElement).append(state.overlay);
    }
    state.overlay.replaceChildren();
    if(!text) { state.overlay.style.display='none'; return; }
    state.overlay.style.display='block';
    // A hidden native TextTrack and an imported SRT/VTT are invisible to the
    // viewer without PIT. Show the original alongside the translation. When
    // the source is already visibly drawn by YouTube/Bilibili/Netflix, avoid
    // displaying a second duplicate original.
    const originalNeeded=Boolean(cueText && !state.domMode &&
      (state.importedCues || state.track?.mode!=='showing'));
    if(originalNeeded){
      const original=document.createElement('div');
      original.className='pit-caption-original';
      original.textContent=cueText;
      state.overlay.append(original);
    }
    const line=document.createElement('div');
    line.className='pit-caption-translated';
    line.textContent=text;
    state.overlay.append(line);
  }
  function createOverlay() {
    const overlay=document.createElement('div');
    overlay.className='pit-caption-overlay';
    overlay.setAttribute('role','status');
    overlay.setAttribute('aria-live','off');
    (document.fullscreenElement || document.documentElement).append(overlay);
    return overlay;
  }
  async function fetchBatch(texts, generation, nearbyText='') {
    // Meaningful subtitles often require preceding dialogue and upcoming
    // utterances. Only add bounded context when the user opted into AI;
    // standard/free machine translation retains the same request behavior.
    const context=state.mode==='ai'
      ?String(nearbyText||'').slice(0,1600):'';
    const response=await chrome.runtime.sendMessage({
      type:'TRANSLATE_BATCH',texts,mode:state.mode,
      // Caption tracks provide a language ISO tag. The browser UI or LMS
      // language may differ from the actual spoken/subtitled language.
      captionSourceLanguage:state.manualSource||state.track?.language||'',
      userInitiated:state.mode==='ai',context
    });
    if(!response?.ok) throw new Error(response?.error || '字幕翻译失败');
    if(state.boundUrl && currentRecordingUrl()!==state.boundUrl){
      stop();throw new Error('播放器录像地址发生变化，字幕会话已停止');
    }
    if(generation!==state.generation || !state.active) return response.translations;
    return response.translations;
  }
  async function tick() {
    if (!state.active) return;
    // A same-frame SPA change can silently switch Panopto recordings without
    // changing frameId or origin. Fail closed before reading any new caption.
    if(state.boundUrl && currentRecordingUrl()!==state.boundUrl){stop();return;}
    if(!refreshPlaybackSource())return;
    // Prefer actual timed cues when available. Some sites advertise a native
    // TextTrack but never populate it, while rendering visible CC in the DOM.
    // Switch to the user's already-visible CC without reading private player
    // requests. Recover automatically if native cues load later.
    if(state.track && !state.importedCues && platform){
      let raw=[];
      try { raw=state.track.cues ? [...state.track.cues] : []; } catch {}
      const timed=core.normalizeCues(raw,state.video?.currentTime);
      const time=state.video?.currentTime ?? 0;
      const canUseTimed=Boolean(core.currentCue(timed,time) ||
        core.upcomingCues(timed,time,state.video?.playbackRate,5).length);
      const visible=platform.readVisibleCaptions(document,location.hostname).text;
      if(!canUseTimed && visible)state.domMode=true;
      else if(canUseTimed && state.domMode){
        state.domMode=false;state.latestDomText='';
        render('');
      }
    }
    if (state.domMode) {
      if (!platform) return;
      const info=platform.readVisibleCaptions(document,location.hostname);
      const text=info.text;
      if(!text){
        state.latestDomText='';
        // An authorized platform may not expose captions until CC is enabled
        // or its player initializes. Stay armed rather than falsely failing.
        // Once a caption has appeared, clear the overlay when CC disappears.
        render(state.seenAny?'':'正在等待播放器显示原文字幕；请开启 CC 字幕。');
        return;
      }
      state.seenAny=true;
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
        const prior=state.contextHistory.join('\n');
        const translations=await fetchBatch([text],generation,prior);
        if(state.active && generation===state.generation) {
          state.cache.put(key,translations[0]);
          if(state.mode==='ai' && state.contextHistory.at(-1)!==text)
            state.contextHistory=[...state.contextHistory.slice(-2),text];
          if(state.latestDomText===text) render(translations[0]);
        }
      } catch {
        if(generation===state.generation){
          state.failedAt=Date.now();
          render('字幕翻译失败，可暂停重试或检查 API 配额');
        }
      } finally {
        if(generation===state.generation)state.domPending=false;
      }
      return;
    }
    if(!state.video || (!state.track && !state.importedCues)) return;
    const generation=state.generation;
    const video=state.video, track=state.track;
    let raw=[];
    try { raw=track?.cues ? [...track.cues] : []; } catch {}
    const cues=core.normalizeCues(state.importedCues || raw,video.currentTime);
    if(!cues.length) {
      // Players clear their cues on CC disable and during track reload.
      // Do not leave a translation from the preceding track visible.
      if(!state.seenAny)
        render('正在等待原生字幕轨加载；若网站使用自绘字幕或无字幕，则此模块无法抓取。');
      else render('');
      return;
    }
    state.seenAny=true;
    const now=video.currentTime;
    renderTimedCues(cues,now);
    if(state.busy || Date.now()-state.failedAt < 3000) return;
    const upcoming=core.upcomingCues(cues,now,video.playbackRate,5);
    if(!upcoming.length || !upcoming.some(c=>!state.cache.has(c.key))) return;
    const budget=state.mode==='ai'?80:1200;
    if(state.requestCount>=budget){render('本次字幕翻译已达到安全请求上限');return;}
    state.requestCount++;
    state.busy=true;
    try {
      const nearby=state.mode==='ai'
        ?cues.filter(c=>c.end>=now-15 && c.start<=now+25)
          .slice(0,10).map(c=>c.text).join('\n'):'';
      await state.cache.prefetch(upcoming,texts=>fetchBatch(texts,generation,nearby));
      if(generation===state.generation && state.active) {
        renderTimedCues(cues,video.currentTime);
      }
    } catch(error) {
      if(generation===state.generation){
        state.failedAt=Date.now();
        render('字幕翻译暂时失败，请检查服务或额度');
      }
    } finally {
      if(generation===state.generation)state.busy=false;
    }
  }
  function renderTimedCues(cues,time){
    const activeCues=core.activeCues(cues,time);
    if(!activeCues.length){render('');return;}
    // Concurrent cues represent different speakers. Display every
    // simultaneously active translated line, never just the latest one.
    render(activeCues.map(c=>state.cache.get(c.key)||'正在翻译…').join('\n'),
      activeCues.map(c=>c.text).join('\n'));
  }
  function stop() {
    state.active=false;state.generation++;
    clearInterval(state.timer);state.timer=null;
    releaseTrack(state.track,state.originalMode);
    state.overlay?.remove();state.overlay=null;
    state.video=null;state.track=null;state.originalMode=null;state.cache.clear();state.busy=false;state.failedAt=0;state.seenAny=false;state.domMode=false;state.latestDomText='';state.requestCount=0;state.domPending=false;state.importedCues=null;state.boundUrl=null;state.mediaUrl=null;state.contextHistory=[];state.manualSource='';
  }
  function embeddedPlayerHint(){
    for(const frame of [...document.querySelectorAll('iframe[src]')].slice(0,40)){
      try{
        const url=new URL(frame.src,location.href);
        const host=url.hostname.toLowerCase();
        if(url.protocol==='https:' &&
          (host==='youtube.com'||host.endsWith('.youtube.com')||
           host==='youtube-nocookie.com'||host.endsWith('.youtube-nocookie.com')||
           host==='panopto.com'||host.includes('.panopto.'))){
          return '检测到跨域嵌入的视频播放器（'+host+'）。当前页面不能读取其内部字幕；请在拥有访问权限的情况下打开源播放器，或选择授权的语音识别。';
        }
      }catch{}
    }
    return '';
  }
  function start(mode, suppliedCues=[], expectedUrl=null, requestedSource='auto') {
    if(expectedUrl!==null && expectedUrl!==undefined){
      let matches=false;
      if(typeof expectedUrl==='string' && expectedUrl.length<=4096){
        try{
          const url=new URL(expectedUrl);
          matches=url.protocol==='https:' && !url.username && !url.password &&
            !url.hash && url.href===currentRecordingUrl();
        }catch{}
      }
      if(!matches)return {ok:false,reason:'播放器录像已切换或身份校验失败，请重新开始字幕翻译。'};
    }
    stop();
    // Manual source overrides unreliable short DOM subtitles, not page UI language.
    state.manualSource=core.normalizeCaptionSource(requestedSource);
    const video=pickVideo();
    const adapter=platform?.identify(location.hostname);
    const visible=adapter && adapter.id!=='generic'
      ? platform.readVisibleCaptions(document,location.hostname) : null;
    const imported=Array.isArray(suppliedCues) && suppliedCues.length
      ? suppliedCues.slice(0,5000) : null;
    if(imported?.length && !video) return {ok:false,reason:'导入 SRT/VTT 需要可访问的视频时间轴，当前播放器未提供。'};
    // Authorized sites may paint visible captions without exposing <video>.
    if(!video && !visible?.text) return {ok:false,
      reason:embeddedPlayerHint()||'没有可访问的视频元素或已显示的字幕。请在播放器中开启原文字幕，或在支持的播放器中导入字幕文件。'};
    const validImport=imported?.length
      ? core.normalizeCues(imported,video.currentTime).length>0 : false;
    if(validImport && !video)return {ok:false,reason:'导入 SRT/VTT 需要可访问的视频时间轴，当前播放器不提供。'};
    const track=validImport ? null : video ? chooseTrack(video) : null;
    // Real platform players often create their TextTrack or visible caption
    // layer *after* the user clicks PIT. A visible, connected video on a
    // known adapter is enough to arm observation; no text is uploaded until
    // caption content actually appears. Generic sites remain fail-closed.
    const waitForPlatformCaptions=Boolean(video && video.isConnected &&
      adapter?.id && adapter.id!=='generic');
    if(!track && !validImport && !visible?.text && !waitForPlatformCaptions)
      return {ok:false,reason:'当前页面没有原生字幕轨，也没有已验证的站点字幕适配器。可使用字幕文件或授权的 ASR。'};
    state.active=true;state.mode=mode;state.video=video;state.track=track;
    // Full-page SPA navigation also changes recording identity; only the
    // document fragment is ignored. An embedded player remains exactly bound
    // to the URL independently confirmed by its parent popup.
    state.boundUrl=expectedUrl ?? currentRecordingUrl();
    state.mediaUrl=video ? (video.currentSrc || video.src || '') : null;
    state.originalMode=track?.mode ?? null;
    state.domMode=!track && !validImport;
    state.importedCues=validImport ? imported : null;
    // Hidden activates disabled native tracks without displaying a second set of original subtitles.
    if(track?.mode==='disabled') track.mode='hidden';
    state.overlay=createOverlay();state.cache=new core.CaptionCache(350);
    state.timer=setInterval(()=>{void tick();},450);
    void tick();
    return {ok:true,reason:state.importedCues?'已加载你提供的 SRT/VTT 字幕，并按视频时间轴进行翻译。':state.domMode?'已开启可见字幕观察：将等待播放器加载/显示原文字幕，未出现字幕前不发送翻译请求。':'原生字幕翻译已启动。'};
  }
  chrome.runtime.onMessage.addListener((msg,_sender,respond)=>{
    if(msg?.type==='PIT_CAPTIONS_START' && ['standard','ai'].includes(msg.mode)) respond(start(msg.mode,msg.cues,msg.expectedUrl,msg.captionSourceLanguage));
    else if(msg?.type==='PIT_CAPTIONS_STOP'){stop();respond({ok:true});}
  });
})();