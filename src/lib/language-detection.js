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

/**
 * Supplement unreliable short-heading detection with CLD over a *batch*.
 * Only propagate a document-level signal when individually detected passages
 * do not disagree; mixed-language paragraphs keep their own CLD languages.
 */
export async function detectLanguagesWithContext(texts,detector=globalThis.chrome?.i18n?.detectLanguage?.bind(globalThis.chrome.i18n)){
 const individual=await detectLanguages(texts,detector);
 if(typeof detector!=='function'||individual.every(x=>x.language!=='auto')||
    texts.length<2)return individual;
 const combined=texts.filter(x=>typeof x==='string'&&x.trim()).join(' ').slice(0,3000);
 if(combined.length<35)return individual;
 let group;
 try{group=chooseDetectedLanguage(await detector(combined),combined);}
 catch{return individual;}
 if(group.language==='auto')return individual;
 const known=new Set(individual.filter(x=>x.language!=='auto').map(x=>x.language));
 // Do not project one language across genuinely mixed German/French documents.
 if(known.size>1 || (known.size===1 && !known.has(group.language)))
  return individual;
 return individual.map((result,index)=>{
  if(result.language!=='auto')return result;
  const sample=texts[index];
  // Keep evidence of non-Latin scripts explicit; don't mistake standalone
  // Chinese/Korean/Japanese snippets for Latin page-level labels.
  if(/[\u3040-\u30ff\uac00-\ud7af\u3400-\u9fff]/u.test(sample))
    return result;
  return {language:group.language,confidence:'group-cld'};
 });
}


/**
 * Only captions belonging to the currently active video are evidence for
 * subtitle language. A page's UI language is not a reliable hint for a
 * lecture or film. This CLD sample stays local to the extension: it is never
 * included in remote translator payloads, logs, or persistent settings.
 */
export async function detectCaptionSampleLanguage(sample,detector=globalThis.chrome?.i18n?.detectLanguage?.bind(globalThis.chrome.i18n)){
 const text=typeof sample==='string'?sample.trim().slice(0,1200):'';
 if(text.length<35)return null;
 const detected=await detectLanguages([text],detector);
 return detected[0]?.language!=='auto'?detected[0]?.language||null:null;
}
