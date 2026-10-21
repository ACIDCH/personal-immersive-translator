import {useState} from 'react';
import type {ReactNode} from 'react';

type Status='受控测试通过'|'仅受控验证'|'需要独立服务';
const modules:{id:string;title:string;subtitle:string;status:Status}[]=[
  {id:'web',title:'网页翻译',subtitle:'分段双语 · 动态页面 · 原文恢复',status:'受控测试通过'},
  {id:'video',title:'视频与字幕',subtitle:'原生字幕 · 可见字幕 · SRT/VTT · 可选 ASR',status:'仅受控验证'},
  {id:'document',title:'文档与 PDF',subtitle:'Office/EPUB · PDF.js · 可选云端 BabelDOC',status:'需要独立服务'},
  {id:'image',title:'图片翻译',subtitle:'Tesseract.js OCR · 翻译 · 双语 PNG',status:'受控测试通过'},
  {id:'ai',title:'AI 服务中心',subtitle:'自选凭据 · 逐项测试 · 不自动启用',status:'仅受控验证'}
];

export function Shell({view,webControls}:{view:'popup'|'dashboard',webControls?:ReactNode}){
 const [active,setActive]=useState('web');
 const item=modules.find(x=>x.id===active)!;
 if(webControls){
  return <main className="shell popup pit-reader-console">
    <header className="hero"><div className="brand-icon">译</div>
      <div><div className="subtitle">PERSONAL IMMERSIVE TRANSLATOR</div>
        <h1>PIT 翻译工作台</h1><p>网页 · 视频 · 文件</p>
      </div>
    </header>
    {webControls}
    <footer>PIT · Draft 测试版 · 服务可用性以实际诊断为准</footer>
  </main>;
 }
 return <main className={view==='popup'?'shell popup':'shell dashboard'}>
  <header className="hero"><div className="brand-icon">译</div><div><div className="subtitle">PERSONAL IMMERSIVE TRANSLATOR</div>
   <h1>PIT 翻译工作台</h1><p>演示入口 · 模块能力与真实可用性分开判断</p></div></header>
  <div className="notice">此处为独立预览页面，展示模块组织和有限的本地文件实验。真实网页及视频翻译、Provider 试译、账号与云端 PDF/ASR 均需在 Chrome 插件中核验；模块状态不是线上可用性承诺。</div>
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
  <footer>PIT · 开发预览 · 产品模块详情请以安装版真实诊断与验收记录为准</footer>
 </main>
}
