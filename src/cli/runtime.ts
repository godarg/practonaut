import { cliText } from './messages.ts';
import { chromiumCheck } from './doctor.ts';
import { headlessShellDownload } from './chromium-download.ts';
import { browserAdvice, chromiumStarts, sandboxFallbackNotice } from './browser-start.ts';
import { spawn } from "node:child_process";
import { readFile, writeFile, rename, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { readWorldPackageFile, readArchiveFile } from "../package/index.ts";
import { parseJsonEntry } from "../package/json.ts";
import { loadWorldPackage } from "../world/index.ts";
import { Session, apply } from "../core/index.ts";
import { resolveAdapter } from "../adapters/registry.ts";
import type { ApplicationAdapter } from "../adapters/types.ts";
import type { Action, CheckerData, CheckerVerdict, Failure, World } from "../world/types.ts";
import {ERROR_CODES} from "../world/types.ts";
import { loadCheckerBundle } from "../checker/bundle.ts";
import type { ConditionTrace, TraceEntry } from "../checker/trace.ts";
import { safeJson } from "./output.ts";
import { canonicalJson, sha256Hex } from "../canonical/index.ts";
import {buildExportEnvelope,nativeMatchesState,parseExportPair,ExportPairError} from '../host/export-pair.ts';
import { inlineOptionValues } from './options.ts';
export class RuntimeError extends Error {
  readonly code: string;
  constructor(code:string,message:string){super(message);this.name="RuntimeError";this.code=code;}
}
function options(given:string[],allowed: string[]): {path:string;flags:Record<string,string>} {
 const args=inlineOptionValues(given,allowed);
 const flags:Record<string,string>={};const paths:string[]=[];
 for(let i=0;i<args.length;i++) { const a=args[i]!;if(a.startsWith("--")){if(!allowed.includes(a))throw new RuntimeError("usage",cliText("optionUnknown", { option: a }));const value=args[++i];if(!value||value.startsWith("--"))throw new RuntimeError("usage",cliText("optionValue", { option: a }));if(Object.hasOwn(flags,a))throw new RuntimeError("usage",cliText("optionDuplicate", { option: a }));flags[a]=value;}else paths.push(a);}
 if(paths.length!==1)throw new RuntimeError("usage",cliText("inputUsage"));return {path:paths[0]!,flags};
}
function integer(raw:string):number {if(!/^-?\d+$/.test(raw)||!Number.isSafeInteger(Number(raw)))throw new RuntimeError("usage",cliText("seedUsage"));return Number(raw);}
async function atomicFile(path:string,body:string):Promise<void>{const tmp=path+".tmp-"+process.pid;try{await writeFile(tmp,body,{flag:"wx"});await rename(tmp,path);}catch(e){await rm(tmp,{force:true});throw e;}}
/** The checker's condition trace of a judged session (PADR-0039), in the same separate process
 * with the same limits as a verdict. */
export async function traceInProcess(world:World,session:string,timeline:readonly TraceEntry[],settings:{seed?:number;taskId?:string}={}):Promise<ConditionTrace>{
 const result=await checkInProcess(world,session,{...settings,trace:timeline}) as unknown as {trace?:ConditionTrace};
 if(!result||typeof result!=="object"||!result.trace)throw new RuntimeError("checker_invalid",cliText("checkerProcess"));
 return result.trace;
}
/** OS process boundary: evaluator receives only data, with a V8 heap cap and a wall deadline. */
export async function checkInProcess(world:World,input:string,settings:{seed?:number;taskId?:string;bundle?:CheckerData;trace?:readonly TraceEntry[]}={}):Promise<CheckerVerdict>{
 const extension=import.meta.url.endsWith(".ts")?"ts":"js";
 const worker=fileURLToPath(new URL(`../checker/main.${extension}`,import.meta.url));
 return new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,["--max-old-space-size=256",worker],{stdio:["pipe","pipe","pipe"]});
  const stdout:Buffer[]=[];let size=0;let settled=false;let failure:Error|undefined;
  const fail=(error:Error):void=>{if(settled||failure)return;failure=error;child.kill("SIGKILL");clearTimeout(timer);};
  const timer=setTimeout(()=>fail(new RuntimeError("checker_timeout",cliText("checkerTimeout"))),10_000);
  child.on("error",()=>fail(new RuntimeError("checker_invalid",cliText("checkerProcess"))));
  child.stdout.on("data",(chunk:Buffer)=>{if(failure)return;size+=chunk.length;if(size>1024*1024)fail(new RuntimeError("checker_invalid",cliText("checkerOutput")));else stdout.push(chunk);});
  child.stderr.on("data",()=>{ /* Drain upstream diagnostics; never echo unknown content. */ });
  child.on("exit",()=>{if(failure){child.stdin.destroy();child.stdout.destroy();child.stderr.destroy();}});
  child.on("close",code=>{if(settled)return;settled=true;clearTimeout(timer);if(failure){reject(failure);return;}try{const result=JSON.parse(Buffer.concat(stdout).toString()) as CheckerVerdict|{ok:false;error:Failure};if(!result.ok){const admitted=ERROR_CODES.includes(result.error?.code)?result.error.code:"checker_invalid";reject(new RuntimeError(admitted,cliText("checkerRejected",{code:admitted})));}else if(code!==0)reject(new RuntimeError("checker_invalid",cliText("checkerProcess")));else resolve(result);}catch{reject(new RuntimeError("checker_invalid",cliText("checkerProcess")));}});
  child.stdin.on("error",()=>{});child.stdin.end(JSON.stringify({world,input,options:settings}));
 });
}
export async function commandRun(args:string[]):Promise<number>{
 const {path,flags}=options(args,["--seed","--actions","--task","--state-out","--export","--mirror"]);
 if(!flags["--seed"]||!flags["--actions"])throw new RuntimeError("usage",cliText("runUsage"));
 const world=loadWorldPackage(await readWorldPackageFile(path));const seed=integer(flags["--seed"]);
 // The adapter comes from the registry by the world's app, refused by name before any browser starts (PADR-0045).
 const registration=resolveAdapter(world.app,world.schema);
 const taskId=flags["--task"]??world.tasks[0]!.id;
 const session=new Session(world,seed,taskId);const initialHash=session.hash;
 const bytes=await readArchiveFile(flags["--actions"]);if(bytes.length>4*1024*1024)throw new RuntimeError("invalid_argument",cliText("actionsSize"));
 const raw=parseJsonEntry(bytes,"actions.json",64);if(!Array.isArray(raw)||raw.length>10_000)throw new RuntimeError("invalid_argument",cliText("actionsArray"));
 const mirror=flags["--mirror"]??"required";if(mirror!=="required"&&mirror!=="off")throw new RuntimeError("usage",cliText("mirrorUsage"));
 if(flags["--export"]&&mirror==="off")throw new RuntimeError("usage",cliText("nativeExport"));
 if(mirror==='required'){
  if(!(await chromiumCheck(true)).ok)throw new RuntimeError('browser_runtime_missing',cliText('browserRuntimeMissing', headlessShellDownload()));
  const started=await chromiumStarts();if(!started.ok)throw new RuntimeError('browser_start_failed',cliText('browserStartFailed',{detail:started.detail,advice:browserAdvice()}));process.stderr.write(sandboxFallbackNotice(started));
 }
 let adapter:ApplicationAdapter|undefined;
 const steps:Array<{step:number;hash:string}>=[];
 try{
  if(mirror==="required")adapter=await registration.create(session.state);
  for(const input of raw){const action=input as Action;const before=session.state;const tentative=apply(session.world,before,action,{seed,prefix:session.log.map(e=>e.action)});
   if(!tentative.ok)throw new RuntimeError(tentative.error.code,tentative.error.message);
   if(adapter){const real=await adapter.apply({before,after:tentative.state,action});if(!real.ok)throw new RuntimeError(real.error.code,real.error.message);}
   const result=session.act(action);if(!result.ok)throw new RuntimeError(result.error.code,result.error.message);
   steps.push({step:session.step,hash:session.hash});
  }
  const replay=session.checkReplay();if(!replay.ok)throw new RuntimeError(replay.error.code,replay.error.message);
  const data=session.serialize();if(flags["--state-out"])await atomicFile(flags["--state-out"],JSON.stringify(data)+"\n");
  let exported:Record<string,string>|undefined;
  if(adapter&&flags["--export"]){const artifact=await adapter.exportArtifact();const prefix=flags["--export"];
   if(!nativeMatchesState(world,artifact.native,data.state))throw new RuntimeError('artifact_invalid',cliText('pairStateMismatch'));
   const pair=buildExportEnvelope(data,steps.length,artifact.native);
   await atomicFile(prefix+".excalidraw",artifact.native);await atomicFile(prefix+".svg",artifact.svg);await atomicFile(prefix+".session.json",pair.session.utf8);
   exported={native:prefix+".excalidraw",svg:prefix+".svg",pair:prefix+".session.json",nativeSha256:artifact.nativeSha256,svgSha256:artifact.svgSha256,pairSha256:pair.session.sha256};}
  process.stdout.write(safeJson({ok:true,world:{id:world.id,version:world.version},taskId,seed,mode:mirror==="required"?"real-engine":"model-only",initialHash,steps,endHash:session.hash,state:data,...(exported?{exported}:{})})+"\n");return 0;
 }finally{await adapter?.close();}
}
export async function commandCheck(args:string[]):Promise<number>{
 const {path,flags}=options(args,["--world","--bundle","--seed","--task","--pair"]);
 if(!flags["--world"])throw new RuntimeError("usage",cliText("checkUsage"));
 const world=loadWorldPackage(await readWorldPackageFile(flags["--world"]));
 const input=await readArchiveFile(path);const bundle=flags["--bundle"]?await loadCheckerBundle(flags["--bundle"],world):undefined;
 const parsed=parseJsonEntry(input,"submission.json",64) as Record<string,unknown>;
 if(flags['--pair']) {
  if(!parsed||parsed.type!=='excalidraw'||parsed.practonaut!==undefined)throw new RuntimeError('artifact_invalid',cliText('pairNativeRequired'));
  let pair;
  try{pair=parseExportPair(await readArchiveFile(flags['--pair']),world,input);}catch(error){if(error instanceof ExportPairError)throw new RuntimeError(error.code,cliText('pairInvalid'));throw error;}
  if((flags['--seed']!==undefined&&integer(flags['--seed'])!==pair.seed)||(flags['--task']!==undefined&&flags['--task']!==pair.taskId))throw new RuntimeError('artifact_invalid',cliText('exportContradiction'));
  if(!nativeMatchesState(world,input,pair.session.state))throw new RuntimeError('artifact_invalid',cliText('pairStateMismatch'));
  const settings={seed:pair.seed,taskId:pair.taskId,...(bundle?{bundle}:{})};
  // This separate process runs the independent history interpreter, not the production Session replay.
  await checkInProcess(world,canonicalJson(pair.session),settings);
  const verdict=await checkInProcess(world,input.toString('utf8'),settings);
  process.stdout.write(safeJson({...verdict,binding:{kind:'export-pair',revision:pair.revision,hash:pair.hash,sessionSha256:pair.sessionSha256,nativeSha256:pair.nativeSha256,origin:'unattested'}})+'\n');return verdict.passed?0:2;
 }
 let routing:{seed:number;taskId:string}|undefined;
 if(parsed&&parsed.type==="excalidraw"&&parsed.practonaut!==undefined){
  const m=parsed.practonaut as {world?:{id?:unknown;version?:unknown};seed?:unknown;taskId?:unknown};
  if(!m||typeof m!=="object"||m.world?.id!==world.id||m.world?.version!==world.version||!Number.isSafeInteger(m.seed)||typeof m.taskId!=="string"||!world.tasks.some(t=>t.id===m.taskId))throw new RuntimeError("artifact_invalid",cliText("exportContext"));
  routing={seed:m.seed as number,taskId:m.taskId};
  if((flags["--seed"]!==undefined&&integer(flags["--seed"])!==routing.seed)||(flags["--task"]!==undefined&&flags["--task"]!==routing.taskId))throw new RuntimeError("artifact_invalid",cliText("exportContradiction"));
 }
 const settings={...(routing??{}),...(flags["--seed"]===undefined?{}:{seed:integer(flags["--seed"])}),...(flags["--task"]===undefined?{}:{taskId:flags["--task"]}),...(bundle===undefined?{}:{bundle})};
 if(parsed?.type==='excalidraw'&&!routing&&(flags['--seed']===undefined||flags['--task']===undefined))throw new RuntimeError('artifact_invalid',cliText('nativeRoutingRequired'));
 const verdict=await checkInProcess(world,input.toString("utf8"),settings);
 const binding=parsed?.type==='excalidraw'?{kind:'manual-unbound',origin:'unattested'}:{kind:'session-history',origin:'unattested'};
 process.stdout.write(safeJson({...verdict,binding})+"\n");return verdict.passed?0:2;
}
