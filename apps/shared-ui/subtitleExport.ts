export type TimedCue={start:number;end:number;text:string};
function parseTime(value:string):number{
 const cleaned=value.trim();
 if(!/^(?:\d{1,3}:)?\d{2}:\d{2}[,.]\d{1,3}$/.test(cleaned))return NaN;
 const parts=cleaned.replace(',','.').split(':').map(Number);
 if(parts.length<2||parts.length>3||parts.some(v=>!Number.isFinite(v)))return NaN;
 if(parts.at(-2)!>59||parts.at(-1)!>=60)return NaN;
 const [h,m,s]=parts.length===3?parts:[0,...parts];
 return h*3600+m*60+s;
}
function parseAssSubtitle(raw:string):TimedCue[]{
 const cues:TimedCue[]=[];
 let inEvents=false,fields:string[]=[];
 for(const line of raw.replace(/\r/g,'').split('\n')){
   const value=line.trim();
   if(/^\[[^\]]+\]$/.test(value)){
     inEvents=/^\[events\]$/i.test(value);continue;
   }
   if(!inEvents)continue;
   if(/^Format\s*:/i.test(value)){
     fields=value.slice(value.indexOf(':')+1).split(',').map(s=>s.trim().toLowerCase());
     continue;
   }
   if(!/^Dialogue\s*:/i.test(value))continue;
   const start=fields.indexOf('start'),end=fields.indexOf('end'),text=fields.indexOf('text');
   if(start<0||end<0||text!==fields.length-1||fields.length<3)continue;
   const parts=value.slice(value.indexOf(':')+1).split(',');
   if(parts.length<fields.length)continue;
   const begin=parseTime(parts[start]),finish=parseTime(parts[end]);
   const plain=parts.slice(text).join(',').replace(/\{[^}]*\}/g,'')
     .replace(/\\[Nn]/g,'\n').replace(/\\h/g,' ').trim();
   if(!Number.isFinite(begin)||!Number.isFinite(finish)||begin<0||
      finish<=begin||finish-begin>360||!plain)continue;
   if(plain.length>4500)throw Error('单条字幕超过 4500 字符');
   if(cues.length>=3000)throw Error('当前最多可翻译 3000 条字幕');
   cues.push({start:begin,end:finish,text:plain});
 }
 if(!cues.length)throw Error('ASS 没有有效的事件时间轴');
 return cues;
}
export function parseSubtitleFile(raw:string):TimedCue[]{
 if(raw.length>2_000_000)throw Error('字幕文件不得超过 2MB');
 if(/^\s*\[Script Info\]|^\s*\[Events\]/im.test(raw))
   return parseAssSubtitle(raw);
 const normalized=raw.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n');
 const value=normalized.replace(/^WEBVTT[^\n]*(?:\n|$)/,'');
 const cues:TimedCue[]=[];
 for(const block of value.split(/\n\s*\n/)){
   const lines=block.trim().split('\n');
   if(/^(NOTE|STYLE|REGION)(?:[ \t]|$)/.test(lines[0]||''))continue;
   const index=lines.findIndex(l=>l.includes('-->'));
   if(index<0||index>1)continue;
   const match=lines[index].match(/^\s*([\d:,.]+)\s*-->\s*([\d:,.]+)/);
   if(!match)continue;
   const start=parseTime(match[1]),end=parseTime(match[2]);
   const text=lines.slice(index+1).join('\n')
     .replace(/<[^>]*>/g,'').replace(/\{\\[^}]+\}/g,'').trim();
   if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<=start||
      end-start>360||!text)continue;
   if(cues.length>=3000)throw Error('当前最多可翻译 3000 条字幕');
   if(text.length>4500)throw Error('单条字幕超过 4500 字符');
   cues.push({start,end,text});
 }
 if(!cues.length)throw Error('没有识别到有效的 SRT/VTT 时间轴');
 return cues;
}
function timestamp(seconds:number):string{
 const ms=Math.max(0,Math.round(seconds*1000));
 const pad=(n:number,w:number)=>String(n).padStart(w,'0');
 return pad(Math.floor(ms/3600000),2)+':'+
   pad(Math.floor(ms%3600000/60000),2)+':'+
   pad(Math.floor(ms%60000/1000),2)+','+pad(ms%1000,3);
}
export function formatBilingualSrt(cues:TimedCue[],translations:string[]):string{
 if(cues.length!==translations.length||translations.some(t=>!t?.trim()))
   throw Error('译文数量与时间轴不对应');
 return cues.map((cue,index)=>
   `${index+1}\n${timestamp(cue.start)} --> ${timestamp(cue.end)}\n${cue.text}\n${translations[index].trim()}\n`
 ).join('\n');
}
