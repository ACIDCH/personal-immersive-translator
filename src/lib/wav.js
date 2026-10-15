// Local-only PCM16 encoding and explicit 16kHz speech resampling.
// AudioContext.sampleRate is hardware/browser dependent; Whisper requires 16kHz.
export const ASR_SAMPLE_RATE=16000;
export function resampleChunks(chunks,inputRate,outputRate=ASR_SAMPLE_RATE) {
  if(!Number.isFinite(inputRate) || inputRate<8000 || inputRate>192000 ||
     !Number.isFinite(outputRate) || outputRate<8000 || outputRate>192000) {
    throw new Error('音频采样率无效');
  }
  if(!Array.isArray(chunks) || !chunks.length) throw new Error('没有音频片段');
  let count=0;
  for(const chunk of chunks) {
    if(!(chunk instanceof Float32Array))throw new Error('音频必须为 Float32 PCM');
    count+=chunk.length;
  }
  if(count<1 || count>inputRate*12)throw new Error('音频片段超过 12 秒限制');
  const input=new Float32Array(count);
  let offset=0;
  for(const chunk of chunks){input.set(chunk,offset);offset+=chunk.length;}
  if(inputRate===outputRate)return [input];
  // Continuous linear interpolation across input chunk boundaries prevents
  // sample skips and pitch errors caused by simply changing WAV headers.
  const outLength=Math.max(1,Math.round(count*outputRate/inputRate));
  const output=new Float32Array(outLength);
  const ratio=inputRate/outputRate;
  for(let i=0;i<outLength;i++){
    const position=Math.min(count-1,i*ratio);
    const left=Math.floor(position),right=Math.min(count-1,left+1),f=position-left;
    output[i]=input[left]*(1-f)+input[right]*f;
  }
  return [output];
}
export function encodeMonoPcm16(chunks,sampleRate=ASR_SAMPLE_RATE) {
  if(!Number.isInteger(sampleRate) || sampleRate<8000 || sampleRate>192000)throw Error('无效 WAV 采样率');
  const total=chunks.reduce((sum,c)=>sum+c.length,0);
  if(!Number.isInteger(total)||total<1||total>sampleRate*12)throw Error('音频片段长度无效');
  const buffer=new ArrayBuffer(44+total*2),view=new DataView(buffer);
  const tag=(i,t)=>{for(let j=0;j<t.length;j++)view.setUint8(i+j,t.charCodeAt(j));};
  tag(0,'RIFF');view.setUint32(4,36+total*2,true);tag(8,'WAVE');tag(12,'fmt ');
  view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);
  view.setUint32(24,sampleRate,true);view.setUint32(28,sampleRate*2,true);
  view.setUint16(32,2,true);view.setUint16(34,16,true);tag(36,'data');view.setUint32(40,total*2,true);
  let index=44;
  for(const chunk of chunks){for(const v of chunk){
    const x=Number.isFinite(v)?Math.max(-1,Math.min(1,v)):0;
    view.setInt16(index,x<0?Math.round(x*32768):Math.round(x*32767),true);index+=2;
  }}
  return new Blob([buffer],{type:'audio/wav'});
}
export function averageEnergy(chunks) {
  let sum=0,count=0;
  for(const chunk of chunks){for(const value of chunk){if(Number.isFinite(value)){sum+=value*value;count++;}}}
  return count?Math.sqrt(sum/count):0;
}
