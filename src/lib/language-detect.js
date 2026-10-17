/** Conservative, deterministic language ID for providers without source=auto.
 * This is not a neural detector; ambiguous input is marked low confidence.
 * Always allow user override via options.source.
 */
const lexicons={
 en:['the','and','with','from','this','that','have','not','are','was','for','your','more','market','we'],
 fr:['bonjour','dans','avec','pour','vous','nous','suis','sont','une','des','les','est','pas','merci','marché'],
 de:['und','der','die','das','nicht','mit','sind','eine','werden','ist','ein','für','aus','markt'],
 es:['hola','gracias','una','los','las','con','para','este','esta','está','son','pero','mercado','por']
};
export function identifyLanguage(text){
 const value=String(text||'').slice(0,6000);
 const count=re=>(value.match(re)||[]).length;
 const jp=count(/[\u3040-\u30ff]/g),kr=count(/[\uac00-\ud7af]/g),
   cn=count(/[\u3400-\u9fff]/g);
 if(kr>=1&&kr>=jp)return {language:'ko',confidence:'script'};
 if(jp>=1)return {language:'ja',confidence:'script'};
 if(cn>=1)return {language:'zh',confidence:'script'};
 const tokens=Array.from(value.toLowerCase().matchAll(/[\p{L}]+/gu),x=>x[0]);
 const rank=Object.entries(lexicons).map(([language,words])=>({
  language,score:tokens.filter(token=>words.includes(token)).length
 })).sort((a,b)=>b.score-a.score);
 if(tokens.length>=3&&rank[0].score>=2&&rank[0].score>rank[1].score)
  return {language:rank[0].language,confidence:'heuristic'};
 return {language:'en',confidence:'latin-default-uncertain'};
}
