// One start of the app with a write and a read-back; prints what happened (no files written).
//   node spikes/drawio/smoke.ts
import { startDrawio } from './harness.ts';
import { project, readDrawio } from './parser.ts';

const app = await startDrawio();
try {
  process.stdout.write(`sandbox=${app.sandbox} timings=${JSON.stringify(app.timings)}\n`);
  const xml = '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="s1" value="Hello &amp; &lt;b&gt;" style="rounded=0;whiteSpace=wrap;html=0;strokeColor=#000000;fillColor=none;" vertex="1" parent="1"><mxGeometry x="10" y="20" width="180" height="90" as="geometry"/></mxCell></root></mxGraphModel>';
  const t = performance.now();
  const loaded = await app.load(xml);
  const exported = await app.exportXml();
  process.stdout.write(`load+export ${(performance.now() - t).toFixed(1)} ms; load keys ${Object.keys(loaded).join(',')}\n`);
  process.stdout.write(`export: ${exported.slice(0, 1200)}\n`);
  const file = readDrawio(exported);
  process.stdout.write(`parsed compressed=${file.compressed} cells=${file.cells.length} ${JSON.stringify(project(file))}\n`);
  process.stdout.write(`denied=${JSON.stringify(app.denied)}\nmissing=${JSON.stringify(app.missing)}\nserved=${app.served.size} files, ${[...app.served.values()].reduce((s, f) => s + f.bytes, 0)} bytes, all match release: ${[...app.served.values()].every(f => f.matchesRelease)}\n`);
  process.stdout.write(`served: ${[...app.served.keys()].join(' ')}\n`);
  process.stdout.write(`console:\n${app.console.join('\n')}\ndialogs: ${app.dialogs.join(' | ')}\n`);
} finally { await app.close(); }
