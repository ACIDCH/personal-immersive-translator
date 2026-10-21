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
  // A YouTube "caption window" may contain multiple text spans, but several
  // windows can be shown at once for different speakers. Never concatenate
  // independent player-owned windows and then try to write one translation
  // into a different DOM subtree.
  function groupedLeaves(doc,hostname,visible=isVisible){
    const rule=identify(hostname);
    if(rule.id==='generic')return {provider:rule.id,groups:[],reason:'no-adapter'};
    discardStalePatches();
    for(const selector of rule.selectors){
      let selected;
      try{selected=[...doc.querySelectorAll(selector)].slice(0,35);}
      catch{continue;}
      const parents=new Map(),seen=new Set();
      for(const node of selected){
        if(node.closest?.('.pit-caption-overlay'))continue;
        // Netflix often selects a wrapper; find its visible leaf text nodes
        // without mutating text inside arbitrary controls or the player root.
        const descendants=node.childElementCount>0
          ?[...node.querySelectorAll('*')].filter(child=>child.childElementCount===0)
          :[node];
        for(const leaf of descendants){
          if(seen.has(leaf))continue;
          if(leaf.closest?.('button,input,textarea,[contenteditable],.pit-caption-overlay'))continue;
          if(!visible(leaf)&&!(inline.has(leaf)&&leaf.parentElement&&visible(leaf.parentElement)))continue;
          if(!displayedText(leaf,visible))continue;
          seen.add(leaf);
          const parent=rule.id==='netflix'
            ?leaf.closest?.('.player-timedtext-text-container')||leaf.parentElement||leaf
            :rule.id==='panopto'?node:leaf.parentElement||leaf;
          if(!parents.has(parent))parents.set(parent,[]);
          parents.get(parent).push(leaf);
        }
      }
      const found=[...parents.values()].map(leaves=>({
        leaves,text:compact(leaves.map(leaf=>displayedText(leaf,visible))
          .filter(Boolean).join(' '))
      })).filter(group=>group.text);
      if(found.length)return {provider:rule.id,selector,groups:found};
    }
    return {provider:rule.id,groups:[],reason:'no-visible-captions'};
  }
  function readVisibleCaptionGroups(doc,hostname,visible=isVisible){
    const selected=groupedLeaves(doc,hostname,visible);
    return {provider:selected.provider,selector:selected.selector,
      groups:selected.groups.map(group=>({text:group.text})),
      reason:selected.reason};
  }
  function replaceVisibleCaptionGroups(doc,hostname,translations){
    if(!Array.isArray(translations)||!translations.length||
       translations.length>MAX_GROUP_NODES)return false;
    const wanted=translations.map(item=>({
      text:compact(item?.text),translation:compact(item?.translation)
    }));
    if(wanted.some(x=>!x.text||!x.translation))return false;
    const selected=groupedLeaves(doc,hostname);
    const snapshots=selected.groups;
    // Atomic preflight: don't translate one speaker but leave the other
    // untranslated when a player changes its caption DOM during a request.
    if(snapshots.length!==wanted.length||snapshots.some((g,i)=>
      g.text!==wanted[i].text||g.leaves.length>MAX_GROUP_NODES))return false;
    const oldGroups=new Set(snapshots.flatMap(g=>g.leaves.map(n=>inline.get(n)?.group))
      .filter(Boolean));
    const untouched=snapshots.every((g,i)=>
      g.leaves.every((node,k)=>{
        const held=inline.get(node);
        return held?.group?.translation===wanted[i].translation&&
          held.group.original===wanted[i].text&&
          node.textContent===held.translated&&
          held.group.parts[k]?.node===node;
      }));
    if(untouched)return true;
    for(const held of oldGroups)restoreGroup(held);
    if(snapshots.some((g,i)=>compact(g.leaves.map(n=>n.textContent).filter(Boolean).join(' '))!==wanted[i].text))
      return false;
    const newNodes=snapshots.reduce((n,g)=>n+g.leaves.length,0);
    if(inline.size+newNodes>MAX_HELD_NODES)return false;
    const patched=[];
    try{
      for(let i=0;i<snapshots.length;i++){
        const g=snapshots[i],w=wanted[i];
        const group={original:w.text,translation:w.translation,
          parts:g.leaves.map((node,k)=>({
            node,original:node.textContent,translated:k===0?w.translation:''
          }))};
        for(const part of group.parts){
          inline.set(part.node,{original:part.original,
            translated:part.translated,group});
          part.node.textContent=part.translated;
        }
        patched.push(group);
        groups.add(group);
      }
      return true;
    }catch{
      for(const group of patched)restoreGroup(group);
      return false;
    }
  }
  function replaceVisibleCaption(doc,hostname,original,translation){
    return replaceVisibleCaptionGroups(doc,hostname,[{text:original,translation}]);
  }
  function restoreVisibleCaptions(){
    for(const group of [...groups])restoreGroup(group);
  }
  function captionChanged(previous,current){
    const text=typeof current==='string'?current:current?.text;
    return Boolean(text && text!==previous);
  }
  root.PITPlatformCaptions=Object.freeze({identify,compact,isVisible,readVisibleCaptions,readVisibleCaptionGroups,replaceVisibleCaption,replaceVisibleCaptionGroups,restoreVisibleCaptions,captionChanged});
})(globalThis);
