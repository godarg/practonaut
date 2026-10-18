/**
 * Practonaut's own host page for draw.io (PADR-0049 decisions 3.1, 4.1, 4.3): one iframe with the app
 * and a `postMessage` relay. No script ever runs in the app frame; Node drives this page, and this page
 * talks to the app only by the documented embed JSON protocol. It also parses draw.io's export with the
 * browser's own XML parser into a cell table: a `parsererror` element is a refusal (DOMParser reports
 * errors that way, not by an exception).
 */
export const HOST_ORIGIN = 'http://practonaut.invalid';
export const APP_ORIGIN = 'http://drawio.practonaut.invalid';
/** The longest export the host page parses. */
export const MAX_EXPORT_CHARS = 10 * 1024 * 1024;

export function hostPage(parameters: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Practonaut</title>
<style>html,body{margin:0;height:100%}iframe{border:0;width:100%;height:100%;display:block}</style></head><body>
<iframe id="app" src="${APP_ORIGIN}/index.html?${parameters}"></iframe>
<script>
(() => {
  const frame = document.getElementById('app'); const waiters = [];
  const pn = { ready: false };
  window.addEventListener('message', (evt) => {
    if (evt.source !== frame.contentWindow || evt.origin !== '${APP_ORIGIN}' || typeof evt.data !== 'string') return;
    let data; try { data = JSON.parse(evt.data); } catch (e) { return; }
    if (!data || typeof data !== 'object') return;
    if (data.event === 'configure') frame.contentWindow.postMessage(JSON.stringify({ action: 'configure', config: { compressXml: false } }), '${APP_ORIGIN}');
    if (data.event === 'init') pn.ready = true;
    for (const w of waiters.slice()) if (w.event === data.event) { waiters.splice(waiters.indexOf(w), 1); clearTimeout(w.timer); w.resolve(data); }
  });
  pn.send = (message, event, timeoutMs) => new Promise((resolve, reject) => {
    const w = { event, resolve };
    w.timer = setTimeout(() => { const i = waiters.indexOf(w); if (i >= 0) waiters.splice(i, 1); reject(new Error('timeout waiting for ' + event)); }, timeoutMs);
    waiters.push(w); frame.contentWindow.postMessage(JSON.stringify(message), '${APP_ORIGIN}');
  });
  const tree = (el) => {
    const attrs = {}; for (const a of Array.from(el.attributes)) attrs[a.name] = a.value;
    const children = [];
    for (const child of Array.from(el.childNodes)) {
      if (child.nodeType === 1) children.push(tree(child));
      else if (child.nodeType === 3 && child.nodeValue.trim() !== '') throw new Error('text');
      else if (child.nodeType !== 3 && child.nodeType !== 8) throw new Error('node');
    }
    return { name: el.nodeName, attrs, children };
  };
  const elements = (el) => Array.from(el.childNodes).filter(n => n.nodeType === 1);
  pn.cells = (xml) => {
    if (typeof xml !== 'string' || xml.length > ${MAX_EXPORT_CHARS}) return { error: 'too_large' };
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    if (doc.getElementsByTagName('parsererror').length > 0) return { error: 'parsererror' };
    let model = doc.documentElement;
    if (model.nodeName === 'mxfile') {
      const diagrams = elements(model);
      if (diagrams.length !== 1 || diagrams[0].nodeName !== 'diagram') return { error: 'pages' };
      const inner = elements(diagrams[0]);
      if (inner.length !== 1 || inner[0].nodeName !== 'mxGraphModel') return { error: 'diagram' };
      model = inner[0];
    }
    if (model.nodeName !== 'mxGraphModel') return { error: 'model' };
    const roots = elements(model);
    if (roots.length !== 1 || roots[0].nodeName !== 'root') return { error: 'root' };
    try { return { cells: elements(roots[0]).map(tree) }; } catch (e) { return { error: 'content' }; }
  };
  window.__pn = pn;
})();
</script></body></html>`;
}
