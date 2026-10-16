/**
 * Readiness gate for the already existing localhost FastAPI Whisper bridge.
 * "ready" refers to PDF/BabelDOC and must NOT be used for ASR readiness.
 * The actual audio remains local and user-triggered.
 */
const HEALTH_URL='http://127.0.0.1:8765/health';
const BACKENDS=new Set(['cli','faster','server']);
export async function checkWhisperReady(token,fetchFn=fetch){
  if(typeof token!=='string'||token.length<16||token.length>512)
    throw Error('请输入有效的本机 Whisper 访问令牌（16–512 字符）');
  let response;
  try{
    response=await fetchFn(HEALTH_URL,{
      method:'GET',headers:{'X-PIT-Token':token},
      signal:AbortSignal.timeout(6000),cache:'no-store'
    });
  }catch{
    throw Error('无法连接本机 Whisper 服务 127.0.0.1:8765；请启动 Python bridge 并检查防火墙');
  }
  if(response.status===401||response.status===403)
    throw Error('本机 Whisper 令牌未通过验证');
  if(!response.ok)throw Error('本机 Whisper 健康检查失败（HTTP '+response.status+'）');
  let data;
  try{data=await response.json();}
  catch{throw Error('本机 Whisper 服务返回的健康信息不是 JSON');}
  if(!data || typeof data!=='object' || data.engine!=='local-only' ||
     !BACKENDS.has(data.speech_asr_backend) ||
     typeof data.speech_asr!=='boolean')
    throw Error('本机 Whisper 服务响应不符合预期，请核对 bridge 版本');
  if(!data.speech_asr)
    throw Error('本机 '+data.speech_asr_backend+' Whisper 模型或引擎尚未准备好');
  return {
    speech_asr:true,backend:data.speech_asr_backend,
    model_loaded:data.speech_asr_model_loaded===true,
    message:'Whisper '+data.speech_asr_backend+' 已就绪'+
      (data.speech_asr_model_loaded===true?'（模型已加载）':'（识别时加载模型）')
  };
}