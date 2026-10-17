/** Portable PIT reading preferences. Explicit whitelist: no provider API
 * keys, client tokens, private AI profiles, or cached translated documents.
 */
import {normalizeSettings} from './settings.js';
const KEYS=[
 'target','source','webDisplay','webScope','translationTheme',
 'hoverTranslate','inputTranslate','inputTarget','autoTranslateHosts',
 'blockedHosts','contextAI','glossary'
];
export function createPreferenceBackup(raw){
 const settings=normalizeSettings(raw);
 const preferences=Object.fromEntries(KEYS.map(key=>[key,settings[key]]));
 return {product:'PIT',schema:1,preferences};
}
export function importPreferenceBackup(payload,original){
 if(!payload||payload.product!=='PIT'||payload.schema!==1||
    !payload.preferences||typeof payload.preferences!=='object'||
    Array.isArray(payload.preferences))throw Error('文件不是有效的 PIT 阅读设置备份');
 const safe={...normalizeSettings(original)};
 for(const key of KEYS){
  if(Object.hasOwn(payload.preferences,key)){
   const value=payload.preferences[key];
   if(typeof value!=='string'&&typeof value!=='boolean')
     throw Error('设置数据格式不正确：'+key);
   safe[key]=value;
  }
 }
 return normalizeSettings(safe);
}
export const PREFERENCE_BACKUP_KEYS=Object.freeze([...KEYS]);
