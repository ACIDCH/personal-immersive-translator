/** Dedicated tab Port, invisible to KISS's onMessage translation bus. */
export function sendToView(tabId,message,frameId=0){
 return new Promise((resolve,reject)=>{
   if(!Number.isInteger(tabId)||tabId<=0)return reject(Error('Invalid target tab'));
   let port;
   try{port=chrome.tabs.connect(tabId,{name:'pit-v046-view',frameId});}
   catch(e){return reject(e);}
   let settled=false;
   const finish=(value,error)=>{
     if(settled)return;settled=true;clearTimeout(timeout);
     try{port.disconnect();}catch{}
     if(error)reject(Error(error));else resolve(value);
   };
   const timeout=setTimeout(()=>finish(null,'PIT page listener timed out'),20000);
   port.onMessage.addListener(value=>finish(value));
   port.onDisconnect.addListener(()=>finish(null,
     chrome.runtime.lastError?.message||'Target page listener not available'));
   try{port.postMessage(message);}catch(e){finish(null,String(e.message||e));}
 });
}