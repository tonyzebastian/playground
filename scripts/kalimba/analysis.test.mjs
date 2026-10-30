import test from 'node:test';
import assert from 'node:assert/strict';
import { Spectrum,ListeningEngine } from '../../src/features/kalimba/analysis.mjs';
import { toneProfile } from '../../src/features/kalimba/calibration.mjs';

const rate=48000,keys=[{id:0,frequency:261.63},{id:1,frequency:293.66}];
function render(keys,events,duration=1.8,noise=0){
  const engine=new ListeningEngine(rate,keys),frames=[];
  for(let start=0;start<rate*duration;start+=128){
    const samples=Float32Array.from({length:128},(_,i)=>{
      const t=(start+i)/rate;
      let value=noise*Math.sin((start+i)*1.9187);
      for(const event of events){const age=t-event.at;if(age>=0)value+=event.level*Math.exp(-age*5)*Math.sin(2*Math.PI*event.frequency*age);}
      return value;
    });
    const frame=engine.push(samples);if(frame)frames.push({...frame,time:(start+128)/rate*1000});
  }
  return frames;
}
test('FFT retains a known fundamental and amplitude',()=>{
  const fft=new Spectrum(),bin=31,f=bin*rate/4096;
  const spectrum=fft.update(Float32Array.from({length:4096},(_,i)=>.2*Math.sin(2*Math.PI*f*i/rate)));
  assert.ok(Math.abs(spectrum[bin]-.2)<.001);
});
test('streamed calibration counts three plucks without counting decay again',()=>{
  const frames=render([], [1,1.7,2.4].map(at=>({at,frequency:261.63,level:.2})),3.2);
  assert.equal(frames.filter(f=>f.pluck).length,3);
  assert.ok(frames.some(f=>f.checking));
  assert.ok(frames.filter(f=>f.pluck).every(f=>Math.abs(f.frequency-261.63)<2));
  assert.equal(toneProfile(frames).harmonics.length,3);
});
test('streamed fast alternating notes survive the previous note ringing',()=>{
  const frames=render(keys,[{at:1,frequency:261.63,level:.3},{at:1.1,frequency:293.66,level:.16},{at:1.22,frequency:261.63,level:.3}]);
  const hits=frames.filter(f=>f.pluck);
  assert.deepEqual(hits.map(f=>f.keyId),[0,1,0]);
  assert.ok(hits[0].time<1100,'first attack confirmed within 100 ms in synthetic audio');
});
test('background noise alone stays quiet',()=>{
  assert.equal(render(keys,[],1.8,.01).filter(f=>f.pluck).length,0);
});
test('clipped calibration audio is marked and not accepted as a pluck',()=>{
  const frames=render([],[{at:1,frequency:261.63,level:1.5}]);
  assert.ok(frames.some(f=>f.quality==='clipping'));
  assert.equal(frames.filter(f=>f.pluck).length,0);
});

// A tine: fundamental, weak 2nd harmonic, an inharmonic overtone that dies
// quickly, and a short contact click. A re-pluck stops the ringing tine for
// ~15 ms and releases it fresh, as a thumb does.
function tinePlucks(starts,duration,{levels=starts.map(()=>.2),frequency=329.63,decay=1.2,noise=.001,echo=0,clicks=[],clickLevel=0}={}){
  const total=Math.floor(duration*rate),audio=new Float32Array(total);
  let seed=7;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2147483648-1;};
  for(let i=0;i<total;i++){
    const t=i/rate,current=starts.findLastIndex(at=>t>=at);
    audio[i]=noise*random();
    for(const k of [current-1,current]){
      if(current<0||k<0)continue;
      const age=t-starts[k],fade=k===current?1:Math.max(0,1-(t-starts[current])/.015);
      if(fade)audio[i]+=fade*levels[k]*(Math.exp(-age*decay)*(Math.sin(2*Math.PI*frequency*age)+.1*Math.sin(4*Math.PI*frequency*age)+.18*Math.exp(-age*6)*Math.sin(2*Math.PI*frequency*6.2*age))+(age<.003?.3*random():0));
    }
    for(const at of clicks){const age=t-at;if(age>=0&&age<.004)audio[i]+=clickLevel*random()*Math.exp(-age*1500);}
  }
  if(echo){const dry=audio.slice();for(const [delay,gain] of [[.011,.5],[.023,.35],[.043,.25],[.083,.15]]){const offset=Math.floor(delay*rate);for(let i=offset;i<total;i++)audio[i]+=dry[i-offset]*gain*echo;}}
  const engine=new ListeningEngine(rate,[]),plucks=[];
  for(let start=0;start+128<=total;start+=128){const frame=engine.push(audio.subarray(start,start+128));if(frame?.pluck)plucks.push(frame);}
  return plucks;
}
test('setup counts quick re-plucks of a tine that is still ringing',()=>{
  for(const [frequency,decay] of [[196,.6],[329.63,1.2],[1174.7,2.5]])for(const gap of [.3,.5,1]){
    const starts=[1,1+gap,1+2*gap],plucks=tinePlucks(starts,1+3*gap+1,{frequency,decay});
    assert.equal(plucks.length,3,`${frequency} Hz, ${gap}s apart`);
    plucks.forEach((pluck,i)=>{const error=pluck.onset-starts[i]*1000;assert.ok(error>=0&&error<45,`onset ${Math.round(error)} ms after the attack`);});
  }
});
test('setup re-plucks still count in a room with echo',()=>{
  assert.equal(tinePlucks([1,1.5,2],3.2,{echo:1}).length,3);
});
test('clicks and bumps while a tine rings are not extra plucks',()=>{
  // Taps on the laptop, a nail touching a tine: louder than the note itself.
  for(const clickLevel of [.02,.1,.3])assert.equal(tinePlucks([1.6],6,{levels:[.06],frequency:594,decay:.8,clicks:[2.2,2.7,3.3,3.9,4.6],clickLevel}).length,1,`clicks at ${clickLevel}`);
  assert.equal(tinePlucks([1],5,{levels:[.1],frequency:196,decay:.3,clicks:[1.6,2.3,3,3.8],clickLevel:.3}).length,1,'slow low tine');
});
test('a long ring and room noise are not extra plucks',()=>{
  assert.equal(tinePlucks([1],5,{decay:.6}).length,1);
  assert.equal(tinePlucks([],4,{noise:.01}).length,0);
});
