// Replay a capture file through the current listening code and score it.
//   node scripts/kalimba/replay.mjs kalimba-capture-….json [--wav out.wav]
// Captures come from the app's hidden capture mode (see src/features/kalimba/README.md).
import {readFile,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {ListeningEngine} from '../../src/features/kalimba/analysis.mjs';
import {learnSignature,TemplatePlucks,validSignature} from '../../src/features/kalimba/signatures.mjs';
import {analyseCalibration,calibrationMatch} from '../../src/features/kalimba/calibration.mjs';
import {CAPTURE_FORMAT,confusionTable,decodeWav,encodeWav,scoreCapture} from '../../src/features/kalimba/capture.mjs';
import {centsBetween,noteName} from '../../src/features/kalimba/music.mjs';

const fromDataUrl=url=>{const bytes=Buffer.from(url.slice(url.indexOf(',')+1),'base64');return decodeWav(bytes);};
function resample(samples,from,to){
  if(from===to)return samples;
  const out=new Float32Array(Math.floor(samples.length*to/from));
  for(let i=0;i<out.length;i++){const x=i*from/to,j=Math.floor(x),f=x-j;out[i]=samples[j]*(1-f)+(samples[j+1]??samples[j])*f;}
  return out;
}
// Mirror KalimbaAudio.prepareKeys: learn each key's signature from its saved sample.
export function prepareKeys(keys,rate){
  return keys.map(({audio,...key})=>{
    let signature=key.profile?.signature;
    if(!validSignature(signature,rate)&&audio?.startsWith('data:audio/wav')){
      try{const {samples,rate:keyRate}=fromDataUrl(audio);signature=learnSignature(resample(samples,keyRate,rate),rate);}catch{signature=undefined;}
    }
    return {...key,profile:{...key.profile,signature}};
  });
}
export function run(samples,rate,keys){
  const engine=new ListeningEngine(rate,keys),frames=[];
  for(let start=0;start+128<=samples.length;start+=128){const frame=engine.push(samples.subarray(start,start+128));if(frame)frames.push(frame);}
  return {frames,tracker:engine.tracker};
}
const pct=(n,total)=>total?`${Math.round(n/total*100)}%`:'–';

export function replayCapture(capture){
  if(capture.format!==CAPTURE_FORMAT)throw new Error('This is not a kalimba capture file.');
  const {samples,rate:fileRate}=fromDataUrl(capture.audio),rate=capture.rate??fileRate;
  const lines=[`${capture.mode} capture · ${capture.seconds ?? (samples.length/rate).toFixed(1)} s at ${rate} Hz · ${capture.createdAt}`];
  if(capture.settings){const {echoCancellation,noiseSuppression,autoGainControl}=capture.settings;lines.push(`mic processing: echoCancellation=${echoCancellation} noiseSuppression=${noiseSuppression} autoGainControl=${autoGainControl}`);}
  let peak=0,energy=0;for(const x of samples){peak=Math.max(peak,Math.abs(x));energy+=x*x;}
  lines.push(`input level: peak ${peak.toFixed(3)}${peak>.98?' (CLIPPING)':''}, rms ${Math.sqrt(energy/samples.length).toFixed(4)}`);
  const keys=prepareKeys(capture.keys??[],rate);
  const ids=keys.map(key=>key.id).sort((a,b)=>a-b);
  if(keys.length){
    lines.push('','saved keys (by pitch):');
    const byPitch=[...keys].sort((a,b)=>a.frequency-b.frequency);
    byPitch.forEach((key,i)=>{
      const next=byPitch[i+1],gap=next?` · ${Math.round(centsBetween(next.frequency,key.frequency))} cents below key ${next.id+1}`:'';
      lines.push(`  key ${key.id+1}: ${key.frequency.toFixed(1)} Hz ${noteName(key.midi)}${key.profile.signature?'':' (no signature)'}${gap}`);
    });
  }
  const report={lines};
  if(capture.mode==='setup'){
    const {frames}=run(samples,rate,[]);
    const plucks=frames.filter(frame=>frame.pluck);
    lines.push('',`setup for key ${capture.key+1} · app outcome: ${capture.outcome}`);
    lines.push(`plucks counted: replay ${plucks.length}, in app ${capture.plucks?.length??'?'}`);
    plucks.forEach((pluck,i)=>lines.push(`  ${i+1}. ${(pluck.onset/1000).toFixed(2)} s · ${pluck.frequency.toFixed(1)} Hz`));
    const tones=frames.filter(frame=>frame.frequency&&frame.confidence>.87).map(frame=>frame.frequency);
    const match=calibrationMatch(plucks);
    lines.push(`match: ${match.accepted?'accepted':'not accepted'} at ${match.frequency?.toFixed(1)} Hz (${noteName(match.midi)}), consistency ${match.match ?? '–'}%`);
    try{const saved=analyseCalibration(tones,plucks);lines.push(`calibration: would save ${saved.frequency.toFixed(1)} Hz (${noteName(saved.midi)}), the ringing pitch`);}catch(error){lines.push(`calibration: ${error.message}`);}
    Object.assign(report,{plucks,match});
    return report;
  }
  const {frames,tracker}=run(samples,rate,keys);
  const detections=frames.filter(frame=>frame.pluck).map(frame=>({time:frame.time,keyId:frame.keyId,frequency:frame.frequency,confidence:frame.confidence}));
  const replay=scoreCapture(capture.cues,detections),live=scoreCapture(capture.cues,capture.detections??[]);
  const total=capture.cues.length;
  lines.push('',`detector: ${tracker instanceof TemplatePlucks?'spectral templates':'pitch fallback (some keys have no signature)'}`);
  if(tracker instanceof TemplatePlucks){
    const pairs=[];
    for(let a=0;a<keys.length;a++)for(let b=a+1;b<keys.length;b++)pairs.push([tracker.gram[a][b],keys[a].id,keys[b].id]);
    pairs.sort((x,y)=>y[0]-x[0]);
    lines.push(`most similar signatures: ${pairs.slice(0,4).map(([value,a,b])=>`${a+1}&${b+1} ${value.toFixed(3)}`).join(', ')}${tracker.identical.some(Boolean)?' (some treated as identical, never recognised)':''}`);
  }
  lines.push('',`replay: ${replay.right}/${total} right (${pct(replay.right,total)}), ${replay.wrong} wrong, ${replay.missed} missed, ${replay.extras.length} extra`);
  lines.push(`in app: ${live.right}/${total} right (${pct(live.right,total)}), ${live.wrong} wrong, ${live.missed} missed, ${live.extras.length} extra`);
  lines.push('','confusion (rows: asked to play, columns: heard):',confusionTable(replay.rows,ids));
  const problems=replay.rows.filter(row=>row.result!=='right');
  if(problems.length){
    lines.push('','misses and confusions:');
    for(const row of problems)lines.push(`  ${(row.time/1000).toFixed(2)} s · asked key ${row.cue+1} · ${row.result==='missed'?'nothing heard':`heard key ${row.heard+1} (confidence ${row.confidence?.toFixed(2)})`}`);
  }
  if(replay.extras.length)lines.push('','extra detections:',...replay.extras.map(hit=>`  ${(hit.time/1000).toFixed(2)} s · key ${hit.keyId+1} (confidence ${hit.confidence?.toFixed(2)})`));
  Object.assign(report,{replay,live});
  return report;
}

if(import.meta.url===pathToFileURL(process.argv[1]).href){
  const [path,...rest]=process.argv.slice(2);
  if(!path){console.error('Usage: node scripts/kalimba/replay.mjs <capture.json> [--wav out.wav]');process.exit(1);}
  const capture=JSON.parse(await readFile(path,'utf8'));
  console.log(replayCapture(capture).lines.join('\n'));
  const wav=rest.indexOf('--wav');
  if(wav>=0&&rest[wav+1]){const {samples,rate}=fromDataUrl(capture.audio);await writeFile(rest[wav+1],Buffer.from(encodeWav(samples,rate)));console.log(`\nwrote ${rest[wav+1]}`);}
}
