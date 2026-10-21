/**
 * Normalize results emitted by Whisper/faster-whisper-compatible gateways.
 * The gateway remains an independently deployed ASR service; this adapter
 * does not bundle Whisper's CPU/GPU inference model into a Chrome extension.
 */
const LANGS=new Set(['en','zh','fr','de','es','ja','ko']);
export function normalizeAsrResult(input,{maxChars=5000}={}){
 if(!input||typeof input!=='object')throw Error('ASR 返回结构无效');
 const limit=Math.max(1,Math.min(5000,Math.floor(maxChars)));
 let text=typeof input.text==='string'?input.text.trim():'';
 if(!text&&Array.isArray(input.segments)){
  // Faster-whisper gateways can expose timed segments instead of a single
  // text field. Only join user-authorized recognized speech, not debug data
  // or untrusted arbitrary metadata from the gateway.
  const segments=input.segments.slice(0,100)
    .filter(item=>item&&typeof item.text==='string'&&
      (item.start===undefined||Number.isFinite(item.start))&&
      (item.end===undefined||Number.isFinite(item.end))&&
      (item.start===undefined||item.end===undefined||item.end>=item.start));
  text=segments.map(item=>item.text.trim()).filter(Boolean).join(' ');
 }
 const rawLang=input.language||input.info?.language||'';
 const lang=String(rawLang).toLowerCase().replace(/_/g,'-').split('-')[0];
 const rawConfidence=input.languageConfidence??input.info?.language_probability;
 const confidence=rawConfidence===undefined?null:Number(rawConfidence);
 const trusted=LANGS.has(lang)&&(
  confidence===null||(Number.isFinite(confidence)&&confidence>=.65&&confidence<=1)
 );
 return {text:text.replace(/\s+/g,' ').slice(0,limit),
  language:trusted?lang:null,
  languageConfidence:trusted&&confidence!==null?confidence:null};
}
