export const SECRET_KEYS=Object.freeze(['cloudEndpoint','cloudToken','cloudPdfEndpoint','cloudPdfToken','microsoftKey','microsoftRegion','googleKey','deeplKey','deeplPlan','libreUrl','libreKey','geminiKey','geminiModel','deepseekKey','deepseekModel','aiProfiles','activeAIProfileId','customExperts','installedExperts','activeExpertId']);
const encode=b=>btoa(String.fromCharCode(...new Uint8Array(b)));
const decode=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
const encoder=new TextEncoder();
export function secretPayload(s){return Object.fromEntries(SECRET_KEYS.filter(k=>Object.hasOwn(s,k)).map(k=>[k,s[k]]));}
export async function deriveVault(password,salt=encode(crypto.getRandomValues(new Uint8Array(16)))){
 if(typeof password!=='string'||password.length<12)throw Error('保险库密码至少 12 字符');
 const material=await crypto.subtle.importKey('raw',encoder.encode(password),'PBKDF2',false,['deriveKey']);
 const key=await crypto.subtle.deriveKey({name:'PBKDF2',salt:decode(salt),iterations:600000,hash:'SHA-256'},material,{name:'AES-GCM',length:256},true,['encrypt','decrypt']);
 return {key,salt};
}
export async function encryptVault(payload,key,salt,userId){
 const nonce=crypto.getRandomValues(new Uint8Array(12));
 const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv:nonce,additionalData:encoder.encode('pit-vault:1:'+userId)},key,encoder.encode(JSON.stringify(secretPayload(payload))));
 return {vault_version:1,kdf:{name:'PBKDF2',hash:'SHA-256',iterations:600000},salt,nonce:encode(nonce),ciphertext:encode(ciphertext)};
}
export async function decryptVault(envelope,key,userId){
 if(envelope?.vault_version!==1||envelope?.kdf?.name!=='PBKDF2'||envelope.kdf.iterations!==600000||envelope.kdf.hash!=='SHA-256')throw Error('不支持的保险库版本 / KDF');
 try{const raw=await crypto.subtle.decrypt({name:'AES-GCM',iv:decode(envelope.nonce),additionalData:encoder.encode('pit-vault:1:'+userId)},key,decode(envelope.ciphertext));return secretPayload(JSON.parse(new TextDecoder().decode(raw)));}
 catch{throw Error('密码不正确或密文损坏；未修改本机密钥。');}
}
export async function exportSessionKey(key){return encode(await crypto.subtle.exportKey('raw',key));}
export async function importSessionKey(raw){return crypto.subtle.importKey('raw',decode(raw),{name:'AES-GCM'},false,['encrypt','decrypt']);}
