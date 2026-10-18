/**
 * The draw.io adapter (PADR-0049). Until the adapter lands on the shared shell, its start is refused
 * by name: a world naming draw.io validates and runs model-only, and `--mirror required` stops.
 */
import type { State } from '../../world/types.ts';
import type { AdapterOptions, MirrorAdapter } from '../types.ts';
import { AdapterError, type EngineLifecycleProbe } from '../browser/shell.ts';

export { DRAWIO_PIN } from './pin.ts';

export async function createDrawioAdapter(_initial: State, _options: AdapterOptions = {}, _probe?: EngineLifecycleProbe): Promise<MirrorAdapter> {
  throw new AdapterError('mirror_unavailable', 'The draw.io mirror is not available in this build');
}
