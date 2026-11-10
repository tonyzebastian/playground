import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const source=(await readFile(new URL('../../src/features/kalimba/audio.js',import.meta.url),'utf8')).replace(/'\.\/(pitch|listening|analysis|signatures|capture)\.mjs'/g,(_,name)=>JSON.stringify(new URL(`../../src/features/kalimba/${name}.mjs`,import.meta.url).href));
const {KalimbaAudio}=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};

function environment(getUserMedia){
  const previous=['window','navigator','requestAnimationFrame','cancelAnimationFrame'].map(name=>[name,Object.getOwnPropertyDescriptor(globalThis,name)]);
  class Context{
    state='running';sampleRate=48000;destination={};started=0;
    async resume(){} async close(){this.state='closed';}
    createMediaStreamSource(){return {connect(){},disconnect(){}};}
    createAnalyser(){this.analyser={frequencyBinCount:2048,disconnect(){},getFloatTimeDomainData(data){data.fill(0);},getFloatFrequencyData(data){data.fill(-Infinity);}};return this.analyser;}
    createBufferSource(){return {connect(){},disconnect(){},start:()=>this.started++,stop(){}};}
    async decodeAudioData(){return {sampleRate:24000,getChannelData:()=>Float32Array.from({length:48000},(_,i)=>i<12000?0:Math.sin(i*.1)*.4)};}
  }
  Object.defineProperty(globalThis,'window',{configurable:true,value:{AudioContext:Context,isSecureContext:true}});
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{mediaDevices:{getUserMedia}}});
  globalThis.requestAnimationFrame=()=>1;globalThis.cancelAnimationFrame=()=>{};
  return ()=>{for(const [name,descriptor]of previous){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];}};
}
test('microphone granted after cancellation is stopped immediately',async()=>{
  const pending=deferred(),requested=deferred();let stopped=0;
  const restore=environment(()=>{requested.resolve();return pending.promise;});const audio=new KalimbaAudio();
  try{
    const listening=audio.listen(()=>{});
    await requested.promise;audio.stopListening();
    pending.resolve({getTracks:()=>[{stop:()=>stopped++}]});
    assert.equal(await listening,false);assert.equal(stopped,1);assert.equal(audio.stream,null);
  }finally{audio.dispose();restore();}
});
test('active microphone tracks are released on stop',async()=>{
  let stopped=0;const track={stop:()=>stopped++};
  const restore=environment(async()=>({getTracks:()=>[track],getAudioTracks:()=>[track]}));const audio=new KalimbaAudio();
  try{assert.equal(await audio.listen(()=>{}),true);audio.stopListening();assert.equal(stopped,1);assert.equal(audio.stream,null);}
  finally{audio.dispose();restore();}
});
test('declined permissions return an actionable error',async()=>{
  const restore=environment(async()=>{throw Object.assign(new Error(),{name:'NotAllowedError'});});const audio=new KalimbaAudio();
  try{await assert.rejects(audio.listen(()=>{}),/website settings/);assert.equal(audio.stream,null);}
  finally{audio.dispose();restore();}
});
test('stopping playback cancels a sample that is still decoding',async()=>{
  const restore=environment();const audio=new KalimbaAudio();
  try{
    const context=await audio.unlock(),pending=deferred();context.decodeAudioData=()=>pending.promise;
    const playing=audio.play({blob:new Blob(['test'])});
    await Promise.resolve();await Promise.resolve();audio.stopPlayback();pending.resolve({});await playing;
    assert.equal(context.started,0);
  }finally{audio.dispose();restore();}
});
test('sample extraction creates a bounded mono PCM WAV',async()=>{
  const restore=environment();const audio=new KalimbaAudio();
  try{
    const sample=await audio.sample(new Blob(['test']));const bytes=await sample.arrayBuffer();
    assert.equal(sample.type,'audio/wav');assert.equal(new TextDecoder().decode(bytes.slice(0,4)),'RIFF');
    const header=new DataView(bytes);assert.equal(header.getUint16(22,true),1);assert.equal(header.getUint32(24,true),24000);
    assert.ok(bytes.byteLength<=44+24000*1.5*2);
  }finally{audio.dispose();restore();}
});

