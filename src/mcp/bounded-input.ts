import { Transform, type TransformCallback } from 'node:stream';
/** Bounded JSON-line admission. An oversized frame is discarded through its LF,
 * never parsed or echoed, then the next frame is serviced independently. */
export class BoundedMcpInput extends Transform {
  private parts: Buffer[]=[];
  private bytes=0;
  private discarding=false;
  private readonly maximum:number;
  private readonly rejectFrame:()=>void;
  constructor(maximum:number,rejectFrame:()=>void){super();this.maximum=maximum;this.rejectFrame=rejectFrame;}
  override _transform(chunk:Buffer,_encoding:BufferEncoding,callback:TransformCallback):void {
    let offset=0;
    while(offset<chunk.length){
      const end=chunk.indexOf(10,offset),limit=end===-1?chunk.length:end+1,part=chunk.subarray(offset,limit);
      if(!this.discarding){
        if(this.bytes+part.length>this.maximum){this.parts=[];this.bytes=0;this.discarding=true;this.rejectFrame();}
        else {this.parts.push(part);this.bytes+=part.length;}
      }
      if(end!==-1){
        if(!this.discarding)this.push(Buffer.concat(this.parts,this.bytes));
        this.parts=[];this.bytes=0;this.discarding=false;
      }
      offset=limit;
    }
    callback();
  }
  override _flush(callback:TransformCallback):void {
    // An unterminated frame is not a protocol message.
    this.parts=[];this.bytes=0;callback();
  }
}
