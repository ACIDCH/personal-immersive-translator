import {useEffect,useRef,useState} from 'react';
import {browser} from '#imports';
import {QuickPreferences} from './QuickPreferences';

type Mode='standard'|'ai';
type Progress={
  eligible:number;translated:number;remaining:number;coveragePercent:number|null;
  skippedOversized?:number;
  succeededBatches:number;failedBatches:number;busy:boolean;lastError:string;
};
const rootFile='pit-native.js';
const rootCss='pit-native.css';

export function NativeWebControls(){
 const [mode,setMode]=useState<Mode>('standard');
 const [feature,setFeature]=useState<'web'|'video'|'files'|'settings'>('web');
 const [display,setDisplay]=useState<'bilingual'|'translation-only'>('bilingual');
 const [scope,setScope]=useState<'smart'|'full'>('full');
 const [captionFile,setCaptionFile]=useState<File|null>(null);
 const [captionSource,setCaptionSource]=useState('auto');
 const [renderMode,setRenderMode]=useState<'replace-track'|'in-player'>('replace-track');
 const [captionBusy,setCaptionBusy]=useState(false);
 const [captionInspection,setCaptionInspection]=useState('');
 const [asrToken,setAsrToken]=useState('');
 const [status,setStatus]=useState('打开普通网页后点击翻译。');
 const [progress,setProgress]=useState<Progress|null>(null);
 const [working,setWorking]=useState(false);
 const [siteAccessNeeded,setSiteAccessNeeded]=useState(false);
 const [siteRules,setSiteRules]=useState<{hostname:string;automatic:boolean;blocked:boolean}|null>(null);
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
     setRenderMode(settings.videoSettings?.subtitleRenderMode==='in-player'?
       'in-player':'replace-track');
     void browser.tabs.query({active:true,currentWindow:true}).then(([tab])=>{
       if(!active||!tab?.url||!/^https?:\/\//.test(tab.url))return;
       const hostname=new URL(tab.url).hostname.toLowerCase();
       const rules=(value:unknown)=>String(value||'').toLowerCase()
         .split(/[\s,;]+/).filter(Boolean);
       setSiteRules({hostname,
         automatic:rules(settings.autoTranslateHosts).includes(hostname),
         blocked:rules(settings.blockedHosts).includes(hostname)});
     }).catch(()=>{});
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
     const saved=await browser.runtime.sendMessage({type:'PATCH_SETTINGS',patch:{[key]:value}});
     if(!saved.ok)throw Error(saved.error);
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
 async function refreshSiteRules(){
   try{
     const [tab]=await browser.tabs.query({active:true,currentWindow:true});
     if(!tab?.url||!/^https?:\/\//.test(tab.url)){
       setSiteRules(null);return;
     }
     const hostname=new URL(tab.url).hostname.toLowerCase();
     const setting=((await browser.storage.local.get('pit_settings_v1')).pit_settings_v1||{}) as Record<string,unknown>;
     const has=(value:unknown)=>String(value||'').toLowerCase()
       .split(/[\s,;]+/).filter(Boolean).includes(hostname);
     setSiteRules({hostname,automatic:has(setting.autoTranslateHosts),
       blocked:has(setting.blockedHosts)});
   }catch{setSiteRules(null);}
 }
 async function toggleSiteRule(key:'autoTranslateHosts'|'blockedHosts'){
   if(!siteRules)return;
   try{
     const old=((await browser.storage.local.get('pit_settings_v1')).pit_settings_v1||{}) as Record<string,unknown>;
     const hostname=siteRules.hostname;
     const list=(value:unknown)=>String(value||'').toLowerCase()
       .split(/[\s,;]+/).filter(Boolean);
     const auto=new Set(list(old.autoTranslateHosts));
     const blocked=new Set(list(old.blockedHosts));
     const group=key==='autoTranslateHosts'?auto:blocked;
     if(group.has(hostname))group.delete(hostname);
     else{
       group.add(hostname);
       if(key==='autoTranslateHosts')blocked.delete(hostname);
       else auto.delete(hostname);
     }
     const saved=await browser.runtime.sendMessage({type:'PATCH_SETTINGS',patch:{autoTranslateHosts:[...auto].join('\n'),blockedHosts:[...blocked].join('\n')}});
     if(!saved.ok)throw Error(saved.error);
     setSiteRules({hostname,automatic:auto.has(hostname),blocked:blocked.has(hostname)});
     if(blocked.has(hostname)){
       const [tab]=await browser.tabs.query({active:true,currentWindow:true});
       if(tab?.id)await browser.tabs.sendMessage(tab.id,{type:'PIT_RESTORE'}).catch(()=>{});
     }
     setStatus('已更新 '+hostname+' 的站点规则。自动翻译从重新加载该页面起生效。');
   }catch(error){setStatus('站点规则保存失败：'+String(error instanceof Error?error.message:error));}
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
       if(settings?.standardProvider==='browser'&&settings.source!==settings.target){
         // Missing Chrome language packs explain the no-translation first run.
         // A popup click is already an explicit translation request, but
         // sending page text to MyMemory still needs a SECOND explicit consent.
         const from=settings.source==='auto'?(settings.target==='en'?'fr':'en'):settings.source;
         let timer:ReturnType<typeof setTimeout>|undefined;
         let probe:any;
         try{
           probe=await Promise.race([
             browser.runtime.sendMessage({type:'PIT_BROWSER_STATUS',
               source:from,target:settings.target}),
             new Promise<never>((_,reject)=>{timer=setTimeout(
               ()=>reject(Error('Chrome 模型检测超时')),9000);})
           ]);
         }catch(error){probe={status:'unavailable',reason:String(error)};}
         finally{clearTimeout(timer);}
         if(probe?.status!=='available'){
           const approved=window.confirm(
             'Chrome 当前离线翻译模型未就绪（'+from+' → '+settings.target+'）。'+
             '是否明确改用 MyMemory 免费在线翻译并继续本次操作？'+
             '\n注意：网页原文会发往 MyMemory 第三方服务器，每日额度有限，'+
             '并非私密文档或敏感网页的适用服务；不会启用付费 AI。'
           );
           if(!approved){
             setStatus('未切换翻译服务，本次没有发送网页原文。请下载 Chrome 模型或手动选择翻译服务。');
             return;
           }
           const patched=await browser.runtime.sendMessage({type:'PATCH_SETTINGS',
             patch:{standardProvider:'mymemory'}});
           if(!patched?.ok){
             setStatus('切换 MyMemory 失败：'+String(patched?.error||'设置未保存'));
             return;
           }
           setStatus('已明确授权改用 MyMemory，正在继续常规翻译。');
         }
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
   const backendName=backend==='cloud'?'云端':'本机';
   setCaptionBusy(true);setStatus('正在连接'+backendName+' Whisper 语音识别服务…');
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
     if(!res?.ok)throw Error(res?.error||backendName+' ASR 请求失败');
     setStatus(action==='start'?backendName+' Whisper 音频字幕已启动；可随时停止。':'实时 Whisper 音频字幕已停止');
     setAsrToken('');
   }catch(error){setStatus(backendName+' ASR 错误：'+String(error instanceof Error?error.message:error));}
   finally{setCaptionBusy(false);}
 }
 async function saveCaptionRenderMode(next:'replace-track'|'in-player'){
   if(captionBusy||working)return;
   setCaptionBusy(true);
   try{
     const response=await browser.runtime.sendMessage({type:'GET_SETTINGS'});
     if(!response?.settings)throw Error('无法读取视频设置');
     const saved=await browser.runtime.sendMessage({
       type:'PATCH_SETTINGS',
       patch:{videoSettings:{...response.settings.videoSettings,subtitleRenderMode:next}}
     });
     if(!saved?.ok)throw Error(saved?.error||'保存字幕模式失败');
     setRenderMode(next);
     setCaptionInspection(next==='replace-track'
       ?'已启用严格原位模式。仅修改播放器现有字幕；无法安全原位替换时不显示外置字幕。'
       :'已启用兼容字幕模式。适用于导入 SRT/VTT/ASS，可能在视频上叠加字幕，不属于原位替换。');
   }catch(error){
     setCaptionInspection('切换字幕模式失败：'+String(
       error instanceof Error?error.message:error));
   }finally{setCaptionBusy(false);}
 }
 async function inspectCaptionState(){
   setCaptionInspection('正在读取播放器字幕状态…');
   try{
     const [tab]=await browser.tabs.query({active:true,currentWindow:true});
     if(!tab?.id||!/^https?:\/\//.test(tab.url||''))throw Error('当前不是可访问的视频网页');
     const key='pit_caption_frame_'+tab.id;
     const saved=await browser.storage.session.get(key);
     const frameId=typeof saved[key]==='number'&&saved[key]>0?saved[key]:0;
     const reply=await browser.tabs.sendMessage(tab.id,{
       type:'PIT_CAPTIONS_DIAGNOSTICS'
     },{frameId});
     if(!reply?.ok)throw Error('字幕脚本未就绪，请先开启视频字幕翻译');
     const state=reply.status==='error'?'翻译失败':
       reply.status==='waiting-for-CC'?'等待播放器字幕':
       reply.status==='pending'?'已读取原文，等待实际原位译文':
       reply.status==='translated'?'已在播放器原位显示译文':
       reply.status==='unsupported'?'播放器不支持安全原位替换':
       '字幕功能未运行';
     const count=Math.max(0,Number(reply.translationCount)||0);
     const config=await browser.runtime.sendMessage({type:'GET_SETTINGS'}).catch(()=>null);
     const standardProvider=String(config?.settings?.standardProvider||'未读取');
     const effectiveProvider=reply.provider&&reply.provider!=='inherit'
       ?String(reply.provider):standardProvider;
     setCaptionInspection([
       state,'译文缓存 '+count+' 条',
       '当前可见字幕窗口 '+(Number(reply.siteCaptionGroups)||0),
       '字幕轨已加载事件 '+(Number(reply.nativeLoadedCues)||0),
       '播放器：'+String(reply.playback||'unknown'),
       reply.status==='waiting-for-CC'?
         (reply.captionControlFound?'请先开启播放器 CC 并播放到有字幕的位置':
           '未检测到可见 CC；确认视频提供字幕且已播放'):'',
       '常规翻译引擎：'+effectiveProvider,
       '识别来源：'+String(reply.source||'unknown'),
       '字幕语言：'+String(reply.language||'unknown'),
       '目标：'+(reply.renderMode==='replace-track'?'优先播放器内原位替换':'用户设置的兼容显示'),
       '实际：'+({['native-track']:'原生字幕轨直接替换',['platform-dom']:'播放器网页字幕原位替换',
         overlay:'兼容叠加层（非原位替换）',
         unsupported:'原位替换被播放器限制，未显示外置字幕',none:'尚未显示任何译文'} as Record<string,string>)[reply.renderRoute||'none'],
       reply.status==='pending'?'字幕捕获成功不等于翻译及原位显示成功':'',
       reply.lastError?'最近错误：'+String(reply.lastError).slice(0,180):''
     ].filter(Boolean).join(' · '));
   }catch(error){
     setCaptionInspection('字幕诊断不可用：'+
       String(error instanceof Error?error.message:error).slice(0,180));
   }
 }
 async function captions(action:'start'|'stop'){
   if(captionBusy)return;
   if(action==='start' && mode==='ai' &&
      !window.confirm('连续视频字幕将调用自选 AI，可能产生 API 费用。确认启动？'))return;
   setCaptionBusy(true);setCaptionInspection('');
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
       if(!cues?.length)throw Error('SRT/VTT/ASS 文件没有可用的时间轴');
     }
     let response=await browser.tabs.sendMessage(tabId,
       {type:'PIT_CAPTIONS_START',mode,cues,captionSourceLanguage:captionSource},{frameId:0});
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
       // YouTube may append autoplay/cc_load_policy/player tracking params
       // after its iframe is created; exact href equality misses the very
       // same user-visible player. Match only the verified recording identity,
       // never arbitrary cross-origin frames or another video ID.
       const recordingIdentity=(raw:string)=>{
         const safe=allowed(raw);if(!safe)return null;
         const u=new URL(safe),host=u.hostname.replace(/^www\./,'');
         if(host.includes('youtube')){
           const id=u.pathname.startsWith('/embed/')
             ?u.pathname.split('/')[2]:u.pathname==='/watch'?u.searchParams.get('v'):'';
           return id?host.replace('youtube-nocookie.com','youtube.com')+'/video/'+id:null;
         }
         if(host.includes('panopto')){
           const id=u.searchParams.get('id')||u.searchParams.get('deliveryId');
           return id?host+u.pathname.toLowerCase()+'?id='+id:null;
         }
         return null;
       };
       const matches=(frames||[]).filter(f=>f.frameId>0 &&
         known.some(url=>recordingIdentity(url)!==null &&
           recordingIdentity(url)===recordingIdentity(f.url)));
       if(matches.length!==1)throw Error(response?.reason||'找不到唯一且可见的受支持视频播放器；请在原视频网站打开播放页');
       const frame=matches[0];
       const embedded={tabId,frameIds:[frame.frameId]};
       await browser.scripting.insertCSS({target:embedded,files:[rootCss]});
       await browser.scripting.executeScript({target:embedded,files:scripts as never});
       response=await browser.tabs.sendMessage(tabId,
         {type:'PIT_CAPTIONS_START',mode,expectedUrl:allowed(frame.url),captionSourceLanguage:captionSource},{frameId:frame.frameId});
       if(response?.ok)await browser.storage.session.set({[sessionKey]:frame.frameId});
     }
     if(!response?.ok)throw Error(response?.reason||'当前播放器没有可读取字幕轨或可见原文字幕');
     setStatus(response.reason||'视频字幕翻译已开启');
   }catch(error){setStatus('字幕翻译失败：'+String(error instanceof Error?error.message:error));}
   finally{setCaptionBusy(false);}
 }
 return <div className="native-web">
   <QuickPreferences mode={mode} onSelection={()=>void run('PIT_SELECTION')}/>
   <nav className="pit-feature-tabs" aria-label="功能模块">
     <button type="button" aria-current={feature==='web'?'page':undefined} onClick={()=>setFeature('web')}>网页翻译</button>
     <button type="button" aria-current={feature==='video'?'page':undefined} onClick={()=>setFeature('video')}>视频字幕</button>
     <button type="button" aria-current={feature==='files'?'page':undefined} onClick={()=>setFeature('files')}>文件与图片</button>
     <button type="button" aria-current={feature==='settings'?'page':undefined} onClick={()=>{setFeature('settings');void refreshSiteRules();}}>设置与诊断</button>
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
       {progress.skippedOversized?' · 超过单段 12 万字符的内容 '+progress.skippedOversized+' 处未翻译（请分段处理或使用文件翻译）':''}
       {progress.busy?' · 处理中':''}{progress.lastError?' · '+progress.lastError:''}
     </p>}
     <p className="native-hint">Alt+A 翻译/恢复 · Alt+W 整页阅读 · Shift+悬停可选 · 输入框连按三次空格可选。</p>
   </section>}
   {feature==='video'&&<section className="pit-feature-section" aria-label="视频字幕">
     <div className="native-modes" role="group" aria-label="字幕翻译模式">
       <button type="button" aria-pressed={mode==='standard'} onClick={()=>setMode('standard')}>常规翻译</button>
       <button type="button" aria-pressed={mode==='ai'} onClick={()=>setMode('ai')}>AI 字幕精译</button>
     </div>
     <p className="native-hint">优先读取视频原生字幕；短字幕无法识别源语言时可手动选择。无字幕时需主动允许 Whisper。</p>
     <label className="pit-field pit-caption-render-choice">字幕显示方式
       <select aria-label="字幕显示方式" value={renderMode}
         disabled={captionBusy}
         onChange={e=>void saveCaptionRenderMode(
           e.target.value==='in-player'?'in-player':'replace-track')}>
         <option value="replace-track">严格原位替换（默认，无外置字幕）</option>
         <option value="in-player">兼容显示（可导入字幕，允许叠加）</option>
       </select>
     </label>
     <p className="pit-render-explanation">
       {renderMode==='replace-track'
         ?'直接替换播放器现有 CC 或字幕轨；如果播放器不开放字幕节点，会报告限制，不会假装翻译成功。'
         :'用于没有原生可修改字幕轨的 SRT/VTT/ASS 文件；可能在播放器上覆盖显示，不能视为原生字幕替换。'}
     </p>
     <label className="pit-field">原始字幕语言
       <select aria-label="原始字幕语言" value={captionSource} onChange={e=>setCaptionSource(e.target.value)}>
         <option value="auto">自动检测（默认）</option>
         <option value="en">英语</option><option value="fr">法语</option>
         <option value="de">德语</option><option value="es">西班牙语</option>
         <option value="zh">中文</option><option value="ja">日语</option>
         <option value="ko">韩语</option>
       </select>
     </label>
     <div className="native-actions">
       <button type="button" disabled={captionBusy} onClick={()=>void captions('start')}>翻译视频字幕</button>
       <button type="button" disabled={captionBusy} onClick={()=>void captions('stop')}>停止字幕翻译</button>
       <button type="button" disabled={captionBusy} onClick={()=>void inspectCaptionState()}>检查字幕状态</button>
     </div>
     {captionInspection&&<p className="native-hint" role="status">{captionInspection}</p>}
     {captionFile&&renderMode==='replace-track'&&
       <p className="pit-inline-warning" role="status">
         已选择字幕文件。手动导入不会创建播放器原生轨道；
         请先选择上方“兼容显示”，否则启动时会明确拒绝，避免显示不完整的译文。
       </p>}
     <label className="pit-field">导入字幕 SRT / VTT / ASS（可选）
       <input type="file" accept=".srt,.vtt,.ass,text/vtt" onChange={event=>setCaptionFile(event.target.files?.[0]??null)}/>
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
       <button type="button" onClick={()=>void browser.tabs.create({url:browser.runtime.getURL('/file-lab.html')+'#pdf-bilingual-lab'})}>打开内置 PDF / BabelDOC 工作台</button>
     </div>
   </section>}
   {feature==='settings'&&<section className="pit-feature-section" aria-label="翻译设置与诊断">
     <p className="native-hint">阅读显示、悬停、输入框、自动站点、语言识别、机器翻译、AI 模型和云端配置统一由完整设置页面管理。</p>
     {siteRules&&<div className="pit-site-rule">
       <strong>当前网站：{siteRules.hostname}</strong>
       <div className="native-actions">
         <button type="button" onClick={()=>void toggleSiteRule('autoTranslateHosts')}>
           {siteRules.automatic?'取消本站自动翻译':'自动翻译此网站'}
         </button>
         <button type="button" onClick={()=>void toggleSiteRule('blockedHosts')}>
           {siteRules.blocked?'解除本站禁用':'禁用此网站翻译'}
         </button>
       </div>
     </div>}
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
