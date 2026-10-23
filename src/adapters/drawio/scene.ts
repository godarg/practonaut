/**
 * What the draw.io adapter holds besides the app's diagram, and how a read and a saved scene use it
 * (PADR-0049 decisions 4.2 and 5.1). It reaches the app only through the functions passed in, so its
 * unit tests run without draw.io (review m2d, r2-runtime-3).
 */
import type { State } from '../../world/types.ts';
import type { SceneIO } from '../browser/shell.ts';
import { readBack, writeCheck } from './readback.ts';
import { cloneMemory, freshMemory, type WriterMemory, type XmlNode } from './writer.ts';

/** The app, as the adapter reaches it through the embed protocol and the host page. */
export interface DrawioIO {
  exportXml(): Promise<string>;
  cellsOf(xml: string): Promise<{ cells: XmlNode[] } | { error: string }>;
  load(xml: string): Promise<void>;
  startPage(): Promise<void>;
}
/** The writer's derived memory and the cells of the last confirmed write: what the app must still hold
 * whenever the adapter reads it (review m2c, Codex 3). */
export interface Remembered { memory: WriterMemory; committed: XmlNode[] | undefined }
export interface DrawioScene extends Remembered { xml: string }
export const freshRemembered = (): Remembered => ({ memory: freshMemory(), committed: undefined });

/** Integrity of the read cells and, after a confirmed write, every difference from that write. */
export function readIssues(committed: readonly XmlNode[] | undefined, cells: readonly XmlNode[]): { state: State; issues: string[] } {
  const result = readBack(cells);
  return { state: result.state, issues: [...(committed ? writeCheck(committed, cells) : []), ...result.issues] };
}
/** The app's current state from its export, as `snapshot()` and apply's before-check read it. */
export async function readScene(io: Pick<DrawioIO, 'exportXml' | 'cellsOf'>, remembered: Remembered): Promise<{ state: State; issues: string[]; exported: string }> {
  const exported = await io.exportXml(), parsed = await io.cellsOf(exported);
  if ('error' in parsed) return { state: { objects: {} }, issues: [`the export does not parse (${parsed.error})`], exported };
  return { ...readIssues(remembered.committed, parsed.cells), exported };
}
/** Saving and restoring a scene for the shell's transactions: the diagram and what the adapter
 * remembers with it, so a rollback restores both. */
export function sceneOf(io: DrawioIO, remembered: Remembered): SceneIO<DrawioScene> {
  const restore = (saved: DrawioScene): void => { remembered.memory = cloneMemory(saved.memory); remembered.committed = structuredClone(saved.committed); };
  return {
    read: async () => ({ xml: await io.exportXml(), memory: cloneMemory(remembered.memory), committed: structuredClone(remembered.committed) }),
    write: async saved => { restore(saved); await io.load(saved.xml); },
    load: async saved => { await io.startPage(); restore(saved); await io.load(saved.xml); },
  };
}
