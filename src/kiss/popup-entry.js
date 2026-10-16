// Bind an actual video tab before navigating away from the KISS popup.
// A page opened directly has no verified tabId and cannot initiate capture.
document.getElementById('pit-caption-control')?.addEventListener('click',async event=>{
  event.preventDefault();
  const link=event.currentTarget;
  try{
    const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
    if(!tab?.id||!/^https?:\/\//.test(tab.url||''))throw Error('请先打开普通视频网站页面');
    await chrome.tabs.create({url:chrome.runtime.getURL('pit/control.html?tabId='+tab.id)});
  }catch(e){link.textContent='请先打开视频网页：'+String(e.message||e);}
});