test('worklet messages are forwarded and disconnected on stop',async()=>{
  const track={stop(){}};const restore=environment(async()=>({getTracks:()=>[track],getAudioTracks:()=>[track]}));
  const audio=new KalimbaAudio(),frames=[];let closed=false,loaded=0;
  try{
    const context=await audio.unlock();context.audioWorklet={async addModule(){loaded++;}};
    window.AudioWorkletNode=class {port={close(){closed=true;}};connect(){} disconnect(){}};
    await audio.listen(frame=>frames.push(frame),null,[{id:4,frequency:261.63}]);
    const node=audio.worklet;node.port.onmessage({data:{keyId:4,frequency:261.63,pluck:true}});
    assert.equal(frames[0].keyId,4);audio.stopListening();assert.ok(closed);assert.equal(node.port.onmessage,null);
    await audio.listen(()=>{});assert.equal(loaded,1);
  }finally{audio.dispose();restore();}
});
test('cancelling while worklet loads never connects a stale microphone',async()=>{
  let stopped=0;const track={stop(){stopped++;}};const restore=environment(async()=>({getTracks:()=>[track],getAudioTracks:()=>[track]}));
  const audio=new KalimbaAudio(),pending=deferred();
  try{
    const context=await audio.unlock();context.audioWorklet={addModule:()=>pending.promise};
    window.AudioWorkletNode=class {constructor(){throw new Error('Must not connect');}};
    const listening=audio.listen(()=>{});await Promise.resolve();await Promise.resolve();await Promise.resolve();
    audio.stopListening();pending.resolve();assert.equal(await listening,false);assert.equal(stopped,1);
  }finally{audio.dispose();restore();}
});

test('sample extraction starts at a matching later pluck, skipping an earlier wrong note',async()=>{
  const restore=environment();const audio=new KalimbaAudio();
  try{
    const context=await audio.unlock(),rate=24000;
    context.decodeAudioData=async()=>({sampleRate:rate,getChannelData:()=>Float32Array.from({length:rate*3},(_,i)=>{
      const time=i/rate;
      return time<.8?.3*Math.sin(2*Math.PI*293.66*time):time>=1.5?.3*Math.sin(2*Math.PI*261.63*time):0;
    })});
    const sample=await audio.sample(new Blob(['test']),{startSeconds:1.38,duration:1.2});
    const view=new DataView(await sample.arrayBuffer());
    const samples=Float32Array.from({length:2048},(_,i)=>view.getInt16(44+(i+2400)*2,true)/32767);
    const {detectPitch}=await import('../../src/features/kalimba/pitch.mjs');
    assert.ok(Math.abs(detectPitch(samples,rate).frequency-261.63)<2);
    assert.ok(sample.size<=44+rate*1.2*2);
  }finally{audio.dispose();restore();}
});

test('old saved WAVs are learned once and cached without changing the recordings',async()=>{
  const restore=environment();const audio=new KalimbaAudio();
  try{
    const context=await audio.unlock();let decodes=0;
    context.decodeAudioData=async()=>{decodes++;return {sampleRate:48000,getChannelData:()=>Float32Array.from({length:48000},(_,i)=>.2*Math.exp(-i/14000)*Math.sin(2*Math.PI*261.63*i/48000))};};
    const blob=new Blob(['original']),original={id:0,midi:60,frequency:261.63,blob};
    const prepared=await audio.prepareKeys([original]);
    assert.equal(prepared[0].profile.signature.rate,48000);assert.equal(prepared[0].profile.signature.bins.length,2048);
    assert.equal(prepared[0].blob,blob);assert.equal(original.profile,undefined);
    await audio.prepareKeys([{...original}]);assert.equal(decodes,1);
  }finally{audio.dispose();restore();}
});
test('cancelled signature preparation never opens the microphone',async()=>{
  let requested=0;const restore=environment(async()=>{requested++;throw new Error('Must not open');});const audio=new KalimbaAudio();
  try{
    const context=await audio.unlock(),pending=deferred(),started=deferred();
    context.decodeAudioData=()=>{started.resolve();return pending.promise;};
    const listening=audio.listen(()=>{},null,[{id:0,frequency:261.63,blob:new Blob(['test'])}]);
    await started.promise;audio.stopListening();
    pending.resolve({sampleRate:48000,getChannelData:()=>new Float32Array(48000)});
    assert.equal(await listening,false);assert.equal(requested,0);
  }finally{audio.dispose();restore();}
});
test('an unreadable legacy recording keeps a safe fallback instead of breaking listening',async()=>{
  const restore=environment();const audio=new KalimbaAudio();
  try{
    const context=await audio.unlock();context.decodeAudioData=async()=>{throw new Error('Unsupported sample');};
    const prepared=await audio.prepareKeys([{id:0,frequency:261.63,blob:new Blob(['old'])}]);
    assert.equal(prepared[0].frequency,261.63);assert.equal(prepared[0].profile.signature,undefined);
  }finally{audio.dispose();restore();}
});
