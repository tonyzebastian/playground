import test from 'node:test';
import assert from 'node:assert/strict';
import {PitchLatch,SpectralPlucks} from '../../src/features/kalimba/listening.mjs';
import {PluckGate} from '../../src/features/kalimba/pitch.mjs';
import {analyseCalibration,assertUniqueKey} from '../../src/features/kalimba/calibration.mjs';
import {frequencyOf} from '../../src/features/kalimba/music.mjs';
const keys=[60,62,72].map((midi,id)=>({id,midi,frequency:frequencyOf(midi)}));
const binHz=48000/4096;
function spectrum(notes){
 const data=new Float32Array(2048);
 for(const [frequency,amplitude] of notes){
  for(const [harmonic,weight] of [[1,1],[2,.5],[3,.2]]){
   const centre=frequency*harmonic/binHz;
   for(let i=Math.floor(centre)-2;i<=Math.ceil(centre)+2;i++)if(i>0&&i<data.length)data[i]+=amplitude*weight*Math.exp(-((i-centre)**2)/.8);
  }
 }
 return data;
}
test('duplicate note labels and near-identical frequencies cannot be saved on another tine',()=>{
 assert.throws(()=>assertUniqueKey({id:8,midi:60,frequency:262},keys),/key 1/);
 assert.throws(()=>assertUniqueKey({id:8,midi:65,frequency:262},keys),/key 1/);
 assert.doesNotThrow(()=>assertUniqueKey({id:0,midi:60,frequency:262},keys));
 assert.doesNotThrow(()=>assertUniqueKey({id:8,midi:77,frequency:frequencyOf(77)},keys));
});
test('octaves are different notes, not duplicate recordings',()=>{
 assert.doesNotThrow(()=>assertUniqueKey({id:8,midi:72,frequency:frequencyOf(72)},[keys[0]]));
});
test('calibration needs repeated independent plucks, not just a long ringing note',()=>{
 const frames=Array(12).fill(261.63);
 assert.throws(()=>analyseCalibration(frames,[261.63]),/two clear plucks/);
 assert.equal(analyseCalibration(frames,[261.63,261.8,261.5]).midi,60);
 assert.throws(()=>analyseCalibration(frames,[261.63,293.66,261.63]),/different notes/);
});
test('calibration rejects unstable measurements even when they round to one note',()=>{
 const frames=[...Array(6).fill(256),...Array(6).fill(267)];
 assert.throws(()=>analyseCalibration(frames,[261,261]),/unstable/);
});
test('pitch needs two consistent frames before being trusted',()=>{
 const latch=new PitchLatch();
 assert.equal(latch.update({frequency:440,confidence:.99,rms:.1}).frequency,null);
 assert.ok(latch.update({frequency:441,confidence:.99,rms:.1}).frequency);
 assert.equal(latch.update({frequency:660,confidence:.99,rms:.1}).frequency,null);
 assert.equal(latch.update({frequency:660,confidence:.5,rms:.1}).frequency,null);
});
test('a pitch change in a decaying sound does not count as a fresh pluck',()=>{
 const gate=new PluckGate();
 assert.ok(gate.update({frequency:262,rms:.1},0));
 assert.equal(gate.update({frequency:524,rms:.07},180),false);
});
test('a softer new note is recognised over a louder old note',()=>{
 const tracker=new SpectralPlucks(keys,binHz);
 tracker.update(spectrum([]),0,0);
 assert.equal(tracker.update(spectrum([[keys[0].frequency,.5]]),.2,30),null);
 assert.equal(tracker.update(spectrum([[keys[0].frequency,.48]]),.2,60)?.id,0);
 assert.equal(tracker.update(spectrum([[keys[0].frequency,.4]]),.18,150),null);
 tracker.update(spectrum([[keys[0].frequency,.35],[keys[1].frequency,.08]]),.18,210);
 assert.equal(tracker.update(spectrum([[keys[0].frequency,.33],[keys[1].frequency,.075]]),.17,240)?.id,1);
 assert.equal(tracker.update(spectrum([[keys[0].frequency,.3],[keys[1].frequency,.07]]),.16,300),null);
});
test('fresh octave notes are distinguished from ringing lower-note harmonics',()=>{
 const tracker=new SpectralPlucks(keys,binHz);
 tracker.update(spectrum([]),0,0);
 tracker.update(spectrum([[keys[0].frequency,.2]]),.1,30);
 assert.equal(tracker.update(spectrum([[keys[0].frequency,.19]]),.1,60)?.id,0);
 tracker.update(spectrum([[keys[0].frequency,.15],[keys[2].frequency,.1]]),.1,210);
 assert.equal(tracker.update(spectrum([[keys[0].frequency,.14],[keys[2].frequency,.095]]),.1,240)?.id,2);
});
test('same-key re-plucks can be recognised 150 ms apart without repeat triggers',()=>{
 const tracker=new SpectralPlucks(keys,binHz);
 tracker.update(spectrum([]),0,0);
 tracker.update(spectrum([[keys[1].frequency,.2]]),.1,30);
 assert.equal(tracker.update(spectrum([[keys[1].frequency,.19]]),.1,60)?.id,1);
 tracker.update(spectrum([[keys[1].frequency,.1]]),.07,150);
 tracker.update(spectrum([[keys[1].frequency,.25]]),.14,180);
 assert.equal(tracker.update(spectrum([[keys[1].frequency,.24]]),.13,210)?.id,1);
 assert.equal(tracker.update(spectrum([[keys[1].frequency,.22]]),.12,360),null);
});
test('broadband noise changes do not become a recognised key',()=>{
 const tracker=new SpectralPlucks(keys,binHz);
 tracker.update(new Float32Array(2048).fill(.001),.02,0);
 assert.equal(tracker.update(new Float32Array(2048).fill(.003),.04,30),null);
 assert.equal(tracker.update(new Float32Array(2048).fill(.003),.04,60),null);
});
