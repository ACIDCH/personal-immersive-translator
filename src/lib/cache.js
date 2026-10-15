/** Bound translation cache: hashes index keys, never embeds source/keys in
 * cache index, and prunes stale/oldest entries. Chrome storage.local is
 * intentionally device-local, not a secret vault or cross-device sync.
 */
export const CACHE_PREFIX='pit_cache_';
export const CACHE_INDEX_KEY='pit_cache_index_v2';
export const CACHE_TTL=30*24*60*60*1000;
export const CACHE_MAX_ENTRIES=300;
let lastWrite=Promise.resolve();

export function cachePayloadKey({text,provider,target,source,model,glossary,context}){
  return JSON.stringify([text,provider,target,source||'auto',model||'',glossary||'',context||'']);
}
export async function sha256(value){
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(n=>n.toString(16).padStart(2,'0')).join('');
}
function entryValid(entry,now){
  return entry && typeof entry.value==='string' && Number.isFinite(entry.when) &&
    entry.when<=now && now-entry.when<CACHE_TTL;
}
export async function cachedTranslation(storage,payload){
  const key=CACHE_PREFIX+await sha256(cachePayloadKey(payload));
  const item=(await storage.get(key))[key];
  return entryValid(item,Date.now())?item.value:null;
}
function isCacheEntry(key){
  return key.startsWith(CACHE_PREFIX) && key!==CACHE_INDEX_KEY;
}
async function persist(storage,payload,value){
  if(typeof value!=='string')throw Error('Invalid cache translation');
  const key=CACHE_PREFIX+await sha256(cachePayloadKey(payload));
  const now=Date.now();
  const stored=(await storage.get(CACHE_INDEX_KEY))[CACHE_INDEX_KEY];
  let index;
  if(!Array.isArray(stored)){
    // Migrate older versions once. This also removes abandoned cache entries
    // that occupied quota without a bounded index.
    const all=await storage.get(null);
    index=Object.entries(all)
      .filter(([k,obj])=>isCacheEntry(k)&&entryValid(obj,now))
      .map(([k,obj])=>({key:k,when:obj.when}));
    const leftovers=Object.entries(all)
      .filter(([k,obj])=>isCacheEntry(k)&&!entryValid(obj,now))
      .map(([k])=>k);
    if(leftovers.length)await storage.remove(leftovers);
  }else{
    index=stored.filter(e=>e&&typeof e.key==='string'&&isCacheEntry(e.key)&&
      Number.isFinite(e.when)&&e.when<=now&&now-e.when<CACHE_TTL);
  }
  index=index.filter(e=>e.key!==key).sort((a,b)=>a.when-b.when);
  index.push({key,when:now});
  const count=Math.max(0,index.length-CACHE_MAX_ENTRIES);
  const expired=Array.isArray(stored)
    ? stored.filter(e=>e&&typeof e.key==='string'&&isCacheEntry(e.key)&&
       (!Number.isFinite(e.when)||e.when>now||now-e.when>=CACHE_TTL)).map(e=>e.key)
    : [];
  const obsolete=[...new Set([...expired,...index.slice(0,count).map(e=>e.key)])]
    .filter(k=>k!==key);
  index=index.slice(count);
  if(obsolete.length)await storage.remove(obsolete);
  await storage.set({[key]:{value,when:now},[CACHE_INDEX_KEY]:index});
}
export function saveTranslation(storage,payload,value){
  // Multiple active tabs can write simultaneously. Serialize metadata updates
  // so one tab does not silently lose the other's cache index.
  const next=lastWrite.catch(()=>{}).then(()=>persist(storage,payload,value));
  lastWrite=next.catch(()=>{});
  return next;
}
export async function clearTranslations(storage){
  await lastWrite;
  const all=await storage.get(null);
  const keys=Object.keys(all).filter(k=>isCacheEntry(k)||k===CACHE_INDEX_KEY);
  if(keys.length)await storage.remove(keys);
}
