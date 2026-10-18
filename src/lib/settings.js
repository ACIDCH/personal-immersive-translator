export const SETTINGS_KEY = 'pit_settings_v1';
export const DEFAULT_SETTINGS = Object.freeze({
  target: 'zh',
  source: 'auto',
  standardProvider: 'browser',
  cloudEndpoint: '',
  cloudToken: '',
  cloudPdfEndpoint: '',
  cloudPdfToken: '',
  aiProvider: 'gemini',
  autoAI: false,
  contextAI: true,
  microsoftKey: '',
  microsoftRegion: '',
  googleKey: '',
  deeplKey: '',
  deeplPlan: 'free',
  libreUrl: '',
  libreKey: '',
  geminiKey: '',
  geminiModel: 'gemini-2.5-flash',
  deepseekKey: '',
  deepseekModel: 'deepseek-chat',
  aiProfiles: [],
  activeAIProfileId: '',
  glossary: '',
  blockedHosts: '',
  webDisplay: 'bilingual',
  webScope: 'smart',
  hoverTranslate: false,
  floatingControl: false,
  inputTranslate: false,
  inputTarget: 'en',
  autoTranslateHosts: '',
  translationTheme: 'subtle'
});
export const STANDARD_PROVIDERS = ['browser', 'mymemory', 'cloud', 'microsoft', 'google', 'deepl', 'libre'];
export const AI_PROVIDERS = ['gemini', 'deepseek', 'custom'];
export const LANGUAGES = ['zh', 'en', 'fr', 'ja', 'ko', 'de', 'es'];

export function normalizeSettings(value = {}) {
  // Storage can contain null or malformed preferences after an interrupted
  // browser upgrade. Never let one bad settings object disable translation.
  if(!value || typeof value!=='object' || Array.isArray(value))value={};
  const clean = {...DEFAULT_SETTINGS};
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    if (Object.hasOwn(value, key)) clean[key] = value[key];
  }
  if (!LANGUAGES.includes(clean.target)) clean.target = 'zh';
  if (!['auto', ...LANGUAGES].includes(clean.source)) clean.source = 'auto';
  if (!STANDARD_PROVIDERS.includes(clean.standardProvider)) clean.standardProvider = 'browser';
  if (!AI_PROVIDERS.includes(clean.aiProvider)) clean.aiProvider = 'gemini';
  clean.aiProfiles = Array.isArray(clean.aiProfiles) ? clean.aiProfiles.slice(0,20) : [];
  clean.activeAIProfileId = typeof clean.activeAIProfileId==='string' ? clean.activeAIProfileId : '';
  if (!['bilingual','translation-only'].includes(clean.webDisplay)) clean.webDisplay='bilingual';
  if (!['smart','full'].includes(clean.webScope)) clean.webScope='smart';
  if (!['subtle','underline','highlight'].includes(clean.translationTheme)) clean.translationTheme='subtle';
  if (!LANGUAGES.includes(clean.inputTarget)) clean.inputTarget='en';
  clean.hoverTranslate=Boolean(clean.hoverTranslate);
  clean.floatingControl=Boolean(clean.floatingControl);
  clean.inputTranslate=Boolean(clean.inputTranslate);
  clean.autoTranslateHosts=typeof clean.autoTranslateHosts==='string'?clean.autoTranslateHosts.slice(0,4000):'';
  clean.autoAI = false;
  clean.contextAI = Boolean(clean.contextAI);
  return clean;
}
export function hostIsBlocked(hostname, blockedHosts = '') {
  const host = String(hostname ?? '').toLowerCase();
  return String(blockedHosts).split(/[\s,;]+/).filter(Boolean).some(raw => {
    const rule = raw.toLowerCase().replace(/^\*\./, '');
    return host === rule || host.endsWith('.' + rule);
  });
}

/** Portable settings contain no API credentials, private service URLs,
 * provider profiles, cache entries or conversation/translation history.
 * Import only enumerated preferences and require a normal Save action.
 */
export const PORTABLE_PREF_KEYS=Object.freeze([
 'target','source','standardProvider','aiProvider','contextAI',
 'webDisplay','webScope','translationTheme','hoverTranslate','inputTranslate',
 'floatingControl','inputTarget','autoTranslateHosts','blockedHosts','glossary'
]);
export function portablePreferences(value={}){
 const settings=normalizeSettings(value);
 return {kind:'pit-preferences',version:1,
  settings:Object.fromEntries(PORTABLE_PREF_KEYS.map(key=>[key,settings[key]]))};
}
export function applyPortablePreferences(current,data){
 if(!data||typeof data!=='object'||Array.isArray(data)||
    data.kind!=='pit-preferences'||data.version!==1||
    !data.settings||typeof data.settings!=='object'||
    Array.isArray(data.settings))throw Error('不是受支持的 PIT 偏好设置备份');
 const imported={};
 for(const key of PORTABLE_PREF_KEYS){
  if(Object.hasOwn(data.settings,key))imported[key]=data.settings[key];
 }
 return normalizeSettings({...normalizeSettings(current),...imported});
}

/** Non-secret readiness, NOT a network/credit or accuracy guarantee. */
export function isStandardServiceConfigured(value){
 const s=normalizeSettings(value);
 switch(s.standardProvider){
 case 'browser':return true; // Free on-device Chrome API; pack readiness is checked at runtime.
 case 'mymemory':return true; // Owner explicitly opts in to public MT.
 case 'cloud':
  try{
   const u=new URL(s.cloudEndpoint);
   return u.protocol==='https:'&&!u.username&&!u.password&&
     String(s.cloudToken).length>=16;
  }catch{return false;}
 case 'microsoft':return Boolean(String(s.microsoftKey||'').trim());
 case 'google':return Boolean(String(s.googleKey||'').trim());
 case 'deepl':return Boolean(String(s.deeplKey||'').trim());
 case 'libre':
  try{return new URL(s.libreUrl).protocol==='https:';}
  catch{return false;}
 default:return false;
 }
}
