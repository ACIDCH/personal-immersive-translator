import test from 'node:test';
import assert from 'node:assert/strict';

test('MV3 background routes default browser MT to offscreen with real CLD hints, no remote API key',async()=>{
 let messageListener=null,opening=0,requests=[],network=0,nativeStatus='downloadable';
 const values=new Map([['pit_settings_v1',{
  standardProvider:'browser',source:'auto',target:'zh'}]]);
 globalThis.chrome={
  runtime:{
   id:'pit-native-engine-fixture',
   getURL:path=>'chrome-extension://pit-native-engine-fixture/'+path,
   onInstalled:{addListener(){}},onMessage:{addListener(fn){messageListener=fn;}},
   async sendMessage(msg){
    requests.push(msg);
    if(msg.type==='PIT_OFFSCREEN_BROWSER_STATUS')
     return {ok:true,status:nativeStatus};
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
    set:async()=>{},
    remove:async()=>{}
   },
   session:{get:async()=>({}),set:async()=>{},remove:async()=>{}}
  },
  tabs:{onRemoved:{addListener(){}},onUpdated:{addListener(){}}}
 };
 globalThis.fetch=async()=>{network++;throw Error('Browser MT must not use remote provider');};
 await import('../src/background.js');
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
 assert.deepEqual(requests.map(x=>x.source),['fr','de']);
 assert.deepEqual(requests.map(x=>x.target),['zh','zh']);
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
 chrome.tabs.detectLanguage=async tabId=>{
  assert.equal(tabId,13);
  return 'fr';
 };
 const short=await call({type:'TRANSLATE_BATCH',mode:'standard',
  texts:['Bonjour']});
 assert.equal(short.ok,true,JSON.stringify(short));
 assert.equal(requests.at(-1).source,'fr',
   'Short French headings must not default to English');
 const diag=await call({type:'PIT_BROWSER_STATUS',source:'en',target:'zh'},
   {id:chrome.runtime.id,
    url:'chrome-extension://pit-native-engine-fixture/pit-options.html'});
 assert.equal(diag.ok,true,JSON.stringify(diag));
 assert.equal(diag.status,'downloadable');
 assert.equal(diag.runtime,'offscreen');
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



});
