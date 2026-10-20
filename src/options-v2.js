import {DEFAULT_SETTINGS,LANGUAGES} from './lib/settings.js';
import {VIDEO_DEFAULTS,EXPERTS,readingStyle} from './lib/product-settings.js';
import {providerCatalog} from './lib/provider-catalog.js';

const el=(tag,text,props={})=>Object.assign(document.createElement(tag),{textContent:text,...props});
export function mountProductSettings({form,get,save,view}){
 const status=document.getElementById('status');
 const report=e=>status.textContent=String(e?.message||e);
 const patch=async data=>{const r=await chrome.runtime.sendMessage({type:'PATCH_SETTINGS',patch:data});if(!r?.ok)throw Error(r?.error||'保存失败');view(r.settings);status.textContent='已保存 · '+new Date().toLocaleTimeString();return r.settings;};
 const section=(id,title,description)=>{const node=el('section','',{id,className:'panel product-panel'});node.append(el('h2',title),el('p',description,{className:'muted'}));form.insertBefore(node,document.getElementById('saveActions'));return node;};
 const row=(parent,title,description,control)=>{const label=el('label','',{className:'setting-row'});const words=el('span','');words.append(el('strong',title),el('small',description));label.append(words,control);parent.append(label);return control;};
 function control(parent,key,title,description,options,scope){
  const value=scope?get()[scope][key]:get()[key];let input;
  if(Array.isArray(options)){input=el('select','');for(const item of options){const [v,t]=Array.isArray(item)?item:[item,item];input.append(el('option',t,{value:v}));}input.value=String(value);}
  else{input=el('input','',{type:typeof value==='boolean'?'checkbox':typeof value==='number'?'number':key.toLowerCase().includes('color')?'color':'text'});if(input.type==='checkbox')input.checked=value;else input.value=String(value);if(options)Object.assign(input,options);}
  input.dataset.key=key;input.setAttribute('aria-label',title);
  row(parent,title,description,input);
  input.addEventListener('change',async()=>{try{if(!input.checkValidity())return input.reportValidity();let v=input.type==='checkbox'?input.checked:input.type==='number'?Number(input.value):input.value;const s=await patch(scope?{[scope]:{...get()[scope],[key]:v}}:{[key]:v});if(input.type==='checkbox')input.checked=scope?s[scope][key]:s[key];else input.value=String(scope?s[scope][key]:s[key]);preview();}catch(e){report(e);}});
  return input;
 }
 const button=(parent,text,fn)=>{const b=el('button',text,{type:'button'});b.addEventListener('click',()=>Promise.resolve(fn()).catch(report));parent.append(b);return b;};
 const basic=document.getElementById('baseSettings');
 control(basic,'uiLanguage','界面语言 / Interface language','与翻译目标语言独立；扩展控制标签使用所选语言。',[['zh','中文'],['en','English']]);
 const services=section('services','翻译服务中心','每项测试都请求对应适配器，不修改默认，不使用翻译缓存。免 Key 服务仍受环境与额度限制。');
 const search=el('input','',{type:'search',placeholder:'搜索服务 / Search services'});services.append(search);
 const compare=el('div','',{className:'buttons'});services.append(compare);const selected=new Set();
 button(compare,'比较勾选的免 Key 服务',async()=>{for(const card of services.querySelectorAll('[data-provider]'))if(selected.has(card.dataset.provider))await card.runProbe();});
 const cards=el('div','',{className:'provider-grid'});services.append(cards);
 function renderProviders(){cards.replaceChildren();for(const p of providerCatalog(get())){
  const id=p.profileId||p.id;const card=el('article','',{className:'provider-card'});card.dataset.provider=id;
  card.append(el('span',p.category,{className:'badge'}),el('h3',p.name),el('p',p.notice));
  const pref=get().providerPreferences[id]||{visible:true,enabled:true};
  for(const [key,title] of [['visible','显示在快捷选择器'],['enabled','启用服务']]){
   const c=el('input','',{type:'checkbox',checked:pref[key]!==false});row(card,title,key==='visible'?'隐藏不影响已选服务。':'停用后新请求将被阻止。',c);
   c.onchange=()=>patch({providerPreferences:{...get().providerPreferences,[id]:{...pref,[key]:c.checked}}}).then(renderProviders).catch(report);
  }
  const active=p.ai?(p.profileId?get().activeAIProfileId===id&&get().aiProvider==='custom':get().aiProvider===id):get().standardProvider===id;
  const def=button(card,active?'当前默认':'设为默认',async()=>{await patch(p.ai?{aiProvider:p.id,...(p.profileId?{activeAIProfileId:id}:{})}:{standardProvider:p.id});renderProviders();});def.disabled=pref.enabled===false||active;
  const output=el('p','从未测试',{className:'probe-result',role:'status'});card.append(output);
  chrome.storage.local.get('pit_probe_'+id).then(r=>{if(r['pit_probe_'+id])show(r['pit_probe_'+id]);});
  function show(r){output.textContent=[r.status,r.translationPreview,r.error,r.elapsedMs!==undefined?r.elapsedMs+' ms':'',r.testedAt].filter(Boolean).join(' · ');output.dataset.ok=String(r.ok===true);}
  card.runProbe=async()=>{if(p.cost&&!confirm('测试 '+p.name+' 可能产生 API 费用。确认单次调用？'))return;test.disabled=true;output.textContent='正在请求 '+p.name+'…';try{const s=await save();const endpoint=p.profileId?s.aiProfiles.find(x=>x.id===id)?.baseUrl:p.id==='cloud'?s.cloudEndpoint:p.id==='libre'?s.libreUrl:'';if(endpoint&&!await chrome.permissions.request({origins:[new URL(endpoint).origin+'/*']}))throw Error('未授予服务网络权限');const r=await chrome.runtime.sendMessage({type:'TEST_PROVIDER',providerId:p.id,profileId:p.profileId,mode:p.ai?'ai':'standard',target:s.target==='en'?'zh':s.target,userInitiated:true,costConfirmed:p.cost});show(r);}catch(e){output.textContent=e.message;}finally{test.disabled=false;}};
  const test=button(card,'测试此服务',()=>card.runProbe());test.setAttribute('aria-label','测试此服务 '+p.name);
  if(!p.cost){const c=el('input','',{type:'checkbox',checked:selected.has(id)});row(card,'加入免费对比','仅此处勾选才批量请求。',c);c.onchange=()=>c.checked?selected.add(id):selected.delete(id);}
  cards.append(card);
 }}
 search.oninput=()=>{for(const c of cards.children)c.hidden=!c.textContent.toLowerCase().includes(search.value.toLowerCase());};renderProviders();
 const expert=section('experts','AI 专家','原创提示词策略，独立于模型与 Key。仅显式启动 AI 时使用；常规 MT 不适用。');
 const expertCards=el('div','',{className:'provider-grid'});expert.append(expertCards);
 function renderExperts(){expertCards.replaceChildren();for(const x of [...EXPERTS,...get().customExperts]){const c=el('article','',{className:'provider-card'});c.append(el('h3',x.name+' · v'+x.version),el('p',x.prompt));const installed=get().installedExperts.includes(x.id);
 button(c,installed?'卸载':'安装',async()=>{await patch({installedExperts:installed?get().installedExperts.filter(id=>id!==x.id):[...get().installedExperts,x.id],...(installed&&get().activeExpertId===x.id?{activeExpertId:''}:{})});renderExperts();});
 const choose=button(c,get().activeExpertId===x.id?'已选用':'选用',async()=>{await patch({activeExpertId:x.id});renderExperts();});choose.disabled=!installed;
 button(c,'克隆 / 编辑',async()=>{const name=prompt('专家名称',x.name);if(!name?.trim())return;const text=prompt('翻译策略（不能改变 JSON 输出协议）',x.prompt);if(!text?.trim())return;const id=x.id.startsWith('custom-')?x.id:'custom-'+crypto.randomUUID();await patch({customExperts:[...get().customExperts.filter(p=>p.id!==id),{id,name,prompt:text,version:1}]});renderExperts();});
 if(x.id.startsWith('custom-'))button(c,'删除',async()=>{await patch({customExperts:get().customExperts.filter(p=>p.id!==x.id),installedExperts:get().installedExperts.filter(id=>id!==x.id)});renderExperts();});expertCards.append(c);}}
 button(expert,'添加自定义专家',async()=>{const name=prompt('专家名称');if(!name?.trim())return;const text=prompt('翻译策略');if(!text?.trim())return;await patch({customExperts:[...get().customExperts,{id:'custom-'+crypto.randomUUID(),name,prompt:text,version:1}]});renderExperts();});
 const expertImport=el('input','',{type:'file',accept:'.json'});row(expert,'导入专家','JSON 数组：每项包含 name、prompt；最多 20 项，提示词最多 2,000 字符。',expertImport);
 expertImport.onchange=async()=>{try{const file=expertImport.files?.[0];if(!file)return;if(file.size>100000)throw Error('专家文件过大');const data=JSON.parse(await file.text());if(!Array.isArray(data)||!data.length||data.length+get().customExperts.length>20||data.some(x=>!x||typeof x.name!=='string'||!x.name.trim()||x.name.length>80||typeof x.prompt!=='string'||!x.prompt.trim()||x.prompt.length>2000))throw Error('专家内容无效：需要非空名称与提示词，且总数不能超过 20');await patch({customExperts:[...get().customExperts,...data.map(x=>({id:'custom-'+crypto.randomUUID(),name:x.name.trim(),prompt:x.prompt.trim(),version:1}))]});renderExperts();}catch(e){report(e);}finally{expertImport.value='';}};
 button(expert,'恢复内置专家选择',async()=>{await patch({installedExperts:['faithful'],activeExpertId:'faithful'});renderExperts();});renderExperts();
 const reading=document.getElementById('readingSettings');
 control(reading,'translationOrder','译文顺序','原站 DOM 与事件保留。',[['source-first','原文在前'],['translation-first','译文在前']]);
 control(reading,'translatedFontFamily','译文字体','仅影响 PIT 译文。',['inherit','serif','sans-serif','monospace']);
 for(const [key,title,min,max,step] of [['translatedFontSize','译文字号',10,48,1],['translationLineHeight','行高',1,3,0.1],['translationSpacing','段落间距',0,48,1]])control(reading,key,title,'保存后更新网页译文。',{min,max,step});
 control(reading,'translationTextColor','译文颜色','即时预览与网页使用相同映射。');control(reading,'translationBgColor','译文背景','只作用于译文，不修改原网页背景。');
 control(reading,'sameLanguageHighlight','相近文字加背景','中日韩目标语言使用背景突出译文。');
 const live=el('div','',{className:'live-preview'});live.append(el('p','A clear sentence makes a complex idea easier to understand.'),el('p','清晰的句子让复杂的想法更容易理解。',{id:'stylePreview'}));reading.append(live);
 function preview(){Object.assign(document.getElementById('stylePreview').style,readingStyle(get()));document.documentElement.lang=get().uiLanguage==='en'?'en':'zh-CN';document.querySelector('h1').textContent=get().uiLanguage==='en'?'PIT · Translation settings':'PIT · 翻译设置中心';}preview();
 const video=section('video','视频字幕','只读取可访问的 TextTrack、已显示 CC 或你导入的字幕。需要先开启播放器原生 CC。音频识别必须在 Popup 手动授权。');
 for(const [key,title,desc] of [['enabled','启用视频双语字幕','关闭会立即停止当前字幕会话。'],['autoStartSupportedSites','支持站点自动启动','仅有可读来源时启动，不会代替你打开站点 CC。'],['playerQuickToggle','播放器快捷开关','在可见播放器附近显示 PIT 按钮。'],['preferPitTranslationOverPlatformMT','使用 PIT 翻译 YouTube 字幕','关闭时保留平台字幕，PIT 不发送该平台字幕请求。'],['baseSentenceSegmentation','基础断句优化','按标点换行，不改变时间轴。'],['preferHumanCaptions','优先人工字幕','仅使用显式轨道元数据；未知类型不猜测。'],['focusDialogueOnly','仅对话内容','过滤明确音效标注，原生字幕不变。'],['translationFirst','字幕译文在前','适用于 PIT 同时显示原文的字幕来源。']])control(video,key,title,desc,null,'videoSettings');
 for(const title of ['AI 智能分句 Beta','Teams / Zoom / Google Meet 自动字幕']){const c=el('input','',{type:'checkbox',disabled:true});row(video,title,'尚无可验收的专用实现，当前不可用；可手动导入字幕或授权 ASR。',c);}
 const choices=[['inherit','跟随全局'],...providerCatalog(get()).filter(x=>!x.ai).map(x=>[x.id,x.name])];
 control(video,'providerId','视频专用翻译服务','站点覆盖 > 视频专用 > 全局。',choices,'videoSettings');
 control(video,'source','字幕源语言','手动覆盖优先；自动使用字幕轨语言。',['auto',...LANGUAGES],'videoSettings');control(video,'target','字幕目标语言','独立于网页目标语。',['inherit',...LANGUAGES],'videoSettings');
 control(video,'subtitleFontSize','字幕字号','12–48 px',{min:12,max:48},'videoSettings');control(video,'subtitlePosition','字幕位置','全屏仍可显示。',['bottom','top'],'videoSettings');
 control(video,'subtitleColor','字幕文字颜色','保存后更新。',null,'videoSettings');control(video,'subtitleBackground','字幕背景颜色','保存后更新。',null,'videoSettings');
 for(const id of ['youtube','bilibili','netflix','panopto','generic']){const box=el('fieldset','');box.append(el('legend',id+' · 受控测试 / 实站待验收'));video.append(box);
 for(const [key,title] of [['enabled','启用平台'],['autoStart','自动启动']]){const c=el('input','',{type:'checkbox',checked:get().videoSettings.siteOverrides[id]?.[key]??key==='enabled'});row(box,title,'平台设置覆盖全局自动启动；全局禁用优先。',c);c.onchange=()=>patch({videoSettings:{...get().videoSettings,siteOverrides:{...get().videoSettings.siteOverrides,[id]:{...get().videoSettings.siteOverrides[id],[key]:c.checked}}}}).catch(report);}
 const select=el('select','');for(const [value,title] of choices)select.append(el('option',title,{value}));select.value=get().videoSettings.siteOverrides[id]?.providerId||'inherit';row(box,'平台服务覆盖','继承时使用视频专用服务。',select);select.onchange=()=>patch({videoSettings:{...get().videoSettings,siteOverrides:{...get().videoSettings.siteOverrides,[id]:{...get().videoSettings.siteOverrides[id],providerId:select.value}}}}).catch(report);}
 const diagnostic=el('pre','尚未检查',{role:'status'});button(video,'检查最近的视频标签页',async()=>{const tabs=await chrome.tabs.query({currentWindow:true});const tab=tabs.filter(t=>/^https?:/.test(t.url||'')).sort((a,b)=>(b.lastAccessed||0)-(a.lastAccessed||0))[0];if(!tab?.id)throw Error('没有可检查的普通网页');const r=await chrome.tabs.sendMessage(tab.id,{type:'PIT_CAPTIONS_DIAGNOSTICS'});diagnostic.textContent=JSON.stringify(r,null,2);});video.append(diagnostic);
 const advanced=section('advanced','高级与性能','值域受到校验；Provider 长度与任务预算保持原限制。范围和请求参数从下一任务生效，样式与禁用实时生效。');
 control(advanced,'minSegmentCharacters','最小段落字符数','1–100；跳过过短片段。',{min:1,max:100});control(advanced,'initialTranslateCharacters','直接翻译前 N 字符','500–20,000；其余按可见区调度，不突破请求预算。',{min:500,max:20000});
 for(const [key,title,desc] of [['longParagraphLineBreak','长段落按句换行','只改变译文展示，不修改原文。'],['translateToBottom','立即翻译至底部','默认关闭；开启会增加网络用量，仍受任务预算限制。'],['contextMenuEnabled','启用右键菜单','启停浏览器 PIT 原生菜单。'],['translateSidebar','翻译侧栏','允许可读 aside 内容，保留表单安全边界。'],['translateTitle','翻译网页标题','恢复原文时恢复标题；页面自己更新标题时不覆盖。'],['skipSameLanguage','相同语种跳过','只使用明确源语或网页 lang，不猜测短句。'],['selectionTranslate','启用划词翻译','需在 Popup 或右键手动触发。']])control(advanced,key,title,desc);
 control(advanced,'loadingAnimation','等待样式','遵循减少动态效果偏好。',['text','spinner']);control(advanced,'lineBreakPolicy','译文换行','仅作用于译文。',['smart','always','preserve']);control(advanced,'temporaryAutoTranslateMinutes','手动翻译后临时自动时长（分钟）','0 禁用；最多一天，仅当前域名。',{min:0,max:1440});
 const langs=el('input','',{value:get().translationOnlyLanguages.join(',')});row(advanced,'仅译文模式的源语言','以逗号分隔：'+LANGUAGES.join(', '),langs);langs.onchange=()=>patch({translationOnlyLanguages:langs.value.split(',').map(x=>x.trim())}).catch(report);
 const rules=document.getElementById('privacySettings');
 const domain=el('input','',{placeholder:'example.com'});row(rules,'网站域名','包含子域名；更精确的域名优先。',domain);
 const ruleProvider=el('select',''),ruleTarget=el('select',''),ruleTheme=el('select','');
 for(const [v,t] of choices)ruleProvider.append(el('option',t,{value:v}));
 for(const v of ['inherit',...LANGUAGES])ruleTarget.append(el('option',v==='inherit'?'跟随全局':v,{value:v}));
 for(const [v,t] of [['inherit','跟随全局'],['none','无背景'],['subtle','轻柔'],['underline','下划线'],['highlight','高亮']])ruleTheme.append(el('option',t,{value:v}));
 row(rules,'本站服务','覆盖网页 / 视频的默认服务。',ruleProvider);row(rules,'本站目标语言','优先于全局语言。',ruleTarget);row(rules,'本站译文样式','仅影响此域名的网页译文。',ruleTheme);
 const ruleList=el('div','');rules.append(ruleList);
 function renderRules(){ruleList.replaceChildren();for(const x of get().siteRules){const item=el('div','',{className:'provider-card'});item.append(el('strong',x.host),el('p',[x.providerId,x.target,x.theme].join(' · ')));button(item,'编辑',()=>{domain.value=x.host;ruleProvider.value=x.providerId;ruleTarget.value=x.target;ruleTheme.value=x.theme;});button(item,'删除',async()=>{await patch({siteRules:get().siteRules.filter(r=>r.host!==x.host)});renderRules();});ruleList.append(item);}}
 button(rules,'保存站点规则',async()=>{const host=domain.value.trim().toLowerCase().replace(/^\*\./,'');if(!/^[a-z0-9.-]+$/.test(host)||host.startsWith('.')||host.endsWith('.'))throw Error('请输入域名，例如 example.com，不要包含网址路径。');await patch({siteRules:[...get().siteRules.filter(x=>x.host!==host),{host,providerId:ruleProvider.value,target:ruleTarget.value,theme:ruleTheme.value}]});renderRules();});renderRules();
 const terms=section('terms','术语与上下文','术语与相邻段落只用于你明确选择的 AI 请求，不会开启付费模型。');
 for(const name of ['glossary','contextAI']){const label=form.elements.namedItem(name)?.closest('label');if(label)terms.append(label);}
 const interaction=section('interaction','输入框 / 悬停 / 悬浮球','Shift + 悬停翻译；输入框三连空格触发。密码与敏感表单保持排除，AI 不会自动调用。');
 for(const name of ['hoverTranslate','inputTranslate','inputTarget','floatingControl']){const label=form.elements.namedItem(name)?.closest('label');if(label)interaction.append(label);}
 const text=section('text','文本翻译','使用基础设置中的语言与常规服务；原文只发送到你已选定的服务，最多 4,500 字符。');
 const sourceText=el('textarea','',{rows:7,maxLength:4500,placeholder:'粘贴要翻译的文本'});row(text,'原文','默认语言不合适时请到基础与语言修改。',sourceText);const translated=el('pre','',{role:'status'});
 button(text,'翻译文本',async()=>{if(!sourceText.value.trim())throw Error('请输入原文');translated.textContent='正在翻译…';const r=await chrome.runtime.sendMessage({type:'TRANSLATE_TEXT',mode:'standard',texts:[sourceText.value],userInitiated:true});translated.textContent=r.ok?r.translations.join('\n'):r.error;});text.append(translated);
 const files=section('files','文件 / PDF / OCR','复用现有 File Lab、PDF.js、Tesseract、字幕导入。高保真 PDF / ASR 需真实部署。');control(files,'fileProviderId','文件翻译服务','跟随全局或使用独立常规服务。',choices);button(files,'打开文件与图片工作台',()=>chrome.tabs.create({url:chrome.runtime.getURL('file-lab.html')}));
 const sync=section('sync','账号与加密同步','普通偏好按类同步；API Key、Token 与完整 AI Profiles 仅加密后上传。离线仍能翻译。');mountSync(sync,button,row,report);
 const help=section('help','快捷键 / 帮助 / 关于','Alt+A 翻译与恢复；Alt+W 整页。Shift+悬停与输入框三连空格需在阅读设置启用。');button(help,'浏览器快捷键管理',()=>chrome.tabs.create({url:'chrome://extensions/shortcuts'}));help.append(el('p','PIT '+chrome.runtime.getManifest().version+' · Draft 测试版 · MIT；沿用 WXT / React / PDF.js / Tesseract，未复制参考产品资产。'));
 const nav=document.querySelector('.options-nav');nav.replaceChildren();const items=[['baseSettings','基础与语言'],['services','翻译服务中心'],['browserModelSettings','本地语言包'],['standardKeys','服务凭据'],['aiKeys','AI 模型配置'],['experts','AI 专家'],['terms','术语与上下文'],['text','文本翻译'],['interaction','输入 / 悬停 / 悬浮球'],['readingSettings','阅读 / 样式 / 交互'],['video','视频字幕'],['files','文件 / 图片 OCR'],['cloudPdfSettings','云端 PDF'],['privacySettings','站点与隐私'],['advanced','高级与性能'],['sync','账号与同步'],['backupSettings','导入 / 导出'],['help','快捷键 / 关于']];
 const find=el('input','',{type:'search',placeholder:'搜索设置 / Search'});nav.append(find);for(const [id,title] of items)nav.append(el('a',title,{href:'#'+id}));
 function navigate(){const id=location.hash.slice(1).split('/')[0]||'baseSettings';for(const [key] of items)document.getElementById(key).hidden=key!==id;for(const a of nav.querySelectorAll('a'))a.setAttribute('aria-current',a.hash==='#'+id?'page':'false');if(id==='services')renderProviders();const provider=location.hash.split('/')[1];if(id==='services'&&provider){for(const c of cards.children){c.style.outline=c.dataset.provider===provider?'2px solid var(--pit-accent)':'';if(c.dataset.provider===provider)c.scrollIntoView({block:'center'});}}}
 window.addEventListener('hashchange',navigate);navigate();find.oninput=()=>{if(!find.value)return navigate();for(const [id] of items)document.getElementById(id).hidden=!document.getElementById(id).textContent.toLowerCase().includes(find.value.toLowerCase());};
 const reset=button(document.getElementById('saveActions'),'恢复当前页默认偏好',async()=>{if(!confirm('恢复当前页偏好默认值？API 凭据和专家不受影响。'))return;const visible=[...form.querySelectorAll('section.panel')].find(x=>!x.hidden);const update={};for(const input of visible?.querySelectorAll('[data-key]')||[]){const k=input.dataset.key;if(visible.id==='video')update.videoSettings={...VIDEO_DEFAULTS};else if(Object.hasOwn(DEFAULT_SETTINGS,k))update[k]=DEFAULT_SETTINGS[k];}await patch(update);location.reload();});reset.title='仅恢复当前分类新增偏好';
 form.addEventListener('change',e=>{if(e.target.name)save().then(preview).catch(report);});
 for(const id of ['profileAdd','profileUpdate','profileDelete'])document.getElementById(id).addEventListener('click',()=>{void save().then(renderProviders).catch(report);});
}

