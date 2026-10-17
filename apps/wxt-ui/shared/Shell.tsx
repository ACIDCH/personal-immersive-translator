import {useState} from 'react';

type Status='设计中'|'已有实现'|'待真实验收';
const modules:{id:string;title:string;subtitle:string;status:Status}[]=[
  {id:'web',title:'网页翻译',subtitle:'分段双语 · 动态页面 · 完成率',status:'已有实现'},
  {id:'video',title:'视频与字幕',subtitle:'SRT/VTT · 时间轴 · 可选 ASR',status:'待真实验收'},
  {id:'document',title:'文档与 PDF',subtitle:'Office · OCR · BabelDOC 排版',status:'设计中'},
  {id:'image',title:'图片翻译',subtitle:'本机 OCR · 可选视觉模型',status:'待真实验收'},
  {id:'ai',title:'AI 服务中心',subtitle:'多配置档案 · 自定义模型与 Base URL',status:'已有实现'}
];

export function Shell({view}:{view:'popup'|'dashboard'}){
 const [active,setActive]=useState('web');
 const item=modules.find(x=>x.id===active)!;
 return <main className={view==='popup'?'shell popup':'shell dashboard'}>
  <header className="hero"><div className="brand-icon">译</div><div><div className="subtitle">MULTIMODAL TRANSLATE</div>
   <h1>多模态翻译</h1><p>统一控制台 · 模块化翻译能力</p></div></header>
  <div className="notice">前端设计预览：当前 WXT 构建不包含翻译引擎。请使用原生 PIT 分支进行功能测试。</div>
  <section className="main-grid">
   <nav aria-label="功能分区" className="module-list">{modules.map(m=><button
     type="button" key={m.id} className={active===m.id?'module selected':'module'}
     onClick={()=>setActive(m.id)} aria-pressed={active===m.id}>
     <span className="module-title">{m.title}</span><span className="module-sub">{m.subtitle}</span>
     </button>)}</nav>
   <section className="detail" aria-live="polite"><div className="detail-top"><h2>{item.title}</h2><span className="status">{item.status}</span></div>
    <p>{item.subtitle}</p>
    {active==='ai'?<><h3>接口类型</h3><p>OpenAI Chat Completions / Anthropic Messages / Gemini 原生协议。</p>
     <p>多个 AI 服务商和 API Key 的可用设置已经在原生设置页实现；下一步将迁入 React 控制台。</p></>:<p>模块将通过统一的 engine adapter 接入；未完成真实验证前不展示虚假“已可用”状态。</p>}
   </section>
  </section>
  <footer>Cloudflare Pages 控制台和浏览器弹窗复用这一设计系统 · 预览版</footer>
 </main>
}
