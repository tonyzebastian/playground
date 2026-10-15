import { detectPitch, PluckGate } from './pitch.mjs';
import { PitchLatch, SpectralPlucks, band } from './listening.mjs';

// Reusable radix-2 FFT: no dependency on a UI frame or browser analyser node.
export class Spectrum {
  constructor(size=4096){
    this.size=size;this.real=new Float32Array(size);this.imag=new Float32Array(size);
    this.values=new Float32Array(size/2);this.window=Float32Array.from({length:size},(_,i)=>.5-.5*Math.cos(2*Math.PI*i/(size-1)));
    this.reverse=new Uint16Array(size);
    const bits=Math.log2(size);
    for(let i=0;i<size;i++){let x=i,r=0;for(let b=0;b<bits;b++){r=(r<<1)|(x&1);x>>=1;}this.reverse[i]=r;}
  }
  update(samples){
    const {size,real,imag,reverse,window,values}=this;
    for(let i=0;i<size;i++){real[reverse[i]]=samples[i]*window[i];imag[i]=0;}
    for(let width=2;width<=size;width*=2){
      const angle=-2*Math.PI/width,cr=Math.cos(angle),ci=Math.sin(angle);
      for(let start=0;start<size;start+=width){let wr=1,wi=0;
        for(let j=0;j<width/2;j++){
          const a=start+j,b=a+width/2,tr=wr*real[b]-wi*imag[b],ti=wr*imag[b]+wi*real[b];
          real[b]=real[a]-tr;imag[b]=imag[a]-ti;real[a]+=tr;imag[a]+=ti;
          const next=wr*cr-wi*ci;wi=wr*ci+wi*cr;wr=next;
        }
      }
    }
    for(let i=0;i<values.length;i++)values[i]=Math.hypot(real[i],imag[i])*4/size;
    return values;
  }
}

export class ListeningEngine {
  constructor(rate,keys=[]){
    this.rate=rate;this.keys=keys;this.ring=new Float32Array(4096);this.buffer=new Float32Array(4096);this.small=new Float32Array(2048);
    this.position=0;this.total=0;this.hop=0;this.fft=new Spectrum();this.gate=new PluckGate();this.latch=new PitchLatch();
    this.tracker=keys.length?new SpectralPlucks(keys,rate/4096):null;
    this.noise=[];this.noiseFloor=.001;this.ready=false;this.clipUntil=0;
  }
  push(samples){
    for(const sample of samples){this.ring[this.position]=sample;this.position=(this.position+1)%4096;this.total++;this.hop++;}
    const stride=this.keys.length?512:1024;
    if(this.total<4096||this.hop<stride)return null;this.hop=0;
    let energy=0,peak=0;
    for(let i=0;i<4096;i++){const x=this.ring[(this.position+i)%4096];this.buffer[i]=x;energy+=x*x;peak=Math.max(peak,Math.abs(x));}
    const rms=Math.sqrt(energy/4096),time=this.total/this.rate*1000;
    if(time<700){this.noise.push(rms);return {rms,time,pluck:false,frequency:null,checking:true};}
    if(!this.ready){
      this.noise.sort((a,b)=>a-b);this.noiseFloor=this.noise[Math.floor(this.noise.length*.25)]??.001;this.ready=true;
    }
    const threshold=Math.max(.003,this.noiseFloor*2.8),quality=peak>.98?'clipping':rms<threshold?'quiet':'ready';
    const spectrum=this.fft.update(this.buffer);
    if(this.tracker){
      const key=this.tracker.update(spectrum,rms,time,threshold);
      return {rms,time,quality,frequency:key?.frequency??null,keyId:key?.id,pluck:!!key,confidence:key?1:0};
    }
    for(let i=0;i<2048;i++)this.small[i]=(this.buffer[i*2]+this.buffer[i*2+1])*.5;
    const result=this.latch.update(detectPitch(this.small,this.rate/2,threshold));
    if(quality==='clipping')this.clipUntil=time+200;
    const attack=this.gate.update(result,time,threshold);
    const pluck=time>this.clipUntil&&attack;
    const harmonics=result.frequency?[1,2,3].map(h=>band(spectrum,result.frequency*h,this.rate/4096)):null;
    return {...result,time,quality,pluck:!!pluck,harmonics};
  }
}
