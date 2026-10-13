import { chromium } from 'playwright';
import { mkdtemp,rm,mkdir,writeFile,realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { startHost } from '../src/host/server.ts';
import { validateWorld } from '../src/world/schema.ts';
const directory=await mkdtemp(join(await realpath(tmpdir()),'pn-recovery-render-'));
const output='.local/product-recovery-renders';await mkdir(output,{recursive:true});
const host=await startHost(validateWorld(JSON.parse(readFileSync('examples/worlds/flow-diagram/world.json','utf8'))),{phase3:true,taskId:'T3',seed:42,localDirectory:directory,tokenDirectory:join(directory,'credentials')});
const browser=await chromium.launch({headless:true});const ledger:unknown[]=[];
try{const page=await browser.newPage({viewport:{width:1280,height:1000},reducedMotion:'reduce'});await page.goto(host.url);await page.getByTestId('phase3-status').filter({hasText:/ready|bereit/}).waitFor();for(const language of ['en','de'] as const)for(const theme of ['light','dark'] as const)for(const width of [1280,320]){
 await page.setViewportSize({width,height:1000});await page.getByTestId('language-'+language).click();await page.getByTestId('theme-select').selectOption(theme);if(!await page.getByTestId('recovery-guide').isVisible())await page.getByTestId('mode-author').click();await page.getByTestId('recovery-prepare').waitFor();await page.getByTestId('real-editor').waitFor({state:'hidden'});await page.evaluate(()=>new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r()))));
 const file=`${output}/guide-${language}-${theme}-${width}.png`;await page.screenshot({path:file,fullPage:true});ledger.push({language,theme,width,file,overflow:await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)});
 }
 await page.setViewportSize({width:1280,height:1000});await page.getByTestId('language-en').click();await page.getByTestId('theme-select').selectOption('light');await page.evaluate(()=>{const d=document.createElement('dialog');d.className='dialog';const h=document.createElement('h2');h.textContent='Design alternative: modal evidence review';const p=document.createElement('p');p.textContent='Observed: deleting Review left the connected arrows loose. Another recorded run is needed to confirm this behavior.';const q=document.createElement('p');q.textContent='This synthetic design variant compares a modal with the inline workbench. It does not record or confirm anything.';const b=document.createElement('button');b.textContent='Return to workbench';b.onclick=()=>d.close();d.append(h,p,q,b);document.body.append(d);d.showModal();b.focus();});await page.screenshot({path:output+'/variant-modal-en-light.png'});ledger.push({variant:'synthetic-modal',file:output+'/variant-modal-en-light.png'});
 await writeFile(output+'/ledger.json',JSON.stringify(ledger,null,2));
}finally{await browser.close();await host.close();await rm(directory,{recursive:true,force:true});}
