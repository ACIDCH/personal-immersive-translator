import test from 'node:test';
import assert from 'node:assert/strict';
import {cachedTranslation, saveTranslation, clearTranslations, cachePayloadKey, CACHE_PREFIX} from '../src/lib/cache.js';
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
