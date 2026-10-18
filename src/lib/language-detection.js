/**
 * Real browser-language detection for standard cloud translation.
 * Uses Chrome's CLD detector through chrome.i18n.detectLanguage (extension API).
 * Short or mixed-language text may not be reliably identifiable; in that
 * case return "auto" to let a configured translation provider decide.
 * Never invent high confidence from stopwords or transliterated proper nouns.
 */
const SUPPORTED=new Set(['en','zh','ja','ko','fr','de','es']);
const ALIASES=new Map([
 ['zh-cn','zh'],['zh-tw','zh'],['zh-hans','zh'],['zh-hant','zh'],
 ['ja-jp','ja'],['ko-kr','ko'],['en-us','en'],['en-gb','en'],
 ['fr-fr','fr'],['de-de','de'],['es-es','es']
]);
export function normalizeDetectedLanguage(value){
 const original=String(value||'').toLowerCase().trim().replace(/_/g,'-');
 const lang=ALIASES.get(original)||original.split('-')[0];
 return SUPPORTED.has(lang)?lang:null;
}
export function chooseDetectedLanguage(result,sourceText){
 const source=String(sourceText||'').trim();
 if(source.length<18||!result?.isReliable||!Array.isArray(result.languages))
   return {language:'auto',confidence:'unreliable'};
 const ordered=[...result.languages].sort((a,b)=>
   (Number(b.percentage)||0)-(Number(a.percentage)||0));
 const first=ordered[0],second=ordered[1];
 const language=normalizeDetectedLanguage(first?.language);
 const confidence=Number(first?.percentage)||0;
 const runnerUp=Number(second?.percentage)||0;
 if(!language||confidence<65||confidence-runnerUp<20)
   return {language:'auto',confidence:'ambiguous'};
 return {language,confidence:'chrome-cld'};
}
export async function detectLanguages(texts,detector=globalThis.chrome?.i18n?.detectLanguage?.bind(globalThis.chrome.i18n)){
 if(!Array.isArray(texts))throw Error('Invalid language-detection input');
 if(typeof detector!=='function')
   return texts.map(()=>({language:'auto',confidence:'not-available'}));
 return Promise.all(texts.map(async(text)=>{
   const source=String(text||'');
   try{
     const result=await detector(source.slice(0,1200));
     return chooseDetectedLanguage(result,source);
   }catch{
     return {language:'auto',confidence:'failed'};
   }
 }));
}
