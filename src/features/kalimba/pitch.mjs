// YIN difference function with cumulative normalisation and parabolic refinement.
// Downsample before this function to keep microphone analysis light on phones.
export function detectPitch(samples,sampleRate,threshold=.006) {
  let energy=0;
  for(const x of samples) energy+=x*x;
  const rms=Math.sqrt(energy/samples.length);
  if(rms<threshold) return {frequency:null,confidence:0,rms};
  const min=Math.floor(sampleRate/2200), max=Math.min(Math.floor(sampleRate/100),Math.floor(samples.length/2)-1);
  const difference=new Float32Array(max+1);
  const size=samples.length-max;
  for(let tau=1;tau<=max;tau++) {
    let sum=0;
    for(let i=0;i<size;i++){const d=samples[i]-samples[i+tau];sum+=d*d;}
    difference[tau]=sum;
  }
  let running=0;
  for(let tau=1;tau<=max;tau++){running+=difference[tau];difference[tau]=running?difference[tau]*tau/running:1;}
  for(let tau=Math.max(2,min);tau<max;tau++) {
    if(difference[tau]<.14) {
      while(tau+1<max && difference[tau+1]<difference[tau]) tau++;
      const a=difference[tau-1],b=difference[tau],c=difference[tau+1];
      const shift=(a-c)/(2*(a-2*b+c)||1);
      return {frequency:sampleRate/(tau+Math.max(-1,Math.min(1,shift))),confidence:1-b,rms};
    }
  }
  return {frequency:null,confidence:0,rms};
}

// Spectral-flux onsets (in the style of SuperFlux): sum the log rises of every
// band that stands above the room's own noise, against the louder of each
// band's neighbours two hops ago. A re-pluck of a still-ringing tine barely
// changes overall loudness, and can even cancel part of the fundamental, but it
// revives the fast-decaying overtones and adds a contact click.
export class OnsetFlux {
  constructor(bins,binHz){
    this.low=Math.max(2,Math.ceil(80/binHz));this.high=Math.min(bins-2,Math.floor(10000/binHz));
    this.noise=new Float32Array(bins);this.noiseFrames=0;
    this.history=[];this.levels=[];this.active=false;
  }
  learnNoise(spectrum){
    this.noiseFrames++;
    for(let bin=this.low-1;bin<=this.high+1;bin++)this.noise[bin]+=(spectrum[bin]-this.noise[bin])/this.noiseFrames;
  }
  update(spectrum){
    const {low,high,noise}=this,level=new Float32Array(high+2);
    for(let bin=low-1;bin<=high+1;bin++)level[bin]=Math.log1p(spectrum[bin]/(noise[bin]*3+1e-7));
    const before=this.levels.length>=2?this.levels[this.levels.length-2]:null;
    this.levels.push(level);if(this.levels.length>2)this.levels.shift();
    if(!before)return {flux:0,onset:false};
    let flux=0;
    for(let bin=low;bin<=high;bin++){
      if(level[bin]<1)continue; // within ~3x of the room noise
      const reference=Math.max(before[bin-1],before[bin],before[bin+1]);
      if(level[bin]>reference)flux+=level[bin]-reference;
    }
    // Adaptive threshold: well above the recent median, and above an absolute
    // floor so that beating and room noise never qualify on their own.
    const sorted=[...this.history].sort((a,b)=>a-b),median=sorted[Math.floor(sorted.length/2)]??0;
    // One attack spans several hops while it fills the 85 ms window; report
    // only the first frame of each burst.
    const above=flux>Math.max(6,median*3),onset=above&&!this.active;
    this.active=above;
    this.history.push(flux);if(this.history.length>12)this.history.shift();
    return {flux,onset};
  }
}

export class PluckGate {
  constructor(){this.lastTime=-Infinity;this.lastFrequency=0;this.previous=0;this.quiet=true;this.pendingUntil=0;this.onsetTime=null;}
  update({frequency,rms},time,threshold=.006,onset=false){
    // The tail of an attack that already fired must not arm another pluck.
    const rising=rms>threshold*1.5 && time-this.lastTime>=120 && (onset || this.quiet || rms>this.previous*1.65);
    // Remember when the newest attack started, so a sample can be cut from it.
    if(rising){if(time>=this.pendingUntil||this.onsetTime===null)this.onsetTime=time;this.pendingUntil=time+160;}
    if(rms<threshold*.8) this.quiet=true;
    else if(rms>threshold*1.5) this.quiet=false;
    const fire=frequency && rms>threshold*1.5 && time-this.lastTime>=120 && time<this.pendingUntil;
    this.previous=rms;
    if(fire){this.lastTime=time;this.lastFrequency=frequency;this.pendingUntil=0;return true;}
    return false;
  }
}