function mountSync(parent,button,row,report){
 const output=el('p','本地就绪 · 未登录',{role:'status'});parent.append(output);
 const call=async(action,extra={})=>{const r=await chrome.runtime.sendMessage({type:'PIT_SYNC',action,...extra});if(!r?.ok)throw Error(r?.error||'同步不可用');const s=r.status;output.textContent=[s.account,s.enabled?'同步已开启':'同步已暂停',s.vault==='unlocked'?'保险库已解锁':'保险库已锁定：新设备需解锁后恢复密钥；本机已有密钥仍可用',s.conflicted?'存在冲突，请选择版本':s.queued?'等待同步':'无待同步修改',s.lastSyncedAt?'最近同步 '+s.lastSyncedAt:'尚未同步',s.error,s.callback?'OAuth 回跳地址：'+s.callback:''].filter(Boolean).join(' · ');return r;};
 button(parent,'Google 登录',()=>call('login'));button(parent,'立即同步 / 重试',()=>call('sync'));button(parent,'暂停同步',()=>call('pause'));button(parent,'退出（保留本地设置）',()=>call('logout'));
 for(const [key,title] of [['preferences','同步普通偏好'],['sites','同步站点规则'],['glossary','同步术语'],['vault','加密同步 Keys / Profiles']]){const c=el('input','',{type:'checkbox',checked:key==='preferences'});row(parent,title,key==='vault'?'使用下方密码创建或解锁保险库。':'可单独关闭此数据类别。',c);c.onchange=()=>call('configure',{options:{[key]:c.checked}}).catch(report);call('status').then(r=>c.checked=r.status.options?.[key]===true).catch(()=>{});}
 const pass=el('input','',{type:'password',autocomplete:'new-password',minLength:12,placeholder:'至少 12 字符；密码不会上传'});row(parent,'保险库密码','新设备一次解锁恢复多个 Key；忘记密码只能从已解锁设备或备份恢复。',pass);
 const backup=el('input','',{type:'file',accept:'.json'});row(parent,'恢复加密备份','填写原保险库密码；只恢复本机，不自动覆盖云端。',backup);backup.onchange=async()=>{try{const file=backup.files?.[0];if(!file)return;if(file.size>300000)throw Error('备份超过大小限制');if(!confirm('恢复备份会替换本机 Keys / Profiles，是否继续？'))return;await call('importVault',{backup:JSON.parse(await file.text()),password:pass.value});}catch(e){report(e);}finally{pass.value='';backup.value='';}};
 for(const [action,title] of [['unlock','创建 / 解锁保险库'],['lock','锁定保险库'],['exportVault','导出加密备份']])button(parent,title,async()=>{try{if(action==='unlock'&&!confirm('若云端已有保险库，解锁会将其 Keys / Profiles 恢复到本机。确认采用云端密钥？'))return;const r=await call(action,{password:pass.value});if(r.backup){const a=el('a','',{href:URL.createObjectURL(new Blob([JSON.stringify(r.backup)],{type:'application/json'})),download:'pit-encrypted-vault.json'});a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}}finally{pass.value='';}});
 button(parent,'冲突：保留本地版本',()=>confirm('将本地偏好作为新版本？其他设备后续修改仍会再次触发冲突。')?call('resolve',{choice:'local'}):null);
 button(parent,'冲突：采用云端版本',()=>confirm('用云端偏好替换本地对应类别？密钥仍需解锁。')?call('resolve',{choice:'remote'}):null);
 button(parent,'删除我的云副本',()=>confirm('删除此账号云端偏好和加密密钥副本？保留本机配置并暂停同步。')?call('delete'):null);
 call('status').catch(e=>output.textContent=e.message);
}
