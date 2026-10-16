import test from 'node:test';
import assert from 'node:assert/strict';
import {learnSignature,TemplatePlucks,validSignature} from '../../src/features/kalimba/signatures.mjs';
import {ListeningEngine} from '../../src/features/kalimba/analysis.mjs';
const rate=48000;
const fixtures=[
 {id:0,frequency:261.63,modes:[[1,1],[2,.5],[3,.16],[5.37,.17]]},
 {id:1,frequency:274.8,modes:[[1,1],[2,.13],[3,.4],[4.83,.21]]},
 {id:2,frequency:523.26,modes:[[1,1],[2,.35],[3,.11],[5.18,.19]]},
];
[329.63,349.23,392,440,493.88,587.33].forEach((frequency,index)=>fixtures.push({id:index+3,frequency,modes:[[1,1],[2,.3],[3,.15],[5.1+index*.03,.2]]}));
const tone=(key,age,level=1)=>age<0?0:level*Math.exp(-age*3.5)*key.modes.reduce((sum,[ratio,amplitude])=>sum+amplitude*Math.sin(2*Math.PI*key.frequency*ratio*age),0);
const keys=fixtures.map(key=>({...key,profile:{signature:learnSignature(Float32Array.from({length:rate},(_,i)=>tone(key,i/rate,.2)),rate)}}));
function render(events,duration=2.4,chosen=keys,noise=0){
 const engine=new ListeningEngine(rate,chosen),frames=[];let seed=17;
 for(let start=0;start<rate*duration;start+=128){
  const samples=Float32Array.from({length:128},(_,i)=>{
   seed=(Math.imul(seed,1664525)+1013904223)>>>0;
   return noise*(seed/2147483648-1)+events.reduce((sum,event)=>sum+tone(event.modes?{...fixtures[event.id],modes:event.modes}:fixtures[event.id],(start+i)/rate-event.at,event.level),0);
  });
  const frame=engine.push(samples);if(frame)frames.push(frame);
 }
 return frames;
}
test('full sound signatures retain more detail than just a pitch and three harmonics',()=>{
 assert.ok(validSignature(keys[0].profile.signature,rate));
 assert.equal(validSignature(keys[0].profile.signature,44100),false);
 assert.notDeepEqual(keys[0].profile.signature.bins,keys[1].profile.signature.bins);
 assert.equal(learnSignature(new Float32Array(rate),rate),null);
});
test('close-pitched keys remain separate while their tails overlap',()=>{
 const frames=render([{id:0,at:1,level:.25},{id:1,at:1.18,level:.16},{id:0,at:1.38,level:.23}]);
 const hits=frames.filter(frame=>frame.pluck);
 assert.deepEqual(hits.map(frame=>frame.keyId),[0,1,0]);
 assert.ok(hits.every(frame=>frame.confidence>=.65));
});
test('a soft higher note is recognised over the lower key’s ringing harmonic',()=>{
 const hits=render([{id:0,at:1,level:.3},{id:2,at:1.23,level:.075}]).filter(frame=>frame.pluck);
 assert.deepEqual(hits.map(frame=>frame.keyId),[0,2]);
});
test('one ringing pluck never becomes a neighbouring key or extra note',()=>{
 const hits=render([{id:0,at:1,level:.3}],3).filter(frame=>frame.pluck);
 assert.deepEqual(hits.map(frame=>frame.keyId),[0]);
});
test('a quiet new key survives louder earlier ringing',()=>{
 const hits=render([{id:0,at:1,level:.3},{id:1,at:1.24,level:.06}]).filter(frame=>frame.pluck);
 assert.deepEqual(hits.map(frame=>frame.keyId),[0,1]);
});
test('same-key repeats are recognised without duplicate tail triggers',()=>{
 const hits=render([{id:1,at:1,level:.2},{id:1,at:1.16,level:.2},{id:1,at:1.34,level:.2}]).filter(frame=>frame.pluck);
 assert.deepEqual(hits.map(frame=>frame.keyId),[1,1,1]);
});
test('broadband background noise does not become a learned key',()=>{
 assert.equal(render([],2.4,keys,.015).filter(frame=>frame.pluck).length,0);
});
test('near-identical learned sounds are ambiguous rather than arbitrarily picking a key',()=>{
 const identical=[keys[0],{...keys[0],id:8}];
 const tracker=new TemplatePlucks(identical,rate);
 assert.deepEqual(tracker.identical,[true,true]);
 const frames=render([{id:0,at:1,level:.2}],2.4,identical);
 assert.equal(frames.filter(frame=>frame.pluck).length,0);
 assert.ok(frames.some(frame=>frame.ambiguous));
});
test('changes in playing strength and spectral balance keep the same key identity',()=>{
 const modes=fixtures[1].modes.map(([ratio,level],index)=>[ratio,level*(index?1.7:.7)]);
 const hits=render([{id:1,at:1,level:.075,modes}]).filter(frame=>frame.pluck);
 assert.deepEqual(hits.map(frame=>frame.keyId),[1]);
});
test('quiet isolated plucks can use the existing louder calibration',()=>{
 const hits=render([{id:0,at:1,level:.04}]).filter(frame=>frame.pluck);
 assert.deepEqual(hits.map(frame=>frame.keyId),[0]);
});
test('a broadband impact does not count as one of the calibrated notes',()=>{
 const engine=new ListeningEngine(rate,keys),hits=[];let seed=111;
 for(let start=0;start<rate*2.4;start+=128){
  const samples=Float32Array.from({length:128},(_,i)=>{
   const age=(start+i)/rate-1;seed=(Math.imul(seed,1664525)+1013904223)>>>0;
   return age>=0?.3*Math.exp(-age*30)*(seed/2147483648-1):0;
  });
  const frame=engine.push(samples);if(frame?.pluck)hits.push(frame);
 }
 assert.equal(hits.length,0);
});
test('clipped live input does not trigger a delayed note from its decaying tail',()=>{
 const engine=new ListeningEngine(rate,keys),hits=[];
 for(let start=0;start<rate*2.4;start+=128){
  const samples=Float32Array.from({length:128},(_,i)=>Math.max(-1,Math.min(1,tone(fixtures[0],(start+i)/rate-1,1.8))));
  const frame=engine.push(samples);if(frame?.pluck)hits.push(frame);
 }
 assert.equal(hits.length,0);
});
test('every key can be recognised against the full nine-key dictionary',()=>{
 for(const key of keys){
  const hits=render([{id:key.id,at:1,level:.12}],2).filter(frame=>frame.pluck);
  assert.deepEqual(hits.map(frame=>frame.keyId),[key.id],`key ${key.id+1}`);
 }
});
