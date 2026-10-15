// Small local-only PCM/WAV encoder for authorized tab audio clips.
export function encodeMonoPcm16(chunks,sampleRate=16000) {
  const total=chunks.reduce((sum,c)=>sum+c.length,0);
  if(!Number.isInteger(total)||total<1||total>sampleRate*12)throw Error('音频片段长度无效');
  const buffer=new ArrayBuffer(44+total*2),view=new DataView(buffer);
  const tag=(i,t)=>{for(let j=0;j<t.length;j++)view.setUint8(i+j,t.charCodeAt(j));};
  tag(0,'RIFF');view.setUint32(4,36+total*2,true);tag(8,'WAVE');tag(12,'fmt ');
  view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);
  view.setUint32(24,sampleRate,true);view.setUint32(28,sampleRate*2,true);
  view.setUint16(32,2,true);view.setUint16(34,16,true);tag(36,'data');view.setUint32(40,total*2,true);
  let index=44;
  for(const chunk of chunks){for(const v of chunk){const x=Math.max(-1,Math.min(1,v));view.setInt16(index,x<0?Math.round(x*32768):Math.round(x*32767),true);index+=2;}}
  return new Blob([buffer],{type:'audio/wav'});
}
export function averageEnergy(chunks) {
  let sum=0,count=0;
  for(const chunk of chunks){for(const value of chunk){sum+=value*value;count++;}}
  return count?Math.sqrt(sum/count):0;
}
