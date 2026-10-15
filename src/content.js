(() => {
  if (window.__PIT_TRANSLATOR_V1__) return;
  window.__PIT_TRANSLATOR_V1__ = true;

  const SKIP = 'script,style,noscript,svg,canvas,pre,code,textarea,input,select,option,button,nav,footer,header,[contenteditable],[translate="no"],[aria-hidden="true"],.pit-translation,.pit-toast';
  const TARGETS = 'main p,article p,p,li,blockquote,h1,h2,h3,h4,h5,h6,figcaption,td,th,[role="heading"],[role="listitem"],[role="slide"] p';
  const processed = new WeakMap();
  let active = false;
  let currentId = 0;
  let observer = null;
  let observedRoots = new Set();
  function getOpenRoots() {
    const found=[document], pending=[document], seen=new Set([document]);
    while(pending.length && found.length < 30) {
      const root=pending.shift();
      const elements=root.querySelectorAll('*');
      for(const el of [...elements].slice(0,6000)) {
        if(el.shadowRoot && !seen.has(el.shadowRoot)) {
          seen.add(el.shadowRoot); found.push(el.shadowRoot); pending.push(el.shadowRoot);
          if(found.length>=30) break;
        }
      }
    }
    return found;
  }
  function queryDeep(selector) {
    const result=[];
    for(const root of getOpenRoots()) result.push(...root.querySelectorAll(selector));
    return result;
  }
  function isUnsafe(el) {
    let current=el;
    while(current) {
      if(current.closest?.(SKIP) || current.closest?.('form')) return true;
      current=current.getRootNode?.().host || null;
    }
    return false;
  }
  function observeOpenRoots() {
    if(!observer) return;
    for(const root of getOpenRoots()) {
      if(observedRoots.has(root)) continue;
      const target=root===document ? document.body : root;
      if(target) {observer.observe(target,{childList:true,subtree:true});observedRoots.add(root);}
    }
  }
  let mode = 'standard';
  let busy = false;
  let rerunQueued = false;

  function toast(msg) {
    document.querySelector('.pit-toast')?.remove();
    const node = document.createElement('div'); node.className = 'pit-toast';
    node.textContent = msg; document.documentElement.append(node);
    setTimeout(()=>node.remove(), 5000);
  }
  function candidates() {
    return queryDeep(TARGETS).filter(el => {
      if (!el.isConnected || isUnsafe(el) || el.querySelector('.pit-translation') || !el.getClientRects().length) return false;
      if (el.children.length && [...el.children].some(ch => ch.matches?.(TARGETS))) return false;
      const text = el.textContent?.trim() || '';
      return text.length >= 12 && text.length <= 5000 && !processed.has(el) && !el.closest('form');
    }).slice(0,250);
  }
  function attach(el, translation, isAI) {
    if (!el.isConnected || !translation) return;
    const node = document.createElement('div');
    node.className = 'pit-translation' + (isAI ? ' pit-ai':'');
    node.textContent = translation;
    node.dataset.pit = 'translation';
    if (el.matches('li,td,th')) el.append(node);
    else el.insertAdjacentElement('afterend', node);
    processed.set(el,node);
  }
  async function request(texts, actionMode, context) {
    const answer = await chrome.runtime.sendMessage({type:'TRANSLATE_BATCH',texts,mode:actionMode,
      userInitiated:actionMode==='ai',context});
    if (!answer?.ok) throw new Error(answer?.error || '翻译请求失败');
    return answer.translations;
  }
  async function translateContent(id) {
    if (busy) {rerunQueued = true;return;}
    busy = true;
    try {
      const targets = candidates().slice(0, mode==='ai' ? 30 : 250);
      if (!targets.length) {if (id === currentId) toast('没有发现新的可翻译段落'); return;}
      let count=0;
      for (let i=0;i<targets.length;i+=6) {
        if (!active || id !== currentId) return;
        const els=targets.slice(i,i+6);
        const texts=els.map(x=>x.textContent.trim());
        const before=targets[i-1]?.textContent?.trim().slice(-400) || '';
        const after=targets[i+6]?.textContent?.trim().slice(0,400) || '';
        const results=await request(texts,mode,[before,after].filter(Boolean).join('\n'));
        if (!active || id !== currentId) return;
        for (let j=0;j<els.length;j++) {attach(els[j],results[j],mode==='ai');count++;}
      }
      if (active && count) toast(`已翻译 ${count} 个段落 · ${mode==='ai'?'AI':'标准'}模式`);
    } catch (error) {if (id===currentId) toast('翻译失败：'+String(error.message||error));}
    finally {
      busy = false;
      if (rerunQueued && active) {
        rerunQueued = false;
        const nextId = currentId;
        setTimeout(()=>translateContent(nextId),600);
      }
    }
  }
  function start(requestedMode) {
    restore();
    mode=requestedMode;
    active=true;
    const id=++currentId;
    translateContent(id);
    let debounce;
    if (requestedMode === 'standard') observer = new MutationObserver(mutations => {
      if (!active || !mutations.some(m=>[...m.addedNodes].some(n=>n.nodeType===1 && !n.closest?.('.pit-translation,.pit-toast')))) return;
      clearTimeout(debounce);
      debounce=setTimeout(()=>{if(active){observeOpenRoots();translateContent(id);}},800);
    });
    observeOpenRoots();
  }
  function restore() {
    active=false;
    currentId++;
    observer?.disconnect(); observer=null; observedRoots.clear();
    queryDeep('.pit-translation').forEach(n=>n.remove());
    document.querySelectorAll('.pit-toast').forEach(n=>n.remove());
    queryDeep(TARGETS).forEach(el=>processed.delete(el));
  }
  async function translateSelection(requestedMode) {
    const selection = window.getSelection();
    const text = selection?.toString().trim() || '';
    if (!text || text.length > 5000) {toast('请先选中 1–5000 字符的正文');return;}
    const anchor=selection.anchorNode?.parentElement;
    if (anchor?.closest(SKIP) || anchor?.closest('form')) {toast('无法翻译编辑框或受保护区域'); return;}
    try {
      const results=await request([text],requestedMode,'');
      toast(results[0]);
    } catch(e) {toast('翻译失败：'+String(e.message||e));}
  }
  chrome.runtime.onMessage.addListener((msg,sender,reply) => {
    if (msg?.type==='PIT_START' && ['standard','ai'].includes(msg.mode)) {start(msg.mode);reply({ok:true});}
    else if (msg?.type==='PIT_RESTORE') {restore();reply({ok:true});}
    else if (msg?.type==='PIT_SELECTION' && ['standard','ai'].includes(msg.mode)) {translateSelection(msg.mode);reply({ok:true});}
  });
})();
