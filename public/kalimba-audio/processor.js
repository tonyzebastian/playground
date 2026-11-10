import { ListeningEngine } from './analysis.mjs';

class KalimbaListener extends AudioWorkletProcessor {
  constructor(options){
    super();this.engine=new ListeningEngine(sampleRate,options.processorOptions?.keys??[]);
    // Capture mode forwards the raw input in 4096-sample chunks for offline replay.
    this.capture=options.processorOptions?.capture?new Float32Array(4096):null;this.filled=0;this.started=false;
  }
  process(inputs){
    const channel=inputs[0]?.[0];
    if(channel){
      if(this.capture){
        if(!this.started){this.started=true;this.port.postMessage({captureStart:currentTime});}
        for(let i=0;i<channel.length;i++){
          this.capture[this.filled++]=channel[i];
          if(this.filled===this.capture.length){this.port.postMessage({raw:this.capture},[this.capture.buffer]);this.capture=new Float32Array(4096);this.filled=0;}
        }
      }
      const frame=this.engine.push(channel);if(frame)this.port.postMessage(frame);
    }
    // The output stays silent; connecting to the destination keeps Safari processing.
    return true;
  }
}
registerProcessor('kalimba-listener',KalimbaListener);
