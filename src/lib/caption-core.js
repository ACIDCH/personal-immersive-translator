/* Shared by the content-script world and Node tests; no network access. */
(function (root) {
  'use strict';
  const MAX_EVENTS = 3000;
  function cleanText(s) {
    return String(s ?? '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, 3000);
  }
  function normalizeCues(cues) {
    if (!Array.isArray(cues)) return [];
    const seen = new Set(), out = [];
    for (const c of cues.slice(0, MAX_EVENTS)) {
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
  function upcomingCues(cues, time, rate=1, limit=5) {
    const r = Math.max(.25, Math.min(4, Number(rate)||1));
    const ahead = Math.max(12,18*r);
    return cues.filter(c=>c.end>=time-.3 && c.start<=time+ahead)
      .slice(0, Math.min(10,Math.max(1,limit)));
  }
  class CaptionCache {
    constructor(limit = 350) { this.limit=Math.max(1,limit); this.map=new Map(); this.inflight=new Set(); }
    get(key) { return this.map.get(key); }
    has(key) { return this.map.has(key); }
    put(key, value) {
      if(typeof value!=='string') return;
      this.map.delete(key); this.map.set(key,value);
      while(this.map.size>this.limit) this.map.delete(this.map.keys().next().value);
    }
    async prefetch(cues, request) {
      const missing=cues.filter(c=>!this.map.has(c.key) && !this.inflight.has(c.key)).slice(0,5);
      if (!missing.length) return 0;
      missing.forEach(c=>this.inflight.add(c.key));
      try {
        const translations = await request(missing.map(c=>c.text));
        if(!Array.isArray(translations) || translations.length!==missing.length || translations.some(t=>typeof t!=='string')) throw new Error('Caption translations did not match the source cues');
        missing.forEach((c,i)=>this.put(c.key,translations[i]));return missing.length;
      } finally {
        missing.forEach(c=>this.inflight.delete(c.key));
      }
    }
    clear(){this.map.clear();this.inflight.clear();}
  }
  root.PITCaptionCore = Object.freeze({cleanText,normalizeCues,currentCue,upcomingCues,CaptionCache});
})(globalThis);
