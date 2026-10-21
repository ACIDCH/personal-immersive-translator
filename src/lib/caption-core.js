/* Shared by the content-script world and Node tests; no network access. */
(function (root) {
  'use strict';
  const MAX_EVENTS = 3000;
  function cleanText(s) {
    return String(s ?? '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, 3000);
  }
  function normalizeCues(cues, aroundTime=null) {
    if (!Array.isArray(cues)) return [];
    // A long VOD/live event may have >3000 cues. Never pin extraction to the
    // beginning of the video after the user seeks far ahead.
    let selected=cues;
    if (cues.length > MAX_EVENTS) {
      selected=Number.isFinite(aroundTime)
        ? cues.filter(c=>Number(c.endTime)>=aroundTime-30 && Number(c.startTime)<=aroundTime+300)
        : cues.slice(-MAX_EVENTS);
    }
    const seen = new Set(), out = [];
    for (const c of selected.slice(0, MAX_EVENTS)) {
      const start = Number(c.startTime), end = Number(c.endTime), text = cleanText(c.text);
      if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end - start > 180 || !text) continue;
      const key = [start.toFixed(3),end.toFixed(3),text].join('|');
      if (seen.has(key)) continue;
      seen.add(key); out.push({key,start,end,text});
    }
    return out.sort((a,b)=>a.start-b.start || a.end-b.end);
  }
  function currentCue(cues, time) {
    // Multiple cues may overlap. Prefer the most recently started cue.
    let found = null;
    for (const c of cues) {
      if (c.start > time + .15) break;
      if (c.start <= time + .15 && c.end >= time - .10) found = c;
    }
    return found;
  }
  function activeCues(cues,time,limit=3){
    if(!Array.isArray(cues)||!Number.isFinite(time))return [];
    const matches=[],texts=new Set();
    for(const cue of cues){
      if(cue.start>time+.15)break;
      if(cue.start<=time+.15 && cue.end>=time-.10 && !texts.has(cue.text)){
        texts.add(cue.text);
        matches.push(cue);
      }
    }
    return matches.slice(-Math.min(5,Math.max(1,limit)));
  }
  function upcomingCues(cues, time, rate=1, limit=5) {
    const r = Math.max(.25, Math.min(4, Number(rate)||1));
    const ahead = Math.max(12,18*r);
    return cues.filter(c=>c.end>=time-.3 && c.start<=time+ahead)
      .slice(0, Math.min(10,Math.max(1,limit)));
  }
  const LANGS=new Set(['en','zh','fr','de','es','ja','ko']);
  function normalizeCaptionSource(value){
    const code=String(value||'').toLowerCase().trim().replace(/_/g,'-');
    const primary=code.split('-')[0];
    return LANGS.has(primary)?primary:'';
  }
  class CaptionCache {
    constructor(limit = 350,{deduplicateText=true}={}) {
      this.limit=Math.max(1,limit);this.deduplicateText=deduplicateText;
      this.map=new Map();this.byText=new Map();this.inflight=new Set();
    }
    get(key) { return this.map.get(key); }
    has(key) { return this.map.has(key); }
    put(key, value) {
      if(typeof value!=='string'||!value.trim())return;
      this.map.delete(key);this.map.set(key,value);
      while(this.map.size>this.limit)this.map.delete(this.map.keys().next().value);
    }
    rememberText(text,translation){
      this.byText.delete(text);this.byText.set(text,translation);
      while(this.byText.size>this.limit)this.byText.delete(this.byText.keys().next().value);
    }
    async prefetch(cues, request) {
      const missing=cues.filter(c=>!this.map.has(c.key) && !this.inflight.has(c.key)).slice(0,5);
      if(!missing.length)return 0;
      missing.forEach(c=>this.inflight.add(c.key));
      try{
        // Timed cues repeat phrases after seeks, overlaps and live retries.
        // Group identical text *within the same video session*, never merge
        // distinct speaker windows or alter their timings.
        const distinct=new Map();
        let restored=0;
        for(const cue of missing){
          const known=this.deduplicateText?this.byText.get(cue.text):null;
          if(known){
            this.put(cue.key,known);restored++;
            continue;
          }
          if(!distinct.has(cue.text))distinct.set(cue.text,[]);
          distinct.get(cue.text).push(cue);
        }
        if(!distinct.size)return restored;
        const texts=[...distinct.keys()];
        const translations=await request(texts);
        if(!Array.isArray(translations)||translations.length!==texts.length||
           translations.some(t=>typeof t!=='string'||!t.trim()))
          throw new Error('Caption translations did not match the source cues');
        texts.forEach((text,index)=>{
          const translation=translations[index];
          if(this.deduplicateText)this.rememberText(text,translation);
          for(const cue of distinct.get(text))this.put(cue.key,translation);
        });
        return missing.length;
      }finally{
        missing.forEach(c=>this.inflight.delete(c.key));
      }
    }
    clear(){this.map.clear();this.byText.clear();this.inflight.clear();}
  }
  root.PITCaptionCore = Object.freeze({cleanText,normalizeCues,currentCue,activeCues,upcomingCues,normalizeCaptionSource,CaptionCache});
})(globalThis);
