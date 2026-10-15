import test from 'node:test';
import assert from 'node:assert/strict';
import {calibrationMatch,analyseCalibration,assertUniqueKey} from '../../src/features/kalimba/calibration.mjs';
const c=261.63,shift=cents=>c*2**(cents/1200),frames=Array(12).fill(c);
test('two close references accept a third around 85–90% consistency',()=>{
 const result=analyseCalibration(frames,[c,shift(5),shift(60)]);
 assert.equal(result.accepted,true);assert.equal(result.midi,60);
 assert.ok(result.similarities[2]>=85&&result.similarities[2]<=90);
 assert.ok(result.match>=90);
});
test('a different semitone cannot masquerade as the tolerant third pluck',()=>{
 assert.equal(calibrationMatch([c,c,shift(100)]).accepted,false);
 assert.throws(()=>analyseCalibration(frames,[c,c,shift(100)]),/No consistent set/);
});
test('two agreeing plucks alone do not finish setup',()=>{
 assert.equal(calibrationMatch([c,c]).accepted,false);
 assert.throws(()=>analyseCalibration(frames,[c,c]),/three clear plucks/);
});
test('a fourth attempt keeps the good earlier plucks',()=>{
 const result=analyseCalibration(frames,[c,c,293.66,shift(10)]);
 assert.deepEqual(result.indexes,[0,1,3]);
});
test('best matching three can be recovered across all six attempts',()=>{
 const result=analyseCalibration(frames,[293.66,c,329.63,shift(4),392,shift(30)]);
 assert.deepEqual(result.indexes,[1,3,5]);assert.equal(result.midi,60);
});
test('six unrelated notes still require a fresh set',()=>{
 assert.equal(calibrationMatch([c,293.66,329.63,349.23,392,440]).accepted,false);
});
test('a harmonic octave is not accepted as a similar pluck',()=>{
 assert.equal(calibrationMatch([c,c,c*2]).accepted,false);
});
test('discarded first attempts do not choose the saved note',()=>{
 const plucks=[293.66,c,shift(2),shift(8)].map((frequency,i)=>({frequency,time:1000+i*1500}));
 const result=analyseCalibration([...Array(20).fill(293.66),...frames],plucks);
 assert.equal(result.midi,60);assert.deepEqual(result.indexes,[1,2,3]);
});
test('more forgiving matching preserves duplicate-key protection',()=>{
 const result=analyseCalibration(frames,[c,shift(5),shift(60)]);
 assert.throws(()=>assertUniqueKey({id:1,...result},[{id:0,midi:60,frequency:c}]),/already saved/);
});
