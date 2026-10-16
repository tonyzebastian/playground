import { Spectrum } from './fft.mjs';
const SIZE=4096;
export function validSignature(signature,rate){
  return signature?.version===1&&signature.rate===rate&&signature.size===SIZE&&
    Array.isArray(signature.bins)&&signature.bins.length===SIZE/2&&signature.bins.every(value=>Number.isFinite(value)&&value>=0&&value<=1);
}

// Learn the entire recorded spectrum, including non-harmonic resonances, rather
// than assuming that a kalimba's sound is only its first three integer harmonics.
export function learnSignature(samples,rate){
  const fft=new Spectrum(),sum=new Float64Array(SIZE/2),buffer=new Float32Array(SIZE);
  let count=0,peak=0;for(const value of samples)peak=Math.max(peak,Math.abs(value));
  if(peak<.002)return null;
  const limit=Math.min(samples.length,Math.floor(rate*.65));
  for(let start=0;start+SIZE<=limit;start+=1024){
    buffer.set(samples.subarray(start,start+SIZE));
    const values=fft.update(buffer);let norm=0;
    for(let bin=1;bin<values.length;bin++)norm+=values[bin]*values[bin];
    norm=Math.sqrt(norm);if(norm<peak*.08)continue;
    for(let bin=1;bin<values.length;bin++)sum[bin]+=values[bin]/norm;
    count++;
  }
  if(!count)return null;
  const maximum=Math.max(...sum);
  return {version:1,rate,size:SIZE,bins:Array.from(sum,value=>value/maximum)};
}

