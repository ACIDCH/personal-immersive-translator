/* Platform DOM subtitle fallback: observes only subtitles already visible to the viewer.
   No page-world network hooks, authentication workarounds or DRM access. */
(function(root) {
  const rules=[
    {id:'youtube',hosts:[/(^|\.)youtube\.com$/i,/(^|\.)youtube-nocookie\.com$/i],selectors:['.ytp-caption-window-container .ytp-caption-segment','.ytp-caption-segment']},
    {id:'netflix',hosts:[/(^|\.)netflix\.com$/i],selectors:['.player-timedtext-text-container','.player-timedtext [data-uia="subtitle-text"]']},
    {id:'panopto',hosts:[/(^|\.)panopto\./i],selectors:['.captionText','.caption-text','.transcript-text']},
    {id:'generic',hosts:[],selectors:[]}
  ];
  function identify(hostname) {
    return rules.find(rule=>rule.hosts.some(re=>re.test(hostname)))||rules.at(-1);
  }
  function compact(text) {
    return String(text||'').replace(/\s+/g,' ').trim().slice(0,3000);
  }
  function readVisibleCaptions(doc, hostname, visible) {
    const rule=identify(hostname);
    if(rule.id==='generic') return {provider:'generic',text:'',reason:'no-adapter'};
    for(const selector of rule.selectors) {
      let nodes;
      try{nodes=Array.from(doc.querySelectorAll(selector)).slice(0,30)}catch{continue}
      const lines=[];
      for(const node of nodes) {
        if(node.closest?.('.pit-caption-overlay')) continue;
        if(typeof visible==='function' && !visible(node)) continue;
        const text=compact(node.textContent);
        if(text && !lines.includes(text)) lines.push(text);
      }
      if(lines.length) return {provider:rule.id,text:compact(lines.join(' ')),selector};
    }
    return {provider:rule.id,text:'',reason:'no-visible-captions'};
  }
  function captionChanged(previous,current){return Boolean(current && current.text && current.text!==previous);}
  root.PITPlatformCaptions=Object.freeze({identify,compact,readVisibleCaptions,captionChanged});
})(globalThis);
