import test from 'node:test';
import assert from 'node:assert/strict';

test('MV3 background routes default browser MT to offscreen with real CLD hints, no remote API key',async()=>{
 let messageListener=null,opening=0,requests=[],network=0,nativeStatus='downloadable';
 const onInstalled=[];
 const values=new Map([['pit_settings_v1',{
  standardProvider:'browser',source:'auto',target:'zh'}]]);
 globalThis.chrome={
  runtime:{
   id:'pit-native-engine-fixture',
   getURL:path=>'chrome-extension://pit-native-engine-fixture/'+path,
   onInstalled:{addListener(fn){onInstalled.push(fn);}},onMessage:{addListener(fn){messageListener=fn;}},
   async sendMessage(msg){
    requests.push(msg);
    if(msg.type==='PIT_OFFSCREEN_PING')
     return {ok:true,ready:true,translatorApi:'function'};
    if(msg.type==='PIT_OFFSCREEN_BROWSER_STATUS')
     return {ok:true,status:nativeStatus};
    if(msg.type==='PIT_OFFSCREEN_BROWSER_PROBE')
     return {ok:true,translation:'真实模型测试译文',elapsedMs:87};
    if(msg.type==='PIT_OFFSCREEN_BROWSER_TRANSLATE')
     return {ok:true,translations:msg.texts.map(x=>'译文:'+x)};
    throw Error('Unknown offscreen message');
   }
  },
  i18n:{
   async detectLanguage(text){
    const fr=text.includes('Bonjour')||text.includes('étudiants');
    return {isReliable:true,languages:[{language:fr?'fr':'de',percentage:95}]};
   }
  },
  offscreen:{
   hasDocument:async()=>opening>0,
   createDocument:async()=>{opening++;},
   closeDocument:async()=>{opening=0;}
  },
  contextMenus:{onClicked:{addListener(){}},create(){}},
  storage:{
   local:{
    setAccessLevel:async()=>{},
    get:async key=>{
     if(key==='pit_settings_v1')return {pit_settings_v1:values.get(key)};
     return {};
    },
    set:async data=>{for(const [key,val] of Object.entries(data))values.set(key,val);},
    remove:async key=>values.delete(key)
   },
   session:{get:async()=>({}),set:async()=>{},remove:async()=>{}}
  },
  tabs:{onRemoved:{addListener(){}},onUpdated:{addListener(){}}}
 };
 globalThis.fetch=async()=>{network++;throw Error('Browser MT must not use remote provider');};
 await import('../src/background.js');
 const obsolete={standardProvider:'cloud',source:'fr',target:'zh',
  cloudEndpoint:'',cloudToken:''};
 values.set('pit_settings_v1',obsolete);
 for(const handler of onInstalled)await handler({reason:'update'});
 assert.equal(values.get('pit_settings_v1').standardProvider,'browser');
 assert.equal(values.get('pit_settings_v1').source,'fr','migration retains reading language');
 const configured={...obsolete,cloudEndpoint:'https://my-worker.example',
  cloudToken:'valid-private-key-12345'};
 values.set('pit_settings_v1',configured);
 for(const handler of onInstalled)await handler({reason:'update'});
 assert.equal(values.get('pit_settings_v1').standardProvider,'cloud',
  'never rewrite a real configured provider');
 values.set('pit_settings_v1',{standardProvider:'browser',source:'auto',target:'zh'});
 const call=(message,sender={id:chrome.runtime.id,
   tab:{id:13,url:'https://example.org/course'},
   url:'https://example.org/course'})=>
   new Promise(resolve=>messageListener(message,sender,resolve));
 const original=[
  'Bonjour les étudiants, nous étudions la finance internationale.',
  'Die wirtschaftlichen Veränderungen erfordern eine neue Planung.'
 ];
 const r=await call({type:'TRANSLATE_BATCH',mode:'standard',texts:original});
 assert.equal(r.ok,true,JSON.stringify(r));
 assert.deepEqual(r.translations,original.map(x=>'译文:'+x));
 assert.equal(opening,1);
 assert.equal(network,0);
 assert.deepEqual(requests.filter(x=>x.type==='PIT_OFFSCREEN_BROWSER_TRANSLATE').map(x=>x.source),['fr','de']);
 assert.deepEqual(requests.filter(x=>x.type==='PIT_OFFSCREEN_BROWSER_TRANSLATE').map(x=>x.target),['zh','zh']);
 const prefs=await call({type:'PIT_PUBLIC_PREFERENCES'});
 assert.equal(prefs.ok,true);
 assert.equal(prefs.preferences.standardProvider,'browser');
 assert.equal(prefs.preferences.standardReady,true);
 assert.equal('cloudToken' in prefs.preferences,false);
 // Chrome 138-149 does not expose chrome.offscreen.hasDocument().
 // Query the exact PIT offscreen URL through runtime.getContexts instead.
 delete chrome.offscreen.hasDocument;
 chrome.runtime.getContexts=async query=>{
  assert.deepEqual(query.contextTypes,['OFFSCREEN_DOCUMENT']);
  assert.equal(query.documentUrls[0],
    'chrome-extension://pit-native-engine-fixture/src/offscreen.html');
  return [{contextType:'OFFSCREEN_DOCUMENT'}];
 };
 const next=await call({type:'TRANSLATE_BATCH',mode:'standard',
  texts:['Bonjour notre prochain cours de finance et économie européenne.']});
 assert.equal(next.ok,true,JSON.stringify(next));
 assert.equal(opening,1,'must reuse existing offscreen document on Chrome 138-149');
 const stopping=await call({type:'PIT_ASR_STOP'},{
  id:chrome.runtime.id,url:chrome.runtime.getURL('pit-options.html')
 });
 assert.equal(stopping.ok,true);
 assert.equal(opening,1,'ASR stop without a recording must not destroy browser MT');
 const translatedAgain=await call({type:'TRANSLATE_BATCH',mode:'standard',texts:[
  'Die Volkswirtschaft wächst mit neuen Investitionen und Exporten.'
 ]});
 assert.equal(translatedAgain.ok,true,JSON.stringify(translatedAgain));
 assert.equal(opening,1);

 chrome.tabs.detectLanguage=async tabId=>{
  assert.equal(tabId,13);
  return 'fr';
 };
 const short=await call({type:'TRANSLATE_BATCH',mode:'standard',
  texts:['Bonjour'],pageContext:'article'});
 assert.equal(short.ok,true,JSON.stringify(short));
 assert.equal(requests.at(-1).source,'fr',
   'Short French headings must not default to English');
 const diag=await call({type:'PIT_BROWSER_STATUS',source:'en',target:'zh'},
   {id:chrome.runtime.id,
    url:'chrome-extension://pit-native-engine-fixture/pit-options.html'});
 assert.equal(diag.ok,true,JSON.stringify(diag));
 assert.equal(diag.status,'downloadable');
 assert.equal(diag.runtime,'offscreen');
 const actualProbe=await call({type:'PIT_BROWSER_PROBE',source:'en',target:'zh'},
   {id:chrome.runtime.id,url:chrome.runtime.getURL('pit-options.html')});
 assert.equal(actualProbe.ok,true,JSON.stringify(actualProbe));
 assert.equal(actualProbe.status,'translated');
 assert.equal(actualProbe.sampleTranslation,'真实模型测试译文');
 const denied=await call({type:'PIT_BROWSER_PROBE',source:'en',target:'zh'});
 assert.equal(denied.ok,false,'content scripts cannot invoke the options-only probe');
 const saved=values.get('pit_settings_v1');
 saved.autoTranslateHosts='example.org';
 let ready=await call({type:'PIT_PUBLIC_PREFERENCES',pageLanguage:'fr'});
 assert.equal(ready.ok,true);
 assert.equal(ready.preferences.standardProvider,'browser');
 assert.equal(ready.preferences.standardReady,false);
 assert.equal(ready.preferences.browserModelStatus,'downloadable');
 nativeStatus='available';
 ready=await call({type:'PIT_PUBLIC_PREFERENCES',pageLanguage:'fr'});
 assert.equal(ready.preferences.standardReady,true);
 assert.equal(ready.preferences.browserModelStatus,'available');
 saved.blockedHosts='example.org';
 ready=await call({type:'PIT_PUBLIC_PREFERENCES',pageLanguage:'fr'});
 assert.equal(ready.preferences.standardReady,true,
  'excluded website does not invoke native model readiness probes');
 saved.blockedHosts='';
 const caption=await call({
  type:'TRANSLATE_BATCH',mode:'standard',texts:['Hello'],
  captionSourceLanguage:'en'
 });
 assert.equal(caption.ok,true,JSON.stringify(caption));
 assert.equal(requests.at(-1).source,'en',
  'English caption source must not inherit the French page language');
 const unknownCaption=await call({
  type:'TRANSLATE_BATCH',mode:'standard',texts:['Hola'],
  captionSourceLanguage:''
 });
 assert.equal(unknownCaption.ok,false,
  'Unknown short subtitles must not silently inherit the host UI language');

 // Owner opts in explicitly. Public external MT must be quota bounded across
 // multiple concurrent webpage requests, with no paid AI fallback.
 values.set('pit_settings_v1',{standardProvider:'mymemory',source:'en',target:'zh'});
 let publicCalls=0;
 globalThis.fetch=async (url,options)=>{
  assert.match(String(url),/^https:\/\/api\.mymemory\.translated\.net\/get\?/);
  assert.equal(options.method,'GET');
  publicCalls++;
  return {ok:true,status:200,json:async()=>({
   responseStatus:200,responseData:{translatedText:'译文'}
  })};
 };
 const publicOne=await call({type:'TRANSLATE_BATCH',mode:'standard',
  texts:['Public academic sample with no API key']});
 assert.equal(publicOne.ok,true,JSON.stringify(publicOne));
 assert.equal(publicOne.provider,'mymemory');
 assert.deepEqual(publicOne.translations,['译文']);
 assert.ok(publicCalls>=1);
 const dailyKey='pit_mymemory_usage_'+new Date().toISOString().slice(0,10);
 assert.ok(Number(values.get(dailyKey))>=30);
 // Reservations must not race: one 3000-character request succeeds and
 // another one is rejected, even when both requests start concurrently.
 values.set(dailyKey,0);
 const outcomes=await Promise.all([
  call({type:'TRANSLATE_BATCH',mode:'standard',texts:['C'.repeat(3000)]}),
  call({type:'TRANSLATE_BATCH',mode:'standard',texts:['D'.repeat(3000)]})
 ]);
 assert.equal(outcomes.filter(r=>r.ok).length,1,JSON.stringify(outcomes));
 assert.equal(outcomes.filter(r=>!r.ok).length,1);
 assert.match(outcomes.find(r=>!r.ok).error,/4,500/);
 assert.equal(values.get(dailyKey),3000);





});
