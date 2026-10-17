import {useEffect,useRef,useState} from 'react';
import {browser} from '#imports';

type Mode='standard'|'ai';
type Progress={
  eligible:number;translated:number;remaining:number;coveragePercent:number|null;
  succeededBatches:number;failedBatches:number;busy:boolean;lastError:string;
};
const rootFile='pit-native.js';
const rootCss='pit-native.css';

export function NativeWebControls(){
 const [mode,setMode]=useState<Mode>('standard');
 const [feature,setFeature]=useState<'web'|'video'|'files'|'settings'>('web');
 const [display,setDisplay]=useState<'bilingual'|'translation-only'>('bilingual');
 const [scope,setScope]=useState<'smart'|'full'>('smart');
 const [captionFile,setCaptionFile]=useState<File|null>(null);
 const [captionBusy,setCaptionBusy]=useState(false);
 const [asrToken,setAsrToken]=useState('');
 const [status,setStatus]=useState('打开普通网页后点击翻译。');
 const [progress,setProgress]=useState<Progress|null>(null);
 const [working,setWorking]=useState(false);
 const [siteAccessNeeded,setSiteAccessNeeded]=useState(false);
 const [tabId,setTabId]=useState<number|null>(null);
 const timer=useRef<ReturnType<typeof setInterval>|null>(null);
 const latest=useRef(0);

 useEffect(()=>{
   let active=true;
   void browser.runtime.sendMessage({type:'GET_SETTINGS'}).then(answer=>{
     const settings=answer?.settings;
     if(!active||!settings)return;
     setDisplay(settings.webDisplay==='translation-only'?'translation-only':'bilingual');
     setScope(settings.webScope==='full'?'full':'smart');
     if(settings.standardProvider==='cloud'&&
       (!settings.cloudEndpoint||!settings.cloudToken)){
       setStatus('云端翻译未部署/配置。请先在「配置翻译服务」填写已部署的 PIT Worker 地址与访问令牌；当前没有可用的默认翻译引擎。');
     }
   }).catch(()=>{});
   return()=>{active=false;};
 },[]);
 useEffect(()=>{
   if(tabId===null)return;
   let alive=true;
   let count=0;
   const update=async()=>{
     try{
       const answer=await browser.tabs.sendMessage(tabId,{type:'PIT_GET_PROGRESS'});
       if(alive && answer?.ok && answer.progress)setProgress(answer.progress);
     }catch{
       if(alive)setStatus('无法读取当前标签页的翻译进度；可能已离开该网页。');
     }
     if(++count>=80 && timer.current){clearInterval(timer.current);timer.current=null;}
   };
   void update();
   timer.current=setInterval(()=>void update(),1500);
   return()=>{alive=false;if(timer.current)clearInterval(timer.current);timer.current=null;};
 },[tabId]);

 async function saveReaderOption(key:'webDisplay'|'webScope',value:string){
   try{
     const data=await browser.storage.local.get('pit_settings_v1');
     const old=(data.pit_settings_v1||{}) as Record<string,unknown>;
     await browser.storage.local.set({pit_settings_v1:{...old,[key]:value}});
     if(key==='webDisplay')setDisplay(value==='translation-only'?'translation-only':'bilingual');
     else setScope(value==='full'?'full':'smart');
     const [tab]=await browser.tabs.query({active:true,currentWindow:true});
     if(tab?.id&&key==='webDisplay'){
       await browser.tabs.sendMessage(tab.id,{type:'PIT_SET_DISPLAY',display:value})
         .catch(()=>{});
     }
     setStatus(key==='webDisplay'?'阅读模式已保存并应用于当前已翻译段落。':
       '翻译范围已保存，下次开启网页翻译时生效。');
   }catch(error){setStatus('阅读设置保存失败：'+String(error instanceof Error?error.message:error));}
 }
 async function run(action:'PIT_START'|'PIT_CONTINUE'|'PIT_SELECTION'|'PIT_RESTORE'){
   if(working)return;
   if(mode==='ai' && (action==='PIT_START'||action==='PIT_SELECTION')){
     if(!window.confirm('此操作会使用你配置的 AI 模型，可能消耗额度或产生费用。继续吗？'))return;
   }
   // A CLI/build pass must not be mistaken for available online MT.
   // Fail before injecting any site scripts if the default remote
   // provider is not configured on this browser.
   if(mode==='standard'&&(action==='PIT_START'||action==='PIT_SELECTION')){
     try{
       const response=await browser.runtime.sendMessage({type:'GET_SETTINGS'});
       const settings=response?.settings;
       if(settings?.standardProvider==='cloud'&&
          (!settings.cloudEndpoint||!settings.cloudToken)){
         setStatus('PIT 云端翻译目前未配置，无法运行。先在插件设置中部署/填写云端 Worker，或切换到你已有 Key 的其他机器翻译服务。');
         return;
       }
     }catch{}
   }
   const token=++latest.current;
   setWorking(true);setStatus('正在与网页通信…');setSiteAccessNeeded(false);
   try{
     const [tab]=await browser.tabs.query({active:true,currentWindow:true});
     if(!tab?.id || !/^https?:\/\//.test(tab.url||''))throw Error('请先打开可访问的普通网页');
     if(action==='PIT_START'||action==='PIT_SELECTION'||action==='PIT_RESTORE'||action==='PIT_CONTINUE'){
       // Installed HTTP(S) site access enables normal page injection without
       // repeated per-domain prompts; Chrome internal pages remain blocked.
       await browser.scripting.insertCSS({target:{tabId:tab.id},files:[rootCss]});
       // WXT's generated pathname union enumerates listed entrypoints only;
       // this static public asset is verified byte-for-byte by the output test.
       await browser.scripting.executeScript({target:{tabId:tab.id},files:[rootFile as never]});
     }
     const answer=await browser.tabs.sendMessage(tab.id,{type:action,mode,scope,display});
     if(!answer?.ok)throw Error(answer?.reason||'原生翻译核心未接受请求');
     if(token!==latest.current)return;
     setTabId(tab.id);
     setStatus('已发送操作，以下方实际覆盖率为准，不代表所有段落均完成。');
   }catch(error){
     if(token===latest.current){
       const detail=String(error instanceof Error?error.message:error);
       const missingPermission=/Cannot access|Missing host permission|permission|permissions|未授权|没有访问权限|无法访问此页面/i.test(detail);
       setSiteAccessNeeded(missingPermission);
       setStatus(missingPermission?'当前网站尚未授权，请点击「允许当前网站翻译」后重试。':'操作失败：'+detail);
     }
   }finally{if(token===latest.current)setWorking(false);}
 }
 async function authorizeCurrentSite(){
   // The permission prompt must be initiated by a real user click.
   // Never request access to every site without an explicit user decision.
   try{
     const [tab]=await browser.tabs.query({active:true,currentWindow:true});
     if(!tab?.url || !/^https?:\/\//.test(tab.url))throw Error('无法识别当前网站地址');
     const url=new URL(tab.url);
     const granted=await browser.permissions.request({origins:[url.origin+'/*']});
     if(!granted){
       setStatus('未授予此网站权限；你仍可在浏览器工具栏正常启动扩展重试。');
       return;
     }
     setSiteAccessNeeded(false);
     setStatus('已授权 '+url.hostname+'，现在点击「翻译当前网页」即可。');
   }catch(error){
     setStatus('授权失败：'+String(error instanceof Error?error.message:error));
   }
 }
 async function screenshotToFileLab(){
   if(working)return;
   setWorking(true);setStatus('正在截取当前可见网页…');
   try{
     const [tab]=await browser.tabs.query({active:true,currentWindow:true});
     if(!tab?.id || !tab.windowId || !/^https?:\/\//.test(tab.url||''))
       throw Error('只能截取当前普通网页，不能截取浏览器内部页');
     const png=await browser.tabs.captureVisibleTab(tab.windowId,{format:'png'});
     if(!png.startsWith('data:image/png;base64,')||png.length>6_000_000)
       throw Error('当前网页截图无效或超过 4.5 MB');
     await browser.storage.session.set({pit_ocr_screenshot:png});
     await browser.tabs.create({url:browser.runtime.getURL('/file-lab.html')});
     setStatus('截图已传送到文件实验台，可选择识别语言后处理。');
   }catch(e){setStatus('网页截图失败：'+String(e instanceof Error?e.message:e));}
   finally{setWorking(false);}
 }
 async function liveAsr(action:'start'|'stop',backend:'local'|'cloud'='cloud'){
   if(captionBusy)return;
   if(action==='start' && !window.confirm(
     (backend==='cloud'
       ?'本次会将当前标签页短音频片段上传至你配置的 PIT 云端 Whisper 服务，可能消耗云端 AI 额度。'
       :'本次音频只发送到本机 Whisper 服务。')+
     (mode==='ai'?'本次将使用已配置的 AI 翻译 API，可能计费，每次会话最多 80 次请求。':
       '将使用常规翻译服务，不自动启用付费 AI。')+
     '仅保留统计指标，不保存录音。确认启动？'))return;
   if(action==='start' && backend==='local' && asrToken.trim().length<16){
     setStatus('请填写本机 Whisper 服务令牌（至少 16 字符）');return;
   }
   setCaptionBusy(true);setStatus('正在连接本机语音识别服务…');
   try{
     const [tab]=await browser.tabs.query({active:true,currentWindow:true});
     if(action==='start'){
       if(!tab?.id||!/^https?:\/\//.test(tab.url||''))throw Error('请打开普通视频网页');
       await browser.scripting.insertCSS({target:{tabId:tab.id},files:[rootCss]});
       await browser.scripting.executeScript({target:{tabId:tab.id},
         files:['src/live-captions.js' as never]});
     }
     const res=await browser.runtime.sendMessage({
       type:action==='start'?'PIT_ASR_START':'PIT_ASR_STOP',
       tabId:action==='start'?tab?.id:undefined,
       token:action==='start'?asrToken.trim():undefined,
       mode:action==='start'?mode:undefined,
       userInitiated:action==='start'&&(mode==='ai'||backend==='cloud'),
       asrBackend:action==='start'?backend:undefined
     });
     if(!res?.ok)throw Error(res?.error||'本机 ASR 请求失败');
     setStatus(action==='start'?'本机 Whisper 音频字幕已启动；可随时停止。':'本机 Whisper 音频字幕已停止');
     setAsrToken('');
   }catch(error){setStatus('本机 ASR 错误：'+String(error instanceof Error?error.message:error));}
   finally{setCaptionBusy(false);}
 }
 async function captions(action:'start'|'stop'){
   if(captionBusy)return;
   if(action==='start' && mode==='ai' &&
      !window.confirm('连续视频字幕将调用自选 AI，可能产生 API 费用。确认启动？'))return;
   setCaptionBusy(true);
   setStatus('正在检测可访问的视频及字幕…');
   try{
     const [tab]=await browser.tabs.query({active:true,currentWindow:true});
     if(!tab?.id||!/^https?:\/\//.test(tab.url||''))throw Error('请打开视频所在的普通网页');
     const tabId=tab.id;
     const sessionKey='pit_caption_frame_'+tabId;
     const former=await browser.storage.session.get(sessionKey);
     const prior=typeof former[sessionKey]==='number' ? former[sessionKey] as number : -1;
     if(action==='stop'){
       await browser.tabs.sendMessage(tabId,{type:'PIT_CAPTIONS_STOP'},{frameId:0}).catch(()=>{});
       if(Number.isInteger(prior)&&prior>0)
         await browser.tabs.sendMessage(tabId,{type:'PIT_CAPTIONS_STOP'},{frameId:prior}).catch(()=>{});
       await browser.storage.session.remove(sessionKey);
       setStatus('字幕观察已停止');
       return;
     }
     if(Number.isInteger(prior)&&prior>0)
       await browser.tabs.sendMessage(tabId,{type:'PIT_CAPTIONS_STOP'},{frameId:prior}).catch(()=>{});
     await browser.storage.session.remove(sessionKey);
     const scripts=['pit-caption-core.js','pit-platform-captions.js','pit-subtitles.js'];
     const target={tabId,frameIds:[0]};
     await browser.scripting.insertCSS({target,files:[rootCss]});
     await browser.scripting.executeScript({target,files:scripts as never});
     // The upstream file parser is intentionally used, not an unrelated parser.
     let cues:unknown[]|undefined;
     if(captionFile){
       if(captionFile.size>2_000_000)throw Error('字幕文件超过 2 MiB');
       await browser.scripting.executeScript({target:{tabId},files:['pit-subtitle-import.js' as never]});
       const raw=await captionFile.text();
       const parsed=await browser.scripting.executeScript({target,func:(source:string)=>{
         const parser=(globalThis as unknown as {PITSubtitleImport?:{parseSubtitles:(s:string)=>unknown[]}}).PITSubtitleImport;
         return parser?.parseSubtitles(source)||[];
       },args:[raw]});
       cues=parsed[0]?.result as unknown[];
       if(!cues?.length)throw Error('SRT/VTT 文件没有可用的时间轴');
     }
     let response=await browser.tabs.sendMessage(tabId,
       {type:'PIT_CAPTIONS_START',mode,cues},{frameId:0});
     if(!response?.ok&&!cues?.length){
       // For user-visible iframe players, only choose an exact HTTPS
       // YouTube/Panopto iframe whose URL matches Chrome navigation frames.
       const visible=await browser.scripting.executeScript({target,func:()=>{
         return [...document.querySelectorAll('iframe')].filter(el=>{
           const rect=el.getBoundingClientRect();
           return rect.width>=240&&rect.height>=120 &&getComputedStyle(el).visibility!=='hidden';
         }).map(el=>el.src).filter(Boolean).slice(0,20);
       }});
       const known=(visible[0]?.result||[]) as string[];
       const frames=await browser.webNavigation.getAllFrames({tabId});
       const allowed=(url:string)=>{try{
         const u=new URL(url);u.hash='';
         return u.protocol==='https:' &&
           (/(^|\.)(youtube\.com|youtube-nocookie\.com|panopto\.com|panopto\.eu)$/i.test(u.hostname))?
           u.href:null;
       }catch{return null;}};
       const matches=(frames||[]).filter(f=>f.frameId>0 &&
         known.some(url=>allowed(url)!==null&&allowed(url)===allowed(f.url)));
       if(matches.length!==1)throw Error(response?.reason||'找不到唯一且可见的受支持视频播放器；请在原视频网站打开播放页');
       const frame=matches[0];
       const embedded={tabId,frameIds:[frame.frameId]};
       await browser.scripting.insertCSS({target:embedded,files:[rootCss]});
       await browser.scripting.executeScript({target:embedded,files:scripts as never});
       response=await browser.tabs.sendMessage(tabId,
         {type:'PIT_CAPTIONS_START',mode,expectedUrl:allowed(frame.url)},{frameId:frame.frameId});
       if(response?.ok)await browser.storage.session.set({[sessionKey]:frame.frameId});
     }
     if(!response?.ok)throw Error(response?.reason||'当前播放器没有可读取字幕轨或可见原文字幕');
     setStatus(response.reason||'视频字幕翻译已开启');
   }catch(error){setStatus('字幕翻译失败：'+String(error instanceof Error?error.message:error));}
   finally{setCaptionBusy(false);}
 }
 return <div className="native-web">
   <nav className="pit-feature-tabs" aria-label="功能模块">
     <button type="button" aria-current={feature==='web'?'page':undefined} onClick={()=>setFeature('web')}>网页翻译</button>
     <button type="button" aria-current={feature==='video'?'page':undefined} onClick={()=>setFeature('video')}>视频字幕</button>
     <button type="button" aria-current={feature==='files'?'page':undefined} onClick={()=>setFeature('files')}>文件与图片</button>
     <button type="button" aria-current={feature==='settings'?'page':undefined} onClick={()=>setFeature('settings')}>设置与诊断</button>
   </nav>
   {feature==='web'&&<section className="pit-feature-section" aria-label="网页阅读">
     <div className="native-modes" role="group" aria-label="翻译模式">
       <button type="button" aria-pressed={mode==='standard'} onClick={()=>setMode('standard')}>常规翻译</button>
       <button type="button" aria-pressed={mode==='ai'} onClick={()=>setMode('ai')}>自选 AI 精译</button>
     </div>
     <div className="pit-setting-row">
       <label>阅读模式
         <select aria-label="网页阅读显示模式" value={display} onChange={e=>void saveReaderOption('webDisplay',e.target.value)}>
           <option value="bilingual">双语对照</option><option value="translation-only">仅显示译文</option>
         </select>
       </label>
       <label>翻译范围
         <select aria-label="网页翻译范围" value={scope} onChange={e=>void saveReaderOption('webScope',e.target.value)}>
           <option value="smart">智能正文</option><option value="full">整页可读文本</option>
         </select>
       </label>
     </div>
     <div className="native-actions">
       <button type="button" disabled={working} onClick={()=>void run('PIT_START')}>翻译当前网页</button>
       <button type="button" disabled={working} onClick={()=>void run('PIT_RESTORE')}>恢复原文</button>
       <button type="button" disabled={working} onClick={()=>void run('PIT_CONTINUE')}>继续翻译</button>
       <button type="button" disabled={working} onClick={()=>void run('PIT_SELECTION')}>翻译选中内容</button>
     </div>
     {siteAccessNeeded&&<button type="button" className="grant-site" onClick={()=>void authorizeCurrentSite()}>允许当前网站翻译</button>}
     {progress&&<p role="status" className="native-progress">正文覆盖 {progress.translated}/{progress.eligible}
       （{progress.coveragePercent===null?'暂无':progress.coveragePercent+'%'}）；未处理 {progress.remaining}；
       成功批次 {progress.succeededBatches}，失败批次 {progress.failedBatches}
       {progress.busy?' · 处理中':''}{progress.lastError?' · '+progress.lastError:''}
     </p>}
     <p className="native-hint">Alt+A 翻译/恢复 · Alt+W 整页阅读 · Shift+悬停可选 · 输入框连按三次空格可选。</p>
   </section>}
   {feature==='video'&&<section className="pit-feature-section" aria-label="视频字幕">
     <div className="native-modes" role="group" aria-label="字幕翻译模式">
       <button type="button" aria-pressed={mode==='standard'} onClick={()=>setMode('standard')}>常规翻译</button>
       <button type="button" aria-pressed={mode==='ai'} onClick={()=>setMode('ai')}>AI 字幕精译</button>
     </div>
     <p className="native-hint">优先读取视频本身的字幕。无字幕时可选择云端 Whisper 识别；字幕源受网站播放器限制。</p>
     <div className="native-actions">
       <button type="button" disabled={captionBusy} onClick={()=>void captions('start')}>翻译视频字幕</button>
       <button type="button" disabled={captionBusy} onClick={()=>void captions('stop')}>停止字幕翻译</button>
     </div>
     <label className="pit-field">导入字幕 SRT / VTT（可选）
       <input type="file" accept=".srt,.vtt,text/vtt" onChange={event=>setCaptionFile(event.target.files?.[0]??null)}/>
     </label>
     <div className="native-actions">
       <button type="button" disabled={captionBusy} onClick={()=>void liveAsr('start','cloud')}>云端 Whisper 语音字幕</button>
       <button type="button" disabled={captionBusy} onClick={()=>void liveAsr('stop')}>停止实时语音字幕</button>
       <button type="button" disabled={captionBusy} onClick={()=>void liveAsr('start','local')}>使用本机 Whisper（可选）</button>
     </div>
     <label className="pit-field">本机 Whisper 服务令牌（仅使用本机模式时填写）
       <input type="password" autoComplete="off" placeholder="PIT_BRIDGE_TOKEN" value={asrToken}
         onChange={event=>setAsrToken(event.target.value)}/>
     </label>
   </section>}
   {feature==='files'&&<section className="pit-feature-section" aria-label="文件与图片">
     <p className="native-hint">统一文件工作台：PDF、Office、EPUB、TXT/UTF、Markdown、图片 OCR 及字幕；云端高保真 PDF 需要实际部署服务器。</p>
     <div className="native-actions">
       <button type="button" onClick={()=>void browser.tabs.create({url:browser.runtime.getURL('/file-lab.html')})}>打开文件翻译工作台</button>
       <button type="button" disabled={working} onClick={()=>void screenshotToFileLab()}>截图当前网页 → 图片 OCR</button>
       <button type="button" onClick={()=>void browser.tabs.create({url:browser.runtime.getURL('pit-tools.html' as never)})}>PDF 高保真服务说明</button>
     </div>
   </section>}
   {feature==='settings'&&<section className="pit-feature-section" aria-label="翻译设置与诊断">
     <p className="native-hint">阅读显示、悬停、输入框、自动站点、语言识别、机器翻译、AI 模型和云端配置统一由完整设置页面管理。</p>
     <div className="native-actions">
       <button type="button" onClick={()=>void browser.runtime.openOptionsPage()}>打开完整设置</button>
       <button type="button" onClick={()=>void browser.tabs.create({url:'chrome://extensions/shortcuts'})}>快捷键管理</button>
       <button type="button" onClick={()=>void browser.tabs.create({url:browser.runtime.getURL('/file-lab.html')})}>文档引擎诊断</button>
     </div>
     <p className="native-hint">当前为对标测试版，若未配置可用翻译引擎，不会伪装成成功翻译。</p>
   </section>}
   <p role="status" aria-live="polite" className="native-status">{status}</p>
 </div>;
}
