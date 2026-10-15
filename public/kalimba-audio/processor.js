import { ListeningEngine } from './analysis.mjs';

class KalimbaListener extends AudioWorkletProcessor {
  constructor(options){
    super();this.engine=new ListeningEngine(sampleRate,options.processorOptions?.keys??[]);
  }
  process(inputs){
    const channel=inputs[0]?.[0];
    if(channel){const frame=this.engine.push(channel);if(frame)this.port.postMessage(frame);}
    // The output stays silent; connecting to the destination keeps Safari processing.
    return true;
  }
}
registerProcessor('kalimba-listener',KalimbaListener);
