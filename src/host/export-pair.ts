/** Public artifact binding only. This module contains no credential or author capability. */
import {z} from 'zod';
import {canonicalJson,sha256Hex} from '../canonical/index.ts';
import {parseJsonEntry} from '../package/json.ts';
import {parseSession} from '../checker/state.ts';
import {nativeFormat,type NativeReading} from '../checker/formats.ts';
import type {SessionData,State,World} from '../world/types.ts';
import {HOST_LIMITS} from './limits.ts';

export interface ExportRouting {world:SessionData['world'];seed:number;taskId:string}
export type NativeFileName=`practonaut${string}`;
/** The native file's name for a world's app: `practonaut` plus the checker table's extension. */
export function nativeFileName(app:World['app']):NativeFileName{return `practonaut${nativeFormat(app).extension}`;}
export interface ExportPair extends ExportRouting {
 schema:'practonaut.export-pair/1';revision:number;hash:string;session:SessionData;
 /** Hash of canonical UTF-8 Session payload; not a self-hash of this manifest. */
 sessionSha256:string;nativeSha256:string;
}
export interface CurrentSessionExport extends ExportRouting {
 schema:'practonaut.export/1';revision:number;hash:string;
 session:{file:'practonaut-session.json';utf8:string;sha256:string};
 /** The app's own file, named by its native format's extension (PADR-0049 decision 10.1). */
 native:{file:NativeFileName;utf8:string;sha256:string};
 /** Only when an in-process caller asked for it (the bench, PADR-0039): the real engine's SVG
  * export of the same confirmed scene. The HTTP route never asks for it. */
 picture?:{file:'practonaut.svg';utf8:string;sha256:string};
}
const hash=z.string().regex(/^[a-f0-9]{64}$/);
const schema=z.strictObject({schema:z.literal('practonaut.export-pair/1'),revision:z.number().int().nonnegative().safe(),hash,
 world:z.strictObject({id:z.string().min(1).max(64),version:z.string().min(1).max(64)}),seed:z.number().int().safe(),taskId:z.string().min(1).max(64).regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/),
 session:z.unknown(),sessionSha256:hash,nativeSha256:hash});
export class ExportPairError extends Error {readonly code='checker_invalid';constructor(){super('Export pair manifest or artifact binding is invalid');}}
export function sessionPayloadSha256(data:SessionData):string{return sha256Hex(canonicalJson(data));}
export function buildExportEnvelope(data:SessionData,revision:number,native:string,app:World['app']):CurrentSessionExport {
 const routing={world:structuredClone(data.world),seed:data.seed,taskId:data.taskId},nativeSha256=sha256Hex(native);
 const manifest:ExportPair={schema:'practonaut.export-pair/1',revision,hash:data.hash,...routing,session:data,sessionSha256:sessionPayloadSha256(data),nativeSha256};
 const utf8=canonicalJson(manifest);
 return {schema:'practonaut.export/1',revision,hash:data.hash,...routing,session:{file:'practonaut-session.json',utf8,sha256:sha256Hex(utf8)},native:{file:nativeFileName(app),utf8:native,sha256:nativeSha256}};
}
/** Strict manifest admission; CLI independently replays this parsed Session afterwards. */
export function parseExportPair(input:string|Uint8Array,world:World,native:string|Uint8Array):ExportPair {
 try {
  const bytes=typeof input==='string'?Buffer.from(input,'utf8'):input;
  const nativeBytes=typeof native==='string'?Buffer.from(native,'utf8'):native;
  if(bytes.length>HOST_LIMITS.replyBytes||nativeBytes.length>HOST_LIMITS.replyBytes)throw new ExportPairError();
  const parsed=schema.parse(parseJsonEntry(bytes,'export-pair.json',64));
  const session=parseSession(canonicalJson(parsed.session),world);
  if(sessionPayloadSha256(session)!==parsed.sessionSha256||sha256Hex(nativeBytes)!==parsed.nativeSha256||parsed.hash!==session.hash||parsed.seed!==session.seed||parsed.taskId!==session.taskId||parsed.world.id!==session.world.id||parsed.world.version!==session.world.version)throw new ExportPairError();
  return {...parsed,session};
 }catch{throw new ExportPairError();}
}
/** Does a native file carry exactly this session state? The parser is the native format of the
 * world's adapter, from the checker's own table (PADR-0045). For Excalidraw, world/1 reads the
 * strict native format (tombstones included); world/2 reads any drawing with the tolerant scene
 * parser, which keeps live objects only, so both sides are compared without tombstones. Parse
 * failures and an adapter without a format are a mismatch. */
export function nativeMatchesState(world:Pick<World,'schema'|'app'>,native:string|Uint8Array,state:State,reading:NativeReading='submission'):boolean {
 try {return nativeFormat(world.app).matches(world.schema,native,state,reading);}catch{return false;}
}
