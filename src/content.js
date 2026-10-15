/* User-initiated bilingual DOM translation. No external code execution.
 * Handles long documents, SPA text updates and open Shadow DOM without
 * reading previously inserted translations as part of the original source.
 */
(() => {
  if (globalThis.__PIT_TRANSLATOR_V1__) return;
  globalThis.__PIT_TRANSLATOR_V1__ = true;

  const SKIP = 'script,style,noscript,svg,canvas,pre,code,textarea,input,select,option,button,nav,footer,header,[contenteditable],[translate="no"],[aria-hidden="true"],.pit-translation,.pit-toast';
  const TARGETS = 'main p,article p,p,li,blockquote,h1,h2,h3,h4,h5,h6,figcaption,td,th,[role="heading"],[role="listitem"],[role="slide"] p';
  let processed = new WeakMap();
  let active = false, currentId = 0, mode = 'standard';
  let observer = null, observedRoots = new Set();
  let busy = false, queued = false, timer = null;
  let aiCount = 0;
  const AI_MAX_PER_ACTION = 30, STANDARD_BATCH = 70;

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
      if(part.closest?.(SKIP) || part.closest?.('form'))return true;
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
  function candidates() {
    const result=[];
    for(const el of queryDeep(TARGETS)){
      if(!el.isConnected || isUnsafe(el) || !el.getClientRects().length)continue;
      if(el.children.length && [...el.children].some(ch=>ch.matches?.(TARGETS)))continue;
      const original=sourceText(el);
      const record=processed.get(el);
      if(record && (record.source!==original || !record.node?.isConnected)){
        record.node?.remove();
        processed.delete(el);
      }
      if(original.length<12 || original.length>5000 || processed.has(el))continue;
      result.push({el,original});
    }
    return result;
  }
  function attach(el,source,translation,isAI) {
    if(!el.isConnected || !translation || sourceText(el)!==source)return false;
    const node=document.createElement('div');
    node.className='pit-translation'+(isAI?' pit-ai':'');
    node.textContent=translation;
    node.dataset.pit='translation';
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
      const limit=mode==='ai' ? Math.max(0,AI_MAX_PER_ACTION-aiCount) : STANDARD_BATCH;
      const targets=candidates().slice(0,limit);
      if(!targets.length)return;
      let count=0;
      for(let i=0;i<targets.length;i+=6){
        if(!active || currentId!==id)return;
        const chunk=targets.slice(i,i+6);
        const before=targets[i-1]?.original?.slice(-300)||'';
        const after=targets[i+6]?.original?.slice(0,300)||'';
        const translations=await request(chunk.map(x=>x.original),mode,[before,after].filter(Boolean).join('\n'));
        if(!active || currentId!==id)return;
        for(let j=0;j<chunk.length;j++){
          if(attach(chunk[j].el,chunk[j].original,translations[j],mode==='ai'))count++;
        }
        if(mode==='ai')aiCount+=chunk.length;
      }
      if(count)toast('已翻译 '+count+' 个新段落 · '+(mode==='ai'?'AI':'标准')+'模式');
      // A long article can exceed the first 70/250 nodes. Process further
      // only in standard mode; AI never expands its budget automatically.
      if(mode==='standard' && targets.length===STANDARD_BATCH && active){
        queued=true;
      }
    }catch(error){
      if(id===currentId)toast('翻译失败：'+String(error?.message||error));
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
    }
    document.querySelectorAll('.pit-toast').forEach(node=>node.remove());
    processed=new WeakMap();aiCount=0;
  }
  function start(requestedMode) {
    restore();mode=requestedMode;active=true;
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
  chrome.runtime.onMessage.addListener((message,_sender,reply)=>{
    if(message?.type==='PIT_START' && ['standard','ai'].includes(message.mode)){
      start(message.mode);reply({ok:true});
    }else if(message?.type==='PIT_RESTORE'){
      restore();reply({ok:true});
    }else if(message?.type==='PIT_SELECTION' && ['standard','ai'].includes(message.mode)){
      void translateSelection(message.mode);reply({ok:true});
    }
  });
})();