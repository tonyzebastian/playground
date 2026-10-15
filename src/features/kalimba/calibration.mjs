import { centsBetween, midiOf, noteName } from './music.mjs';

export function duplicateKey(candidate,keys){
  return keys.find(key=>key.id!==candidate.id && (
    key.midi===candidate.midi || (key.frequency>0&&candidate.frequency>0&&Math.abs(centsBetween(key.frequency,candidate.frequency))<65)
  ))??null;
}
export function assertUniqueKey(candidate,keys){
  const duplicate=duplicateKey(candidate,keys);
  if(duplicate)throw new Error(`${noteName(candidate.midi)} is already saved for key ${duplicate.id+1}. Dampen the other tines, then record only key ${candidate.id+1} again.`);
}
export function analyseCalibration(frames,plucks){
  if(frames.length<6||plucks.length<2)throw new Error('We need at least two clear plucks of this key. Leave two seconds between them.');
  const votes=new Map();
  plucks.forEach(f=>{const midi=Math.round(midiOf(f));votes.set(midi,(votes.get(midi)||0)+1);});
  const [midi,count]=[...votes].sort((a,b)=>b[1]-a[1])[0];
  if(count/plucks.length<.8)throw new Error('The plucks gave different notes. Dampen the other tines and try this key again.');
  const values=frames.filter(f=>Math.round(midiOf(f))===midi).sort((a,b)=>a-b);
  if(values.length<6||values.length/frames.length<.7)throw new Error('The pitch was unclear. Try again with the phone closer to this key.');
  const low=values[Math.floor(values.length*.1)],high=values[Math.min(values.length-1,Math.floor(values.length*.9))];
  if(Math.abs(centsBetween(high,low))>45)throw new Error('The pitch was unstable. Let the key ring by itself and try again.');
  return {midi,frequency:values[Math.floor(values.length/2)]};
}

export function toneProfile(frames){
  const tones=frames.filter(frame=>frame.harmonics?.[0]>0);
  if(!tones.length)return undefined;
  const median=values=>values.sort((a,b)=>a-b)[Math.floor(values.length/2)];
  const harmonics=[1,...[1,2].map(h=>median(tones.map(frame=>Math.min(10,frame.harmonics[h]/frame.harmonics[0]))))];
  const decays=[];
  let start=null,peak=0;
  for(const frame of frames){
    if(frame.pluck){start=frame.time;peak=frame.rms;}
    else if(start!==null&&frame.rms<peak*.5){decays.push(frame.time-start);start=null;}
  }
  return {harmonics,decayMs:decays.length?median(decays):600};
}
