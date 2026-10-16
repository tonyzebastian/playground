import { ListeningEngine } from './analysis.mjs';
import { learnSignature, validSignature } from './signatures.mjs';

export class KalimbaAudio {
  constructor(){this.stream=null;this.context=null;this.frame=0;this.generation=0;this.playGeneration=0;this.recorder=null;this.sources=new Set();this.signatures=new WeakMap();}
  async unlock(){
    if(!this.context || this.context.state==='closed'){
      const Context=window.AudioContext||window.webkitAudioContext;
      if(!Context) throw new Error('This browser doesn’t support audio. Try Safari or Chrome.');
      this.context=new Context({latencyHint:'interactive'});this.workletModule=null;
    }
    await this.context.resume();
    return this.context;
  }
  async listen(onFrame,onEnd,keys=[]){
    this.stopListening();const generation=this.generation;
    if(!window.isSecureContext) throw new Error('Open the HTTPS version of this page to use the microphone.');
    if(!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone access isn’t available in this browser.');
    await this.unlock();
    const prepared=await this.prepareKeys(keys);
    if(generation!==this.generation)return false;
    let stream;
    try{stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false},video:false});}
    catch(error){
      if(error.name==='NotAllowedError') throw new Error('Microphone access was declined. Allow it in your browser’s website settings, then try again.');
      throw new Error('Couldn’t open the microphone. Check that another app isn’t using it and try again.');
    }
    if(generation!==this.generation){stream.getTracks().forEach(t=>t.stop());return false;}
    this.stream=stream;
    stream.getAudioTracks()[0].onended=()=>{this.stopListening();onEnd?.();};
    try{
      if(this.context.audioWorklet&&window.AudioWorkletNode){
        if(!this.workletModule)this.workletModule=this.context.audioWorklet.addModule('/kalimba-audio/processor.js?v=3').catch(error=>{this.workletModule=null;throw error;});
        await this.workletModule;
        if(generation!==this.generation)return false;
        const input=this.context.createMediaStreamSource(stream);
        const node=new window.AudioWorkletNode(this.context,'kalimba-listener',{
          numberOfInputs:1,numberOfOutputs:1,outputChannelCount:[1],
          processorOptions:{keys:prepared.map(({id,frequency,profile})=>({id,frequency,profile}))},
        });
        this.input=input;this.worklet=node;
        let lastUi=-Infinity;
        node.port.onmessage=event=>{
          if(generation!==this.generation)return;
          const frame=event.data;
          // Keep note events immediate; the visual level meter needs only 25 Hz.
          if(keys.length&&!frame.pluck&&frame.time-lastUi<40)return;
          lastUi=frame.time;onFrame(frame);
        };
        node.onprocessorerror=()=>{if(generation===this.generation){this.stopListening();onEnd?.();}};
        input.connect(node);node.connect(this.context.destination);
      }else{
        // Compatibility for older browsers; normal Safari/Chrome use the worklet.
        const input=this.context.createMediaStreamSource(stream),analyser=this.context.createAnalyser();
        analyser.fftSize=4096;analyser.smoothingTimeConstant=0;input.connect(analyser);
        this.input=input;this.analyser=analyser;
        const engine=new ListeningEngine(this.context.sampleRate,prepared),buffer=new Float32Array(4096);
        this.frame=setInterval(()=>{
          if(generation!==this.generation)return;
          analyser.getFloatTimeDomainData(buffer);
          // The analyser returns a rolling window; feed only the new hop.
          const hop=Math.round(this.context.sampleRate*.022);
          const result=engine.push(buffer.subarray(buffer.length-hop));
          if(result)onFrame(result);
        },22);
      }
      return true;
    }catch(error){if(generation===this.generation)this.stopListening();throw error;}
  }

  async prepareKeys(keys){
    const prepared=[];
    for(const key of keys){
      if(validSignature(key.profile?.signature,this.context.sampleRate)||!key.blob){prepared.push(key);continue;}
      let signature=this.signatures.get(key.blob);
      if(!validSignature(signature,this.context.sampleRate)){
        try{
          const decoded=await this.context.decodeAudioData(await key.blob.arrayBuffer());
          signature=learnSignature(decoded.getChannelData(0),decoded.sampleRate);
          if(signature)this.signatures.set(key.blob,signature);
        }catch{/* Old or unsupported samples keep the conservative pitch fallback. */}
      }
      prepared.push({...key,profile:{...key.profile,signature}});
    }
    return prepared;
  }

  startRecording(){
    if(!window.MediaRecorder)throw new Error('Recording isn’t supported here. Try Safari or Chrome.');
    const mime=['audio/mp4','audio/webm;codecs=opus','audio/webm','audio/ogg'].find(type=>MediaRecorder.isTypeSupported(type));
    const recorder=new MediaRecorder(this.stream,mime?{mimeType:mime}:undefined);
    const chunks=[];this.recorder=recorder;
    this.recording=new Promise((resolve,reject)=>{
      recorder.ondataavailable=event=>{if(event.data.size)chunks.push(event.data);};
      recorder.onerror=()=>reject(new Error('Recording was interrupted. Please try this key again.'));
      recorder.onstop=()=>resolve(new Blob(chunks,{type:recorder.mimeType}));
    });
    // Attach a rejection handler immediately; callers still receive the error.
    this.recording.catch(()=>{});recorder.start();
  }
  async finishRecording(){
    const promise=this.recording;
    if(this.recorder?.state==='recording')this.recorder.stop();
    this.recorder=null;this.recording=null;
    return promise?await promise:null;
  }
  stopListening(){
    this.generation++;clearInterval(this.frame);
    if(this.recorder?.state==='recording')this.recorder.stop();
    this.recorder=null;
    this.stream?.getTracks().forEach(track=>{track.onended=null;track.stop();});this.stream=null;
    if(this.worklet){this.worklet.port.onmessage=null;this.worklet.onprocessorerror=null;this.worklet.port.close();this.worklet.disconnect();this.worklet=null;}
    this.input?.disconnect();this.analyser?.disconnect();this.input=null;this.analyser=null;
  }
  async sample(blob,{startSeconds=0,duration=1.5}={}){
    const context=await this.unlock();
    const decoded=await context.decodeAudioData(await blob.arrayBuffer());
    const data=decoded.getChannelData(0),rate=decoded.sampleRate;
    // Start at a matching pluck, rather than replaying a discarded first attempt.
    const offset=Math.max(0,Math.min(data.length-1,Math.floor(startSeconds*rate)));
    const limit=Math.min(data.length,offset+Math.floor(Math.max(.15,Math.min(1.5,duration))*rate));
    let peak=0;for(let i=offset;i<limit;i++)peak=Math.max(peak,Math.abs(data[i]));
    let start=offset;while(start<limit&&Math.abs(data[start])<peak*.25)start++;
    start=Math.max(offset,start-Math.floor(rate*.025));
    const end=Math.min(limit,start+Math.floor(rate*1.5));
    const length=end-start;
    if(!length)throw new Error('The recording was empty. Please try again.');
    const wav=new ArrayBuffer(44+length*2),view=new DataView(wav);
    const text=(at,s)=>{for(let i=0;i<s.length;i++)view.setUint8(at+i,s.charCodeAt(i));};
    text(0,'RIFF');view.setUint32(4,36+length*2,true);text(8,'WAVE');text(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,rate,true);view.setUint32(28,rate*2,true);view.setUint16(32,2,true);view.setUint16(34,16,true);text(36,'data');view.setUint32(40,length*2,true);
    for(let i=0;i<length;i++){
      const fade=Math.min(1,(length-i)/(rate*.04));
      view.setInt16(44+i*2,Math.max(-1,Math.min(1,data[start+i]*fade))*32767,true);
    }
    return new Blob([wav],{type:'audio/wav'});
  }
  async play(key){
    const generation=this.playGeneration;
    const context=await this.unlock();
    if(generation!==this.playGeneration)return;
    let source;
    if(key.blob){
      const buffer=await context.decodeAudioData(await key.blob.arrayBuffer());
      if(generation!==this.playGeneration)return;
      source=context.createBufferSource();source.buffer=buffer;source.connect(context.destination);source.start();
    }
    else{
      source=context.createOscillator();source.type='sine';source.frequency.value=key.frequency;
      const gain=context.createGain();gain.gain.setValueAtTime(.0001,context.currentTime);gain.gain.exponentialRampToValueAtTime(.18,context.currentTime+.012);gain.gain.exponentialRampToValueAtTime(.0001,context.currentTime+1.25);
      source.connect(gain);gain.connect(context.destination);source.start();source.stop(context.currentTime+1.3);
    }
    this.sources.add(source);source.onended=()=>{this.sources.delete(source);source.disconnect();};
  }
  stopPlayback(){this.playGeneration++;for(const source of this.sources){try{source.stop();}catch{}source.disconnect();}this.sources.clear();}
  dispose(){this.stopListening();this.stopPlayback();this.context?.close().catch(()=>{});}
}
