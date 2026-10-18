/**
 * The pinned draw.io release (PADR-0049 decision 2.2) and what of it the adapter may serve
 * (decision 3.2). Practonaut never redistributes the release: `practonaut setup --app drawio`
 * downloads it unmodified from the official release and keeps it only when its size and SHA-256
 * equal these values. A pin bump changes this file, the world table, the registry and the checker's
 * format table together, and needs a full conformance run.
 */
export const DRAWIO_PIN = Object.freeze({
  /** The app version worlds name in `app.versionRange`. */
  version: '32.4.1',
  tag: 'v32.4.1',
  asset: 'draw.war',
  size: 48_442_174,
  sha256: 'b83663313ccdecef6581476a7eaa96750bccf1bfdc3768981eb5d95e94be7820',
  source: 'https://github.com/jgraph/drawio/releases/download/v32.4.1/draw.war',
  /** When size and hash were recorded; they matched GitHub's published asset digest. */
  recorded: '2026-10-14',
});

/**
 * The only archive entries the app origin serves: the 14 files the pinned app loads with `lang=en`
 * (measured, spikes/drawio/results/shell.json). Every other path is refused and recorded. A file is
 * added only when the conformance suite records it as needed, with the reason in the change.
 */
export const DRAWIO_ALLOWLIST = Object.freeze([
  'index.html', 'styles/grapheditor.css', 'styles/high-contrast.css', 'mxgraph/css/common.css',
  'js/bootstrap.js', 'js/main.js', 'js/PreConfig.js', 'js/PostConfig.js', 'js/app.min.js',
  'js/shapes-14-6-5.min.js', 'js/stencils.min.js', 'js/extensions.min.js',
  'resources/dia.txt', 'images/github-logo.svg',
] as const);

/** Documented URL parameters only: the spike's set plus `lang=en`, which pins the served files. */
export const DRAWIO_URL_PARAMETERS = 'embed=1&proto=json&configure=1&stealth=1&lockdown=1&pwa=0&plugins=0&math=0&gapi=0&od=0&tr=0&gh=0&gl=0&drafts=0&splash=0&sync=none&lang=en';
