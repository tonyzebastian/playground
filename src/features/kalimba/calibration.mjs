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
const frequencyOf=pluck=>typeof pluck==='number'?pluck:pluck.frequency;
const distance=(a,b)=>Math.abs(centsBetween(a,b));
const similarity=(a,b)=>Math.round(Math.max(0,100-distance(a,b)*.23));

// Two close reference plucks anchor the note. A third may vary by up to
// 65 cents (~85% pitch consistency); unrelated notes never count as a match.
export function calibrationMatch(plucks){
  const values=plucks.map(frequencyOf);
  if(!values.length)return {accepted:false,match:null,similarities:[],indexes:[]};
  let best=null,pair=null;
  for(let a=0;a<values.length;a++)for(let b=a+1;b<values.length;b++){
    const spread=distance(values[a],values[b]);
    const frequency=Math.sqrt(values[a]*values[b]);
    if(!pair||spread<pair.spread)pair={spread,frequency,indexes:[a,b]};
    if(spread>30)continue;
    for(let c=0;c<values.length;c++){
      if(c===a||c===b||distance(values[c],frequency)>65)continue;
      const indexes=[a,b,c].sort((x,y)=>x-y);
      const score=indexes.reduce((sum,index)=>sum+similarity(values[index],frequency),0)/3;
      if(!best||score>best.score)best={frequency,indexes,score};
    }
  }
  const frequency=best?.frequency??pair?.frequency??values[0];
  const similarities=values.map(value=>similarity(value,frequency));
  return {accepted:!!best,frequency,midi:Math.round(midiOf(frequency)),
    match:values.length<2?null:Math.round(best?.score??similarities.reduce((a,b)=>a+b,0)/similarities.length),
    similarities,indexes:best?.indexes??pair?.indexes??[0]};
}
export function analyseCalibration(frames,plucks){
  if(frames.length<6||plucks.length<3)throw new Error('We need three clear plucks. Keep the key ringing by itself and try again.');
  const match=calibrationMatch(plucks);
  if(!match.accepted)throw new Error('No consistent set yet. Start again with gentle plucks of this key only.');
  // Keep useful frames from the chosen note; a noisy outlier or a drifting tail
  // no longer invalidates the entire recording.
  const values=frames.map(frequencyOf).filter(f=>distance(f,match.frequency)<=85).sort((a,b)=>a-b);
  if(values.length<6)throw new Error('We couldn’t hear enough of the note. Move the phone closer and try again.');
  return {...match,frequency:match.frequency};
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
