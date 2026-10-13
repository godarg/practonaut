import test from 'node:test';
import assert from 'node:assert/strict';
import { integrity, toRaw, project } from '../../src/adapters/excalidraw/raw.ts';
import type { State } from '../../src/world/types.ts';
const state:State={objects:{f:{id:'f',type:'frame',deleted:false,name:'Flow'},a:{id:'a',type:'step',deleted:false,frameId:'f',label:'A',x:300,y:300,width:180,height:100,fontFamily:3},b:{id:'b',type:'step',deleted:false,frameId:'f',label:'B',x:600,y:300,width:180,height:100,fontFamily:3},ab:{id:'ab',type:'arrow',deleted:false,frameId:'f',from:'a',to:'b'}}};
test('projection includes semantic ids and tombstones independently of excluded fields',()=>{const raw=toRaw(state);assert.deepEqual(project(raw),state);const a=raw.find(e=>e.id==='a')!;a.seed=123;a.versionNonce=44;assert.deepEqual(project(raw),state);a.isDeleted=true;assert.equal(project(raw).objects.a!.deleted,true);});
test('missing binding is fatal for own writes and UI snapshots, stale cache only warns for UI',()=>{
  const raw=toRaw(state);assert.deepEqual(integrity(raw,true),{errors:[],warnings:[]});
  raw.find(e=>e.id==='ab')!.endBinding={elementId:'ghost',focus:0,gap:4};
  assert.ok(integrity(raw,true).errors.some(e=>e.includes('missing target ghost')));assert.ok(integrity(raw,false).errors.some(e=>e.includes('missing target ghost')));
  const stale=toRaw(state);stale.find(e=>e.id==='a')!.boundElements.push({id:'ghost',type:'arrow'});
  assert.ok(integrity(stale,true).errors.some(e=>e.includes('stale back-reference')));
  const ui=integrity(stale,false);assert.deepEqual(ui.errors,[]);assert.ok(ui.warnings.some(e=>e.includes('stale back-reference')));
});
