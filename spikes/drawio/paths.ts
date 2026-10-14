// Locations of the spike. Third-party files live only under the ignored .local/ folder.
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

export interface Pin { tag: string; asset: string; published: string; size?: number; sha256?: string; recorded?: string }
export const SPIKE_DIR = fileURLToPath(new URL('./', import.meta.url));
export const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const PIN_FILE = join(SPIKE_DIR, 'pin.json');
export const LOCAL_DIR = join(REPO_ROOT, '.local', 'spikes', 'drawio');
const tag = 'v32.4.1';
export const DOWNLOAD_DIR = join(LOCAL_DIR, `download-${tag}`);
export const WEBAPP_DIR = join(LOCAL_DIR, `webapp-${tag}`);
export const RESULTS_DIR = join(LOCAL_DIR, 'results');
export const SUMMARY_DIR = join(SPIKE_DIR, 'results');
