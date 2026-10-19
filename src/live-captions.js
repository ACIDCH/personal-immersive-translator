/* Opt-in translated speech text, never persisted. One outstanding
 * standard-provider request; newer ASR fragments supersede stale results.
 * The user sees measured estimates, not a promised latency guarantee. */
(() => {
  if(window.__PIT_LIVE_CAPTIONS__)return;
  window.__PIT_LIVE_CAPTIONS__=true;
  let enabled=false,seq=0,overlay=null,queued=null;
  let translationMode='standard',sourceHistory=[],spokenLanguage='';
  let activeSession=null,lastStoppedSession=null,epoch=0,busyEpoch=null;
  let stats={requests:0,dropped:0,errors:0,p50Ms:0,p95Ms:0};
  const observed=[]; // timing only, no transcript retention.
  function ensure(){
    if(overlay?.isConnected)return;
    overlay=document.createElement('div');
    overlay.className='pit-caption-overlay pit-asr-overlay';
    (document.fullscreenElement||document.documentElement).append(overlay);
  }
  function percentile(p){
    const sorted=[...observed].sort((a,b)=>a-b);
    return sorted.length?sorted[Math.ceil(p*sorted.length)-1]:null;
  }
  function draw(original,translated,delay=null){
    if(!enabled)return;
    ensure();overlay.replaceChildren();
    for(const [text,color] of [[original,'#f5f7fa'],[translated,'#bbdcff']]){
      const line=document.createElement('div');line.className='pit-caption-translated';
      line.style.color=color;line.textContent=text;overlay.append(line);
    }
    const meta=document.createElement('div');meta.className='pit-live-meta';
    const latency=delay===null?'等待识别':('处理延迟约 '+(delay/1000).toFixed(1)+'s');
    const p95=percentile(.95);
    meta.textContent=latency+(spokenLanguage?' · 识别语种 '+spokenLanguage:'')+
      (p95===null?'':' · p95约 '+(p95/1000).toFixed(1)+'s')+
      ' · 丢弃 '+stats.dropped+' 段 · 识别错误 '+stats.errors+
      (stats.p95Ms>8000?' · 识别延迟偏高，建议使用小模型':'');
    overlay.append(meta);
  }
  async function drain(){
    const generation=epoch;
    if(!enabled || busyEpoch===generation || !queued)return;
    busyEpoch=generation;
    try{
      while(enabled && epoch===generation && queued){
        const item=queued;queued=null;
        let translation='翻译服务不可用';
        try{
          const result=await chrome.runtime.sendMessage({
            type:'TRANSLATE_BATCH',texts:[item.text],mode:translationMode,transient:true,
            userInitiated:translationMode==='ai',sessionId:item.sessionId,
            captionSourceLanguage:item.language||'',
            context:translationMode==='ai'?sourceHistory.slice(-2).join('\n').slice(0,1600):''
          });
          translation=result?.ok ? String(result.translations?.[0]||''):'翻译服务不可用';
          // Translation history belongs to the CURRENT recognized utterance,
          // not an old request that resolved after STOP/START or after newer
          // Whisper audio arrived. Otherwise a new AI session inherits stale
          // dialogue and silently mistranslates later subtitles.
          if(result?.ok && translationMode==='ai' && enabled &&
             epoch===generation && activeSession===item.sessionId &&
             item.sequence===seq)
            sourceHistory=[...sourceHistory.slice(-2),item.text];
        }catch{translation='翻译连接失败';}
        if(!enabled || epoch!==generation || activeSession!==item.sessionId)break;
        // Do not display a completed old translation after a newer cue arrived.
        if(item.sequence===seq){
          const capturedAt=Number(item.capturedAt);
          const estimated=Number.isFinite(capturedAt)&&capturedAt>0
            ? Math.max(0,Date.now()-capturedAt+Math.max(0,item.segmentMs||0)) : null;
          if(estimated!==null){
            observed.push(estimated);if(observed.length>120)observed.shift();
          }
          draw(item.text,translation,estimated);
        }
      }
    }finally{
      if(busyEpoch===generation){
        busyEpoch=null;
        if(enabled && queued)void drain();
      }
    }
  }
  chrome.runtime.onMessage.addListener((msg,_sender,respond)=>{
    if(msg?.type==='PIT_ASR_VIEW_START'){
      if(typeof msg.sessionId!=='string' || !/^[0-9a-f-]{36}$/i.test(msg.sessionId)){
        respond({ok:false});return;
      }
      enabled=true;activeSession=msg.sessionId;lastStoppedSession=null;
      translationMode=msg.mode==='ai'?'ai':'standard';sourceHistory=[];spokenLanguage='';
      epoch++;seq++;queued=null;observed.length=0;
      stats={requests:0,dropped:0,errors:0,p50Ms:0,p95Ms:0};
      draw('本机正在识别当前标签页音频…','');
      respond({ok:true});return;
    }
    if(msg?.type==='PIT_ASR_INTERRUPTED_VIEW'){
      if(enabled || !lastStoppedSession || msg.sessionId!==lastStoppedSession)return;
      // A visible but temporary failure notice independent of the subtitle
      // overlay; never leave the UI suggesting audio is still being captured.
      const old=document.querySelector('.pit-asr-interrupted');
      old?.remove();
      const notice=document.createElement('div');
      notice.className='pit-toast pit-asr-interrupted';
      notice.textContent='标签页音频捕获已中断，实时字幕已停止；请检查权限或播放器状态后手动重新启动。';
      document.documentElement.append(notice);
      setTimeout(()=>notice.remove(),7000);
      return;
    }
    if(msg?.type==='PIT_ASR_VIEW_STOP'){
      if(!enabled || msg.sessionId!==activeSession){
        respond({ok:true,ignored:true});return;
      }
      lastStoppedSession=activeSession;activeSession=null;
      enabled=false;epoch++;seq++;queued=null;observed.length=0;
      translationMode='standard';sourceHistory=[];spokenLanguage='';
      overlay?.remove();overlay=null;respond({ok:true});return;
    }
    if(!enabled || msg?.sessionId!==activeSession)return;
    if(msg?.type==='PIT_ASR_METRICS_VIEW'){
      const m=msg.metrics||{};
      stats={requests:Number(m.requests)||0,dropped:Number(m.dropped)||0,
        errors:Number(m.errors)||0,p50Ms:Number(m.p50Ms)||0,p95Ms:Number(m.p95Ms)||0};
      return;
    }
    if(msg?.type==='PIT_ASR_ERROR_VIEW'){
      draw(String(msg.message||'本机识别失败').slice(0,300),'');
      return;
    }
    if(msg?.type!=='PIT_ASR_TEXT_VIEW')return;
    const text=String(msg.text||'').trim().slice(0,5000);
    if(!text)return;
    spokenLanguage=['en','zh','fr','de','es','ja','ko'].includes(msg.language)
      ?msg.language:'';
    seq++;
    queued={text,sequence:seq,capturedAt:msg.capturedAt,segmentMs:msg.segmentMs,
      // Leave source empty when Whisper gave no reliable language evidence.
      // Backend settings.source is authoritative if manually configured.
      language:['en','zh','fr','de','es','ja','ko'].includes(msg.language)?msg.language:'',
      sessionId:activeSession};
    draw(text,'正在翻译…');
    void drain();
  });
})();
