import {useState} from 'react';
import type {ReactNode} from 'react';

type Status='已接入'|'部分验收'|'需要本机服务';
const modules:{id:string;title:string;subtitle:string;status:Status}[]=[
  {id:'web',title:'网页翻译',subtitle:'分段双语 · 动态页面 · 原文恢复',status:'已接入'},
  {id:'video',title:'视频与字幕',subtitle:'原生字幕 · 可见字幕 · SRT/VTT · 本机 ASR',status:'部分验收'},
  {id:'document',title:'文档与 PDF',subtitle:'DOCX 导出 · PDF.js · 本机 BabelDOC',status:'需要本机服务'},
  {id:'image',title:'图片翻译',subtitle:'本机 OCR · 翻译 · 双语 PNG',status:'已接入'},
  {id:'ai',title:'AI 服务中心',subtitle:'多配置档案 · OpenAI 兼容 / Anthropic / Gemini',status:'已接入'}
];

export function Shell({view,webControls}:{view:'popup'|'dashboard',webControls?:ReactNode}){
 const [active,setActive]=useState('web');
 const item=modules.find(x=>x.id===active)!;
 if(webControls){
  return <main className="shell popup pit-reader-console">
    <header className="hero"><div className="brand-icon">译</div>
      <div><div className="subtitle">PIT · CORE PARITY BUILD</div>
        <h1>多模态翻译</h1><p>网页 · 视频 · 文件 · 设置</p>
      </div>
    </header>
    {webControls}
    <footer>功能对标测试版 · 未完成真实服务验收，不代表正式版</footer>
  </main>;
 }
 return <main className={view==='popup'?'shell popup':'shell dashboard'}>
  <header className="hero"><div className="brand-icon">译</div><div><div className="subtitle">MULTIMODAL TRANSLATE</div>
   <h1>多模态翻译</h1><p>统一控制台 · 模块化翻译能力</p></div></header>
  <div className="notice">{webControls?'原生网页、视频字幕、DOCX、图片 OCR 和 PDF 预览已接入测试版；高保真 PDF 与实时 ASR 需要额外本机服务。':'这是独立的网页预览，支持本地 DOCX/OCR 实验；在线翻译与插件设置需通过 Chrome 扩展使用。'}</div>
  <section className="main-grid">
   <nav aria-label="功能分区" className="module-list">{modules.map(m=><button
     type="button" key={m.id} className={active===m.id?'module selected':'module'}
     onClick={()=>setActive(m.id)} aria-pressed={active===m.id}>
     <span className="module-title">{m.title}</span><span className="module-sub">{m.subtitle}</span>
     </button>)}</nav>
   <section className="detail" aria-live="polite"><div className="detail-top"><h2>{item.title}</h2><span className="status">{item.status}</span></div>
    <p>{item.subtitle}</p>
    {webControls?<><p>下方提供当前扩展的实际功能操作。网页与字幕测试覆盖部分公开网站及本地样本；实际网站仍可能存在兼容性限制。</p>{webControls}</>
       :active==='ai'?<><h3>接口类型</h3><p>OpenAI Chat Completions / Anthropic Messages / Gemini 原生协议；API Key 仅在插件扩展设置中配置。</p></>
       :<p>此网站仅展示前端与本地文档实验；浏览器标签页翻译需要安装 Chrome/Edge 插件。</p>}
   </section>
  </section>
  <footer>多模态翻译 · WXT 浏览器扩展与 Cloudflare Pages 预览共用设计系统</footer>
 </main>
}
