// V2 additions to the existing settings contract, never a second store.
export const VIDEO_DEFAULTS=Object.freeze({enabled:true,autoStartSupportedSites:false,playerQuickToggle:true,
 providerId:'inherit',source:'auto',target:'inherit',preferHumanCaptions:true,focusDialogueOnly:false,
 baseSentenceSegmentation:true,aiSentenceSegmentation:false,preferPitTranslationOverPlatformMT:true,
 subtitleFontSize:22,subtitlePosition:'bottom',subtitleRenderMode:'in-player',subtitleColor:'#ffffff',subtitleBackground:'#142130',
 translationFirst:false,siteOverrides:{},meetingMode:'off'});
export const PRODUCT_DEFAULTS=Object.freeze({schemaVersion:2,uiLanguage:'zh',providerPreferences:{},
 videoSettings:VIDEO_DEFAULTS,installedExperts:['faithful'],customExperts:[],activeExpertId:'faithful',
 translationOrder:'source-first',translatedFontFamily:'inherit',translatedFontSize:16,
 translationTextColor:'#245a72',translationBgColor:'#edf7fb',translationLineHeight:1.7,
 translationSpacing:8,sameLanguageHighlight:false,minSegmentCharacters:2,initialTranslateCharacters:5000,
 longParagraphLineBreak:false,translateToBottom:false,contextMenuEnabled:true,translateSidebar:false,
 translateTitle:false,skipSameLanguage:true,loadingAnimation:'text',lineBreakPolicy:'smart',
 temporaryAutoTranslateMinutes:0,temporaryAutoTranslateUntil:{},translationOnlyLanguages:[],siteRules:[],
 selectionTranslate:true,fileProviderId:'inherit'});
