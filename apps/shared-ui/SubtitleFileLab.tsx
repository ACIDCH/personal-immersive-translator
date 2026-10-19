import {useState} from 'react';
import type {ChangeEvent} from 'react';
import {formatBilingualSrt,parseSubtitleFile} from './subtitleExport';
import type {TimedCue} from './subtitleExport';

type Mode='standard'|'ai';
type Runtime={id?:string;sendMessage?:(input:unknown)=>Promise<{
 ok?:boolean;error?:string;translations?:string[];
}>};
function getRuntime():Runtime|undefined{
 return (globalThis as {chrome?:{runtime?:Runtime}}).chrome?.runtime;
}
export function SubtitleFileLab(){
 const runtime=getRuntime();
 const enabled=Boolean(runtime?.id&&location.protocol==='chrome-extension:'&&
  location.pathname==='/file-lab.html'&&runtime.sendMessage);
 const [file,setFile]=useState<File|null>(null);
 const [mode,setMode]=useState<Mode>('standard');
 const [status,setStatus]=useState('输入 SRT/VTT/ASS，输出带原文和译文的双语 SRT（ASS 样式不会保留）。');
 const [progress,setProgress]=useState('');
 const [busy,setBusy]=useState(false);
 if(!enabled)return null;
 function selected(e:ChangeEvent<HTMLInputElement>){
   setFile(e.target.files?.[0]||null);setProgress('');
 }
 async function translate(){
   if(busy||!file||!runtime?.sendMessage)return;
   if(file.size>2_000_000||!/\.(srt|vtt|ass)$/i.test(file.name)){
     setStatus('请上传不超过 2 MB 的 SRT/VTT/ASS 文件');return;
   }
   if(mode==='ai'&&!window.confirm('自选 AI 将连续翻译全部字幕，可能产生额外 API 费用，继续吗？'))return;
   setBusy(true);
   setStatus('正在解析并翻译字幕文件…');
   try{
     const cues:TimedCue[]=parseSubtitleFile(await file.text());
     const {createRecoverableTranslator}=await import('./translationRecovery');
     const translate=createRecoverableTranslator(async texts=>{
       const response=await runtime.sendMessage!({type:'TRANSLATE_DOCUMENT',texts,mode,userInitiated:true});
       if(!response?.ok||!response.translations)throw Error(response?.error||'字幕翻译服务响应失败');
       return response.translations;
     },{maxRetries:mode==='ai'?0:2,onRetry:info=>setProgress('字幕服务暂时繁忙，重试 '+info.attempt+' 次')});
     const outputs:string[]=[];
     for(let i=0;i<cues.length;){
       const chunk:TimedCue[]=[];let size=0;
       for(let j=i;j<cues.length&&chunk.length<8;j++){
         const cue=cues[j];
         if(chunk.length&&size+cue.text.length>10500)break;
         chunk.push(cue);size+=cue.text.length;
       }
       outputs.push(...await translate(chunk.map(x=>x.text)));
       i+=chunk.length;setProgress('已翻译 '+i+'/'+cues.length+' 条');
     }
     const serialized=formatBilingualSrt(cues,outputs);
     const url=URL.createObjectURL(new Blob([serialized],{type:'application/x-subrip;charset=utf-8'}));
     const a=document.createElement('a');
     a.href=url;a.download=file.name.replace(/\.(srt|vtt|ass)$/i,'')+'-bilingual.srt';
     document.body.append(a);a.click();a.remove();
     setTimeout(()=>URL.revokeObjectURL(url),60000);
     setStatus('双语 SRT 已生成，时间轴保留，原文在前、译文在后。');
   }catch(e){setStatus('字幕翻译失败：'+String(e instanceof Error?e.message:e));}
   finally{setBusy(false);}
 }
 return <section className="document-lab subtitle-file-lab" id="subtitle-file-lab">
   <h2>离线字幕文件翻译</h2>
   <p>不需要视频播放。导入自己拥有的 SRT/VTT/ASS 字幕，按原时间轴导出双语 SRT。不会上传视频或音频。</p>
   <label className="document-field">字幕文件（最多 2 MB）
     <input type="file" accept=".srt,.vtt,.ass,text/vtt" onChange={selected}/>
   </label>
   <div className="native-modes" role="group" aria-label="字幕文件翻译服务">
     <button type="button" aria-pressed={mode==='standard'} onClick={()=>setMode('standard')}>常规翻译</button>
     <button type="button" aria-pressed={mode==='ai'} onClick={()=>setMode('ai')}>自选 AI</button>
   </div>
   <button type="button" disabled={busy||!file} onClick={()=>void translate()}>
     {busy?'翻译中…':'翻译并导出双语 SRT'}
   </button>
   {progress&&<p role="status">{progress}</p>}
   <p aria-live="polite">{status}</p>
 </section>;
}
