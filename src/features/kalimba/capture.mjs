// Capture sessions: raw microphone audio plus what the player was asked to
// pluck, so recognition can be replayed offline against real recordings.
// Shared by the app (recording) and scripts/kalimba/replay.mjs (scoring).

export const CAPTURE_FORMAT='kalimba-capture-v1';
export const CUE_MS=1000;          // one cue per second
export const CAPTURE_LIMIT_S=180;  // never keep more than three minutes of audio

// Every key up and down, then each pair of pitch neighbours back and forth,
// because neighbours in pitch are the likeliest confusions.
export function captureScript(keys){
  const ids=keys.map(key=>key.id).sort((a,b)=>a-b);
  const byPitch=[...keys].filter(key=>key.frequency>0).sort((a,b)=>a.frequency-b.frequency).map(key=>key.id);
  const pairs=byPitch.slice(1).flatMap((id,index)=>[byPitch[index],id,byPitch[index],id]);
  return [...ids,...[...ids].reverse(),...pairs];
}

export function encodeWav(samples,rate){
  const buffer=new ArrayBuffer(44+samples.length*2),view=new DataView(buffer);
  const text=(at,value)=>{for(let i=0;i<value.length;i++)view.setUint8(at+i,value.charCodeAt(i));};
  text(0,'RIFF');view.setUint32(4,36+samples.length*2,true);text(8,'WAVE');text(12,'fmt ');
  view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,rate,true);
  view.setUint32(28,rate*2,true);view.setUint16(32,2,true);view.setUint16(34,16,true);text(36,'data');view.setUint32(40,samples.length*2,true);
  for(let i=0;i<samples.length;i++)view.setInt16(44+i*2,Math.round(Math.max(-1,Math.min(1,samples[i]))*32767),true);
  return buffer;
}

// Reads 16-bit PCM WAV files (what encodeWav and the key samples produce).
export function decodeWav(buffer){
  const view=new DataView(buffer instanceof ArrayBuffer?buffer:buffer.buffer.slice(buffer.byteOffset,buffer.byteOffset+buffer.byteLength));
  const tag=at=>String.fromCharCode(...Array.from({length:4},(_,i)=>view.getUint8(at+i)));
  if(tag(0)!=='RIFF'||tag(8)!=='WAVE')throw new Error('Not a WAV file.');
  let offset=12,rate=0,channels=1,bits=16;
  while(offset+8<=view.byteLength){
    const id=tag(offset),size=view.getUint32(offset+4,true),body=offset+8;
    if(id==='fmt '){channels=view.getUint16(body+2,true);rate=view.getUint32(body+4,true);bits=view.getUint16(body+14,true);}
    if(id==='data'){
      if(bits!==16)throw new Error('Only 16-bit WAV is supported.');
      const frames=Math.floor(Math.min(size,view.byteLength-body)/(2*channels)),samples=new Float32Array(frames);
      for(let i=0;i<frames;i++)samples[i]=view.getInt16(body+i*2*channels,true)/32768;
      return {samples,rate};
    }
    offset=body+size+(size%2);
  }
  throw new Error('The WAV file has no audio data.');
}

// Match each cue to the first unused detection from shortly before the cue
// (an eager pluck) to most of the way to the next cue (a late one).
export function scoreCapture(cues,detections,{early=150,late=900}={}){
  const used=new Set(),rows=[];
  for(const cue of cues){
    const index=detections.findIndex((hit,i)=>!used.has(i)&&hit.time>=cue.time-early&&hit.time<=cue.time+late);
    if(index>=0)used.add(index);
    const hit=detections[index];
    rows.push({cue:cue.key,time:cue.time,heard:hit?hit.keyId??null:null,confidence:hit?.confidence,result:!hit?'missed':hit.keyId===cue.key?'right':'wrong'});
  }
  const extras=detections.filter((_,i)=>!used.has(i));
  const count=result=>rows.filter(row=>row.result===result).length;
  return {rows,extras,right:count('right'),wrong:count('wrong'),missed:count('missed')};
}

export function confusionTable(rows,ids){
  const header=['cue\\heard',...ids.map(id=>`${id+1}`),'miss'];
  const lines=ids.map(cue=>[`key ${cue+1}`,...ids.map(heard=>rows.filter(row=>row.cue===cue&&row.heard===heard).length||'.'),rows.filter(row=>row.cue===cue&&row.result==='missed').length||'.']);
  return [header,...lines].map(cells=>cells.map(cell=>String(cell).padStart(5)).join('')).join('\n');
}
