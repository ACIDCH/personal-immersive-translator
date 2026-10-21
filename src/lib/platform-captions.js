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
  // Touch only visible, leaf-level public caption text; never flatten an
  // entire player container. A caption can be split into multiple sibling
  // spans (common on YouTube), which must be replaced and restored as a unit.
  const inline=new Map();
  const groups=new Set();
  const MAX_GROUP_NODES=8, MAX_HELD_NODES=24;
  function restoreGroup(group){
    for(const part of group.parts){
      // A player may have replaced this cue since PIT last wrote it.
      // Never overwrite newer caption text created by the site.
      if(part.node.isConnected&&part.node.textContent===part.translated)
        part.node.textContent=part.original;
      inline.delete(part.node);
    }
    groups.delete(group);
  }
  function discardStalePatches(){
    for(const group of [...groups]){
      if(group.parts.some(part=>!part.node.isConnected ||
         part.node.textContent!==part.translated))restoreGroup(group);
    }
  }
  function originalIfUnchanged(node){
    const held=inline.get(node);
    if(!held)return null;
    if(node.textContent===held.translated)return held.original;
    restoreGroup(held.group);
    return null;
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
    discardStalePatches();
    for(const selector of rule.selectors){
      let nodes;
      try{nodes=[...doc.querySelectorAll(selector)].slice(0,35)}catch{continue;}
      const lines=[];
      for(const node of nodes){
        if(node.closest?.('.pit-caption-overlay'))continue;
        // Empty trailing spans remain owned by PIT after a split caption
        // is collapsed into its first leaf. Their parent remains visible.
        if(!visible(node)&&!(inline.has(node)&&node.parentElement&&visible(node.parentElement)))continue;
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
    discardStalePatches();
    for(const selector of rule.selectors){
      let nodes;
      try{nodes=[...doc.querySelectorAll(selector)].slice(0,35);}catch{continue;}
      const leaves=nodes.filter(node=>node.childElementCount===0 &&
        !node.closest?.('.pit-caption-overlay') &&
        (isVisible(node)||(inline.has(node)&&isVisible(node.parentElement))));
      if(!leaves.length||leaves.length>MAX_GROUP_NODES)continue;
      // Multi-span updates are safe only inside one caption container;
      // separate speakers/windows or transcript sections stay unmodified.
      if(leaves.length>1&&!leaves.every(n=>n.parentElement===leaves[0].parentElement))
        continue;
      const parts=leaves.map(node=>displayedText(node,isVisible));
      if(compact(parts.filter(Boolean).join(' '))!==text)continue;
      const held=new Set(leaves.map(node=>inline.get(node)?.group).filter(Boolean));
      const existing=inline.get(leaves[0])?.group;
      if(held.size===1&&existing&&existing.original===text &&
         existing.translation===translated&&existing.parts.length===leaves.length &&
         existing.parts.every((part,i)=>part.node===leaves[i] &&
           part.node.textContent===part.translated))return true;
      for(const group of held)restoreGroup(group);
      // Prevent mutating a site that rewrote part of the caption between
      // extraction and replacement.
      if(compact(leaves.map(node=>node.textContent).filter(Boolean).join(' '))!==text)
        continue;
      discardStalePatches();
      if(inline.size+leaves.length>MAX_HELD_NODES)return false;
      const group={original:text,translation:translated,parts:leaves.map((node,i)=>({
        node,original:node.textContent,translated:i===0?translated:''
      }))};
      groups.add(group);
      try{
        for(const part of group.parts){
          inline.set(part.node,{original:part.original,translated:part.translated,group});
          part.node.textContent=part.translated;
        }
        return true;
      }catch{
        restoreGroup(group);
        return false;
      }
    }
    return false;
  }
  function restoreVisibleCaptions(){
    for(const group of [...groups])restoreGroup(group);
  }
  function captionChanged(previous,current){
    const text=typeof current==='string'?current:current?.text;
    return Boolean(text && text!==previous);
  }
  root.PITPlatformCaptions=Object.freeze({identify,compact,isVisible,readVisibleCaptions,replaceVisibleCaption,restoreVisibleCaptions,captionChanged});
})(globalThis);
