/* User-initiated bilingual DOM translation. No external code execution.
 * Handles long documents, SPA text updates and open Shadow DOM without
 * reading previously inserted translations as part of the original source.
 */
(() => {
  if (globalThis.__PIT_TRANSLATOR_V1__) return;
  globalThis.__PIT_TRANSLATOR_V1__ = true;

  const SKIP = 'script,style,noscript,svg,canvas,pre,code,textarea,input,select,option,button,nav,footer,header,[contenteditable],[translate="no"],[aria-hidden="true"],.pit-translation,.pit-toast';
  const TARGETS = 'main p,article p,p,li,blockquote,h1,h2,h3,h4,h5,h6,figcaption,td,th,[role="heading"],[role="paragraph"],[role="listitem"],[role="slide"] p,article div,main div,[role="main"] div,[role="article"] div';
  let processed = new WeakMap();
  let scope='smart',display='bilingual',theme='subtle';
  let hoverEnabled=false,inputEnabled=false;
  let lastInput=null,inputTaps=0,inputTapAt=0;
  let hovered=null;
  const CONTENT_TARGETS = 'p,li,blockquote,h1,h2,h3,h4,h5,h6,figcaption,td,th,[role="heading"],[role="paragraph"],[role="listitem"],div';

  let active = false, currentId = 0, mode = 'standard';
  let observer = null, observedRoots = new Set();
  let busy = false, queued = false, timer = null;
  let aiCount = 0, standardSpent = 0, standardBudget = 600;
  let failedBatches=0, lastError='', succeededBatches=0;
  const AI_MAX_PER_ACTION = 30, STANDARD_BATCH = 70, STANDARD_STEP = 600;

  function roots() {
    const found=[document],pending=[document],seen=new Set(found);
    while(pending.length && found.length<30) {
      const root=pending.shift(),elements=root.querySelectorAll('*');
      for(const el of Array.from(elements).slice(0,6000)) {
        if(el.shadowRoot && !seen.has(el.shadowRoot)){
          seen.add(el.shadowRoot);found.push(el.shadowRoot);pending.push(el.shadowRoot);
          if(found.length>=30)break;
        }
      }
    }
    return found;
  }
  function queryDeep(selector) {
    return roots().flatMap(root=>Array.from(root.querySelectorAll(selector)));
  }
  function isUnsafe(el) {
    let part=el;
    while(part) {
      if(part.closest?.(scope==='full'?SKIP.replace(',footer,header',''):SKIP) ||
        part.closest?.('form'))return true;
      part=part.getRootNode?.().host || null;
    }
    return false;
  }
  function sourceText(el) {
    // textContent includes injected <div.pit-translation> for list/table nodes.
    // TreeWalker avoids accumulating the translation into subsequent requests.
    const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);
    const parts=[];let textNode;
    while((textNode=walker.nextNode())) {
      const parent=textNode.parentElement;
      if(parent?.closest?.(SKIP))continue;
      parts.push(textNode.nodeValue || '');
      if(parts.length>5000)break;
    }
    return parts.join('').replace(/\s+/g,' ').trim();
  }
  function toast(message) {
    document.querySelector('.pit-toast')?.remove();
    const el=document.createElement('div');
    el.className='pit-toast';el.textContent=message;
    document.documentElement.append(el);
    setTimeout(()=>el.remove(),5000);
  }
  function translatable(el,original){
    // Avoid numeric-only UI counters while retaining short article headings
    // and normal CJK text. The former 12-character minimum discarded a large
    // class of legitimate short paragraphs without reporting any failure.
    if(original.length>5000||!/[\p{L}]/u.test(original))return false;
    const threshold=/[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/.test(original)?2:4;
    if(original.length<threshold)return false;
    // Translating nested editable menus or site controls is not article reading.
    if(el.matches('div')&&el.closest('nav,aside,[role="navigation"],[role="menu"],[role="toolbar"],[role="dialog"],[aria-modal="true"]'))return false;
    if(el.matches('div')&&el.children.length>0){
      // A wrapping DIV with its own rich descendants is not a leaf text unit.
      // Only permit literal text runs at leaf DIV level, so a whole article is
      // never translated twice as one giant paragraph.
      if([...el.children].some(child=>child.matches?.('div,p,section,article,ul,ol,h1,h2,h3,h4,h5,h6')))return false;
    }
    return true;
  }
  function candidates() {
    const result=[];
    for(const el of queryDeep(scope==='full'?CONTENT_TARGETS:TARGETS)){
      if(!el.isConnected || isUnsafe(el) || (!el.getClientRects().length && !el.classList.contains('pit-original-concealed')))continue;
      if(el.children.length && [...el.children].some(ch=>ch.matches?.(TARGETS)))continue;
      const original=sourceText(el);
      const record=processed.get(el);
      if(record && (record.source!==original || !record.node?.isConnected)){
        record.node?.remove();
        el.classList.remove('pit-source-block','pit-original-concealed');
        processed.delete(el);
      }
      if(!translatable(el,original) || processed.has(el))continue;
      result.push({el,original});
    }
    return result;
  }
  // Actual DOM coverage is measured, not inferred from a successful
  // translate-command response. No original text is returned in these stats.
  function coverage() {
    let eligible=0,translated=0;
    for(const el of queryDeep(scope==='full'?CONTENT_TARGETS:TARGETS)){
      if(!el.isConnected || isUnsafe(el) || (!el.getClientRects().length && !el.classList.contains('pit-original-concealed')))continue;
      if(el.children.length && [...el.children].some(ch=>ch.matches?.(TARGETS)))continue;
      const original=sourceText(el);
      if(!translatable(el,original))continue;
      eligible++;
      const done=processed.get(el);
      if(done && done.source===original && done.node?.isConnected)translated++;
    }
    return {
      active,mode,eligible,translated,remaining:Math.max(0,eligible-translated),
      coveragePercent:eligible?Math.round(10000*translated/eligible)/100:null,
      failedBatches,succeededBatches,busy,lastError,
      budgetRemaining:mode==='standard'?Math.max(0,standardBudget-standardSpent):
        Math.max(0,AI_MAX_PER_ACTION-aiCount)
    };
  }
  function attach(el,source,translation,isAI) {
    if(!el.isConnected || !translation || sourceText(el)!==source)return false;
    const node=document.createElement('div');
    node.className='pit-translation'+(isAI?' pit-ai':'');
    node.textContent=translation;
    node.dataset.pit='translation';
    node.dataset.theme=theme;
    el.classList.add('pit-source-block');
    el.classList.toggle('pit-original-concealed',display==='translation-only');
    if(el.matches('li,td,th'))el.append(node);
    else el.insertAdjacentElement('afterend',node);
    processed.set(el,{source,node});
    return true;
  }
  async function request(texts,requestedMode,context) {
    const answer=await chrome.runtime.sendMessage({
      type:'TRANSLATE_BATCH',texts,mode:requestedMode,
      userInitiated:requestedMode==='ai',context
    });
    if(!answer?.ok)throw Error(answer?.error||'翻译服务未响应');
    if(!Array.isArray(answer.translations)||answer.translations.length!==texts.length)throw Error('翻译结果与原文段落数量不符');
    return answer.translations;
  }
  function schedule(id,delay=300) {
    if(!active || currentId!==id)return;
    clearTimeout(timer);
    timer=setTimeout(()=>{timer=null;void translateContent(id);},delay);
  }
  function observeRoots() {
    if(!observer)return;
    for(const root of roots()){
      if(observedRoots.has(root))continue;
      const target=root===document ? document.body : root;
      if(target){
        observer.observe(target,{
          subtree:true,childList:true,characterData:true,
          attributes:true,attributeFilter:['class','style','hidden','aria-hidden']
        });
        observedRoots.add(root);
      }
    }
  }
  function ownedMutation(mutation) {
    const element=mutation.target.nodeType===1
      ? mutation.target : mutation.target.parentElement;
    if(element?.closest?.('.pit-translation,.pit-toast'))return true;
    if(mutation.type==='childList' && mutation.addedNodes.length){
      return [...mutation.addedNodes].every(node=>
        node.nodeType===1 && node.matches?.('.pit-translation,.pit-toast'));
    }
    if(mutation.type==='childList' && mutation.removedNodes.length){
      return [...mutation.removedNodes].every(node=>
        node.nodeType===1 && node.matches?.('.pit-translation,.pit-toast'));
    }
    return false;
  }
  async function translateContent(id){
    if(!active || id!==currentId)return;
    if(busy){queued=true;return;}
    busy=true;
    try{
      const limit=mode==='ai' ? Math.max(0,AI_MAX_PER_ACTION-aiCount)
        : Math.min(STANDARD_BATCH,Math.max(0,standardBudget-standardSpent));
      const targets=candidates().slice(0,limit);
      if(!targets.length)return;
      let count=0;
      for(let i=0;i<targets.length;i+=6){
        if(!active || currentId!==id)return;
        const chunk=targets.slice(i,i+6);
        const before=targets[i-1]?.original?.slice(-300)||'';
        const after=targets[i+6]?.original?.slice(0,300)||'';
        const translations=await request(chunk.map(x=>x.original),mode,[before,after].filter(Boolean).join('\n'));
        succeededBatches++;
        if(!active || currentId!==id)return;
        for(let j=0;j<chunk.length;j++){
          if(attach(chunk[j].el,chunk[j].original,translations[j],mode==='ai'))count++;
        }
        if(mode==='ai')aiCount+=chunk.length;
        else standardSpent+=chunk.length;
      }
      if(count)toast('已翻译 '+count+' 个新段落 · '+(mode==='ai'?'AI':'标准')+'模式');
      // A long article can exceed the first 70/250 nodes. Process further
      // only in standard mode; AI never expands its budget automatically.
      if(mode==='standard' && targets.length===STANDARD_BATCH && active && standardSpent<standardBudget){
        queued=true;
      }
      if(mode==='standard' && standardSpent>=standardBudget){
        toast('已到本次自动翻译的 '+standardBudget+' 段请求上限；如仍有未翻译内容，请在插件中点击「继续翻译」。');
      }
    }catch(error){
      if(id===currentId){
        failedBatches++;
        lastError=String(error?.message||error).slice(0,200);
        toast('翻译失败：'+lastError);
      }
    }finally{
      busy=false;
      if(queued && active){
        queued=false;schedule(currentId,200);
      }
    }
  }
  function restore(){
    active=false;currentId++;
    clearTimeout(timer);timer=null;queued=false;
    observer?.disconnect();observer=null;observedRoots.clear();
    for(const root of roots()){
      root.querySelectorAll('.pit-translation').forEach(node=>node.remove());
      root.querySelectorAll('.pit-source-block').forEach(node=>
        node.classList.remove('pit-source-block','pit-original-concealed'));
    }
    document.querySelectorAll('.pit-toast').forEach(node=>node.remove());
    processed=new WeakMap();aiCount=0;standardSpent=0;standardBudget=STANDARD_STEP;
    failedBatches=0;succeededBatches=0;lastError='';
  }
  function setDisplay(next,style=theme){
    if(!['bilingual','translation-only'].includes(next))return;
    display=next;theme=['subtle','underline','highlight'].includes(style)?style:'subtle';
    for(const root of roots()){
      root.querySelectorAll('.pit-source-block').forEach(el=>
        el.classList.toggle('pit-original-concealed',display==='translation-only'));
      root.querySelectorAll('.pit-translation').forEach(el=>el.dataset.theme=theme);
    }
  }
  function start(requestedMode,options={}) {
    restore();mode=requestedMode;active=true;
    scope=options.scope==='full'?'full':'smart';
    setDisplay(options.display||display,options.theme||theme);
    const id=++currentId;
    if(requestedMode==='standard'){
      observer=new MutationObserver(mutations=>{
        if(!active || currentId!==id || mutations.every(ownedMutation))return;
        observeRoots();schedule(id,600);
      });
      observeRoots();
    }
    void translateContent(id);
  }
  async function translateSelection(requestedMode) {
    const selection=window.getSelection();
    const text=selection?.toString().trim()||'';
    if(!text || text.length>5000){toast('请选中 1–5000 字符的正文');return;}
    const anchor=selection.anchorNode?.parentElement;
    if(anchor && isUnsafe(anchor)){toast('无法翻译编辑框或受保护区域');return;}
    try{const result=await request([text],requestedMode,'');toast(result[0]);}
    catch(error){toast('翻译失败：'+String(error.message||error));}
  }
  function mountFloatingControl(){
    if(document.getElementById('pit-floating-translate'))return;
    const button=document.createElement('button');
    button.id='pit-floating-translate';
    button.type='button';
    button.textContent='译';
    button.title='PIT：翻译此网页 / 恢复原文';
    button.setAttribute('aria-label','PIT：翻译当前网页或恢复原文');
    document.documentElement.append(button);
    button.addEventListener('click',()=>{
      if(active)restore();
      else start('standard',{scope,display,theme});
    });
  }
  // Opt-in paragraph hover, only after an explicit Shift+pointer gesture.
  // Passwords, forms, buttons, code and hidden page sections stay excluded.
  async function translateHovered(el){
    if(!hoverEnabled || !el?.isConnected || isUnsafe(el) || !el.getClientRects().length)return;
    const original=sourceText(el);
    if(!translatable(el,original)||processed.has(el))return;
    const marker=el.dataset.pitHoverPending;
    if(marker==='1')return;
    el.dataset.pitHoverPending='1';
    try{
      const result=await request([original],'standard','');
      if(!el.isConnected)return;
      attach(el,original,result[0],false);
    }catch(error){
      toast('悬停翻译失败：'+String(error?.message||error).slice(0,120));
    }finally{delete el.dataset.pitHoverPending;}
  }
  function hoverElement(target){
    if(!(target instanceof Element))return null;
    const el=target.closest(CONTENT_TARGETS);
    return el && !isUnsafe(el)?el:null;
  }
  document.addEventListener('pointerover',event=>{
    hovered=hoverElement(event.target);
    if(hoverEnabled&&event.shiftKey&&hovered)void translateHovered(hovered);
  },true);
  document.addEventListener('keydown',event=>{
    if(event.key==='Shift'&&hoverEnabled&&hovered&&!event.repeat)
      void translateHovered(hovered);
  },true);
  document.addEventListener('keydown',event=>{
    if(!inputEnabled||event.isComposing||event.key!==' '||
       event.ctrlKey||event.altKey||event.metaKey||event.repeat)return;
    const el=event.target;
    if(!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)||
       (el instanceof HTMLInputElement && !['text','search'].includes(el.type))||
       el.readOnly||el.disabled)return;
    const now=Date.now();
    if(lastInput!==el||now-inputTapAt>900)inputTaps=0;
    lastInput=el;inputTapAt=now;inputTaps++;
    if(inputTaps<3)return;
    inputTaps=0;event.preventDefault();
    const source=el.value.trim();
    if(source.length<1||source.length>3000)return;
    el.dataset.pitInputPending='1';
    void chrome.runtime.sendMessage({type:'TRANSLATE_BATCH',
      texts:[source],mode:'standard',inputEnhancement:true}).then(answer=>{
      if(!answer?.ok)throw Error(answer?.error||'输入框翻译失败');
      if(!el.isConnected || !el.dataset.pitInputPending)return;
      if(el.value.trim()!==source)return; // Never overwrite typed changes.
      el.value=answer.translations[0];
      el.dispatchEvent(new Event('input',{bubbles:true}));
      el.dispatchEvent(new Event('change',{bubbles:true}));
    }).catch(error=>toast('输入框翻译失败：'+String(error?.message||error).slice(0,120)))
      .finally(()=>{delete el.dataset.pitInputPending;});
  },true);
  // The background only returns a strictly limited preference subset, never
  // vendor keys. Without settings access the extension remains idle.
  void chrome.runtime.sendMessage({type:'PIT_PUBLIC_PREFERENCES'}).then(answer=>{
    if(!answer?.ok||!answer.preferences)return;
    const p=answer.preferences;
    if(p.floatingControl===true)mountFloatingControl();
    hoverEnabled=p.hoverTranslate===true;
    inputEnabled=p.inputTranslate===true;
    scope=p.webScope==='full'?'full':'smart';
    setDisplay(p.webDisplay,p.translationTheme);
    const host=location.hostname.toLowerCase();
    const matches=(rules)=>String(rules||'').split(/[\s,;]+/).filter(Boolean)
      .some(raw=>{
        const rule=raw.trim().toLowerCase().replace(/^\*\./,'');
        return host===rule||host.endsWith('.'+rule);
      });
    if(matches(p.autoTranslateHosts)&&!matches(p.blockedHosts))
      start('standard',{scope,display,theme});
  }).catch(()=>{});
  chrome.runtime.onMessage.addListener((message,_sender,reply)=>{
    if(message?.type==='PIT_GET_PROGRESS'){
      reply({ok:true,progress:coverage()});
    }else if(message?.type==='PIT_START' && ['standard','ai'].includes(message.mode)){
      start(message.mode,{scope:message.scope||scope,display:message.display||display,
        theme:message.theme||theme});reply({ok:true});
    }else if(message?.type==='PIT_CONTINUE' && active && mode==='standard'){
      standardBudget+=STANDARD_STEP;
      schedule(currentId,0);
      reply({ok:true});
    }else if(message?.type==='PIT_CONTINUE'){
      reply({ok:false,reason:'请先开启标准网页翻译，才能继续翻译后续段落。'});
    }else if(message?.type==='PIT_SET_DISPLAY'){
      setDisplay(message.display,message.theme);
      reply({ok:true,display,theme});
    }else if(message?.type==='PIT_RESTORE'){
      restore();reply({ok:true});
    }else if(message?.type==='PIT_SELECTION' && ['standard','ai'].includes(message.mode)){
      void translateSelection(message.mode);reply({ok:true});
    }
  });
})();