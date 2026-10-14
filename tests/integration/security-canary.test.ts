import assert from 'node:assert/strict';import {test} from 'node:test';import {mkdir,mkdtemp,rm,writeFile,readFile} from 'node:fs/promises';import {join,resolve} from 'node:path';
import {startHost,HTTP_CAPABILITIES} from '../../src/host/server.ts';import {TOKEN_HEADER,HOST_ROUTES} from '../../src/host/protocol.ts';import {AUTHOR_ROUTES} from '../../src/host/author-protocol.ts';import {validateWorld} from '../../src/world/index.ts';import {createRecordingStore} from '../../src/recordings/index.ts';import {makeRecording} from '../unit/recorder-fixture.ts';import {sdkClient} from '../mcp/client-helper.ts';import {packChecker} from '../../tools/pack-checker.ts';
test('placed private author/bundle canaries stay out of all seven tools in both wire eras',{timeout:60000},async()=>{
 await mkdir('.local',{recursive:true});const root=await mkdtemp(resolve('.local/p5-canaries-'));const local=join(root,'private');await mkdir(local,{mode:0o700});
 const authorMarker='PN_PRIVATE_AUTHOR_CANARY_P5',bundleMarker='PN_PRIVATE_BUNDLE_CANARY_P5',positive='PN_VISIBLE_CONTROL_P5';
 const record=makeRecording('r-private');record.manifest.author=authorMarker;await createRecordingStore(join(local,'recordings')).save(record);
 const checkerSource=join(root,'checker-source');await mkdir(checkerSource);const checker=JSON.parse(await readFile('examples/worlds/flow-diagram.check/checker.json','utf8'));checker.heldOutTasks[0].hints[0].en=bundleMarker;await writeFile(join(checkerSource,'checker.json'),JSON.stringify(checker));await writeFile(join(local,'private.pncheck'),await packChecker(checkerSource),{mode:0o600});
 const source=JSON.parse(await readFile('tests/fixtures/core/world.json','utf8'));source.tasks[0].prompt.en=positive;source.app.fontFamilies=[3];for(const object of Object.values(source.initialState.objects) as any[])if(object.type==='step')object.fontFamily=3;
 const world=validateWorld(source),assets=join(root,'player');await mkdir(assets);for(const name of ['index.html','player.js','player.css','tokens.css'])await writeFile(join(assets,name),'fixed');
 const host=await startHost(world,{phase3:true,assetDirectory:assets,localDirectory:local,tokenDirectory:join(root,'tokens')});
 try{
  const bootstrap=await fetch(host.origin+HOST_ROUTES.bootstrap,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:host.code})});const exchange=(await bootstrap.json()).value;const authorToken=exchange.authorToken;assert.match(authorToken,/^[a-f0-9]{64}$/);assert.notEqual(authorToken,host.token);assert.equal((await readFile(host.tokenFile,'utf8')).trim(),host.token);
  const prepare=await fetch(host.origin+AUTHOR_ROUTES.prepare,{method:'POST',headers:{[TOKEN_HEADER]:authorToken,'Content-Type':'application/json'},body:JSON.stringify({expectedRevision:0,title:'Private author scene',author:authorMarker,labels:[authorMarker,'Private middle','Private last']})});assert.equal(prepare.status,200);await prepare.text();
  const positiveRead=await fetch(host.origin+AUTHOR_ROUTES.observe,{headers:{[TOKEN_HEADER]:authorToken}});assert.equal(positiveRead.status,200);assert.ok((await positiveRead.text()).includes(authorMarker));
  const scan=(raw:string)=>{for(const marker of [host.token,authorToken,host.code,authorMarker,bundleMarker])assert.equal(raw.includes(marker),false,'private credential/canary must remain absent from practice replies');};
  assert.ok((await readFile(join(local,'private.pncheck'))).length>0);assert.ok((await readFile(join(local,'recordings','r-private.json'),'utf8')).includes(authorMarker));
  let visibleHits=0;
  for(const modern of [true,false]){
   const sdk=await sdkClient(host,modern);try{
    const outputs:unknown[]=[await sdk.client.listTools(),await sdk.client.listResources(),await sdk.client.listPrompts(),await sdk.client.readResource({uri:'practonaut://task'}),await sdk.client.getPrompt({name:'practise'}),await sdk.call('observe',{detail:'full',lang:'both'})];
    const obs=await sdk.call('observe',{});assert.equal(obs.ok,true);if(!obs.ok)throw Error('observe refused');outputs.push(obs);
    outputs.push(await sdk.call('list_actions',{}));
    outputs.push(await sdk.call('act',{name:'rename_step',params:{id:'a',label:'Reviewed'},baseStep:obs.value.step,expectedRevision:obs.value.revision}));
    let current=await sdk.call('observe',{});if(!current.ok)throw Error('observe');outputs.push(await sdk.call('undo',{expectedRevision:current.value.revision}));
    current=await sdk.call('observe',{});if(!current.ok)throw Error('observe');outputs.push(await sdk.call('reset',{expectedRevision:current.value.revision,confirmed:true}));
    outputs.push(await sdk.call('explain_result',{}));current=await sdk.call('observe',{});if(!current.ok)throw Error('observe');outputs.push(await sdk.call('check_result',{expectedRevision:current.value.revision}));
    const raw=JSON.stringify(outputs);visibleHits+=raw.includes(positive)?1:0;
    scan(raw);
    // The scanner's counter-probe has an actual hit, not a never-planted string.
    assert.equal(JSON.stringify({...outputs,leak:authorMarker}).includes(authorMarker),true);
   }finally{await sdk.close();}
  }
  assert.equal(visibleHits,2);
  assert.deepEqual(Object.keys(HTTP_CAPABILITIES).sort(),[...Object.values(HOST_ROUTES),...Object.values(AUTHOR_ROUTES)].sort());
  for(const route of Object.values(AUTHOR_ROUTES).filter(route=>HTTP_CAPABILITIES[route]==='author'))for(const method of ['GET','POST']){const denied=await fetch(host.origin+route,{method,headers:{[TOKEN_HEADER]:host.token,'Content-Type':'application/json'},...(method==='POST'?{body:'{}'}:{})});assert.equal(denied.status,403);const text=await denied.text();scan(text);assert.equal(JSON.parse(text).error.code,'author_required');}
  for(const route of [HOST_ROUTES.resume,HOST_ROUTES.observe,AUTHOR_ROUTES.scene,HOST_ROUTES.tool]){const response=await fetch(host.origin+route,{headers:{[TOKEN_HEADER]:host.token}});assert.equal(response.status,200);scan(Buffer.from(await response.arrayBuffer()).toString('utf8'));}
  const resumed=await fetch(host.origin+HOST_ROUTES.resume,{headers:{[TOKEN_HEADER]:host.token}});const resume=await resumed.json();assert.equal(resume.value.authorEnabled,false);assert.equal(resume.value.authorToken,undefined);const authorResume=await fetch(host.origin+HOST_ROUTES.resume,{headers:{[TOKEN_HEADER]:authorToken}});const held=await authorResume.json();assert.equal(held.value.authorEnabled,true);assert.equal(held.value.authorToken,undefined);assert.equal(held.value.view.sessionId,resume.value.view.sessionId);scan(JSON.stringify(held));
  const exported=await fetch(host.origin+HOST_ROUTES.export,{method:'POST',headers:{[TOKEN_HEADER]:host.token,'Content-Type':'application/json'},body:JSON.stringify({expectedRevision:resume.value.view.revision})});assert.equal(exported.status,200);scan(await exported.text());
  const sceneReply=await fetch(host.origin+AUTHOR_ROUTES.scene,{headers:{[TOKEN_HEADER]:host.token}});const before=(await sceneReply.json()).value;const after=structuredClone(before);const text=after.find((element:any)=>element.type==='text'&&element.containerId==='a');assert.ok(text);text.text='Practice-owned editor input';text.originalText=text.text;
  const editor=await fetch(host.origin+AUTHOR_ROUTES.editor,{method:'POST',headers:{[TOKEN_HEADER]:host.token,'Content-Type':'application/json'},body:JSON.stringify({expectedRevision:resume.value.view.revision,before,after,boundary:'quiet'})});assert.equal(editor.status,200);scan(await editor.text());
  const sse=await fetch(host.origin+HOST_ROUTES.events,{headers:{[TOKEN_HEADER]:host.token}}),reader=sse.body!.getReader();try{scan(new TextDecoder().decode((await reader.read()).value));}finally{await reader.cancel();}
  const replay=await fetch(host.origin+HOST_ROUTES.bootstrap,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:host.code})});assert.equal(replay.status,401);scan(await replay.text());
 }finally{await host.close();await rm(root,{recursive:true,force:true});}
});
