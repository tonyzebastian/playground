export const DEMO_MIDI = [72,69,65,62,60,64,67,71,74];
export const noteName = midi => ['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'][((midi%12)+12)%12]+(Math.floor(midi/12)-1);
export const frequencyOf = midi => 440*2**((midi-69)/12);
export const midiOf = frequency => 69+12*Math.log2(frequency/440);
export const centsBetween = (a,b) => 1200*Math.log2(a/b);

export const SONGS = [
  { id:'twinkle', title:'Twinkle, Twinkle, Little Star', detail:'A familiar first melody', level:'Start here', bpm:76,
    notes:[0,0,7,7,9,9,7,5,5,4,4,2,2,0], beats:[1,1,1,1,1,1,2,1,1,1,1,1,1,2] },
  { id:'joy', title:'Ode to Joy', detail:'Beethoven · opening phrase', level:'Easy', bpm:84,
    notes:[4,4,5,7,7,5,4,2,0,0,2,4,4,2,2], beats:[1,1,1,1,1,1,1,1,1,1,1,1,1.5,.5,2] },
  { id:'row', title:'Row, Row, Row Your Boat', detail:'A little rhythm practice', level:'Easy', bpm:72,
    notes:[0,0,0,2,4,4,2,4,5,7], beats:[1,1,.75,.25,1,.75,.25,.75,.25,2] },
  { id:'love', title:'Can’t Help Falling in Love', detail:'Simplified opening · melody only', level:'Gentle', bpm:66,
    notes:[0,7,0,2,4,5,4,2,7,9,11,0,2,4,2,0], beats:[2,2,2,1,1,2,2,3,2,2,2,1,1,2,2,3] },
  { id:'thrones', title:'Game of Thrones', detail:'Simplified opening motif · melody only', level:'Next step', bpm:90,
    notes:[7,0,3,5,7,0,3,5,2,7,0,2,3,7,0,2], beats:[1.5,.5,.5,.5,1.5,.5,.5,.5,1.5,.5,.5,.5,1.5,.5,.5,.5] },
];

// Exact semitone matching after transposition. Never silently substitute a note.
export function mapSong(song, keys) {
  const mapped = keys.filter(k=>Number.isFinite(k.midi));
  if (!mapped.length) return null;
  for (const root of [...new Set(mapped.map(k=>k.midi))].sort((a,b)=>a-b)) {
    const sequence = song.notes.map(interval=>mapped.find(k=>k.midi===root+interval));
    if (sequence.every(Boolean)) return {root,sequence:sequence.map((k,i)=>({key:k.id,midi:k.midi,beats:song.beats[i]??1}))};
  }
  return null;
}

// An explicitly labelled practice arrangement for non-standard nine-key tunings.
// Map distinct melody pitches to distinct, ascending recorded pitches so repeats
// and melodic direction survive; choose the smallest overall interval changes.
export function adaptSong(song,keys){
  const available=[...new Map(keys.filter(key=>Number.isFinite(key.midi)).sort((a,b)=>a.midi-b.midi||a.id-b.id).map(key=>[key.midi,key])).values()];
  const intervals=[...new Set(song.notes)].sort((a,b)=>a-b);
  if(keys.length!==9||new Set(keys.map(key=>key.id)).size!==9||available.length<intervals.length)return null;
  let best=null;
  for(let start=0;start<=available.length-intervals.length;start++){
    const root=available[start].midi-intervals[0];
    let states=new Map([[start,{cost:0,indexes:[start]}]]);
    for(let tone=1;tone<intervals.length;tone++){
      const next=new Map();
      for(let index=start+tone;index<available.length-(intervals.length-tone-1);index++){
        const error=available[index].midi-(root+intervals[tone]);
        for(const [previous,state] of states){
          if(previous>=index)continue;
          const gapError=(available[index].midi-available[previous].midi)-(intervals[tone]-intervals[tone-1]);
          const cost=state.cost+error*error+gapError*gapError*.5;
          if(!next.has(index)||cost<next.get(index).cost)next.set(index,{cost,indexes:[...state.indexes,index]});
        }
      }
      states=next;
    }
    for(const state of states.values())if(!best||state.cost<best.cost)best={...state,root};
  }
  if(!best)return null;
  const pitches=new Map(intervals.map((interval,index)=>[interval,available[best.indexes[index]]]));
  return {root:best.root,adapted:true,sequence:song.notes.map((interval,index)=>{
    const key=pitches.get(interval);return {key:key.id,midi:key.midi,beats:song.beats[index]??1};
  })};
}
export function playableSong(song,keys){
  const exact=mapSong(song,keys);
  return exact?{...exact,adapted:false}:adaptSong(song,keys);
}

export function nearestKey(frequency,keys,tolerance=65) {
  const candidates=keys.filter(k=>k.frequency>0).map(k=>({key:k,cents:Math.abs(centsBetween(frequency,k.frequency))})).sort((a,b)=>a.cents-b.cents);
  // Identical pitches cannot identify a physical tine reliably.
  if (!candidates.length || candidates[0].cents>tolerance || (candidates[1] && candidates[1].cents-candidates[0].cents<12)) return null;
  return candidates[0].key;
}