// Fit the microphone spectrum as a non-negative mixture of the nine learned
// spectra. The Gram matrix is precomputed; each frame needs only projections
// and a small coordinate-descent solve, keeping worklet work bounded.
export class TemplatePlucks {
  constructor(keys,rate){
    this.keys=keys;this.count=keys.length;this.ambiguous=false;this.pending=null;this.lastTime=-Infinity;
    this.previous=null;this.lastByKey=new Map();
    this.bins=[];this.weights=[];this.columns=keys.map(()=>[]);
    for(let bin=Math.ceil(80*SIZE/rate);bin<Math.min(SIZE/2,Math.floor(8000*SIZE/rate));bin++){
      const maximum=Math.max(...keys.map(key=>key.profile.signature.bins[bin]));
      if(maximum<.004)continue;
      const weight=1/Math.sqrt(.02+maximum);
      this.bins.push(bin);this.weights.push(weight);
      keys.forEach((key,index)=>this.columns[index].push(key.profile.signature.bins[bin]*weight));
    }
    this.columns=this.columns.map(column=>{const norm=Math.hypot(...column)||1;return Float32Array.from(column,value=>value/norm);});
    this.gram=keys.map((_,a)=>keys.map((_,b)=>this.columns[a].reduce((sum,value,bin)=>sum+value*this.columns[b][bin],0)));
    this.identical=keys.map((_,index)=>this.gram[index].some((value,other)=>other!==index&&value>.985));
    this.witnesses=keys.map((key,index)=>{
      const groups=[];let group=[];
      for(let bin=1;bin<SIZE/2;bin++){
        const value=key.profile.signature.bins[bin];
        const other=Math.max(0,...keys.filter((_,i)=>i!==index).map(k=>k.profile.signature.bins[bin]));
        if(value>.045&&value>other*2.5){group.push(bin);}
        else if(group.length){groups.push(group);group=[];}
      }
      if(group.length)groups.push(group);
      return groups.sort((a,b)=>Math.max(...b.map(bin=>key.profile.signature.bins[bin]))-Math.max(...a.map(bin=>key.profile.signature.bins[bin]))).slice(0,8);
    });
    this.previousWitness=null;this.envelopes=null;
    this.coefficients=new Float64Array(this.count);this.projection=new Float64Array(this.count);
    this.observed=new Float32Array(this.bins.length);
  }
  fit(spectrum){
    let norm=0;
    for(let bin=0;bin<this.bins.length;bin++){
      const value=spectrum[this.bins[bin]]*this.weights[bin];this.observed[bin]=value;norm+=value*value;
    }
    norm=Math.sqrt(norm);
    for(let key=0;key<this.count;key++){
      let projection=0;for(let bin=0;bin<this.bins.length;bin++)projection+=this.columns[key][bin]*this.observed[bin];
      this.projection[key]=projection;
    }
    const penalty=norm*.012;
    for(let sweep=0;sweep<18;sweep++)for(let key=0;key<this.count;key++){
      let cross=0;for(let other=0;other<this.count;other++)if(other!==key)cross+=this.gram[key][other]*this.coefficients[other];
      this.coefficients[key]=Math.max(0,(this.projection[key]-cross-penalty)/(this.gram[key][key]||1));
    }
    let residual=0;
    for(let bin=0;bin<this.bins.length;bin++){
      let predicted=0;for(let key=0;key<this.count;key++)predicted+=this.columns[key][bin]*this.coefficients[key];
      residual+=(this.observed[bin]-predicted)**2;
    }
    this.fitQuality=norm?Math.max(0,1-residual/(norm*norm)):0;
    return this.coefficients;
  }
  update(spectrum,rms,time,threshold=.006){
    this.ambiguous=false;
    const levels=this.fit(spectrum);
    const witnesses=this.witnesses.map(groups=>groups.map(group=>Math.sqrt(group.reduce((sum,bin)=>sum+spectrum[bin]**2,0))));
    if(!this.previous){this.previous=Float64Array.from(levels);this.previousWitness=witnesses;this.envelopes=witnesses.map(values=>values.slice());return null;}
    const scores=new Float64Array(this.count),counts=[];
    let largest=0;
    for(let index=0;index<this.count;index++){
      const rising=witnesses[index].filter((value,group)=>value>.001&&value>this.envelopes[index][group]*1.07&&value-this.previousWitness[index][group]>Math.max(.0004,value*.06)).length;
      counts[index]=rising;
      const evidence=rising>=Math.min(2,this.witnesses[index].length)&&rising>0;
      const novelty=witnesses[index].reduce((sum,value,group)=>sum+Math.max(0,value-this.previousWitness[index][group]),0);
      if(evidence&&levels[index]>.003){scores[index]=novelty/Math.sqrt(witnesses[index].length);largest=Math.max(largest,scores[index]);}
      if(this.identical[index]&&levels[index]-this.previous[index]>.003&&rms>threshold)this.ambiguous=true;
    }
    if(!this.pending&&largest>.001&&rms>threshold&&time-this.lastTime>=40){
      this.pending={time,scores:new Float64Array(this.count),counts:new Uint8Array(this.count)};
    }
    this.previous.set(levels);this.previousWitness=witnesses;
    witnesses.forEach((values,index)=>values.forEach((value,group)=>{this.envelopes[index][group]=Math.max(value,this.envelopes[index][group]*.985);}));
    if(!this.pending)return null;
    const pending=this.pending;
    for(let index=0;index<this.count;index++){
      pending.scores[index]+=scores[index];pending.counts[index]=Math.max(pending.counts[index],counts[index]);
    }
    if(time-pending.time>85||rms<threshold){this.pending=null;return null;}
    // Wait for the attack's broad transient to settle before deciding which
    // source added energy. This prevents a neighbour winning the first frame.
    if(time-pending.time<40)return null;
    let winner=-1,score=0,runner=0;
    for(let index=0;index<this.count;index++){
      const last=this.lastByKey.get(this.keys[index].id)??-Infinity;
      const candidate=!this.identical[index]&&time-last>=95&&levels[index]>.003?pending.scores[index]*Math.sqrt(levels[index]):0;
      if(candidate>score){runner=score;score=candidate;winner=index;}else runner=Math.max(runner,candidate);
    }
    const margin=score?1-runner/score:0;
    const minimumQuality=winner>=0&&pending.counts[winner]>=2?.42:.75;
    if(winner<0||margin<.28||this.fitQuality<minimumQuality){this.ambiguous=true;return null;}
    const confidence=Math.min(1,this.fitQuality*.5+margin*.3+Math.min(1,pending.counts[winner]/2)*.2);
    if(confidence<.65){this.ambiguous=true;return null;}
    this.pending=null;this.lastTime=time;this.lastByKey.set(this.keys[winner].id,time);
    return {...this.keys[winner],confidence};
  }
}
