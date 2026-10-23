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

// A tine: fundamental, weak 2nd harmonic, and an inharmonic overtone that dies
// quickly. Re-plucks add to the ringing note rather than replacing it.
function tinePlucks(events,duration,{noise=.001,echo=0}={}){
  const total=Math.floor(duration*rate),audio=new Float32Array(total);
  for(const {at,level,frequency=329.63,phase=0} of events){
    for(let i=Math.floor(at*rate);i<total;i++){
      const age=i/rate-at;
      audio[i]+=level*Math.exp(-age*1.2)*(Math.sin(2*Math.PI*frequency*age+phase)+.1*Math.sin(4*Math.PI*frequency*age)+.18*Math.exp(-age*6)*Math.sin(2*Math.PI*frequency*6.2*age));
    }
  }
  if(echo){const dry=audio.slice();for(const [delay,gain] of [[.011,.5],[.023,.35],[.043,.25],[.083,.15]]){const offset=Math.floor(delay*rate);for(let i=offset;i<total;i++)audio[i]+=dry[i-offset]*gain*echo;}}
  for(let i=0;i<total;i++)audio[i]+=noise*Math.sin(i*1.9187)*Math.sin(i*.0137);
  const engine=new ListeningEngine(rate,[]),plucks=[];
  for(let start=0;start+128<=total;start+=128){const frame=engine.push(audio.subarray(start,start+128));if(frame?.pluck)plucks.push(frame);}
  return plucks;
}
test('setup counts soft re-plucks of a tine that is still ringing',()=>{
  for(const [gap,ratio] of [[.3,1],[.4,.35],[.7,.6],[1,.35]]){
    const plucks=tinePlucks([0,1,2].map(i=>({at:1+i*gap,level:.2*(i?ratio:1),phase:i*2.1})),1+3*gap+1);
    assert.equal(plucks.length,3,`${gap}s apart at ${ratio*100}%`);
    plucks.forEach((pluck,i)=>{const error=pluck.onset-(1+i*gap)*1000;assert.ok(error>=0&&error<45,`onset ${Math.round(error)} ms after the attack`);});
  }
});
test('setup re-plucks still count in a room with echo',()=>{
  assert.equal(tinePlucks([0,1,2].map(i=>({at:1+i*.4,level:.2*(i?.6:1),phase:i*2.1})),3,{echo:1}).length,3);
});
test('a long ring, beating tines, and room noise are not extra plucks',()=>{
  assert.equal(tinePlucks([{at:1,level:.25}],5).length,1);
  assert.equal(tinePlucks([{at:1,level:.25},{at:1,level:.08,frequency:329.63*1.004}],5).length,1);
  assert.equal(tinePlucks([],4,{noise:.01}).length,0);
});
