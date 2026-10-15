import test from 'node:test';
import assert from 'node:assert/strict';
import {firstMissingKey,initialSong,nextSetupKey} from '../../src/features/kalimba/flow.mjs';
import {DEMO_MIDI,SONGS} from '../../src/features/kalimba/music.mjs';
const keys=DEMO_MIDI.map((midi,id)=>({id,midi}));
test('setup resumes at the first missing key',()=>{
  assert.equal(firstMissingKey([]),0);
  assert.equal(firstMissingKey(keys.filter(k=>k.id!==4)),4);
  assert.equal(firstMissingKey(keys),null);
});
test('saving the final key completes onboarding',()=>{
  assert.equal(nextSetupKey(keys,8),null);
  assert.equal(nextSetupKey(keys.filter(k=>k.id!==6),5),6);
});
test('record-all walks every key even when old recordings exist',()=>{
  assert.equal(nextSetupKey(keys,0,true),1);
  assert.equal(nextSetupKey(keys,8,true),null);
});
test('setup loads a playable basic song and remembers free play',()=>{
  assert.equal(initialSong(keys).id,'twinkle');
  assert.equal(initialSong(keys,'joy').id,'joy');
  assert.equal(initialSong(keys,'free'),null);
  assert.equal(initialSong([{id:0,midi:60}]),null);
  assert.ok(SONGS.includes(initialSong(keys,'unknown')));
});
