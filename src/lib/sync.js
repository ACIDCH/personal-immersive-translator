// Supabase official SDK is bundled locally by prepare-native.mjs (MV3 CSP).
import {createClient} from '../vendor/supabase.js';
import {SETTINGS_KEY,normalizeSettings,PORTABLE_PREF_KEYS} from './settings.js';
import {SECRET_KEYS,secretPayload,deriveVault,encryptVault,decryptVault,exportSessionKey,importSessionKey} from './vault.js';
const URL='https://ligamejpnracymxfbbff.supabase.co';
const PUBLIC_KEY='sb_publishable_RMjk_DRGZk3KV63VHutsMA_9V16XWNx';
const META='pit_sync_state',KEY='pit_vault_session';
let sdkClient;
function getClient(){return sdkClient??=createClient(URL,PUBLIC_KEY,{auth:{flowType:'pkce',detectSessionInUrl:false,autoRefreshToken:false,persistSession:true,storageKey:'pit_auth',storage:{
 getItem:async key=>(await chrome.storage.local.get(key))[key]??null,
 setItem:async(key,value)=>chrome.storage.local.set({[key]:value}),
 removeItem:async key=>chrome.storage.local.remove(key)
}}});}
const client=new Proxy({},{get:(_target,key)=>getClient()[key]});
const initial={enabled:false,options:{preferences:true,sites:false,glossary:false,vault:false},revision:0,vaultRevision:0,base:null,queued:false,conflicted:false,lastSyncedAt:null};
let chain=Promise.resolve();
const read=async()=>({...initial,...(await chrome.storage.local.get(META))[META]});
const write=async s=>chrome.storage.local.set({[META]:s});
const local=async()=>normalizeSettings((await chrome.storage.local.get(SETTINGS_KEY))[SETTINGS_KEY]);
const equivalent=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const siteKeys=['siteRules','autoTranslateHosts','blockedHosts','temporaryAutoTranslateUntil'];
export function syncPreferences(s,options){return Object.fromEntries(PORTABLE_PREF_KEYS.filter(k=>!SECRET_KEYS.includes(k)&&(siteKeys.includes(k)?options.sites:k==='glossary'?options.glossary:options.preferences)).map(k=>[k,s[k]]));}
function checked(r){if(r.error)throw Error('云端请求失败（'+(r.error.code||r.status||'network')+'）；请检查登录、网络与 PIT 表部署。');return r.data;}
async function user(){let {data,error}=await client.auth.getSession();if(error)throw Error('登录会话读取失败');if(data.session&&data.session.expires_at*1000<Date.now()+60000){({data,error}=await client.auth.refreshSession());if(error)throw Error('登录已过期，请重新登录');}if(!data.session)throw Error('请先登录 PIT 账号');return data.session.user;}
async function remote(table,id){return checked(await client.from(table).select('*').eq('user_id',id).maybeSingle());}
async function cas(table,id,revision,data){
 const r=revision===0?await client.from(table).insert({user_id:id,revision:1,...data}).select().single():await client.from(table).update({...data,revision:revision+1,updated_at:new Date().toISOString()}).eq('user_id',id).eq('revision',revision).select().maybeSingle();
 if(r.error?.code==='23505'||(!r.error&&!r.data))throw Error('revision-conflict');return checked(r);
}
async function sessionKey(id){const x=(await chrome.storage.session.get(KEY))[KEY];return x?.userId===id?{...x,key:await importSessionKey(x.raw)}:null;}
async function status(){const s=await read();const a=await client.auth.getSession();const id=a.data.session?.user?.id;return {enabled:s.enabled,options:s.options,account:id?'已登录':'未登录',queued:s.queued,conflicted:s.conflicted,lastSyncedAt:s.lastSyncedAt,error:s.error||'',vault:id&&await sessionKey(id)?'unlocked':'locked',callback:chrome.identity?.getRedirectURL('supabase')};}
async function sync(choice){
 let s=await read();if(!s.enabled)return;
 const account=await user();if(s.userId!==account.id)throw Error('账号已改变，请重新启用同步');
 if(s.conflicted&&!choice)return;
 const before=await local(),payload=syncPreferences(before,s.options),r=await remote('pit_user_preferences',account.id);
 if(r&&r.revision!==s.revision){
  if((s.base===null||!equivalent(payload,s.base))&&!choice){await write({...s,conflicted:true,queued:true,error:'本地与云端均有设置，请选择保留本地或采用云端。'});return;}
  if(choice!=='local'){
   if(!equivalent(syncPreferences(await local(),s.options),payload)){await write({...s,queued:true,conflicted:true,error:'拉取期间本地设置变化，请重新选择版本。'});return;}
   const allowed=syncPreferences(normalizeSettings(r.payload),s.options);
   await chrome.storage.local.set({[SETTINGS_KEY]:normalizeSettings({...await local(),...allowed})});
   s={...s,revision:r.revision,base:allowed};
  }else s.revision=r.revision;
 }
 const current=syncPreferences(await local(),s.options);
 if(!r||!equivalent(current,s.base)){const prior=r?syncPreferences(normalizeSettings(r.payload),{preferences:true,sites:true,glossary:true}):{};const saved=await cas('pit_user_preferences',account.id,s.revision,{schema_version:2,device_id:s.deviceId,payload:{...prior,...current}});s={...s,revision:saved.revision,base:current};}
 if(s.options.vault){
  const key=await sessionKey(account.id);
  if(key){const vr=await remote('pit_user_vault',account.id);if((vr?.revision||0)!==s.vaultRevision){await chrome.storage.session.remove(KEY);await write({...s,conflicted:true,queued:true,error:'云端保险库已更新。已锁定；请解锁并审阅云端 Keys，未覆盖本机。'});return;}
   const secrets=secretPayload(await local());
   const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(secrets))))).join(',');
   if(digest!==key.digest){const envelope=await encryptVault(secrets,key.key,key.salt,account.id);const saved=await cas('pit_user_vault',account.id,s.vaultRevision,envelope);s.vaultRevision=saved.revision;await chrome.storage.session.set({[KEY]:{userId:account.id,raw:key.raw,salt:key.salt,digest}});}
  }
 }
 const changed=!equivalent(current,syncPreferences(await local(),s.options));
 await write({...s,queued:changed,conflicted:false,lastSyncedAt:new Date().toISOString(),error:''});
}
async function action(msg){
 let s=await read();
 switch(msg.action){
 case 'status':break;
 case 'login':{
  const redirectTo=chrome.identity.getRedirectURL('supabase');
  const {data,error}=await client.auth.signInWithOAuth({provider:'google',options:{redirectTo,skipBrowserRedirect:true}});
  if(error)throw Error('Google 登录尚未配置：检查 Supabase Auth provider / 回跳白名单');
  const callback=await chrome.identity.launchWebAuthFlow({url:data.url,interactive:true});
  const u=new globalThis.URL(callback);if(u.origin+u.pathname!==redirectTo)throw Error('登录回跳不匹配');
  if(!u.searchParams.get('code'))throw Error('登录未返回授权码');
  checked(await client.auth.exchangeCodeForSession(u.searchParams.get('code')));
  const a=await user();await chrome.storage.session.remove(KEY);
  s={...initial,options:s.options,userId:a.id,deviceId:s.deviceId||crypto.randomUUID(),enabled:true,queued:true};await write(s);await sync();break;
 }
 case 'configure':{const options={...s.options};for(const k of ['preferences','sites','glossary','vault'])if(typeof msg.options?.[k]==='boolean')options[k]=msg.options[k];await write({...s,options,queued:true,base:null});break;}
 case 'pause':await write({...s,enabled:false});await chrome.storage.session.remove(KEY);break;
 case 'logout':await write({...s,enabled:false});await chrome.storage.session.remove(KEY);await client.auth.signOut({scope:'local'});break;
 case 'sync':{const a=await user();await write({...s,userId:a.id,enabled:true,queued:true});await sync();break;}
 case 'resolve':if(!['local','remote'].includes(msg.choice))throw Error('请选择版本');await sync(msg.choice);break;
 case 'lock':await chrome.storage.session.remove(KEY);break;
 case 'unlock':{
  const a=await user();if(!s.options.vault)throw Error('请先同意加密同步 Keys / Profiles');
  const r=await remote('pit_user_vault',a.id);const {key,salt}=await deriveVault(msg.password,r?.salt);
  if(r){const secrets=await decryptVault(r,key,a.id);await chrome.storage.local.set({[SETTINGS_KEY]:normalizeSettings({...await local(),...secrets})});}
  await chrome.storage.session.set({[KEY]:{userId:a.id,raw:await exportSessionKey(key),salt}});
  await write({...s,enabled:true,userId:a.id,vaultRevision:r?.revision||0,conflicted:false,queued:true});await sync();break;
 }
 case 'exportVault':{const a=await user(),key=await sessionKey(a.id);if(!key)throw Error('请先解锁保险库');return {status:await status(),backup:{userId:a.id,...await encryptVault(await local(),key.key,key.salt,a.id)}};}
 case 'importVault':{const a=await user(),b=msg.backup;if(!b||b.userId!==a.id)throw Error('备份必须属于当前 PIT 账号');const {key}=await deriveVault(msg.password,b.salt);const secrets=await decryptVault(b,key,a.id);await chrome.storage.local.set({[SETTINGS_KEY]:normalizeSettings({...await local(),...secrets})});await chrome.storage.session.remove(KEY);await write({...s,queued:true,error:'已恢复本地备份；云保险库保持锁定，未覆盖云端。'});break;}
 case 'delete':{const a=await user();checked(await client.from('pit_user_vault').delete().eq('user_id',a.id));checked(await client.from('pit_user_preferences').delete().eq('user_id',a.id));await write({...initial,deviceId:s.deviceId,options:s.options});await chrome.storage.session.remove(KEY);break;}
 default:throw Error('未知同步操作');
 }
 return {status:await status()};
}
export function syncAction(msg){const next=chain.then(()=>action(msg));chain=next.catch(()=>{});return next;}
export function backgroundSync(){const next=chain.then(()=>sync()).catch(async e=>{const s=await read();await write({...s,queued:true,conflicted:s.conflicted||e.message==='revision-conflict',error:e.message==='revision-conflict'?'并发修改被拒绝；请选择版本。':e.message});});chain=next;return next;}
