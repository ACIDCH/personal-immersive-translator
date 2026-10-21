/* User-initiated bilingual DOM translation. No external code execution.
 * Handles long documents, SPA text updates and open Shadow DOM without
 * reading previously inserted translations as part of the original source.
 */
(() => {
  if (globalThis.__PIT_TRANSLATOR_V1__) return;
  globalThis.__PIT_TRANSLATOR_V1__ = true;

  const SKIP = 'script,style,noscript,svg,canvas,pre,code,textarea,input,select,option,button,nav,footer,header,[contenteditable],[translate="no"],[aria-hidden="true"],.pit-translation,.pit-toast,.pit-selection-card';
  const TARGETS = 'main p,article p,p,li,blockquote,h1,h2,h3,h4,h5,h6,figcaption,td,th,[role="heading"],[role="paragraph"],[role="listitem"],[role="slide"] p,article div,main div,[role="main"] div,[role="article"] div';
  let processed = new WeakMap();
  let scope='smart',display='bilingual',theme='subtle';
  let prefs={},titleRecord=null,initialChars=0;
  let taskId='web-'+(globalThis.crypto?.randomUUID?.()||Date.now().toString(36)+'-'+Math.random().toString(36).slice(2));
  let candidateChars=0;
  const visibleOrInitial=(item)=>{
    if(prefs.translateToBottom!==false)return true;
    const rect=item.el.getBoundingClientRect();
    const before=candidateChars+initialChars;candidateChars+=item.original.length;
    return before<(prefs.initialTranslateCharacters||5000)||(rect.bottom>=0&&rect.top<innerHeight+200);
  };
  function applyReadingStyle(node,settings){
    for(const [key,value] of Object.entries(settings.readingStyle||{}))node.style.setProperty(key.replace(/[A-Z]/g,c=>'-'+c.toLowerCase()),value,'important');
    if(settings.longParagraphLineBreak||settings.lineBreakPolicy==='always')node.style.setProperty('white-space','pre-line','important');
    // Product default is an unboxed, contextual bilingual line, not a
    // tinted full-width callout. Allow explicit highlight theme separately.
    if(theme==='subtle'||theme==='none'){
      node.style.setProperty('background-color','transparent','important');
      node.style.setProperty('color','inherit','important');
    }
    // Hero headings often live inside CSS grid/flex columns. The injected
    // translation must inherit their width, not become another grid item.
    if(node.classList.contains('pit-flow-translation')){
      node.style.setProperty('font-size','.78em','important');
      node.style.setProperty('padding','0','important');
      node.style.setProperty('border','0','important');
      node.style.setProperty('margin','.14em 0 0','important');
    }
  }
  let hoverEnabled=false,inputEnabled=false;
  let voiceSource='auto',voiceTarget='zh';
  let lastInput=null,inputTaps=0,inputTapAt=0;
  let hovered=null;
  const CONTENT_TARGETS = 'p,li,blockquote,h1,h2,h3,h4,h5,h6,figcaption,td,th,[role="heading"],[role="paragraph"],[role="listitem"],div';

  let active = false, currentId = 0, mode = 'standard';
  let observer = null, observedRoots = new Set();
  let busySession = null, queued = false, timer = null;
  let aiCount = 0, standardSpent = 0, standardBudget = 600;
  let failedBatches=0, lastError='', succeededBatches=0;
  const AI_MAX_PER_ACTION = 30, STANDARD_BATCH = 70, STANDARD_STEP = 600;
  const MAX_PARAGRAPH_CHARS = 120000; // 38 bounded 3,200-char segments maximum
  const TRUNCATED_SOURCE_MARKER = '\uFFF0'; // Internal signal, never sent to MT

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
    if(prefs.translateSidebar===false&&el.closest('aside,[role="complementary"]'))return true;
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
    const parts=[];let textNode,rawChars=0,truncated=false;
    while((textNode=walker.nextNode())) {
      const parent=textNode.parentElement;
      if(parent?.closest?.(SKIP))continue;
      const value=textNode.nodeValue||'';
      // A 5,000-node stop silently truncated rich articles whose text is
      // split across many spans. Bound by actual characters, not DOM nodes.
      const remaining=MAX_PARAGRAPH_CHARS+1-rawChars;
      if(value.length>=remaining){
        parts.push(value.slice(0,remaining));
        truncated=true;
        break; // Content beyond this point must never count as translated.
      }
      parts.push(value);
      rawChars+=value.length;
    }
    const normalized=parts.join('').replace(/\s+/g,' ').trim();
    // Whitespace-heavy DOM nodes may shrink below 120k after normalization.
    // Preserve the raw overflow signal so no incomplete prefix is translated.
    return normalized+(truncated?TRUNCATED_SOURCE_MARKER:'');
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
    if(original.includes(TRUNCATED_SOURCE_MARKER)||
       original.length>MAX_PARAGRAPH_CHARS||!/[\p{L}]/u.test(original))return false;
    const threshold=prefs.minSegmentCharacters||(/[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/.test(original)?2:4);
    if(original.length<threshold)return false;
    // Translating nested editable menus or site controls is not article reading.
    if(el.matches('div')&&el.closest('nav,'+(prefs.translateSidebar?'':'aside,')+'[role="navigation"],[role="menu"],[role="toolbar"],[role="dialog"],[aria-modal="true"]'))return false;
    // Hero search/filter panels are NOT prose. A catch-all div with several
    // labels/inputs must never become a translated single paragraph.
    if(el.matches('div')&&el.querySelector('input,textarea,select,button,form,[role="search"],[role="button"],[role="combobox"],[role="textbox"]'))return false;
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
    let eligible=0,translated=0,skippedOversized=0;
    for(const el of queryDeep(scope==='full'?CONTENT_TARGETS:TARGETS)){
      if(!el.isConnected || isUnsafe(el) || (!el.getClientRects().length && !el.classList.contains('pit-original-concealed')))continue;
      if(el.children.length && [...el.children].some(ch=>ch.matches?.(TARGETS)))continue;
      const original=sourceText(el);
      if((original.includes(TRUNCATED_SOURCE_MARKER)||
         original.length>MAX_PARAGRAPH_CHARS) && /[\p{L}]/u.test(original)){
        // Do not report 100% coverage when giant/possibly generated blocks
        // were deliberately not sent to a provider.
        skippedOversized++;
        continue;
      }
      if(!translatable(el,original))continue;
      eligible++;
      const done=processed.get(el);
      if(done && done.source===original && done.node?.isConnected)translated++;
    }
    return {
      active,mode,eligible:eligible+skippedOversized,translated,
      remaining:Math.max(0,eligible-translated)+skippedOversized,
      skippedOversized,
      coveragePercent:(eligible+skippedOversized)
        ?Math.round(10000*translated/(eligible+skippedOversized))/100:null,
      failedBatches,succeededBatches,busy:busySession===currentId,lastError,
      budgetRemaining:mode==='standard'?Math.max(0,standardBudget-standardSpent):
        Math.max(0,AI_MAX_PER_ACTION-aiCount)
    };
  }
  function attach(el,source,translation,isAI) {
    if(!el.isConnected || !translation || sourceText(el)!==source)return false;
    const heading=el.matches('h1,h2,h3,h4,h5,h6,[role="heading"]');
    const node=document.createElement(heading?'span':'div');
    node.className='pit-translation'+(isAI?' pit-ai':'')+(heading?' pit-flow-translation':'');
    node.textContent=prefs.longParagraphLineBreak?translation.replace(/([.!?。！？])\s*/g,'$1\n'):translation;
    applyReadingStyle(node,prefs);
    if(prefs.longParagraphLineBreak||prefs.lineBreakPolicy==='always')node.style.setProperty('white-space','pre-line','important');
    if(theme==='none')node.style.setProperty('background-color','transparent','important');
    if(prefs.sameLanguageHighlight&&['zh','ja','ko'].includes(voiceTarget))node.style.setProperty('background-color',prefs.translationBgColor,'important');
    node.dataset.pit='translation';
    node.dataset.theme=theme;
    el.classList.add('pit-source-block');
    el.classList.toggle('pit-original-concealed',display==='translation-only');
    if(heading||el.matches('li,td,th')){
      if(prefs.translationOrder==='translation-first')el.prepend(node);else el.append(node);
    }else el.insertAdjacentElement(prefs.translationOrder==='translation-first'?'beforebegin':'afterend',node);
    processed.set(el,{source,node,translation});
    return true;
  }
  async function request(texts,requestedMode,context,pinTask=false) {
    const answer=await chrome.runtime.sendMessage({
      type:'TRANSLATE_BATCH',texts,mode:requestedMode,
      pageContext:'article',taskId:pinTask?taskId:'gesture-'+(globalThis.crypto?.randomUUID?.()||Date.now().toString(36)+'-'+Math.random().toString(36).slice(2)),
      userInitiated:requestedMode==='ai',context
    });
    if(!answer?.ok)throw Error(answer?.error||'翻译服务未响应');
    if(!Array.isArray(answer.translations)||answer.translations.length!==texts.length||
       answer.translations.some(t=>typeof t!=='string'||!t.trim()))
      throw Error('翻译结果与原文段落数量不符或译文为空');
    return answer.translations;
  }
  // The hosted engine enforces 4,000 chars/segment and all adapters
  // enforce 12,000 chars/batch. The old loop sent six arbitrary 5,000-char
  // paragraphs and silently failed whole sections at the first large batch.
  function splitParagraph(source){
    const chars=Array.from(source);
    const out=[];
    for(let i=0;i<chars.length;){
      let end=Math.min(i+3200,chars.length);
      if(end<chars.length){
        for(let probe=end;probe>i+2400;probe--){
          if(/[\s,.;:!?。！？；，]/u.test(chars[probe-1])){
            end=probe;break;
          }
        }
      }
      out.push(chars.slice(i,end).join(''));
      i=end;
    }
    return out;
  }
  function joinTranslatedFragments(translated,sourceFragments){
    let combined='';
    for(let i=0;i<translated.length;i++){
      const next=translated[i];
      const before=sourceFragments[i-1]||'',after=sourceFragments[i]||'';
      // Some MT engines trim the whitespace at the edge of each request.
      // Restore Latin word boundaries that appeared in the original source,
      // but never inject arbitrary spaces between CJK text fragments.
      const sourceBoundary=/\s$/u.test(before)||/^\s/u.test(after)||
        /[.!?。！？]$/u.test(before);
      if(i>0 && sourceBoundary && /[A-Za-z0-9,.;:!?]$/u.test(combined) &&
         /^[A-Za-z0-9]/u.test(next) && !/\s$/u.test(combined))
        combined+=' ';
      combined+=next;
    }
    return combined;
  }
  async function requestBoundedParagraphs(items,requestedMode,context,sessionId,onComplete){
    const fragments=items.map(item=>splitParagraph(item.original));
    const queued=fragments.flatMap((pieces,owner)=>
      pieces.map((text,index)=>({text,owner,index})));
    const results=fragments.map(parts=>Array(parts.length).fill(''));
    const completed=new Set();
    for(let i=0;i<queued.length;){
      // Restoring original text or navigating away cancels further queued
      // provider requests, even when a previous browser message is pending.
      if(!active||currentId!==sessionId)return null;
      const batch=[];let characters=0;
      while(i<queued.length&&batch.length<6){
        const item=queued[i];
        if(batch.length&&characters+item.text.length>9500)break;
        batch.push(item);characters+=item.text.length;i++;
      }
      const reply=await request(batch.map(x=>x.text),requestedMode,context,true);
      if(!active||currentId!==sessionId)return null;
      succeededBatches++;
      if(requestedMode==='ai')aiCount+=batch.length;
      for(let k=0;k<batch.length;k++){
        const item=batch[k];
        results[item.owner][item.index]=reply[k];
      }
      // Commit a paragraph as soon as *all* its fragments are valid. If
      // batch 2 fails, batch 1 translations stay visible and accounted for;
      // manual retry only sees genuinely untranslated paragraphs.
      for(const {owner} of batch){
        if(!completed.has(owner) && results[owner].every(t=>t.trim())){
          completed.add(owner);
          onComplete(owner,joinTranslatedFragments(results[owner],fragments[owner]));
        }
      }
    }
    return {completed:completed.size,segments:queued.length};
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
    if(element?.closest?.('.pit-translation,.pit-toast,.pit-selection-card'))return true;
    if(mutation.type==='childList' && mutation.addedNodes.length){
      return [...mutation.addedNodes].every(node=>
        node.nodeType===1 && node.matches?.('.pit-translation,.pit-toast,.pit-selection-card'));
    }
    if(mutation.type==='childList' && mutation.removedNodes.length){
      return [...mutation.removedNodes].every(node=>
        node.nodeType===1 && node.matches?.('.pit-translation,.pit-toast'));
    }
    return false;
  }
  async function translateContent(id){
    if(!active || id!==currentId)return;
    if(busySession===id){queued=true;return;}
    // A superseded provider request can take many seconds to settle.
    // Never let that old session block the user's new START after RESTORE.
    busySession=id;
    try{
      const limit=mode==='ai' ? Math.max(0,AI_MAX_PER_ACTION-aiCount)
        : Math.min(STANDARD_BATCH,Math.max(0,standardBudget-standardSpent));
      candidateChars=0;
      const targets=candidates().filter(visibleOrInitial).slice(0,limit);
      if(!targets.length)return;
      let count=0;
      for(let i=0;i<targets.length;i+=6){
        if(!active || currentId!==id)return;
        const chunk=targets.slice(i,i+6);
        chunk.forEach(x=>{x.el.dataset.pitLoading=prefs.loadingAnimation||'text';});
        const before=targets[i-1]?.original?.slice(-300)||'';
        const after=targets[i+6]?.original?.slice(0,300)||'';
        const segmentCount=chunk.reduce((n,item)=>n+splitParagraph(item.original).length,0);
        if(mode==='ai'&&aiCount+segmentCount>AI_MAX_PER_ACTION){
          lastError='AI 本次段落额度不足，长段需要多次分段；请手动重新选择或使用常规翻译。';
          break;
        }
        const outcome=await requestBoundedParagraphs(chunk,mode,
          [before,after].filter(Boolean).join('\n'),id,(owner,translation)=>{
            if(!active||currentId!==id)return;
            const item=chunk[owner];
            if(attach(item.el,item.original,translation,mode==='ai')){
              count++;
              if(mode==='standard')standardSpent++;
              initialChars+=item.original.length;
            }
          }).finally(()=>chunk.forEach(x=>delete x.el.dataset.pitLoading));
        if(!outcome)return;
        if(!active || currentId!==id)return;
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
      // A prior session may complete after a new one has started. It must
      // neither clear the new session's busy state nor schedule its queue.
      if(busySession===id){
        busySession=null;
        if(queued && active && currentId===id){
          queued=false;schedule(id,200);
        }
      }
    }
  }
  function restore(){
    if(titleRecord&&document.title===titleRecord.translated)document.title=titleRecord.original;
    titleRecord=null;initialChars=0;
    active=false;currentId++;
    clearTimeout(timer);timer=null;queued=false;busySession=null;
    observer?.disconnect();observer=null;observedRoots.clear();
    for(const root of roots()){
      root.querySelectorAll('.pit-translation').forEach(node=>node.remove());
      root.querySelectorAll('.pit-source-block').forEach(node=>
        node.classList.remove('pit-source-block','pit-original-concealed'));
    }
    document.querySelectorAll('.pit-toast,.pit-selection-card').forEach(node=>node.remove());
    processed=new WeakMap();aiCount=0;standardSpent=0;standardBudget=STANDARD_STEP;
    failedBatches=0;succeededBatches=0;lastError='';
  }
  function setDisplay(next,style=theme){
    if(!['bilingual','translation-only'].includes(next))return;
    display=next;theme=['subtle','underline','highlight','none'].includes(style)?style:'subtle';
    for(const root of roots()){
      root.querySelectorAll('.pit-source-block').forEach(el=>
        el.classList.toggle('pit-original-concealed',display==='translation-only'));
      root.querySelectorAll('.pit-translation').forEach(el=>el.dataset.theme=theme);
    }
  }
  function start(requestedMode,options={}) {
    const host=location.hostname.toLowerCase();
    if(String(prefs.blockedHosts||'').split(/[\s,;]+/).filter(Boolean).some(x=>host===x||host.endsWith('.'+x))){toast('本站已禁止翻译');return;}
    const lang=(prefs.sourceLanguage!=='auto'?prefs.sourceLanguage:document.documentElement.lang)?.split('-')[0];
    if(prefs.skipSameLanguage&&lang&&lang===prefs.targetLanguage){toast('明确源语与目标语相同，已跳过；可在高级设置关闭。');return;}
    restore();mode=requestedMode;active=true;
    taskId='web-'+(globalThis.crypto?.randomUUID?.()||Date.now().toString(36)+'-'+Math.random().toString(36).slice(2));
    scope=options.scope==='full'?'full':'smart';
    setDisplay(options.display||display,options.theme||theme);
    if(prefs.translationOnlyLanguages?.includes(lang))setDisplay('translation-only',theme);
    const id=++currentId;
    if(prefs.translateTitle&&document.title){const original=document.title;void request([original],requestedMode,'',true).then(values=>{if(active&&currentId===id&&document.title===original&&values[0]){titleRecord={original,translated:values[0]};document.title=values[0];}}).catch(e=>toast('标题翻译失败：'+e.message));}
    if(prefs.temporaryAutoTranslateMinutes>0)void chrome.runtime.sendMessage({type:'PIT_TEMPORARY_AUTO'}).catch(()=>{});
    if(requestedMode==='standard'){
      observer=new MutationObserver(mutations=>{
        if(!active || currentId!==id || mutations.every(ownedMutation))return;
        observeRoots();schedule(id,600);
      });
      observeRoots();
    }
    void translateContent(id);
  }
  function speechLocale(code,text){
    const locales={zh:'zh-CN',en:'en-US',fr:'fr-FR',ja:'ja-JP',
      ko:'ko-KR',de:'de-DE',es:'es-ES'};
    if(locales[code])return locales[code];
    if(/[\u3040-\u30ff]/.test(text))return 'ja-JP';
    if(/[\uac00-\ud7af]/.test(text))return 'ko-KR';
    if(/[\u3400-\u9fff]/.test(text))return 'zh-CN';
    return document.documentElement.lang||'en-US';
  }
  function showSelectionCard(original,translated,rect){
    document.querySelector('.pit-selection-card')?.remove();
    const card=document.createElement('aside');
    card.className='pit-selection-card';
    card.setAttribute('role','dialog');
    card.setAttribute('aria-label','PIT 划词翻译');
    const title=document.createElement('strong');
    title.textContent='PIT · 划词翻译';
    const close=document.createElement('button');
    close.type='button';close.textContent='关闭';
    close.setAttribute('aria-label','关闭划词翻译');
    close.addEventListener('click',()=>card.remove());
    const heading=document.createElement('div');
    heading.className='pit-selection-header';
    heading.append(title,close);
    const source=document.createElement('p');source.className='pit-selection-source';
    source.textContent=original;
    const output=document.createElement('p');output.className='pit-selection-result';
    output.textContent=translated;
    const actions=document.createElement('div');actions.className='pit-selection-actions';
    const button=(label,run)=>{
      const el=document.createElement('button');
      el.type='button';el.textContent=label;el.addEventListener('click',run);
      actions.append(el);
    };
    button('复制译文',()=>{
      void navigator.clipboard?.writeText(translated)
        .then(()=>toast('译文已复制'))
        .catch(()=>toast('复制失败，请手动选择译文'));
    });
    button('朗读原文',()=>{
      if(!('speechSynthesis' in window) || !('SpeechSynthesisUtterance' in window)){
        toast('此浏览器未提供语音朗读功能');return;
      }
      window.speechSynthesis.cancel();
      const utterance=new SpeechSynthesisUtterance(original);
      utterance.lang=speechLocale(voiceSource,original);
      window.speechSynthesis.speak(utterance);
    });
    button('朗读译文',()=>{
      if(!('speechSynthesis' in window) || !('SpeechSynthesisUtterance' in window)){
        toast('此浏览器未提供语音朗读功能');return;
      }
      window.speechSynthesis.cancel();
      const utterance=new SpeechSynthesisUtterance(translated);
      utterance.lang=speechLocale(voiceTarget,translated);
      window.speechSynthesis.speak(utterance);
    });
    card.append(heading,source,output,actions);
    document.documentElement.append(card);
    const box=rect&&Number.isFinite(rect.left)?rect:null;
    const left=box?box.left:window.innerWidth/2-160;
    const top=box?box.bottom+9:70;
    card.style.left=Math.max(8,Math.min(left,window.innerWidth-340))+'px';
    card.style.top=Math.max(8,Math.min(top,window.innerHeight-180))+'px';
  }
  async function translateSelection(requestedMode) {
    if(prefs.selectionTranslate===false){toast('划词翻译已关闭');return;}
    const selection=window.getSelection();
    const text=selection?.toString().trim()||'';
    if(!text || text.length>5000){toast('请选中 1–5000 字符的正文');return;}
    const anchor=selection.anchorNode?.parentElement;
    if(anchor && isUnsafe(anchor)){toast('无法翻译编辑框或受保护区域');return;}
    let rectangle=null;
    try{
      if(selection.rangeCount)rectangle=selection.getRangeAt(0).getBoundingClientRect();
    }catch{}
    try{
      const result=await request([text],requestedMode,'');
      showSelectionCard(text,result[0],rectangle);
    }
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
  function loadPreferences(auto=false){return chrome.runtime.sendMessage({type:'PIT_PUBLIC_PREFERENCES',
    pageLanguage:document.documentElement.lang||''}).then(answer=>{
    if(!answer?.ok||!answer.preferences)return;
    const p=answer.preferences;
    prefs=p;
    const rule=[...(p.siteRules||[])].sort((a,b)=>b.host.length-a.host.length).find(x=>location.hostname===x.host||location.hostname.endsWith('.'+x.host));
    if(rule?.theme&&rule.theme!=='inherit')p.translationTheme=rule.theme;
    if(rule?.target&&rule.target!=='inherit')p.targetLanguage=rule.target;
    if(p.floatingControl===true)mountFloatingControl();
    voiceSource=p.sourceLanguage||'auto';voiceTarget=p.targetLanguage||'zh';
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
    if(matches(p.blockedHosts)){restore();hoverEnabled=false;inputEnabled=false;document.getElementById('pit-floating-translate')?.remove();return;}
    for(const source of queryDeep('.pit-source-block')){
      const record=processed.get(source);if(!record?.node)continue;
      const node=record.node;
      applyReadingStyle(node,p);
      node.textContent=p.longParagraphLineBreak?record.translation.replace(/([.!?。！？])\s*/g,'$1\n'):record.translation;
      if(p.longParagraphLineBreak||p.lineBreakPolicy==='always')node.style.setProperty('white-space','pre-line','important');
      if(theme==='none')node.style.setProperty('background-color','transparent','important');
      if(node.classList.contains('pit-flow-translation')||source.matches('li,td,th')){
        if(p.translationOrder==='translation-first')source.prepend(node);else source.append(node);
      }else source.insertAdjacentElement(p.translationOrder==='translation-first'?'beforebegin':'afterend',node);
    }
    if(!p.floatingControl)document.getElementById('pit-floating-translate')?.remove();
    if(auto&&(matches(p.autoTranslateHosts)||p.temporaryAutoTranslateUntil?.[host]>Date.now())&&!matches(p.blockedHosts)){
      // A first install must never silently fake translations or send API
      // calls to an unconfigured self-hosted Worker.
      if(p.standardReady===true)start('standard',{scope,display,theme});
      else toast(p.standardProvider==='browser'
        ?'本网站已启用自动翻译，但 Chrome 内置模型未准备好或无法确定源语言；请在 PIT 设置检查/下载语言包。'
        :'该站点已加入自动翻译，但常规翻译服务尚未配置或就绪。请打开 PIT 设置。');
    }
  }).catch(()=>{});}
  void loadPreferences(true);
  document.addEventListener('scroll',()=>{if(active&&mode==='standard'&&!prefs.translateToBottom)schedule(currentId,150);},{passive:true});
  chrome.runtime.onMessage.addListener((message,_sender,reply)=>{
    if(message?.type==='PIT_PREFERENCES_CHANGED'){void loadPreferences().then(()=>reply({ok:true}));return true;}
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
