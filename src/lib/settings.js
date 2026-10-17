export const SETTINGS_KEY = 'pit_settings_v1';
export const DEFAULT_SETTINGS = Object.freeze({
  target: 'zh',
  source: 'auto',
  standardProvider: 'cloud',
  cloudEndpoint: '',
  cloudToken: '',
  cloudPdfEndpoint: '',
  cloudPdfToken: '',
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
  blockedHosts: ''
});
export const STANDARD_PROVIDERS = ['cloud', 'microsoft', 'google', 'deepl', 'libre'];
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
  if (!STANDARD_PROVIDERS.includes(clean.standardProvider)) clean.standardProvider = 'cloud';
  if (!AI_PROVIDERS.includes(clean.aiProvider)) clean.aiProvider = 'gemini';
  clean.aiProfiles = Array.isArray(clean.aiProfiles) ? clean.aiProfiles.slice(0,20) : [];
  clean.activeAIProfileId = typeof clean.activeAIProfileId==='string' ? clean.activeAIProfileId : '';
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