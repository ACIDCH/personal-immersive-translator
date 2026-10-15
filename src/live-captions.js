/* Optional user-initiated near-real-time ASR captions. Translation uses standard
   providers only by default. These transcripts are not synced or stored. */
(() => {
 if(window.__PIT_LIVE_CAPTIONS__)return;
 window.__PIT_LIVE_CAPTIONS__=true;
 let enabled=false,seq=0,overlay=null,history=[];
 function ensure(){
  if(overlay?.isConnected)return;
  overlay=document.createElement('div');overlay.className='pit-caption-overlay pit-asr-overlay';
  (document.fullscreenElement||document.documentElement).append(overlay);
 }
 function draw(original,translated){
  ensure();
  overlay.replaceChildren();
  for(const [text,color] of [[original,'#f5f7fa'],[translated,'#bbdcff']]){
   const line=document.createElement('div');line.className='pit-caption-translated';
   line.style.color=color;line.textContent=text;overlay.append(line);
  }
 }
 chrome.runtime.onMessage.addListener((msg,_sender,respond)=>{
  if(msg?.type==='PIT_ASR_VIEW_START'){enabled=true;ensure();draw('本机正在识别当前标签页音频…','');respond({ok:true});return;}
  if(msg?.type==='PIT_ASR_VIEW_STOP'){enabled=false;seq++;overlay?.remove();overlay=null;respond({ok:true});return;}
  if(msg?.type==='PIT_ASR_ERROR_VIEW'&&enabled){draw(msg.message,'');return;}
  if(msg?.type!=='PIT_ASR_TEXT_VIEW'||!enabled)return;
  const original=String(msg.text||'').slice(0,5000),n=++seq;
  if(!original.trim())return;
  history.push(original);if(history.length>4)history.shift();
  draw(original,'正在翻译…');
  chrome.runtime.sendMessage({type:'TRANSLATE_BATCH',texts:[original],mode:'standard',transient:true,context:''})
   .then(res=>{if(enabled && n===seq)draw(original,res?.ok?res.translations[0]:'翻译服务不可用');})
   .catch(()=>{if(enabled&&n===seq)draw(original,'翻译服务连接失败');});
 });
})();
