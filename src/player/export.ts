import type {CurrentSessionExport} from '../host/export-pair.ts';
import type {HostReply,HostView} from '../host/protocol.ts';
import type {Message} from './messages.ts';
import {banner,button,card,h} from './ui/components.ts';

interface Context{
 current():HostView|undefined;request(expectedRevision:number):Promise<HostReply<CurrentSessionExport>>;
 message(key:Message):string;working():boolean;setWorking(value:boolean):void;render():void;announce(text:string):void;
 /** The attempt belongs to the bundled example's demonstration: never saved as anyone's result. */
 demonstration():boolean;
}
async function bytesHash(utf8:string):Promise<string>{
 const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(utf8));
 return Array.from(new Uint8Array(hash),byte=>byte.toString(16).padStart(2,'0')).join('');
}

/** Both downloads retain one envelope. Artifact strings stay opaque and are never reserialized. */
export function createExportControl(context:Context):{view():HTMLElement}{
 let prepared:CurrentSessionExport|undefined,loading=false,error:Message|undefined;
 const urls=new Set<string>();
 window.addEventListener('pagehide',()=>{for(const url of urls)URL.revokeObjectURL(url);urls.clear();});
 const m=context.message;
 async function prepare():Promise<void>{
  const before=context.current();if(!before||context.working())return;
  loading=true;error=undefined;prepared=undefined;context.setWorking(true);context.render();context.announce(m('exportLoading'));
  try{
   const reply=await context.request(before.revision);
   if(!reply.ok){error=reply.error.code==='result_too_large'?'exportTooLarge':reply.error.code==='stale_base'?'exportStale':reply.error.code==='mirror_unavailable'||reply.error.code==='mirror_timeout'?'exportNeedsReal':'exportFailed';return;}
   const value=reply.value;
   if(value.schema!=='practonaut.export/1'||value.revision!==before.revision||value.hash!==before.hash||value.session.file!=='practonaut-session.json'||value.native.file!=='practonaut.excalidraw'
    ||typeof value.session.utf8!=='string'||typeof value.native.utf8!=='string'||!/^[a-f0-9]{64}$/.test(value.session.sha256)||!/^[a-f0-9]{64}$/.test(value.native.sha256)
    ||await bytesHash(value.session.utf8)!==value.session.sha256||await bytesHash(value.native.utf8)!==value.native.sha256){error='exportMismatch';return;}
   prepared=value;
  }catch{error='exportFailed';}
  finally{
   loading=false;context.setWorking(false);context.render();
   const notice=error?m(error):m('exportReady').replace('{n}',String(prepared!.revision));context.announce(notice);
   document.querySelector<HTMLElement>('[data-testid=export-prepare]')?.focus({preventScroll:true});
  }
 }
 function download(which:'session'|'native'):void{
  const current=context.current();if(!prepared||!current||context.working()||prepared.revision!==current.revision||prepared.hash!==current.hash)return;
  const artifact=prepared[which],url=URL.createObjectURL(new Blob([artifact.utf8],{type:which==='session'?'application/json':'application/vnd.excalidraw+json'}));urls.add(url);
  const anchor=document.createElement('a');anchor.hidden=true;anchor.href=url;anchor.download=which==='session'?'practonaut-session.json':'practonaut.excalidraw';
  document.body.append(anchor);anchor.click();anchor.remove();
  setTimeout(()=>{URL.revokeObjectURL(url);urls.delete(url);},1000);
 }
 return{view(){
  const current=context.current(),modelOnly=current?.mirror!=='required',stale=prepared&&(prepared.revision!==current?.revision||prepared.hash!==current?.hash);
  const panel=card({title:m('exportTitle'),level:2});panel.dataset.testid='export-panel';
  panel.append(h('p',{class:'export-status',text:m('exportExplanation')}));
  const demonstration=context.demonstration();
  if(modelOnly)panel.append(banner({tone:'unknown',text:m('exportNeedsReal'),testid:'export-model-only'}));
  else if(demonstration)panel.append(banner({tone:'unknown',text:m('exportDemonstration'),testid:'export-demonstration'}));
  else if(loading)panel.append(h('p',{class:'export-status',testid:'export-loading',text:m('exportLoading'),attrs:{role:'status'}}));
  else if(error)panel.append(banner({tone:'danger',text:m(error),testid:'export-error',role:'alert'}));
  else if(prepared)panel.append(stale?banner({tone:'warning',text:m('exportStale'),testid:'export-stale'}):h('p',{class:'export-status',testid:'export-ready',text:m('exportReady').replace('{n}',String(prepared.revision)),attrs:{role:'status'}}));
  const actions=h('div',{class:'export-actions'},button({label:m('exportPrepare'),testid:'export-prepare',variant:'secondary',size:'sm',disabled:modelOnly||demonstration||context.working(),onClick:()=>{void prepare();}}));
  if(prepared)actions.append(button({label:m('exportSession'),testid:'export-session',icon:'download',variant:'secondary',size:'sm',disabled:Boolean(stale)||context.working(),onClick:()=>download('session')}),button({label:m('exportNative'),testid:'export-native',icon:'download',variant:'secondary',size:'sm',disabled:Boolean(stale)||context.working(),onClick:()=>download('native')}));
  panel.append(actions);return panel;
 }};
}
