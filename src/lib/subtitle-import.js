/* Local, user-provided .srt or .vtt files; no subtitle requests from platforms. */
(function(root){
 function seconds(raw){
   const t=String(raw||'').trim().replace(',','.');
   const parts=t.split(':').map(Number);
   if(parts.some(n=>!Number.isFinite(n)||n<0)||parts.length<2||parts.length>3)return NaN;
   const [a,b,c]=parts.length===3?parts:[0,...parts];
   if(b>=60||c>=60||!Number.isInteger(b))return NaN;
   return a*3600+b*60+c;
 }
 function parseAss(raw){
   const cues=[];let inEvents=false,fields=[];
   for(const line of raw.replace(/\r/g,'').split('\n')){
     const trimmed=line.trim();
     if(/^\[[^\]]+\]$/.test(trimmed)){
       inEvents=/^\[events\]$/i.test(trimmed);continue;
     }
     if(!inEvents)continue;
     if(/^Format\s*:/i.test(trimmed)){
       fields=trimmed.slice(trimmed.indexOf(':')+1).split(',').map(x=>x.trim().toLowerCase());
       continue;
     }
     if(!/^Dialogue\s*:/i.test(trimmed))continue;
     const start=fields.indexOf('start'),end=fields.indexOf('end'),text=fields.indexOf('text');
     if(start<0||end<0||text!==fields.length-1||fields.length<3)continue;
     // Only the last Text field can contain commas; preserve these.
     const values=trimmed.slice(trimmed.indexOf(':')+1).split(',');
     if(values.length<fields.length)continue;
     const begin=seconds(values[start]),finish=seconds(values[end]);
     const dialogue=values.slice(text).join(',').replace(/\{[^}]*\}/g,'')
       .replace(/\\[Nn]/g,' ').replace(/\\h/g,' ').trim();
     if(Number.isFinite(begin)&&Number.isFinite(finish)&&finish>begin&&
        finish-begin<=360&&dialogue&&dialogue.length<=3000)
       cues.push({startTime:begin,endTime:finish,text:dialogue});
     if(cues.length>=5000)break;
   }
   return cues;
 }
 function parseSubtitles(raw){
   if(typeof raw!=='string'||raw.length>2_000_000)throw Error('字幕文件无效或超过 2MB');
   if(/^\s*\[Script Info\]|^\s*\[Events\]/im.test(raw))
     return parseAss(raw);
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