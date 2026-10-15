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

export class PluckGate {
  constructor(){this.lastTime=-Infinity;this.lastFrequency=0;this.previous=0;this.quiet=true;this.pendingUntil=0;}
  update({frequency,rms},time,threshold=.006){
    const rising=rms>threshold*1.5 && (this.quiet || rms>this.previous*1.65);
    if(rising) this.pendingUntil=time+160;
    if(rms<threshold*.8) this.quiet=true;
    else if(rms>threshold*1.5) this.quiet=false;
    const fire=frequency && rms>threshold*1.5 && time-this.lastTime>=120 && time<this.pendingUntil;
    this.previous=rms;
    if(fire){this.lastTime=time;this.lastFrequency=frequency;this.pendingUntil=0;return true;}
    return false;
  }
}
