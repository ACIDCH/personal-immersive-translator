/* Namespace-separated runtime Port client for PIT's KISS-based sidecar.
 * This intentionally never calls sendMessage, handled by KISS upstream.
 */
(function(root){
 if(root.PITSidecar)return;
 const handlers=[];
 chrome.runtime.onConnect.addListener(port=>{
   if(port.name!=='pit-v046-view')return;
   port.onMessage.addListener(msg=>{
     let answered=false,asynchronous=false;
     const reply=result=>{
       if(answered)return;answered=true;
       try{port.postMessage(result);}catch{}
     };
     for(const callback of handlers){
       try{if(callback(msg,port.sender,reply)===true)asynchronous=true;}
       catch(e){reply({ok:false,error:String(e.message||e)});}
     }
     if(!answered&&!asynchronous)reply({ok:true,ignored:true});
   });
 });
 function send(message){
   return new Promise((resolve,reject)=>{
     const port=chrome.runtime.connect({name:'pit-v046'});
     let settled=false;
     const finish=(result,error)=>{
       if(settled)return;settled=true;clearTimeout(timer);
       try{port.disconnect();}catch{}
       if(error)reject(Error(error));else resolve(result);
     };
     const timer=setTimeout(()=>finish(null,'PIT controller timed out'),65000);
     port.onMessage.addListener(data=>finish(data));
     port.onDisconnect.addListener(()=>finish(null,chrome.runtime.lastError?.message||'PIT controller disconnected'));
     try{port.postMessage(message);}catch(e){finish(null,String(e.message||e));}
   });
 }
 root.PITSidecar=Object.freeze({send,onViewMessage:{addListener(fn){handlers.push(fn);}}});
})(globalThis);