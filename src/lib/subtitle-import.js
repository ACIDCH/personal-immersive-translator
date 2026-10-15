/* Local, user-provided .srt or .vtt files; no subtitle requests from platforms. */
(function(root){
 function seconds(raw){
   const t=String(raw||'').trim().replace(',','.');
   const parts=t.split(':').map(Number);
   if(parts.some(n=>!Number.isFinite(n))||parts.length<2||parts.length>3)return NaN;
   const [a,b,c]=parts.length===3?parts:[0,...parts];
   return a*3600+b*60+c;
 }
 function parseSubtitles(raw){
   if(typeof raw!=='string'||raw.length>2_000_000)throw Error('字幕文件无效或超过 2MB');
   const normalized=raw.replace(/^\uFEFF/,'').replace(/\r/g,'').replace(/^WEBVTT[^\n]*\n/,'');
   const blocks=normalized.split(/\n\s*\n/),result=[];
   for(const block of blocks.slice(0,5000)){
     const lines=block.trim().split('\n');
     const timing=lines.findIndex(line=>line.includes('-->'));
     if(timing<0)continue;
     const match=lines[timing].match(/^\s*([\d:,.]+)\s*-->\s*([\d:,.]+)/);
     if(!match)continue;
     const startTime=seconds(match[1]), endTime=seconds(match[2]);
     const text=lines.slice(timing+1).join(' ').replace(/<[^>]*>/g,'').trim();
     if(Number.isFinite(startTime)&&endTime>startTime&&text)result.push({startTime,endTime,text});
   }
   return result;
 }
 root.PITSubtitleImport=Object.freeze({seconds,parseSubtitles});
})(globalThis);