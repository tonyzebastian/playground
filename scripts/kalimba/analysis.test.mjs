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
