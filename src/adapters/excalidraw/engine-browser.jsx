// The unmodified pinned real engine. This host is a capability bridge, never a recorder.
import React from 'react';
import { createFontReadinessBootstrap } from './fonts-ready.js';
import { createRoot } from 'react-dom/client';
import { Excalidraw, restoreElements, exportToSvg, CaptureUpdateAction } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';
import './native-overlay.css';
window.EXCALIDRAW_ASSET_PATH = '/';
const fontsBootstrap = createFontReadinessBootstrap(document.getElementById('root'));
window.__pn = {
  api: null,
  fontsReady: false,
  async write(elements) {
    await fontsBootstrap();
    const restored = restoreElements(elements, null, { repairBindings: true, refreshDimensions: true });
    const byId = new Map(restored.map(e => [e.id, e]));
    for (const e of restored) {
      if (e.type === 'text' && e.containerId) {
        const box = byId.get(e.containerId);
        if (box) { e.x = box.x + (box.width - e.width) / 2; e.y = box.y + (box.height - e.height) / 2; }
      }
    }
    this.api.updateScene({ elements: restored, captureUpdate: CaptureUpdateAction.NEVER, appState: { currentItemFontFamily: 3, scrollX: 0, scrollY: 0 } });
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return this.read();
  },
  read() { return JSON.parse(JSON.stringify(this.api.getSceneElementsIncludingDeleted())); },
  async svg() {
    await document.fonts.ready;
    const svg = await exportToSvg({ elements: this.api.getSceneElements(), appState: { ...this.api.getAppState(), exportWithDarkMode: false, exportBackground: true }, files: {}, exportPadding: 20 });
    return svg.outerHTML;
  },
};
createRoot(document.getElementById('root')).render(React.createElement(Excalidraw, { aiEnabled:false, excalidrawAPI: api => { window.__pn.api = api; void fontsBootstrap().then(() => { window.__pn.fontsReady = true; }).catch(() => {}); }, initialData: { appState: { currentItemFontFamily: 3 } } }));
