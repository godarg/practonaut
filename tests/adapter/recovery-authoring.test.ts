import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chromium } from 'playwright-core';
import { build } from 'esbuild';
import { mkdtemp,readFile,realpath,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve,join,extname } from 'node:path';
import { validateRecording,projectSnapshot } from '../../src/adapters/excalidraw/recorder.ts';
import { toRaw } from '../../src/adapters/excalidraw/raw.ts';
import { analyzeRecordings,confirmHypothesis,createAuthorProject,observationRef,prepareRepairProject,RULE_TEMPLATES } from '../../src/authoring/index.ts';
import type { Recording } from '../../src/adapters/excalidraw/recorder-types.ts';
import { canonicalJson } from '../../src/canonical/index.ts';

test('three genuine native arrow removals provide new confirmation while preserving obsolete source bindings',{timeout:60000},async()=>{
  const scratch=await mkdtemp(join(await realpath(tmpdir()),'pn-recovery-native-'));
  const source=`import React from'react';import{createRoot}from'react-dom/client';import{Excalidraw,restoreElements,CaptureUpdateAction}from'@excalidraw/excalidraw';import'@excalidraw/excalidraw/index.css';import{createGestureRecorder}from${JSON.stringify(resolve('src/adapters/excalidraw/recorder.ts'))};window.EXCALIDRAW_ASSET_PATH='/';const recorder=createGestureRecorder();window.__probe={api:null,async seed(raw){await document.fonts.load('20px Cascadia');await document.fonts.ready;this.api.updateScene({elements:restoreElements(raw,null,{repairBindings:true,refreshDimensions:true}),captureUpdate:CaptureUpdateAction.NEVER,appState:{scrollX:0,scrollY:0,currentItemFontFamily:3}});await new Promise(r=>setTimeout(r,250));recorder.start(this.api.getSceneElementsIncludingDeleted(),true)},finish(){recorder.stop();return{initial:recorder.initial,gestures:recorder.gestures}}};document.addEventListener('keyup',()=>requestAnimationFrame(()=>requestAnimationFrame(()=>recorder.boundary('key'))));createRoot(document.getElementById('root')).render(React.createElement(Excalidraw,{excalidrawAPI:api=>window.__probe.api=api,onChange:els=>recorder.observe(els),initialData:{appState:{currentItemFontFamily:3}}}));`;
  await build({stdin:{contents:source,resolveDir:resolve('.'),sourcefile:'native-recovery.jsx'},outdir:scratch,entryNames:'probe',bundle:true,splitting:true,format:'esm',conditions:['production'],minify:true,loader:{'.woff2':'file'},define:{'process.env.NODE_ENV':'"production"'}});
  const browser=await chromium.launch({headless:true}),recordings:Recording[]=[];
  const initial=prepareRepairProject({id:'native-probe',title:'Native evidence',author:'Synthetic native probe',labels:['Receive','Review','Send']}).initialState;
  try{
    for(let repetition=0;repetition<3;repetition++){
      const context=await browser.newContext({viewport:{width:1600,height:1000},serviceWorkers:'block'}),external:string[]=[];
      await context.route('**/*',async route=>{const url=new URL(route.request().url());if(url.origin!=='http://recovery.invalid'||url.pathname.includes('..')){external.push(url.href);await route.abort();return;}
        if(url.pathname==='/'){await route.fulfill({body:'<html><head><link rel="stylesheet" href="/probe.css"><style>@font-face{font-family:Cascadia;src:url(/fonts/Cascadia/CascadiaCode-Regular.woff2)}html,body,#root{height:100%;margin:0}</style></head><body><div id="root"></div><script type="module" src="/probe.js"></script></body></html>',contentType:'text/html'});return;}
        try{const bytes=await readFile(join(url.pathname.startsWith('/fonts/')?resolve('.local/engine'):scratch,url.pathname.slice(1)));await route.fulfill({body:bytes,contentType:({'.js':'text/javascript','.css':'text/css','.woff2':'font/woff2'} as Record<string,string>)[extname(url.pathname)]??'application/octet-stream'});}catch{external.push(url.href);await route.abort();}});
      const page=await context.newPage();await page.goto('http://recovery.invalid');await page.waitForFunction('window.__probe?.api');await page.evaluate('window.__probe.seed('+JSON.stringify(toRaw(initial))+')');
      // Target the actual drawn arrow, not a coordinate from the older prepared geometry.
      const point=await page.evaluate(()=>{const probe=(window as unknown as {__probe:{api:{getSceneElementsIncludingDeleted():Array<{id:string;x:number;y:number;points?:number[][]}>;getAppState():{scrollX:number;scrollY:number;offsetLeft:number;offsetTop:number;zoom:{value:number}}}}}).__probe;const arrow=probe.api.getSceneElementsIncludingDeleted().find(e=>e.id==='ab')!;const first=arrow.points![0]!,last=arrow.points!.at(-1)!,app=probe.api.getAppState();return{x:(arrow.x+(first[0]!+last[0]!)/2+app.scrollX)*app.zoom.value+app.offsetLeft,y:(arrow.y+(first[1]!+last[1]!)/2+app.scrollY)*app.zoom.value+app.offsetTop};});
      await page.mouse.click(point.x,point.y);await page.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
      assert.deepEqual(await page.evaluate('Object.keys(window.__probe.api.getAppState().selectedElementIds).filter(id=>window.__probe.api.getAppState().selectedElementIds[id])'),['ab'],'the real native arrow must be selected before Delete');
      await page.keyboard.press('Delete');
      await page.waitForFunction('window.__probe.api.getSceneElementsIncludingDeleted().some(e=>e.id==="ab"&&e.isDeleted)');
      const recorded=await page.evaluate('window.__probe.finish()') as Pick<Recording,'initial'|'gestures'>;
      const recording=validateRecording({manifest:{schema:'practonaut.recording/1',id:'native-arrow-'+repetition,createdAt:'2026-10-04T00:00:00Z',stoppedAt:'2026-10-04T00:00:01Z',appVersion:'0.18.1',adapterVersion:'1.0.0',coalescingVersion:'excalidraw-gesture-v1',author:'Synthetic native probe',license:'CC0-1.0',consent:'Self-created synthetic scene; no personal content',demonstration:'scripted',status:'review'},...recorded});
      assert.equal(recording.gestures.length,1);const gesture=recording.gestures[0]!,original=canonicalJson(recording);
      assert.equal(gesture.after.elements.ab!.attributes.start,'a');assert.equal(gesture.after.elements.ab!.attributes.end,'b');assert.equal(gesture.after.elements.ab!.attributes.isDeleted,true);
      const projected=projectSnapshot(gesture.after);assert.equal(projected.ok,true);if(projected.ok)assert.equal(projected.state.objects.ab?.type==='arrow'&&projected.state.objects.ab.to,'b');
      assert.deepEqual(analyzeRecordings([recording]).hypotheses.map(h=>h.id),['disconnect-v1']);assert.equal(canonicalJson(recording),original);assert.deepEqual(external,[]);recordings.push(recording);await context.close();
    }
    let project=createAuthorProject([recordings[0]!]);assert.throws(()=>confirmHypothesis(project,{hypothesisId:'disconnect-v1',evidence:observationRef(recordings[0]!,0)},recordings),/confirmation_requires_new_observation/);
    project={...project,...analyzeRecordings(recordings,project)};project=confirmHypothesis(project,{hypothesisId:'disconnect-v1',evidence:observationRef(recordings[1]!,0)},recordings);assert.equal(project.hypotheses[0]!.status,'confirmed');
    const first=projectSnapshot(recordings[0]!.gestures[0]!.before),last=projectSnapshot(recordings[0]!.gestures[0]!.after);assert.equal(first.ok&&last.ok,true);
    if(first.ok&&last.ok){const wrong=structuredClone(last.state);wrong.objects.ab!.deleted=false;assert.equal(RULE_TEMPLATES.find(t=>t.id==='disconnect-v1')!.matches(first.state,wrong),false);}
  }finally{await browser.close();await rm(scratch,{recursive:true,force:true});}
});
