export const CACHE_PREFIX = 'pit_cache_';
export const CACHE_TTL = 30 * 24 * 60 * 60 * 1000;
export function cachePayloadKey({text, provider, target, source, model, glossary, context}) {
  return JSON.stringify([text,provider,target,source||'auto',model||'',glossary||'',context||'']);
}
export async function sha256(value) {
  const binary = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', binary);
  return [...new Uint8Array(digest)].map(n => n.toString(16).padStart(2,'0')).join('');
}
export async function cachedTranslation(storage, payload) {
  const key = CACHE_PREFIX + await sha256(cachePayloadKey(payload));
  const obj = (await storage.get(key))[key];
  return obj && typeof obj.value === 'string' && Date.now() - obj.when < CACHE_TTL ? obj.value : null;
}
export async function saveTranslation(storage, payload, value) {
  const key = CACHE_PREFIX + await sha256(cachePayloadKey(payload));
  await storage.set({[key]: {value, when: Date.now()}});
}
export async function clearTranslations(storage) {
  const all = await storage.get(null);
  await storage.remove(Object.keys(all).filter(x => x.startsWith(CACHE_PREFIX)));
}