const languages=['zh','en','fr','ja','ko','de','es'];
const providers=['browser','mymemory','cloud','microsoft','google','deepl','libre'];
const bounded=(v,d,min,max)=>Number.isFinite(Number(v))?Math.min(max,Math.max(min,Number(v))):d;
const color=(v,d)=>/^#[a-f0-9]{6}$/i.test(v||'')?v:d;
const record=v=>v&&typeof v==='object'&&!Array.isArray(v)?v:{};
export function normalizeProduct(s){
 for(const [k,v] of Object.entries(PRODUCT_DEFAULTS))if(typeof v==='boolean')s[k]=s[k]===true;
 for(const [k,min,max] of [['minSegmentCharacters',1,100],['initialTranslateCharacters',500,20000],['translatedFontSize',10,48],['translationLineHeight',1,3],['translationSpacing',0,48],['temporaryAutoTranslateMinutes',0,1440]])
  s[k]=bounded(s[k],PRODUCT_DEFAULTS[k],min,max);
 s.minSegmentCharacters=Math.round(s.minSegmentCharacters);s.initialTranslateCharacters=Math.round(s.initialTranslateCharacters);
 s.uiLanguage=['zh','en'].includes(s.uiLanguage)?s.uiLanguage:'zh';
 s.translationOrder=s.translationOrder==='translation-first'?'translation-first':'source-first';
 s.loadingAnimation=s.loadingAnimation==='spinner'?'spinner':'text';
 s.lineBreakPolicy=['smart','always','preserve'].includes(s.lineBreakPolicy)?s.lineBreakPolicy:'smart';
 s.translatedFontFamily=['inherit','serif','sans-serif','monospace'].includes(s.translatedFontFamily)?s.translatedFontFamily:'inherit';
 for(const k of ['translationTextColor','translationBgColor'])s[k]=color(s[k],PRODUCT_DEFAULTS[k]);
 s.translationOnlyLanguages=Array.isArray(s.translationOnlyLanguages)?s.translationOnlyLanguages.filter(x=>languages.includes(x)):[];
 s.providerPreferences=Object.fromEntries(Object.entries(record(s.providerPreferences)).slice(0,40).map(([id,v])=>[id,{visible:v?.visible!==false,enabled:v?.enabled!==false}]));
 s.fileProviderId=providers.includes(s.fileProviderId)?s.fileProviderId:'inherit';
 const v={...VIDEO_DEFAULTS,...record(s.videoSettings)};
 for(const [k,d] of Object.entries(VIDEO_DEFAULTS))if(typeof d==='boolean')v[k]=typeof v[k]==='boolean'?v[k]:d;
 // No paid segmentation adapter yet: visible disabled control, never a fake switch.
 v.aiSentenceSegmentation=false;v.meetingMode='off';
 v.providerId=providers.includes(v.providerId)?v.providerId:'inherit';
 v.source=languages.includes(v.source)?v.source:'auto';v.target=languages.includes(v.target)?v.target:'inherit';
 v.subtitleFontSize=bounded(v.subtitleFontSize,22,12,48);v.subtitlePosition=v.subtitlePosition==='top'?'top':'bottom';
 v.subtitleRenderMode=v.subtitleRenderMode==='replace-track'?'replace-track':'in-player';
 v.subtitleColor=color(v.subtitleColor,'#ffffff');v.subtitleBackground=color(v.subtitleBackground,'#142130');
 v.siteOverrides=Object.fromEntries(Object.entries(record(v.siteOverrides)).filter(([k])=>['youtube','bilibili','netflix','panopto','generic'].includes(k)).map(([k,x])=>[k,{enabled:x?.enabled!==false,autoStart:x?.autoStart===true,providerId:providers.includes(x?.providerId)?x.providerId:'inherit'}]));
 s.videoSettings=v;
 s.installedExperts=Array.isArray(s.installedExperts)?s.installedExperts.filter(x=>typeof x==='string').slice(0,40):['faithful'];
 s.customExperts=Array.isArray(s.customExperts)?s.customExperts.filter(x=>x&&/^custom-/.test(x.id)&&typeof x.name==='string'&&typeof x.prompt==='string'&&x.prompt.trim()).slice(0,20).map(x=>({id:x.id.slice(0,80),name:x.name.slice(0,80),prompt:x.prompt.slice(0,2000),version:1})):[];
 s.activeExpertId=typeof s.activeExpertId==='string'?s.activeExpertId:'faithful';
 s.temporaryAutoTranslateUntil=Object.fromEntries(Object.entries(record(s.temporaryAutoTranslateUntil)).filter(([k,v])=>/^[a-z0-9.-]+$/.test(k)&&Number.isFinite(v)).slice(0,100));
 s.siteRules=Array.isArray(s.siteRules)?s.siteRules.filter(x=>x&&/^[a-z0-9.-]+$/.test(x.host)).slice(0,100).map(x=>({host:x.host,providerId:providers.includes(x.providerId)?x.providerId:'inherit',target:languages.includes(x.target)?x.target:'inherit',theme:['subtle','underline','highlight','none'].includes(x.theme)?x.theme:'inherit'})):[];
 s.schemaVersion=2;return s;
}
export function siteRule(settings,host){return [...settings.siteRules].sort((a,b)=>b.host.length-a.host.length).find(x=>host===x.host||host.endsWith('.'+x.host));}
export function videoPlatform(host){return /(^|\.)(youtube.com|youtube-nocookie.com)$/.test(host)?'youtube':/(^|\.)bilibili.com$/.test(host)?'bilibili':/(^|\.)netflix.com$/.test(host)?'netflix':/(^|\.)panopto\./.test(host)?'panopto':'generic';}
export function effectiveVideo(settings,host){const v=settings.videoSettings;const o=v.siteOverrides[videoPlatform(host)];return {...v,enabled:v.enabled&&o?.enabled!==false,autoStart:o?.autoStart??v.autoStartSupportedSites,providerId:o?.providerId&&o.providerId!=='inherit'?o.providerId:v.providerId};}
export const EXPERTS=Object.freeze([
 {id:'faithful',name:'忠实通用',prompt:'Translate faithfully in a natural register. Do not add explanations.',version:1},
 {id:'academic',name:'学术术语',prompt:'Use precise academic terminology and preserve hedging, citations and technical distinctions.',version:1},
 {id:'learning',name:'语言学习',prompt:'Use clear idiomatic language suitable for language learners while preserving all meaning.',version:1},
 {id:'captions',name:'字幕口语',prompt:'Use concise conversational language suitable for subtitles. Preserve speaker intent.',version:1},
 {id:'news',name:'新闻速读',prompt:'Use direct factual journalistic language. Preserve attribution and uncertainty.',version:1},
 {id:'literary',name:'文学风格',prompt:'Preserve imagery, rhythm and narrative voice without inventing details.',version:1},
 {id:'code',name:'代码文档',prompt:'Translate explanatory prose precisely. Preserve code, identifiers and command syntax unchanged.',version:1}
]);
export function expertPrompt(s){return s.installedExperts?.includes(s.activeExpertId)?[...EXPERTS,...(s.customExperts||[])].find(x=>x.id===s.activeExpertId)?.prompt||'':'';}
export function readingStyle(s){return {fontFamily:s.translatedFontFamily,fontSize:s.translatedFontSize+'px',color:s.translationTextColor,backgroundColor:s.translationBgColor,lineHeight:String(s.translationLineHeight),marginBlock:s.translationSpacing+'px',whiteSpace:s.lineBreakPolicy==='preserve'?'pre-wrap':'normal'};}
