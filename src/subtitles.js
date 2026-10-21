/* Native HTML5 TextTrack subtitles. No network scraping or audio capture. */
(() => {
  if (globalThis.__PIT_CAPTION_V1__) return;
  globalThis.__PIT_CAPTION_V1__ = true;
  const core = globalThis.PITCaptionCore;
  const platform = globalThis.PITPlatformCaptions;
  if (!core) return;
  let config={enabled:true,playerQuickToggle:false,preferPitTranslationOverPlatformMT:true},quick=null,settingsReady=Promise.resolve(),lastError='',manuallyStopped=false;
  const taskPrefix='captions-'+(globalThis.crypto?.randomUUID?.()||Date.now().toString(36)+'-'+Math.random().toString(36).slice(2));
  const platformId=()=>/youtube/.test(location.hostname)?'youtube':/bilibili/.test(location.hostname)?'bilibili':/netflix/.test(location.hostname)?'netflix':/panopto/.test(location.hostname)?'panopto':'generic';
  function dialogue(text){return config.focusDialogueOnly?text.replace(/\[(?:music|applause|laughter|laughing|sighs?|gasps?|noise|silence)\]|[（(](?:音乐|笑声|掌声|叹气|背景音)[）)]/gi,'').trim():text;}
  function prepareCues(cues){return cues.map(c=>({...c,text:dialogue(c.text)})).filter(c=>c.text);}
  function quickToggle(){
    const v=pickVideo();
    if(!config.enabled||!config.playerQuickToggle||!v||!v.getClientRects().length){quick?.remove();quick=null;return;}
    if(!quick){quick=document.createElement('button');quick.type='button';quick.className='pit-player-toggle';quick.onclick=()=>{manuallyStopped=state.active;if(state.active)stop();else{const result=start('standard');if(!result.ok){lastError=result.reason;quick.title=result.reason;}}quickToggle();};}
    const parent=document.fullscreenElement||document.documentElement;if(quick.parentNode!==parent)parent.append(quick);
    quick.textContent=state.active?'PIT · 停止字幕':'PIT · 双语字幕';quick.setAttribute('aria-pressed',String(state.active));
    const rect=v.getBoundingClientRect();quick.style.top=Math.max(8,Math.min(innerHeight-45,rect.top+12))+'px';quick.style.right=Math.max(8,innerWidth-rect.right+12)+'px';
  }
  function autoStart(){quickToggle();if(config.enabled&&config.autoStart&&!manuallyStopped&&!state.active){const v=pickVideo();const visible=platform?.readVisibleCaptions(document,location.hostname)?.text;if(v&&([...v.textTracks].some(t=>t.cues?.length)||visible))start('standard');}}
  async function refreshConfig(){
    const r=await chrome.runtime.sendMessage({type:'PIT_PUBLIC_PREFERENCES'});if(!r?.preferences?.videoSettings)return;
    const p=r.preferences,v=p.videoSettings,o=v.siteOverrides?.[platformId()]||{};
    const blocked=String(p.blockedHosts||'').split(/[\s,;]+/).filter(Boolean).some(h=>location.hostname===h||location.hostname.endsWith('.'+h));
    const next={...v,enabled:v.enabled&&o.enabled!==false&&!blocked,autoStart:o.autoStart??v.autoStartSupportedSites,providerId:o.providerId&&o.providerId!=='inherit'?o.providerId:v.providerId};
    const restart=state.active&&JSON.stringify(config)!==JSON.stringify(next),previous={mode:state.mode,cues:state.importedCues,source:state.manualSource};config=next;
    if(!config.enabled||(platformId()==='youtube'&&!config.preferPitTranslationOverPlatformMT))stop();
    else if(restart)start(previous.mode,previous.cues||[],null,previous.source);
    quickToggle();autoStart();
  }
  const state = {active:false, generation:0, timer:null, video:null, track:null, originalMode:null, mode:'standard', overlay:null, cache:new core.CaptionCache(),busy:false,failedAt:0,seenAny:false,domMode:false,latestDomText:'',requestCount:0,domPending:false,importedCues:null,boundUrl:null,mediaUrl:null,contextHistory:[],languageSamples:[],manualSource:'',nativePatches:new Map(),renderRoute:'none'};
  function rememberCaptionLanguage(text){
    const sample=String(text||'').trim().slice(0,400);
    if(!sample||state.languageSamples.at(-1)===sample)return;
    state.languageSamples=[...state.languageSamples.slice(-7),sample];
  }
  function allVideos(root, depth=0, output=[]) {
    if (!root || depth>3 || output.length>30) return output;
    const videos=root.querySelectorAll?.('video')||[];
    for(const video of videos) output.push(video);
    const elems=root.querySelectorAll?.('*')||[];
    for(const element of elems) if(element.shadowRoot) allVideos(element.shadowRoot,depth+1,output);
    return output;
  }
  function pickVideo() {
    const videos=allVideos(document).filter(v=>v.isConnected);
    // Hidden advertisements/preloaded players may be much larger than the
    // lecture currently on screen. Prefer a visible player, even if its
    // media is still initializing (readyState=0).
    const visible=videos.filter(v=>{
      const style=getComputedStyle(v);
      const bounds=v.getBoundingClientRect();
      return style.display!=='none' && style.visibility!=='hidden' &&
        bounds.width>0 && bounds.height>0 && v.getClientRects().length>0;
    });
    const choose=items=>items.sort((a,b)=>{
      const area=v=>v.getBoundingClientRect().width*v.getBoundingClientRect().height;
      return area(b)-area(a) || b.readyState-a.readyState;
    })[0]||null;
    return choose(visible)||choose(videos);
  }
  function chooseTrack(video) {
    const tracks=[...video.textTracks].filter(t=>t.kind==='subtitles'||t.kind==='captions');
    const desired=config.source&&config.source!=='auto'?config.source:'';
    const matched=desired?tracks.filter(t=>t.language?.split('-')[0]===desired):tracks;
    // HTML TextTrack has no standard human/auto flag. Only explicit metadata
    // supplied by the publisher is trusted; labels are never guessed.
    if(config.preferHumanCaptions){const human=matched.find(t=>[...video.querySelectorAll('track')].some(el=>el.track===t&&el.dataset.pitCaptionKind==='human'));if(human)return human;}
    if(desired&&matched.length)return matched.find(t=>t.mode==='showing')||matched[0];
    return tracks.find(t=>t.mode==='showing') || tracks.find(t=>t.mode==='hidden') || tracks[0] || null;
  }
  function releaseTrack(track, originalMode) {
    if(!track)return;
    // Restore a track visibility state that PIT changed for in-player
    // captions. A user switching the caption track remains in control.
    if((originalMode==='disabled'||originalMode==='hidden') &&
       (track.mode==='hidden'||track.mode==='showing'))
      track.mode=originalMode;
  }
  function refreshPlaybackSource() {
    if(state.video && !state.video.isConnected) {
      // A player can replace <video> without navigating. Never keep showing
      // subtitles from the removed player or silently attach to another video.
      stop();return false;
    }
    if(state.video){
      const current=state.video.currentSrc || state.video.src || '';
      if(state.mediaUrl && current && current!==state.mediaUrl){
        // A source swap within the same video element is a new recording.
        stop();return false;
      }
      // A video can be armed before src/currentSrc is assigned. Bind the
      // first real media identity, then detect later same-element swaps.
      if(!state.mediaUrl && current)state.mediaUrl=current;
    }
    if(!state.video || state.importedCues) return true;
    const next=chooseTrack(state.video);
    if(next===state.track) return true;
    // Track switching must invalidate both previously cached subtitles and
    // any provider response that was started for the old language.
    restoreNativeTrack();
    platform?.restoreVisibleCaptions?.();
    releaseTrack(state.track,state.originalMode);
    state.track=next;
    state.originalMode=next?.mode ?? null;
    if(next?.mode==='disabled')next.mode='hidden';
    state.generation++;
    state.cache=new core.CaptionCache(350,{deduplicateText:state.mode!=='ai'});
    state.busy=false;state.domPending=false;state.failedAt=0;
    state.seenAny=false;state.latestDomText='';state.contextHistory=[];state.languageSamples=[];
    state.renderRoute='none';state.domMode=!next;
    render('');
    return true;
  }
  function currentRecordingUrl(){
    try {const url=new URL(location.href);url.hash='';return url.href;}
    catch {return '';}
  }
  function restoreNativeTrack(){
    for(const [cue,record] of state.nativePatches){
      try{
        // Restore only PIT-owned changes, never overwrite newly loaded CC.
        if(cue.text===record.translated)cue.text=record.original;
      }catch{}
    }
    state.nativePatches.clear();
  }
  function originalNativeCue(cue){
    const record=state.nativePatches.get(cue);
    if(record && cue.text===record.translated)
      return {startTime:cue.startTime,endTime:cue.endTime,text:record.original};
    if(record)state.nativePatches.delete(cue);
    return cue;
  }
  function inlineNativeTranslation(cues,time){
    if(config.subtitleRenderMode!=='replace-track'||state.domMode||
       state.importedCues||!state.track||state.track.mode==='disabled')return false;
    let raw=[];
    try{raw=state.track.cues?[...state.track.cues]:[];}catch{return false;}
    const patches=[];
    for(const item of raw){
      if(item.startTime>time+.15||item.endTime<time-.10)continue;
      const source=originalNativeCue(item);
      const normalized=core.normalizeCues([source],time);
      if(!normalized.length||!cues.some(c=>c.key===normalized[0].key))continue;
      const translation=state.cache.get(normalized[0].key);
      if(typeof translation!=='string'||!translation.trim())return false;
      // Never insert provider HTML/VTT markup into a native caption track.
      const plain=core.cleanText(translation);
      if(!plain)return false;
      patches.push({item,original:source.text,translated:plain});
    }
    if(!patches.length)return false;
    try{
      for(const entry of patches){
        if(entry.item.text!==entry.translated){
          entry.item.text=entry.translated;
          state.nativePatches.set(entry.item,entry);
        }
      }
      // HTML5 tracks are often hidden solely to read cue data. Make them
      // visible only after valid translated cues exist, then restore the
      // original mode on STOP/track switch.
      if(state.track.mode==='hidden')state.track.mode='showing';
      state.renderRoute='native-track';
      return true;
    }catch{restoreNativeTrack();return false;}
  }
  function updateOverlayGeometry(){
    const overlay=state.overlay,video=state.video;
    if(!overlay)return;
    const box=video?.isConnected?video.getBoundingClientRect():null;
    // Keep translation WITHIN the actual player, not at global viewport bottom.
    if(box && box.width>=120 && box.height>=75){
      const width=Math.min(box.width*.92,1100),left=box.left+(box.width-width)/2;
      const top=box.top+(config.subtitlePosition==='top'?box.height*.075:box.height*.74);
      overlay.style.setProperty('left',Math.max(0,left)+'px','important');
      overlay.style.setProperty('top',Math.max(0,top)+'px','important');
      overlay.style.setProperty('width',Math.min(width,innerWidth)+'px','important');
      overlay.style.setProperty('transform','none','important');
      overlay.style.setProperty('bottom','auto','important');
    }else{
      overlay.style.setProperty('left','50%','important');
      overlay.style.setProperty('top',config.subtitlePosition==='top'?'8%':'auto','important');
      overlay.style.setProperty('bottom',config.subtitlePosition==='top'?'auto':'12%','important');
      overlay.style.setProperty('width','min(85vw,1100px)','important');
      overlay.style.setProperty('transform','translateX(-50%)','important');
    }
  }
  function render(text, cueText='') {
    if(state.boundUrl && currentRecordingUrl()!==state.boundUrl){stop();return;}
    if(!state.overlay) return;
    // Strict original-player mode never displays external subtitles or status text.
    // Waiting, HTTP and ASR failures belong in diagnostics, not on the video.
    if(config.subtitleRenderMode==='replace-track'){
      state.overlay.replaceChildren();
      state.overlay.style.display='none';
      return;
    }
    if(state.overlay.parentNode!== (document.fullscreenElement || document.documentElement)) {
      (document.fullscreenElement || document.documentElement).append(state.overlay);
    }
    updateOverlayGeometry();
    state.overlay.replaceChildren();
    if(!text) { state.overlay.style.display='none'; return; }
    state.overlay.style.display='block';
    state.renderRoute='overlay';
    state.overlay.style.fontSize=(config.subtitleFontSize||22)+'px';
    state.overlay.style.color=config.subtitleColor||'#ffffff';state.overlay.style.backgroundColor=config.subtitleBackground||'#142130';
    // Placement is resolved against the actual video bounds above.
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
    line.style.setProperty('font-size',(config.subtitleFontSize||22)+'px','important');line.style.setProperty('color',config.subtitleColor||'#ffffff','important');line.style.setProperty('background-color',config.subtitleBackground||'#142130','important');
    line.textContent=config.baseSentenceSegmentation?text.replace(/([.!?。！？])\s+/g,'$1\n'):text;
    if(config.translationFirst)state.overlay.prepend(line);else state.overlay.append(line);
  }
  function createOverlay() {
    const overlay=document.createElement('div');
    overlay.className='pit-caption-overlay';
    overlay.setAttribute('role','status');
    overlay.setAttribute('aria-live','off');
    overlay.style.display='none';
    (document.fullscreenElement || document.documentElement).append(overlay);
    return overlay;
  }
  async function fetchBatch(texts, generation, nearbyText='') {
    // Meaningful subtitles often require preceding dialogue and upcoming
    // utterances. Only add bounded context when the user opted into AI;
    // standard/free machine translation retains the same request behavior.
    const context=state.mode==='ai'
      ?String(nearbyText||'').slice(0,1600):'';
    // MV3 worker shutdown or a slow model must not stall subtitles forever.
    // Timeout stops waiting only: it cannot cancel an already accepted call.
    const reply=chrome.runtime.sendMessage({
      type:'TRANSLATE_BATCH',texts,mode:state.mode,pageContext:'video',taskId:taskPrefix+'-'+generation,
      captionSourceLanguage:state.manualSource||state.track?.language||'',
      captionLanguageSample:state.mode==='standard'?state.languageSamples.join(' ').slice(-1600):'',
      userInitiated:state.mode==='ai',context
    });
    let timeout;
    const response=await Promise.race([
      reply,
      new Promise((_,reject)=>{timeout=setTimeout(
        ()=>reject(Error('字幕翻译服务超过 25 秒未返回，请检查网络或模型')),25000);})
    ]).finally(()=>clearTimeout(timeout));
    if(!response?.ok) throw new Error(response?.error || '字幕翻译失败');
    // A service-worker restart, outdated adapter or partial upstream reply
    // must not be counted as successfully translated speaker windows.
    // Reject the *entire* response before any cue cache/DOM mutation.
    if(!Array.isArray(response.translations)||
       response.translations.length!==texts.length||
       response.translations.some(t=>typeof t!=='string'||!t.trim()))
      throw new Error('字幕译文数量不匹配或包含空译文，未写入播放器');
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
    if(state.mode==='ai' && state.failedAt){
      // Do not conceal a paid-provider error behind "translating" or
      // silently spend more calls every 450 ms while a model is unavailable.
      render('AI 字幕调用失败，已停止自动重试；请检查模型/额度后手动重新启动。');
      return;
    }
    // Prefer actual timed cues when available. Some sites advertise a native
    // TextTrack but never populate it, while rendering visible CC in the DOM.
    // Switch to the user's already-visible CC without reading private player
    // requests. Recover automatically if native cues load later.
    if(state.track && !state.importedCues && platform){
      let raw=[];
      try { raw=state.track.cues ? [...state.track.cues] : []; } catch {}
      const timed=core.normalizeCues(raw.map(originalNativeCue),state.video?.currentTime);
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
      const visible=platform.readVisibleCaptionGroups?.(document,location.hostname);
      const groups=visible?.groups||[];
      const text=groups.map(g=>g.text).join(' ');
      if(!text){
        state.renderRoute='none';
        state.latestDomText='';
        render(state.seenAny?'':'正在等待播放器显示原文字幕；请开启 CC 字幕。');
        return;
      }
      state.seenAny=true;
      for(const group of groups)rememberCaptionLanguage(group.text);
      state.latestDomText=text;
      const generation=state.generation;
      const applyTranslations=()=>{
        // Never apply an older network response to captions repainted while
        // it was in flight. Also avoid partial/mismatched multi-speaker patches.
        const current=platform.readVisibleCaptionGroups?.(document,location.hostname)?.groups||[];
        if(!current.length||current.length!==groups.length||
           current.some((g,i)=>g.text!==groups[i].text))return false;
        const translations=current.map(g=>({
          text:g.text,translation:state.cache.get('dom:'+g.text)
        }));
        if(translations.some(g=>!g.translation))return false;
        const replaced=config.subtitleRenderMode==='replace-track' &&
          platform.replaceVisibleCaptionGroups?.(document,location.hostname,translations);
        if(replaced){
          state.renderRoute='platform-dom';lastError='';render('');
        }else if(config.subtitleRenderMode==='replace-track'){
          state.renderRoute='unsupported';
          lastError='播放器多个字幕区域无法安全完成原位替换；严格模式不显示外置字幕。';
          render('');
        }else render(translations.map(g=>g.translation).join('\n'));
        return Boolean(replaced)||config.subtitleRenderMode!=='replace-track';
      };
      if(groups.every(g=>state.cache.has('dom:'+g.text))){
        applyTranslations();return;
      }
      // A previously translated frame must not imply the publisher's new CC
      // frame has also been translated or shown in place.
      state.renderRoute='none';
      const budget=state.mode==='ai'?80:1200;
      if(state.requestCount>=budget){
        lastError='本次字幕翻译已达到安全请求上限';
        if(config.subtitleRenderMode!=='replace-track')render(lastError);
        return;
      }
      if(state.domPending || (state.failedAt &&
        (state.mode==='ai'||Date.now()-state.failedAt<2500)))return;
      // Strict mode must not flash an out-of-player text overlay while
      // waiting for the public translation service.
      if(config.subtitleRenderMode==='replace-track')render('');
      else render('正在翻译…');
      state.requestCount++;state.domPending=true;
      const missing=[...new Set(groups.map(g=>g.text).filter(t=>!state.cache.has('dom:'+t)))];
      try{
        const prior=state.contextHistory.join('\n');
        const translations=await fetchBatch(missing,generation,prior);
        if(state.active&&generation===state.generation){
          state.failedAt=0;lastError='';
          for(let i=0;i<missing.length;i++)
            state.cache.put('dom:'+missing[i],translations[i]);
          if(state.mode==='ai'){
            state.contextHistory=[...state.contextHistory,...missing].slice(-3);
          }
          if(state.latestDomText===text)applyTranslations();
        }
      }catch(error){
        lastError=String(error?.message||error);
        if(generation===state.generation){
          state.failedAt=Date.now();
          // Preserve diagnostics, but don't replace the native CC display
          // with an external overlay during a strict in-place session.
          if(config.subtitleRenderMode==='replace-track'){
            state.renderRoute='unsupported';
            render('');
          }else render(state.mode==='ai'
            ?'AI 字幕调用失败，已停止自动重试；请检查模型/额度后手动重新启动。'
            :/无法可靠识别原文语言/.test(lastError)
              ?'无法确定字幕原文语言：请手动指定源语言。'
              :'字幕翻译失败：'+lastError.slice(0,160));
        }
      }finally{
        if(generation===state.generation)state.domPending=false;
      }
      return;
    }
    if(!state.video || (!state.track && !state.importedCues)) return;
    const generation=state.generation;
    const video=state.video, track=state.track;
    let raw=[];
    try { raw=track?.cues ? [...track.cues] : []; } catch {}
    const cues=prepareCues(core.normalizeCues(state.importedCues || raw.map(originalNativeCue),video.currentTime));
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
    if(state.busy || (state.failedAt &&
      (state.mode==='ai'||Date.now()-state.failedAt < 3000))) return;
    const upcoming=core.upcomingCues(cues,now,video.playbackRate,5);
    for(const cue of upcoming)rememberCaptionLanguage(cue.text);
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
        state.failedAt=0;lastError='';
        renderTimedCues(cues,video.currentTime);
      }
    } catch(error) {
      lastError=String(error?.message||error);
      if(generation===state.generation){
        state.failedAt=Date.now();
        render(state.mode==='ai'
          ?'AI 字幕调用失败，已停止自动重试；请检查模型/额度后手动重新启动。'
          :'字幕翻译失败：'+lastError.slice(0,160));
      }
    } finally {
      if(generation===state.generation)state.busy=false;
    }
  }
  function renderTimedCues(cues,time){
    const activeCues=core.activeCues(cues,time);
    if(!activeCues.length){state.renderRoute='none';render('');return;}
    if(inlineNativeTranslation(activeCues,time)){render('');return;}
    // Strict mode never draws pending/error text over the player.
    if(config.subtitleRenderMode==='replace-track'){
      if(activeCues.every(c=>state.cache.has(c.key))){
        state.renderRoute='unsupported';
        lastError='字幕已译出，但播放器不允许直接修改原生字幕轨。严格模式未启用外置字幕。';
      }else state.renderRoute='none';
      render('');return;
    }
    if(state.failedAt&&activeCues.some(c=>!state.cache.has(c.key))){
      render('字幕翻译失败：'+(lastError||'请检查所选翻译服务').slice(0,160));
      return;
    }
    // Concurrent cues represent different speakers. Display every
    // simultaneously active translated line, never just the latest one.
    render(activeCues.map(c=>state.cache.get(c.key)||'正在翻译…').join('\n'),
      activeCues.map(c=>c.text).join('\n'));
  }
  function stop() {
    state.active=false;state.generation++;
    clearInterval(state.timer);state.timer=null;
    restoreNativeTrack();
    platform?.restoreVisibleCaptions?.();
    releaseTrack(state.track,state.originalMode);
    state.overlay?.remove();state.overlay=null;
    state.video=null;state.track=null;state.originalMode=null;state.cache.clear();state.busy=false;state.failedAt=0;state.seenAny=false;state.domMode=false;state.latestDomText='';state.requestCount=0;state.domPending=false;state.importedCues=null;state.boundUrl=null;state.mediaUrl=null;state.contextHistory=[];state.languageSamples=[];state.manualSource='';state.renderRoute='none';
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
    if(!config.enabled)return {ok:false,reason:'此平台字幕功能已禁用，请在视频设置启用。'};
    if(platformId()==='youtube'&&!config.preferPitTranslationOverPlatformMT)return {ok:false,reason:'已选择保留 YouTube 平台字幕；PIT 翻译关闭。'};
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
    state.manualSource=core.normalizeCaptionSource(requestedSource)||core.normalizeCaptionSource(config.source);
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
    if(imported?.length && !validImport)
      return {ok:false,reason:'导入字幕的时码或文本无效，未启动翻译。'};
    if(validImport && config.subtitleRenderMode==='replace-track')
      return {ok:false,reason:'导入字幕没有可修改的播放器原生轨道；请明确选用兼容字幕显示模式，或启用网站原有字幕。'};
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
    state.overlay=createOverlay();state.cache=new core.CaptionCache(350,{deduplicateText:mode!=='ai'});
    lastError='';
    state.timer=setInterval(()=>{void tick();},450);
    void tick();
    return {ok:true,reason:state.importedCues?'已加载你提供的 SRT/VTT 字幕，并按视频时间轴进行翻译。':state.domMode?'已开启可见字幕观察：将等待播放器加载/显示原文字幕，未出现字幕前不发送翻译请求。':'原生字幕翻译已启动。'};
  }
  chrome.runtime.onMessage.addListener((msg,_sender,respond)=>{
    if(msg?.type==='PIT_CAPTIONS_START' && ['standard','ai'].includes(msg.mode)){void settingsReady.then(()=>{manuallyStopped=false;respond(start(msg.mode,msg.cues,msg.expectedUrl,msg.captionSourceLanguage));quickToggle();});return true;}
    else if(msg?.type==='PIT_CAPTIONS_STOP'){manuallyStopped=true;stop();quickToggle();respond({ok:true});}
    else if(msg?.type==='PIT_PREFERENCES_CHANGED'){void refreshConfig().catch(()=>{});}
    else if(msg?.type==='PIT_CAPTIONS_DIAGNOSTICS'){
      const v=pickVideo();
      const tracks=v?[...v.textTracks]:[];
      const visible=platform?.readVisibleCaptionGroups?.(document,location.hostname)?.groups||[];
      let loadedCues=0,currentNativeCues=0;
      for(const track of tracks){
        if(!['captions','subtitles'].includes(track.kind))continue;
        try{
          const cues=track.cues?[...track.cues]:[];
          loadedCues+=cues.length;
          currentNativeCues+=cues.filter(c=>v &&
            c.startTime<=v.currentTime+.15&&c.endTime>=v.currentTime-.10).length;
        }catch{}
      }
      const visibleGroups=visible.length;
      const currentCaption=visibleGroups>0||currentNativeCues>0;
      const rendered=['native-track','platform-dom'].includes(state.renderRoute)&&
        state.cache.map.size>0&&currentCaption;
      const ccControl=Boolean(document.querySelector(
        '.ytp-subtitles-button,.bpx-player-ctrl-subtitle,[data-uia="control-captions"],[aria-label*="Captions"]'));
      respond({ok:true,platform:platformId(),videos:allVideos(document).length,
        visibleVideo:Boolean(v?.getClientRects().length),
        playback:v?(v.paused?'paused':'playing'):'no-video',
        source:state.importedCues?'imported-file':state.domMode?'dom-caption':state.track?'texttrack (human/auto unknown)':'none',
        language:state.manualSource||state.track?.language||'unknown',
        tracks:tracks.map(t=>({language:t.language,kind:t.kind,mode:t.mode})),
        siteCaptionGroups:visibleGroups,nativeLoadedCues:loadedCues,nativeActiveCues:currentNativeCues,
        captionControlFound:ccControl,provider:config.providerId||'inherit',
        renderRoute:state.renderRoute,translationCount:state.cache.map.size,
        active:state.active,renderMode:config.subtitleRenderMode||'in-player',
        status:!config.enabled?'disabled':state.failedAt?'error':!state.active?'disabled':
          state.renderRoute==='unsupported'&&currentCaption?'unsupported':
          rendered?'translated':currentCaption?'pending':'waiting-for-CC',lastError});
    }
  });
  settingsReady=refreshConfig().catch(()=>{});
  // Event-driven discovery; existing 450 ms session timer remains the only poll.
  for(const event of ['play','loadedmetadata','loadeddata'])document.addEventListener(event,()=>autoStart(),true);
  document.addEventListener('fullscreenchange',()=>{quickToggle();if(state.active)void tick();});
  document.addEventListener('scroll',quickToggle,{passive:true});window.addEventListener('resize',quickToggle);
  let pendingDiscovery=false;
  const discovery=new MutationObserver(records=>{
    if(pendingDiscovery||!config.enabled||(!config.playerQuickToggle&&!config.autoStart))return;
    if(records.every(r=>r.target?.closest?.('.pit-caption-overlay,.pit-player-toggle')))return;
    pendingDiscovery=true;setTimeout(()=>{pendingDiscovery=false;autoStart();},500);
  });
  discovery.observe(document.documentElement,{childList:true,subtree:true});
})();
