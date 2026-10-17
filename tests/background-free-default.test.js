import test from 'node:test';
import assert from 'node:assert/strict';

test('actual MV3 worker: free default MT, usage ceiling, context menus and settings migration',async()=>{
 const state=new Map(),sessionState=new Map(),installed=[],menus=[],createdTabs=[];
 let onMessage,onMenu,network=0;
 const local={
  setAccessLevel:async()=>{},
  get:async key=>{
   if(typeof key==='string')return {[key]:state.get(key)};
   return Object.fromEntries(state);
  },
  set:async obj=>{for(const [key,value]of Object.entries(obj))state.set(key,value);},
  remove:async key=>state.delete(key)
 };
 const session={
  get:async keys=>Object.fromEntries(
   (Array.isArray(keys)?keys:[keys]).map(k=>[k,sessionState.get(k)])),
  set:async obj=>{for(const [k,v]of Object.entries(obj))sessionState.set(k,v);},
  remove:async keys=>{for(const k of (Array.isArray(keys)?keys:[keys]))sessionState.delete(k);}
 };
 state.set('pit_settings_v1',{
  standardProvider:'cloud',cloudEndpoint:'',cloudToken:'',source:'auto',target:'zh'
 });
 globalThis.chrome={
  runtime:{
   id:'test-extension',lastError:null,
   getURL:p=>'chrome-extension://test-extension/'+p,
   onInstalled:{addListener:fn=>installed.push(fn)},
   onMessage:{addListener:fn=>{onMessage=fn;}}
  },
  storage:{local,session},
  contextMenus:{
   create:(spec,callback)=>{menus.push(spec);callback?.();},
   onClicked:{addListener:fn=>{onMenu=fn;}}
  },
  tabs:{
   onRemoved:{addListener(){}},onUpdated:{addListener(){}},
   create:async spec=>{createdTabs.push(spec);return {id:23};},
   sendMessage:async()=>({ok:true}),
   query:async()=>[{id:21,url:'https://example.org/article'}]
  },
  scripting:{insertCSS:async()=>{},executeScript:async()=>{}},
  commands:{onCommand:{addListener(){}}}
 };
 globalThis.fetch=async (url,init)=>{
  if(!String(url).startsWith('https://api.mymemory.translated.net/get?'))
   throw Error('unexpected endpoint '+url);
  network++;
  const q=new URL(url).searchParams.get('q');
  assert.equal(init.method,'GET');
  assert.ok(new TextEncoder().encode(q).length<=500);
  return {ok:true,status:200,json:async()=>({
   responseStatus:200,responseData:{translatedText:'译文'}
  })};
 };
 await import('../src/background.js');
 for(const handler of installed)await handler({reason:'update'});
 assert.equal(state.get('pit_settings_v1').standardProvider,'mymemory');
 assert.deepEqual(menus.map(x=>x.id).sort(),[
   'pit-image-ocr','pit-read-selected','pit-translate-page','pit-translate-selected']);
 const request=(message,sender={id:chrome.runtime.id,tab:{url:'https://example.org/article'}})=>
  new Promise(resolve=>onMessage(message,sender,resolve));
 const first=await request({type:'TRANSLATE_BATCH',mode:'standard',texts:['Hello world']});
 assert.equal(first.ok,true,JSON.stringify(first));
 assert.deepEqual(first.translations,['译文']);
 assert.equal(network,1);
 const big=await request({type:'TRANSLATE_BATCH',mode:'standard',texts:['x'.repeat(4400)]});
 assert.equal(big.ok,true,JSON.stringify(big));
 assert.ok(network>=10);
 const before=network;
 const blocked=await request({type:'TRANSLATE_BATCH',mode:'standard',texts:['x'.repeat(110)]});
 assert.equal(blocked.ok,false);
 assert.match(blocked.error,/每日匿名额度/);
 assert.equal(network,before);
 assert.equal([...state.keys()].some(x=>x.startsWith('pit_mymemory_usage_')),true);
 assert.equal(typeof onMenu,'function');
 await onMenu({menuItemId:'pit-image-ocr',
   srcUrl:'https://cdn.example.org/article-photo.jpg'},
   {id:21,url:'https://example.org/article'});
 // The image context action is async fire-and-forget; flush microtasks.
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(sessionState.get('pit_ocr_image_url'),'https://cdn.example.org/article-photo.jpg');
 assert.ok(createdTabs.some(x=>x.url==='chrome-extension://test-extension/file-lab.html'));
});
