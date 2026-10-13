// Pinned Excalidraw 0.18.1 SourceMap sources[34], SHA db994e57791014204ba89e7ff902f2409b46ace3cd53907c3b4ac0e88d8e18c9.
// These are descriptors of the already registered upstream faces, never new font definitions.
const EXCALIFONT_RANGES = Object.freeze([
  "U+20-7E, U+A0-A3, U+A5-A6, U+A8-AB, U+AD-B1, U+B4, U+B6-B8, U+BA-FF, U+131, U+152-153, U+2BC, U+2C6, U+2DA, U+2DC, U+304, U+308, U+2013-2014, U+2018-201A, U+201C-201E, U+2020, U+2022, U+2024-2026, U+2030, U+2039-203A, U+20AC, U+2122, U+2212",
  "U+100-130, U+132-137, U+139-149, U+14C-151, U+154-17E, U+192, U+1FC-1FF, U+218-21B, U+237, U+1E80-1E85, U+1EF2-1EF3, U+2113",
  "U+400-45F, U+490-491, U+2116",
  "U+37E, U+384-38A, U+38C, U+38E-393, U+395-3A1, U+3A3-3A8, U+3AA-3CF, U+3D7",
  "U+2C7, U+2D8-2D9, U+2DB, U+2DD, U+302, U+306-307, U+30A-30C, U+326-328, U+212E, U+2211, U+FB01-FB02",
  "U+462-463, U+472-475, U+4D8-4D9, U+4E2-4E3, U+4E6-4E9, U+4EE-4EF",
  "U+300-301, U+303"
]);
const FAILURE = 'Engine fonts are not ready';
const BOOTSTRAP_TIMEOUT_MS = 8000;
function existingFaces() {
  const faces = [...document.fonts].filter(face => face.family.replace(/^['"]|['"]$/g, '') === 'Excalifont');
  if (!faces.length) return null; // The API callback precedes upstream initializeScene.
  if (faces.length !== EXCALIFONT_RANGES.length) throw Error(FAILURE);
  const ranges = new Set();
  for (const face of faces) {
    if (face.family !== 'Excalifont' || face.style !== 'normal' || face.weight !== '400' ||
        !EXCALIFONT_RANGES.includes(face.unicodeRange) || ranges.has(face.unicodeRange)) throw Error(FAILURE);
    ranges.add(face.unicodeRange);
  }
  return faces;
}
/** One bounded promise for registration, load and strict recheck on this surface. */
export function createFontReadinessBootstrap(root) {
  root.inert = true;
  // The pinned app also handles keyboard/clipboard/drop on window. Inert only
  // blocks target interaction; close those global handlers until strict readiness.
  const inputEvents = ['keydown', 'keyup', 'paste', 'drop', 'copy', 'cut'];
  const blockInput = event => { if (event.cancelable && !(['keydown', 'keyup'].includes(event.type) && event.key === 'Tab')) event.preventDefault(); event.stopImmediatePropagation(); };
  for (const type of inputEvents) window.addEventListener(type, blockInput, true);
  let promise;
  return () => promise ??= (() => {
    let timeout;
    const deadline = performance.now() + BOOTSTRAP_TIMEOUT_MS;
    const work = (async () => {
      let faces;
      while (!(faces = existingFaces())) {
        if (performance.now() >= deadline) throw Error(FAILURE);
        await new Promise(resolve => setTimeout(resolve, 16));
      }
      await Promise.all([document.fonts.load('20px Cascadia'), ...faces.map(face => face.load())]);
      await document.fonts.ready;
      const finalFaces = existingFaces();
      if (!finalFaces || finalFaces.some(face => face.status !== 'loaded' || !faces.includes(face)) ||
          !document.fonts.check('20px Cascadia')) throw Error(FAILURE);
    })();
    // Only the winning bounded promise can release input; a late load cannot reopen it.
    const bounded = Promise.race([work, new Promise((_, reject) => {
      timeout = setTimeout(() => reject(Error(FAILURE)), BOOTSTRAP_TIMEOUT_MS);
    })]);
    return bounded.then(() => { for (const type of inputEvents) window.removeEventListener(type, blockInput, true); root.inert = false; }, () => { throw Error(FAILURE); })
      .finally(() => clearTimeout(timeout));
  })();
}
