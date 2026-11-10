import test from 'node:test';
import assert from 'node:assert/strict';
import { detectPitch, PluckGate } from '../../src/features/kalimba/pitch.mjs';
import { mapSong, nearestKey, SONGS, frequencyOf, DEMO_MIDI } from '../../src/features/kalimba/music.mjs';

for(const frequency of [130.81,261.63,440,659.25,1046.5,1760]){
  test(`fundamental ${frequency} Hz survives harmonics and deterministic noise`,()=>{
    const rate=24000;
    const signal=Float32Array.from({length:2048},(_,i)=>.2*Math.sin(i*2*Math.PI*frequency/rate)+.32*Math.sin(i*4*Math.PI*frequency/rate)+.015*Math.sin(i*12.345));
    const result=detectPitch(signal,rate);
    assert.ok(result.frequency);
    assert.ok(Math.abs(1200*Math.log2(result.frequency/frequency))<12,`Detected ${result.frequency}`);
  });
}
test('silence does not become a note',()=>assert.equal(detectPitch(new Float32Array(2048),24000).frequency,null));
test('ringing does not advance repeated notes; a confirmed fresh attack does',()=>{
  const gate=new PluckGate();
  assert.ok(gate.update({frequency:440,rms:.1},0));
  assert.equal(gate.update({frequency:440,rms:.08},300),false);
  assert.equal(gate.update({frequency:440,rms:.04},600),false);
  // While a note rings, a loudness jump alone is often a click or bump.
  assert.equal(gate.update({frequency:440,rms:.1},900),false);
  // An onset confirmed against the note itself counts, timed from its start.
  assert.ok(gate.update({frequency:440,rms:.1},1100,.006,1000));
  assert.equal(gate.onsetTime,1000);
});
test('a noisy attack can resolve to a pitched pluck shortly afterwards',()=>{
  const gate=new PluckGate();
  assert.equal(gate.update({frequency:null,rms:.1},0),false);
  assert.ok(gate.update({frequency:440,rms:.08},60));
});
test('song transposition preserves every interval and rejects unavailable notes',()=>{
  const keys=DEMO_MIDI.map((midi,id)=>({midi,id,frequency:frequencyOf(midi)}));
  for(const song of SONGS){
    const result=mapSong(song,keys);
    if(result)result.sequence.forEach((item,i)=>assert.equal(item.midi-result.root,song.notes[i]));
  }
  assert.ok(mapSong(SONGS[0],keys));
  assert.equal(mapSong(SONGS[0],[keys[0]]),null);
});
test('nearest key rejects distant notes and indistinguishable tines',()=>{
  assert.equal(nearestKey(440,[{id:0,frequency:440}]).id,0);
  assert.equal(nearestKey(470,[{id:0,frequency:440}]),null);
  assert.equal(nearestKey(440,[{id:0,frequency:440},{id:1,frequency:441}]),null);
});

test('all songs have labelled playable arrangements for a complete non-standard tuning',async()=>{
 const {playableSong}=await import('../../src/features/kalimba/music.mjs');
 const keys=[60,62,63,66,68,70,73,75,78].map((midi,id)=>({id,midi,frequency:frequencyOf(midi)}));
 assert.equal(SONGS.filter(song=>mapSong(song,keys)).length,0);
 for(const song of SONGS){
  const arrangement=playableSong(song,keys);
  assert.ok(arrangement?.adapted);
  assert.equal(arrangement.sequence.length,song.notes.length);
  arrangement.sequence.forEach((item,index)=>{
   assert.equal(item.beats,song.beats[index]??1);
   assert.ok(keys.some(key=>key.id===item.key&&key.midi===item.midi));
   if(index)assert.equal(Math.sign(item.midi-arrangement.sequence[index-1].midi),Math.sign(song.notes[index]-song.notes[index-1]));
  });
 }
});
test('exact arrangements remain preferred and unmodified',async()=>{
 const {playableSong}=await import('../../src/features/kalimba/music.mjs');
 const keys=DEMO_MIDI.map((midi,id)=>({id,midi}));
 for(const song of SONGS){
  const exact=mapSong(song,keys);
  if(exact){const result=playableSong(song,keys);assert.equal(result.adapted,false);assert.deepEqual(result.sequence,exact.sequence);}
 }
});
test('adapted arrangements require a complete instrument and are independent of key order',async()=>{
 const {playableSong}=await import('../../src/features/kalimba/music.mjs');
 const keys=[60,62,63,66,68,70,73,75,78].map((midi,id)=>({id,midi}));
 assert.equal(playableSong(SONGS[0],keys.slice(0,8)),null);
 assert.deepEqual(playableSong(SONGS[0],keys),playableSong(SONGS[0],[...keys].reverse()));
});
