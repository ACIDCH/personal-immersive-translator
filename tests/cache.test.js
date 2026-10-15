import test from 'node:test';
import assert from 'node:assert/strict';
import {cachedTranslation, saveTranslation, clearTranslations, cachePayloadKey, CACHE_PREFIX, CACHE_INDEX_KEY, CACHE_MAX_ENTRIES} from '../src/lib/cache.js';
function memoryStore() {
  const items={};
  return {
    async get(key){if(key===null)return {...items}; return Object.hasOwn(items,key)?{[key]:items[key]}:{};},
    async set(obj){Object.assign(items,obj);},
    async remove(keys){for(const key of keys)delete items[key];},
    entries:items
  };
}
test('Cache returns cached translation for same model, target and input',async()=>{
  const s=memoryStore();const p={text:'Hello',target:'zh',source:'en',provider:'microsoft'};
  assert.equal(await cachedTranslation(s,p),null);
  await saveTranslation(s,p,'你好');
  assert.equal(await cachedTranslation(s,p),'你好');
  assert.equal(await cachedTranslation(s,{...p,target:'fr'}),null);
});
test('Cache includes AI context and glossary in cache identity',()=>{
  const p={text:'Bond',target:'zh',provider:'gemini'};
  assert.notEqual(cachePayloadKey({...p,context:'finance'}),cachePayloadKey({...p,context:'chemistry'}));
  assert.notEqual(cachePayloadKey({...p,glossary:'bond=债券'}),cachePayloadKey({...p,glossary:'bond=键'}));
});
test('Clear cache does not erase extension provider keys',async()=>{
  const s=memoryStore();await s.set({pit_settings_v1:{geminiKey:'private'}});
  await saveTranslation(s,{text:'x',target:'zh',provider:'microsoft'},'y');
  assert.ok(Object.keys(s.entries).some(x=>x.startsWith(CACHE_PREFIX)));
  await clearTranslations(s);
  assert.deepEqual(s.entries,{pit_settings_v1:{geminiKey:'private'}});
});

test('Cache never grows beyond 300 entries after long browsing',async()=>{
 const storage=memoryStore();
 const p={provider:'microsoft',source:'en',target:'zh'};
 for(let i=0;i<CACHE_MAX_ENTRIES+45;i++){
   await saveTranslation(storage,{...p,text:'course paragraph '+i},'translated '+i);
 }
 const keys=Object.keys(storage.entries).filter(k=>k.startsWith(CACHE_PREFIX)&&k!==CACHE_INDEX_KEY);
 assert.equal(keys.length,CACHE_MAX_ENTRIES);
 assert.equal((storage.entries[CACHE_INDEX_KEY]||[]).length,CACHE_MAX_ENTRIES);
 assert.equal(await cachedTranslation(storage,{...p,text:'course paragraph 0'}),null);
 assert.equal(await cachedTranslation(storage,{...p,text:'course paragraph 344'}),'translated 344');
});
test('Concurrent cache writes retain their full bounded index',async()=>{
 const s=memoryStore();
 const p={provider:'microsoft',target:'zh'};
 await Promise.all(Array.from({length:20},(_,i)=>saveTranslation(s,{...p,text:'parallel '+i},'value '+i)));
 assert.equal(s.entries[CACHE_INDEX_KEY].length,20);
 assert.equal(Object.keys(s.entries).filter(k=>k.startsWith(CACHE_PREFIX)&&k!==CACHE_INDEX_KEY).length,20);
});
test('Migrates old unbounded cache entries without leaving expired data',async()=>{
 const s=memoryStore();
 await s.set({
  [CACHE_PREFIX+'invalid']:{value:'secret',when:1},
  [CACHE_PREFIX+'valid']:{value:'ok',when:Date.now()-1000}
 });
 await saveTranslation(s,{text:'A',provider:'microsoft',target:'fr'},'B');
 assert.equal(Object.hasOwn(s.entries,CACHE_PREFIX+'invalid'),false);
 assert.equal(s.entries[CACHE_INDEX_KEY].length,2);
 await clearTranslations(s);
 assert.deepEqual(s.entries,{});
});
