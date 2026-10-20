/* Only currently visible, permitted caption DOM. No player internals,
   credential scraping, cross-origin frame traversal or DRM bypass. */
(function(root){
  'use strict';
  const rules=[
    {id:'youtube',hosts:[/(^|\.)youtube\.com$/i,/(^|\.)youtube-nocookie\.com$/i],
      selectors:['.ytp-caption-window-container .ytp-caption-segment','.ytp-caption-segment']},
    {id:'bilibili',hosts:[/(^|\.)bilibili\.com$/i],
      selectors:[
        '.bpx-player-subtitle-panel-major-group span',
        '.bpx-player-subtitle-panel-text',
        '.bpx-player-subtitle-item',
        '.bilibili-player-video-subtitle .subtitle-item'
      ]},
    {id:'netflix',hosts:[/(^|\.)netflix\.com$/i],
      selectors:['.player-timedtext [data-uia="subtitle-text"]','.player-timedtext-text-container']},
    {id:'panopto',hosts:[/(^|\.)panopto\./i],
      selectors:['.captionText','.caption-text','.transcript-text']},
    {id:'generic',hosts:[],selectors:[]}
  ];
  function identify(hostname){
    const host=String(hostname||'').toLowerCase();
    return rules.find(rule=>rule.hosts.some(re=>re.test(host))) || rules.at(-1);
  }
  function compact(text){
    return String(text||'').replace(/[\u200B-\u200D\uFEFF]/g,'').replace(/\s+/g,' ').trim().slice(0,3000);
  }
  function isVisible(node){
    if(!node?.isConnected || !node.getClientRects?.().length) return false;
    const view=node.ownerDocument?.defaultView;
    let el=node;
    while(el && el.nodeType===1){
      const style=view?.getComputedStyle(el);
      if(style?.display==='none'||style?.visibility==='hidden'||
         style?.visibility==='collapse'||style?.opacity==='0') return false;
      el=el.parentElement;
    }
    return true;
  }
  // Only explicitly editable, single-node public caption text is mutated.
  // WeakMap prevents re-translating PIT's own replacement as a new source.
  const inline=new Map();
  function originalIfUnchanged(node){
    const state=inline.get(node);
    if(!state)return null;
    if(node.textContent===state.translated)return state.original;
    inline.delete(node);return null;
  }
  function displayedText(node,visible){
    const held=originalIfUnchanged(node);
    if(held!==null)return compact(held);
    const doc=node.ownerDocument;
    if(!doc?.createTreeWalker) return compact(node.textContent);
    const walker=doc.createTreeWalker(node,4); // NodeFilter.SHOW_TEXT
    const parts=[];
    let part;
    while((part=walker.nextNode())){
      if(visible(part.parentElement)){
        const text=compact(part.nodeValue);
        if(text)parts.push(text);
      }
      if(parts.join(' ').length>3000)break;
    }
    return compact(parts.join(' '));
  }
  function readVisibleCaptions(doc,hostname,visible=isVisible){
    const rule=identify(hostname);
    if(rule.id==='generic')return {provider:'generic',text:'',reason:'no-adapter'};
    for(const selector of rule.selectors){
      let nodes;
      try{nodes=[...doc.querySelectorAll(selector)].slice(0,35)}catch{continue;}
      const lines=[];
      for(const node of nodes){
        if(node.closest?.('.pit-caption-overlay'))continue;
        if(!visible(node))continue;
        // Netflix and Panopto often wrap leaf spans with an ancestor selected
        // by the fallback. Never concatenate parent and child copies.
        if(nodes.some(other=>other!==node && node.contains?.(other) && visible(other)))continue;
        const text=displayedText(node,visible);
        if(text && lines.at(-1)!==text && !lines.includes(text))lines.push(text);
      }
      if(lines.length)return {provider:rule.id,text:compact(lines.join(' ')),selector};
    }
    return {provider:rule.id,text:'',reason:'no-visible-captions'};
  }
  function replaceVisibleCaption(doc,hostname,original,translation){
    const rule=identify(hostname);
    if(rule.id==='generic'||!original||!translation)return false;
    const text=compact(original),translated=compact(translation);
    if(!text||!translated)return false;
    // Replacing a parent's innerHTML or multiple caption spans may erase
    // timestamps, speaker metadata or other active content; fail closed.
    for(const selector of rule.selectors){
      let nodes;
      try{nodes=[...doc.querySelectorAll(selector)].filter(isVisible);}catch{continue;}
      const leaves=nodes.filter(node=>node.childElementCount===0 &&
        !node.closest?.('.pit-caption-overlay'));
      if(leaves.length!==1)continue;
      const node=leaves[0];
      if(displayedText(node,isVisible)!==text)continue;
      const prior=inline.get(node);
      if(prior && node.textContent===prior.translated &&
         prior.original===text && prior.translated===translated)return true;
      if(node.textContent!==text && !prior)continue;
      if(inline.size>=12)for(const [other] of inline){
        if(!other.isConnected)inline.delete(other);
      }
      if(inline.size>=12)return false;
      inline.set(node,{original:prior?.original||node.textContent,translated});
      node.textContent=translated;
      return true;
    }
    return false;
  }
  function restoreVisibleCaptions(){
    for(const [node,item] of inline){
      if(node.isConnected && node.textContent===item.translated)
        node.textContent=item.original;
    }
    inline.clear();
  }
  function captionChanged(previous,current){
    const text=typeof current==='string'?current:current?.text;
    return Boolean(text && text!==previous);
  }
  root.PITPlatformCaptions=Object.freeze({identify,compact,isVisible,readVisibleCaptions,replaceVisibleCaption,restoreVisibleCaptions,captionChanged});
})(globalThis);
