import test from 'node:test';
import assert from 'node:assert/strict';
import {CAPTURE_FORMAT,captureScript,confusionTable,decodeWav,encodeWav,scoreCapture} from '../../src/features/kalimba/capture.mjs';
import {frequencyOf} from '../../src/features/kalimba/music.mjs';
import {replayCapture} from './replay.mjs';

const rate=48000;
const dataUrl=samples=>`data:audio/wav;base64,${Buffer.from(encodeWav(samples,rate)).toString('base64')}`;
const tine=(frequency,age)=>age<0?0:Math.exp(-age*2.5)*(Math.sin(2*Math.PI*frequency*age)+.25*Math.sin(4*Math.PI*frequency*age)+.15*Math.exp(-age*6)*Math.sin(2*Math.PI*frequency*6.2*age));
function render(events,seconds){
  const audio=new Float32Array(Math.floor(seconds*rate));
  for(const {at,frequency,level} of events)for(let i=Math.floor(at*rate);i<audio.length;i++)audio[i]+=level*tine(frequency,i/rate-at);
  for(let i=0;i<audio.length;i++)audio[i]+=.0008*Math.sin(i*1.9187)*Math.sin(i*.0137);
  return audio;
}
const keys=[60,62,64,65,67,69,71,72,74].map((midi,id)=>({id,midi,frequency:frequencyOf(midi),profile:{harmonics:[1,.25,0],decayMs:300}}));
const savedKeys=keys.map(key=>({...key,audio:dataUrl(render([{at:.05,frequency:key.frequency,level:.25}],1.5))}));

test('WAV encoding round-trips 16-bit audio',()=>{
  const samples=Float32Array.from({length:480},(_,i)=>Math.sin(i/10)*.5);
  const decoded=decodeWav(encodeWav(samples,rate));
  assert.equal(decoded.rate,rate);assert.equal(decoded.samples.length,480);
  assert.ok(decoded.samples.every((value,i)=>Math.abs(value-samples[i])<1e-4));
});
test('the capture script covers every key and each pitch-neighbour pair',()=>{
  const script=captureScript(keys);
  assert.deepEqual(script.slice(0,9),[0,1,2,3,4,5,6,7,8]);
  assert.equal(script.length,9+9+8*4);
  assert.deepEqual(script.slice(18,22),[0,1,0,1]);
});
test('scoring separates right, wrong, missed and extra detections',()=>{
  const cues=[{key:0,time:1000},{key:1,time:2000},{key:2,time:3000}];
  const score=scoreCapture(cues,[{time:1100,keyId:0},{time:2050,keyId:2},{time:2500,keyId:2},{time:5000,keyId:4}]);
  assert.deepEqual(score.rows.map(row=>row.result),['right','wrong','missed']);
  assert.equal(score.extras.length,2);
  assert.match(confusionTable(score.rows,[0,1,2]),/key 2/);
});
test('a listening capture replays through the engine and is scored against its cues',()=>{
  const order=[0,4,8,2,6,1,5,3,7,4,3,4];
  const cues=order.map((key,i)=>({key,time:3000+i*700}));
  const audio=render(cues.map(cue=>({at:cue.time/1000+.08,frequency:keys[cue.key].frequency,level:.2})),3+order.length*.7+1.5);
  const report=replayCapture({format:CAPTURE_FORMAT,mode:'listen',rate,createdAt:'test',cues,detections:[],keys:savedKeys,audio:dataUrl(audio)});
  assert.ok(report.replay.right>=order.length-1,report.lines.join('\n'));
  assert.equal(report.replay.wrong,0,report.lines.join('\n'));
  assert.ok(report.lines.some(line=>line.includes('spectral templates')));
});
test('a setup capture reports counted plucks and the calibration outcome',()=>{
  const audio=render([1.2,1.6,2.0].map(at=>({at,frequency:keys[2].frequency,level:.2})),3.5);
  const report=replayCapture({format:CAPTURE_FORMAT,mode:'setup',key:2,outcome:'test',rate,createdAt:'test',plucks:[],keys:[],audio:dataUrl(audio)});
  assert.equal(report.plucks.length,3,report.lines.join('\n'));
  assert.ok(report.match.accepted);
  assert.ok(report.lines.includes('calibration: would save'),report.lines.join('\n'));
});
