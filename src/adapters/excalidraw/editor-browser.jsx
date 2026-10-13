// Real application input device on a separate static-only origin. No token enters this frame.
import React from 'react';
import { createFontReadinessBootstrap } from './fonts-ready.js';
import { createRoot } from 'react-dom/client';
import { createGestureRecorder, snapshotElements } from './recorder.ts';
window.EXCALIDRAW_ASSET_PATH = '/';
const fontsBootstrap = createFontReadinessBootstrap(document.getElementById('root'));
const { Excalidraw, restoreElements, CaptureUpdateAction, zoomToFitBounds, getCommonBounds } = await import('@excalidraw/excalidraw');
const parentOrigin = new URLSearchParams(location.hash.slice(1)).get('parent');
history.replaceState(null,'',location.pathname);
let fontBootstrapReloadPending=false;
let api, port, loading=false, fontsReady=false, mode='author', base=[], last=[], busy=false,canUndo=false,presentationAvailable=true,presentationTail=Promise.resolve();
const reply=(message)=>port?.postMessage(message);
const read=()=>JSON.parse(JSON.stringify(api.getSceneElementsIncludingDeleted()));
const recorder=createGestureRecorder({onGesture:gesture=>reply({type:'recorded',gesture}),onError:error=>reply({type:'error',message:String(error)})});
let quiet,pendingBoundary,boundaryGeneration=0;
function clearPendingBoundary(){pendingBoundary=undefined;boundaryGeneration++;}
function boundary(kind) {
 clearTimeout(quiet);
 if(!api || loading)return;
 if(mode==='author') {if(recorder.active)recorder.observe(read());recorder.boundary(kind);return;}
 if(busy || JSON.stringify(base)===JSON.stringify(last))return;
 busy=true;reply({type:'editor-gesture',before:base,after:last,boundary:kind});
}
// A terminal callback may outlive the next native input. Close it from the real
// scene before Excalidraw handles that input, then invalidate its delayed rAFs.
function flushPendingBoundary(){
 if(!pendingBoundary)return;
 const kind=pendingBoundary;clearPendingBoundary();boundary(kind);
}
function terminalBoundary(kind){
 pendingBoundary=kind;const generation=++boundaryGeneration;
 requestAnimationFrame(()=>requestAnimationFrame(()=>{if(generation===boundaryGeneration)flushPendingBoundary();}));
}
function beforeNativeInput(event){
 try{
  flushPendingBoundary();
  if(mode==='author'&&recorder.active&&!loading&&event.type==='pointerdown')recorder.pointerDown();
  if(mode!=='author'||!recorder.active||loading||event.type!=='keydown'||!['Delete','Backspace'].includes(event.key))return;
  if(event.target instanceof Element&&(event.target.closest('input,textarea')||event.target.isContentEditable))return;
  const elements=read(),byId=new Map(elements.map(element=>[element.id,element]));
  recorder.observe(elements);
  const selection=api.getAppState().selectedElementIds;
  const roots=Object.keys(selection).filter(id=>selection[id]).map(id=>{
   const element=byId.get(id);return element?.type==='text'&&element.containerId?element.containerId:id;
  }).filter(id=>{const element=byId.get(id);return element&&!element.isDeleted&&['rectangle','arrow','frame'].includes(element.type);});
  recorder.excludeSelection(roots);
 }catch(error){reply({type:'error',message:String(error)});}
}
// Camera fitting never writes elements or records an action. The fit area is the
// editor minus Excalidraw's own chrome as it is laid out now (top toolbar and hint,
// bottom zoom/undo bar, mobile bars), measured from its DOM, plus room for a frame's
// name above the frame. Sizes come from the editor's root element, not the app
// state, which can still hold the size from before the editor was shown (UP-06).
// The zoom comes from the content (legibility); a frame is shown closed on all
// four sides when it fits at that zoom, at a smaller zoom that stays legible
// (ER-05), or at most 10 % below a content zoom that is already under it; a frame
// too large for that keeps the content-centred view. Both fits are computed
// first and the camera moves once, so nothing sees an in-between view.
const LEGIBLE_ZOOM=0.65,EDGE=32,GAP=8,FRAME_NAME=28;
// Islands of the desktop and the mobile layout; layout containers that span the editor are skipped.
const CHROME='.App-toolbar,.HintViewer,.layer-ui__wrapper__footer-left,.layer-ui__wrapper__footer-right,.App-bottom-bar>.Island,.App-mobile-menu,.mobile-misc-tools-container';
function fitOffsets(width,height){
 const offsets={top:EDGE,bottom:EDGE,left:EDGE,right:EDGE};
 for(const node of document.querySelectorAll(CHROME)){
  const r=node.getBoundingClientRect();
  if(r.width<=0||r.height<=0||r.bottom<=0||r.top>=height||r.height>height/2)continue;
  if(r.height>r.width){ // a vertical island on a side
   if((r.left+r.right)/2>width/2)offsets.right=Math.max(offsets.right,width-r.left+GAP);
   else offsets.left=Math.max(offsets.left,r.right+GAP);
  }else if((r.top+r.bottom)/2<height/2)offsets.top=Math.max(offsets.top,r.bottom+GAP+FRAME_NAME);
  else offsets.bottom=Math.max(offsets.bottom,height-r.top+GAP);
 }
 return offsets;
}
function fitViewport(){
 if(!api||loading)return;
 const live=api.getSceneElements().filter(element=>!element.isDeleted);
 const content=live.filter(element=>element.type!=='frame'),frames=live.filter(element=>element.type==='frame');
 if(!content.length)return;
 const root=document.getElementById('root').getBoundingClientRect();
 if(root.width<=0||root.height<=0)return;
 const appState={...api.getAppState(),width:root.width,height:root.height},canvasOffsets=fitOffsets(root.width,root.height);
 if(root.height-canvasOffsets.top-canvasOffsets.bottom<=0)return;
 let camera=zoomToFitBounds({bounds:getCommonBounds(content),appState,canvasOffsets,fitToViewport:true,viewportZoomFactor:0.9,maxZoom:1}).appState;
 if(frames.length===1){
  // Exact, not rounded to Excalidraw's 10 % steps: a frame that fits at 66 % is not shown at 60 %.
  const [x1,y1,x2,y2]=getCommonBounds(frames),contentZoom=camera.zoom.value;
  const width=root.width-canvasOffsets.left-canvasOffsets.right,height=root.height-canvasOffsets.top-canvasOffsets.bottom;
  const zoom=Math.min(contentZoom,width/(x2-x1),height/(y2-y1));
  // Below the legible zoom anyway (narrow editors), closing the frame may cost at most 10 % more.
  if(zoom>=Math.min(contentZoom,LEGIBLE_ZOOM)||(contentZoom<LEGIBLE_ZOOM&&zoom>=contentZoom*0.9))camera={zoom:{value:zoom},
   scrollX:(canvasOffsets.left+(width-(x2-x1)*zoom)/2)/zoom-x1,
   scrollY:(canvasOffsets.top+(height-(y2-y1)*zoom)/2)/zoom-y1};
 }
 api.updateScene({appState:{zoom:camera.zoom,scrollX:camera.scrollX,scrollY:camera.scrollY},captureUpdate:CaptureUpdateAction.NEVER});
}
async function replace(elements) {
 await fontsBootstrap();
 clearPendingBoundary();loading=true;clearTimeout(quiet);
 try {
  const restored=restoreElements(elements,null,{repairBindings:true,refreshDimensions:true});
  const byId=new Map(restored.map(e=>[e.id,e]));
  for(const e of restored)if(e.type==='text' && e.containerId){const box=byId.get(e.containerId);if(box){e.x=box.x+(box.width-e.width)/2;e.y=box.y+(box.height-e.height)/2;}}
  // A new scene starts without a selection: a selection left over from another mode or an
  // earlier scene would open Excalidraw's properties panel over the drawing (R3-02).
  api.updateScene({elements:restored,captureUpdate:CaptureUpdateAction.NEVER,appState:{currentItemFontFamily:3,selectedElementIds:{},selectedGroupIds:{},editingGroupId:null}});
  api.history.clear();await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  base=read();last=base;busy=false;historyButtons();
 } finally {loading=false;}
 fitViewport();
}
function observe(elements) {
 if(loading || !api)return;
 last=JSON.parse(JSON.stringify(elements));
 if(mode==='author' && recorder.active) {try{recorder.observe(last);}catch(error){reply({type:'error',message:String(error)});}}
 if(mode==='editor' && !busy){clearTimeout(quiet);quiet=setTimeout(()=>boundary('quiet'),120);}
}
// Excalidraw loads locales asynchronously. Its memoized LayerUI can retain old
// labels when setLanguage finishes after a scene update. Refresh only the tool
// object's identity (not its value), with NEVER capture, until native controls
// prove the requested presentation. Do not remount or clear native/host history.
async function present(language,theme){
 presentationAvailable=false;engineLanguage=language==='de'?'de-DE':'en';engineTheme=theme==='dark'?'dark':'light';renderApp();
 const expected=engineLanguage==='de-DE'?'Rückgängig machen':'Undo',deadline=Date.now()+5000;
 while(Date.now()<deadline){
  await new Promise(resolve=>setTimeout(resolve,25));
  const undo=document.querySelector('[data-testid="button-undo"]'),canvas=document.querySelector('.excalidraw');
  if(document.documentElement.lang===engineLanguage&&undo?.getAttribute('aria-label')===expected&&canvas?.classList.contains('theme--dark')===(engineTheme==='dark')){presentationAvailable=true;return;}
  if(api)api.updateScene({appState:{activeTool:{...api.getAppState().activeTool}},captureUpdate:CaptureUpdateAction.NEVER});
 }
 throw Error('Engine locale presentation unavailable');
}
// Presentation-only visible bounds from the existing verified parent port.
// Only finite, clamped numeric CSS properties; no scene/camera/history/recorder calls.
function presentBounds(bounds){
 if(!bounds||typeof bounds!=='object'||Array.isArray(bounds)||Object.keys(bounds).sort().join(',')!=='height,width,x,y')return;
 const values=['x','y','width','height'];if(values.some(key=>typeof bounds[key]!=='number'||!Number.isFinite(bounds[key])))return;
 const x=Math.min(innerWidth,Math.max(0,bounds.x)),y=Math.min(innerHeight,Math.max(0,bounds.y));
 const width=Math.min(innerWidth-x,Math.max(0,bounds.width)),height=Math.min(innerHeight-y,Math.max(0,bounds.height));
 for(const [key,value]of Object.entries({x,y,width,height}))document.documentElement.style.setProperty('--_pn-native-visible-'+key,value+'px');
}
async function receive(message) {
 const {id,type}=message;
 if(type==='presentation-bounds'){presentBounds(message.bounds);return;}
 try {
  if(!presentationAvailable&&!['language','stop'].includes(type))throw Error('Engine locale presentation unavailable');
  if(type==='configure'){mode=message.mode;canUndo=message.canUndo===true;await replace(message.elements);reply({id,type:'configured',fontsReady});}
  else if(type==='snapshot')reply({id,type:'snapshot',snapshot:snapshotElements(read()),elements:read(),fontsReady});
  else if(type==='start'){if(mode!=='author')throw Error('Recorder requires author mode');if(!fontsReady)throw Error('Fonts are not ready');clearPendingBoundary();recorder.start(read(),fontsReady);reply({id,type:'started',initial:recorder.initial,fontsReady});}
  else if(type==='stop'){clearPendingBoundary();if(recorder.active)recorder.observe(read());recorder.stop();reply({id,type:'stopped'});}
  else if(type==='resync'){canUndo=message.canUndo===true;await replace(message.elements);reply({id,type:'resynced'});}
  else if(type==='language'){await present(message.language,message.theme);reply({id,type:'language',language:engineLanguage,theme:engineTheme});}
 }catch(error){reply({id,type:'error',message:String(error)});}
}
// Only the already authenticated immutable Port can request a fresh failed-font document.
function retryFontBootstrap(message){
 if(!message||typeof message!=='object'||Array.isArray(message)||Object.keys(message).length!==1||
    fontsBootstrap.bootstrapError!=='Engine fonts are not ready'||fontsReady||recorder.active||fontBootstrapReloadPending||
    !parentOrigin||location.pathname!=='/editor.html'||location.search!=='')return;
 fontBootstrapReloadPending=true;
 // Restore only the original canonical parent fragment; the static route and origin stay identical.
 history.replaceState(null,'',location.pathname+'#parent='+encodeURIComponent(parentOrigin));
 location.reload();
}
window.addEventListener('message',event=>{
 if(port || event.source!==parent || event.origin!==parentOrigin || event.data?.type!=='practonaut-engine/1' || event.ports.length!==1)return;
 port=event.ports[0];port.onmessage=event=>{const message=event.data;if(message?.type==='retry-font-bootstrap'){retryFontBootstrap(message);return;}if(message?.type==='language')presentationTail=presentationTail.then(()=>receive(message));else void presentationTail.then(()=>receive(message));};port.start();
 if(fontsBootstrap.bootstrapError&&!fontsBootstrap.bootstrapErrorReported){fontsBootstrap.bootstrapErrorReported=true;reply({type:'error',message:fontsBootstrap.bootstrapError});}
 if(api && fontsReady)reply({type:'ready',fontsReady});
});
parent.postMessage({type:'practonaut-engine-ready/1'},parentOrigin);
window.addEventListener('pointerdown',beforeNativeInput,true);
window.addEventListener('keydown',beforeNativeInput,true);
window.addEventListener('pointerup',()=>terminalBoundary('pointerup'));
window.addEventListener('pointercancel',()=>terminalBoundary('pointerup'));
window.addEventListener('keyup',()=>terminalBoundary('key'));
// Native toolbar and keyboard Undo share the host's sole history in practice mode.
const historyButtons=()=>{if(mode!=='editor')return;const undo=document.querySelector('[data-testid="button-undo"]');if(undo&&undo.disabled===canUndo)undo.disabled=!canUndo;};
new MutationObserver(historyButtons).observe(document.getElementById('root'),{subtree:true,childList:true,attributes:true,attributeFilter:['disabled']});
window.addEventListener('click',event=>{if(mode!=='editor')return;const button=event.target instanceof Element?event.target.closest('[data-testid="button-undo"],[data-testid="button-redo"]'):null;if(!button)return;event.preventDefault();event.stopImmediatePropagation();if(button.dataset.testid==='button-undo'&&canUndo)reply({type:'undo'});else reply({type:'unmodeled',message:'Redo is not modeled'});},true);
window.addEventListener('keydown',event=>{
 if(mode==='editor' && (event.ctrlKey||event.metaKey) && ['z','y'].includes(event.key.toLowerCase())){event.preventDefault();event.stopImmediatePropagation();if(event.key.toLowerCase()==='z' && !event.shiftKey)reply({type:'undo'});else reply({type:'unmodeled',message:'Redo is not modeled'});}
},true);
// Viewport changes only move the camera; scene, native history and recorder remain untouched.
let viewportFitFrame,lastViewport='';
new ResizeObserver(entries=>{const {width,height}=entries[0].contentRect,key=`${width}:${height}`;if(width<=0||height<=0||key===lastViewport)return;lastViewport=key;cancelAnimationFrame(viewportFitFrame);viewportFitFrame=requestAnimationFrame(()=>requestAnimationFrame(fitViewport));}).observe(document.getElementById('root'));
async function loaded(value){api=value;window.__pnEditor={read,appState:()=>api.getAppState()};try{await fontsBootstrap();fontsReady=true;reply({type:'ready',fontsReady});}catch{fontsBootstrap.bootstrapError='Engine fonts are not ready';if(port&&!fontsBootstrap.bootstrapErrorReported){fontsBootstrap.bootstrapErrorReported=true;reply({type:'error',message:fontsBootstrap.bootstrapError});}}}
let engineLanguage='en',engineTheme='light';
const root=createRoot(document.getElementById('root')),onApi=value=>{void loaded(value);};
function renderApp(){root.render(React.createElement(Excalidraw,{aiEnabled:false,excalidrawAPI:onApi,onChange:observe,initialData:{appState:{currentItemFontFamily:3}},UIOptions:{canvasActions:{loadScene:false,saveToActiveFile:false,export:false,saveAsImage:false}},langCode:engineLanguage,theme:engineTheme}));}
renderApp();
