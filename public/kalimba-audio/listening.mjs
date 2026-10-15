const cents=(a,b)=>Math.abs(1200*Math.log2(a/b));

export class PitchLatch{
  constructor(){this.frames=[];}
  update(result){
    if(!result.frequency||result.confidence<.87){this.frames=[];return {...result,frequency:null};}
    if(this.frames.length&&cents(result.frequency,this.frames.at(-1))>40)this.frames=[];
    this.frames.push(result.frequency);if(this.frames.length>3)this.frames.shift();
    return {...result,frequency:this.frames.length>=2?[...this.frames].sort((a,b)=>a-b)[Math.floor(this.frames.length/2)]:null};
  }
}

export function band(spectrum,frequency,binHz){
  const centre=frequency/binHz;
  let maximum=0;
  for(let bin=Math.max(1,Math.floor(centre)-1);bin<=Math.ceil(centre)+1&&bin<spectrum.length;bin++){
    const weight=Math.max(0,1-Math.abs(bin-centre)/1.8);
    maximum=Math.max(maximum,spectrum[bin]*weight);
  }
  return maximum;
}

// Match NEW energy at known fundamentals and harmonics. Decaying notes do not
// become attacks merely because their pitch takes over the mixed waveform.
export class SpectralPlucks{
  constructor(keys,binHz){
    this.keys=keys.filter(k=>k.frequency>0&&!keys.some(other=>other.id!==k.id&&other.frequency>0&&cents(k.frequency,other.frequency)<65));
    this.binHz=binHz;this.previous=null;this.pending=null;this.lastTime=-Infinity;this.lastByKey=new Map();
    this.noiseBins=Array.from({length:Math.max(0,Math.floor(3000/binHz)-Math.ceil(100/binHz))},(_,i)=>i+Math.ceil(100/binHz))
      .filter(bin=>!this.keys.some(key=>[1,2,3].some(h=>Math.abs(bin-key.frequency*h/binHz)<2.5)));
  }
  retrigger(key){return Math.max(85,Math.min(120,(key?.profile?.decayMs??600)*.16));}
  update(spectrum,rms,time,threshold=.006){
    const noise=this.noiseBins.filter(bin=>bin<spectrum.length).map(bin=>spectrum[bin]).sort((a,b)=>a-b);
    const floor=noise[Math.floor(noise.length/2)]??0;
    const levels=this.keys.map(key=>[1,2,3].map(h=>band(spectrum,key.frequency*h,this.binHz)));
    if(!this.previous){this.previous=levels;return null;}
    const candidates=this.keys.map((key,index)=>{
      const level=levels[index],previous=this.previous[index];
      const rise=level.map((value,h)=>Math.max(0,value-previous[h]));
      const valid=rms>threshold&&level[0]>Math.max(.0006,floor*4)&&rise[0]>Math.max(.0003,floor*2)&&rise[0]/Math.max(level[0],.0001)>.18;
      let score=valid?rise[0]+rise[1]*.45+rise[2]*.2:0;
      const profile=key.profile?.harmonics;
      if(profile?.length===3){
        const norm=Math.hypot(...level)*Math.hypot(...profile);
        const similarity=norm?level.reduce((sum,x,h)=>sum+x*profile[h],0)/norm:0;
        score*=similarity<.55?0:.65+.35*similarity;
      }
      return {key,index,rise:rise[0],score};
    });
    // A higher tine can share a lower tine's harmonic. Prefer the lower
    // fundamental only when it ALSO has fresh energy, never because it rings.
    for(const candidate of candidates){
      if(candidates.some(other=>other.score>0&&other.key.frequency<candidate.key.frequency&&
        [2,3].some(h=>cents(other.key.frequency*h,candidate.key.frequency)<45)&&other.rise>candidate.rise*.28))candidate.score*=.35;
    }
    candidates.sort((a,b)=>b.score-a.score);
    const winner=candidates[0],runner=candidates[1];
    if(winner?.score>.0006&&(!runner?.score||winner.score>runner.score*1.2)&&time-this.lastTime>=45&&time-(this.lastByKey.get(winner?.key.id)??-Infinity)>=this.retrigger(winner?.key)){
      if(!this.pending)this.pending={...winner,time,frames:0,level:levels[winner.index][0]};
    }
    this.previous=levels;
    if(this.pending){
      const pending=this.pending;
      if(time-pending.time>110||rms<threshold*.8||levels[pending.index][0]<pending.level*.5){this.pending=null;return null;}
      pending.frames++;
      if(pending.frames>=2&&time-this.lastTime>=45&&time-(this.lastByKey.get(pending.key.id)??-Infinity)>=this.retrigger(pending.key)){this.pending=null;this.lastTime=time;this.lastByKey.set(pending.key.id,time);return pending.key;}
    }
    return null;
  }
}
