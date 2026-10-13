// Trusted test witnesses only; this module never enters the world package.
import { Session } from "../../src/core/index.ts";
import { selectVariant } from "../../src/world/index.ts";
import type { World, Action, Scalar } from "../../src/world/types.ts";
export function solution(world:World,seed:number,taskId:string):Action[]{
 const session=new Session(world,seed,taskId);const selected=selectVariant(world,seed);const labels=selected.labels;const {x:dx,y:dy}=selected.layoutOffset;
 const actions:Action[]=[];
 function act(name:string,params:Record<string,Scalar>):string {
  const action:Action={name,params,baseStep:session.step};const result=session.act(action);if(!result.ok)throw new Error(result.error.code+": "+result.error.message);actions.push(action);return result.effects[0]?.id??"";
 }
 const add=(label:string,x:number)=>act("add_step",{frameId:"flow-frame",label,x:x+dx,y:160+dy,width:180,height:100,fontFamily:3});
 if(taskId==="T1"){
  const a=add("Draft",100);act("rename_step",{id:a,label:labels.first!});const b=add(labels.middle!,340),c=add(labels.last!,580);
  act("connect",{frameId:"flow-frame",from:a,to:b});act("connect",{frameId:"flow-frame",from:b,to:c});
 }else if(taskId==="T2"){
  if(selected.insertPosition===1)act("move_step",{id:"b",x:580+dx,y:160+dy});
  act("move_step",{id:"c",x:820+dx,y:160+dy});
  const n=add(labels.inserted!,100+selected.insertPosition!*240);
  const edge=selected.insertPosition===1?"ab":"bc",target=selected.insertPosition===1?"b":"c";
  act("reconnect_end",{id:edge,end:"end",target:n});act("connect",{frameId:"flow-frame",from:n,to:target});
 }else if(taskId==="T3"){
  act("reconnect_end",{id:"ab",end:"end",target:"c"});act("disconnect",{id:"bc"});act("delete_step",{id:"b"});
 }else throw new Error("unknown witness task");
 return actions;
}
