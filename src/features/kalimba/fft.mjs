// Reusable radix-2 FFT: no dependency on a UI frame or browser analyser node.
export class Spectrum {
  constructor(size=4096){
    this.size=size;this.real=new Float32Array(size);this.imag=new Float32Array(size);
    this.values=new Float32Array(size/2);this.window=Float32Array.from({length:size},(_,i)=>.5-.5*Math.cos(2*Math.PI*i/(size-1)));
    this.reverse=new Uint16Array(size);
    const bits=Math.log2(size);
    for(let i=0;i<size;i++){let x=i,r=0;for(let b=0;b<bits;b++){r=(r<<1)|(x&1);x>>=1;}this.reverse[i]=r;}
  }
  update(samples){
    const {size,real,imag,reverse,window,values}=this;
    for(let i=0;i<size;i++){real[reverse[i]]=samples[i]*window[i];imag[i]=0;}
    for(let width=2;width<=size;width*=2){
      const angle=-2*Math.PI/width,cr=Math.cos(angle),ci=Math.sin(angle);
      for(let start=0;start<size;start+=width){let wr=1,wi=0;
        for(let j=0;j<width/2;j++){
          const a=start+j,b=a+width/2,tr=wr*real[b]-wi*imag[b],ti=wr*imag[b]+wi*real[b];
          real[b]=real[a]-tr;imag[b]=imag[a]-ti;real[a]+=tr;imag[a]+=ti;
          const next=wr*cr-wi*ci;wi=wr*ci+wi*cr;wr=next;
        }
      }
    }
    for(let i=0;i<values.length;i++)values[i]=Math.hypot(real[i],imag[i])*4/size;
    return values;
  }
}

