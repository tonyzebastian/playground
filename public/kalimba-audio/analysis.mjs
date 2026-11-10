import { detectPitch, OnsetFlux, PluckGate } from './pitch.mjs';
import { PitchLatch, SpectralPlucks, band } from './listening.mjs';

import { Spectrum } from './fft.mjs';
import { TemplatePlucks, validSignature } from './signatures.mjs';
export { Spectrum } from './fft.mjs';

export class ListeningEngine {
  constructor(rate,keys=[]){
    this.rate=rate;this.keys=keys;this.ring=new Float32Array(4096);this.buffer=new Float32Array(4096);this.small=new Float32Array(2048);
    this.position=0;this.total=0;this.hop=0;this.fft=new Spectrum();this.gate=new PluckGate();this.onsets=new OnsetFlux(2048,rate/4096);this.latch=new PitchLatch();
    this.tracker=keys.length?(keys.every(key=>validSignature(key.profile?.signature,rate))?new TemplatePlucks(keys,rate):new SpectralPlucks(keys,rate/4096)):null;
    this.noise=[];this.noiseFloor=.001;this.ready=false;this.clipUntil=0;this.spectra=[];this.candidate=null;
  }
  // Level of a note (fundamental plus octave) in a spectrum.
  tone(spectrum,frequency){const binHz=this.rate/4096;return band(spectrum,frequency,binHz)+band(spectrum,frequency*2,binHz);}
  // A burst while something is already sounding counts only if, once it has
  // passed through the 85 ms window, the note now heard is clearly louder than
  // it was just before the burst. A re-pluck or a new note passes; a click or
  // bump leaves the ringing note decaying. Returns the burst's start time.
  confirm(spectrum,time,frequency,burst){
    if(burst&&!this.candidate){
      const reference=[...this.spectra].reverse().find(entry=>entry.time<=time-20);
      if(reference)this.candidate={at:time,reference:reference.spectrum.slice(),frequency:reference.frequency};
    }
    const copy=this.spectra.length>=3?this.spectra.shift().spectrum:new Float32Array(spectrum.length);
    copy.set(spectrum);this.spectra.push({time,frequency,spectrum:copy});
    const candidate=this.candidate;
    if(!candidate||time-candidate.at<100)return null;
    const note=frequency??candidate.frequency;
    if(note&&this.tone(spectrum,note)>=this.tone(candidate.reference,note)*1.05){this.candidate=null;return candidate.at;}
    if(time-candidate.at>190)this.candidate=null;
    return null;
  }
  push(samples){
    for(const sample of samples){this.ring[this.position]=sample;this.position=(this.position+1)%4096;this.total++;this.hop++;}
    const stride=this.keys.length?512:1024;
    if(this.total<4096||this.hop<stride)return null;this.hop=0;
    let energy=0,peak=0;
    for(let i=0;i<4096;i++){const x=this.ring[(this.position+i)%4096];this.buffer[i]=x;energy+=x*x;peak=Math.max(peak,Math.abs(x));}
    const rms=Math.sqrt(energy/4096),time=this.total/this.rate*1000;
    if(time<700){
      this.noise.push(rms);
      if(!this.tracker)this.onsets.learnNoise(this.fft.update(this.buffer),rms);
      return {rms,time,pluck:false,frequency:null,checking:true};
    }
    if(!this.ready){
      this.noise.sort((a,b)=>a-b);this.noiseFloor=this.noise[Math.floor(this.noise.length*.25)]??.001;this.ready=true;
    }
    const threshold=Math.max(.003,this.noiseFloor*2.8),quality=peak>.98?'clipping':rms<threshold?'quiet':'ready';
    const spectrum=this.fft.update(this.buffer);
    if(this.tracker){
      const key=this.tracker.update(spectrum,rms,time,quality==='clipping'?Infinity:threshold);
      return {rms,time,quality,frequency:key?.frequency??null,keyId:key?.id,pluck:!!key,confidence:key?.confidence??(key?1:0),ambiguous:this.tracker.ambiguous??false};
    }
    for(let i=0;i<2048;i++)this.small[i]=(this.buffer[i*2]+this.buffer[i*2+1])*.5;
    const result=this.latch.update(detectPitch(this.small,this.rate/2,threshold));
    if(quality==='clipping')this.clipUntil=time+200;
    const {flux,onset}=this.onsets.update(spectrum);
    const attack=this.gate.update(result,time,threshold,this.confirm(spectrum,time,result.frequency,onset));
    const pluck=time>this.clipUntil&&attack;
    const harmonics=result.frequency?[1,2,3].map(h=>band(spectrum,result.frequency*h,this.rate/4096)):null;
    // onset: end time of the analysis window in which the attack first appeared.
    return {...result,time,quality,pluck:!!pluck,harmonics,flux,onset:pluck?this.gate.onsetTime:undefined};
  }
}
