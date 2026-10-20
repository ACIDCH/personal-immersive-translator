import React,{useEffect,useState} from 'react';
import {browser} from '#imports';
import {createRoot} from 'react-dom/client';
import {DocumentLab} from '../../../shared-ui/DocumentLab';
import {BatchFileLab} from '../../../shared-ui/BatchFileLab';
import {SubtitleFileLab} from '../../../shared-ui/SubtitleFileLab';
import {PdfBilingualLab} from '../../../shared-ui/PdfBilingualLab';
import '../../../shared-ui/design.css';
import '../../../shared-ui/document-lab.css';

// One extension-owned workbench, one native background Provider runtime.
// Tabs are scrollable anchors, not separately hosted legacy tools.
function FileWorkbench(){
 const [engine,setEngine]=useState('正在检查当前配置…');
 useEffect(()=>{
   let active=true;
   void browser.runtime.sendMessage({type:'GET_SETTINGS'}).then((reply:{settings?:any})=>{
     if(!active)return;
     const s=reply?.settings;
     if(!s){setEngine('设置读取失败；文件不会自动调用任何云端服务');return;}
     const id=s.fileProviderId&&s.fileProviderId!=='inherit'?s.fileProviderId:s.standardProvider;
     const names:Record<string,string>={browser:'Chrome 原生模型',mymemory:'MyMemory 在线免 Key',cloud:'PIT 自托管云端',microsoft:'Microsoft Translator',google:'Google Cloud Translation',deepl:'DeepL',libre:'LibreTranslate'};
     setEngine('文件翻译服务：'+(names[id]||id)+' · 实际可用性以独立诊断为准');
   }).catch(()=>{if(active)setEngine('连接插件翻译服务失败；请检查扩展后台状态');});
   return()=>{active=false;};
 },[]);
 return <main className="pit-file-workbench">
   <header className="pit-workbench-header">
     <div className="pit-workbench-brand"><span aria-hidden="true">译</span>
       <div><small>PERSONAL IMMERSIVE TRANSLATOR</small>
         <h1>PIT 文件与图片翻译</h1>
         <p>统一工作台 · 原有 DOCX / PDF.js / OCR / BabelDOC 引擎</p>
       </div>
     </div>
     <div className="pit-workbench-actions">
       <a href="/pit-options.html#services">翻译服务及测试</a>
       <a href="/pit-options.html#files">文件引擎设置</a>
       <a href="/pit-options.html#sync">账号与同步</a>
     </div>
   </header>
   <nav aria-label="文件翻译功能" className="pit-workbench-nav">
     <a href="#document-lab">文档 · 图片 OCR</a>
     <a href="#batch-file-lab">多文件批量</a>
     <a href="#subtitle-file-lab">SRT / VTT / ASS 字幕</a>
     <a href="#pdf-bilingual-lab">双语 PDF · BabelDOC</a>
   </nav>
   <p className="pit-workbench-engine" role="status">{engine}。所有模块共享当前 PIT 扩展设置，不会调用旧版独立翻译平台。</p>
   <div id="document-lab" className="pit-workbench-module"><DocumentLab/></div>
   <div id="batch-file-lab" className="pit-workbench-module"><BatchFileLab/></div>
   <div id="subtitle-file-lab" className="pit-workbench-module"><SubtitleFileLab/></div>
   <div id="pdf-bilingual-lab" className="pit-workbench-module"><PdfBilingualLab/></div>
   <footer>高保真 BabelDOC / Whisper 需要真实就绪的独立服务。普通图片覆盖不等于语义补绘；所有文件处理结果必须由用户审查。</footer>
 </main>;
}
createRoot(document.getElementById('root')!).render(
 <React.StrictMode><FileWorkbench/></React.StrictMode>
);
