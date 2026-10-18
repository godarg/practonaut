import type { Action, AdapterId, AppVersion, Failure, State } from "../world/types.ts";
export interface AdapterDescription {
  id: AdapterId; appVersion: AppVersion; adapterVersion: string;
  capabilities: Array<"describe" | "snapshot" | "apply" | "exportArtifact" | "importArtifact">;
  fontFamilies: number[]; excludedAttributes: Record<string, string>;
}
export interface Artifact { native: string; svg: string; nativeSha256: string; svgSha256: string }
export interface AdapterOptions { timeoutMs?: number; signal?: AbortSignal }
export type AdapterResult = { ok: true; state: State; warnings: string[] } | { ok: false; error: Failure };
export interface Transition { before: State; after: State; action: Action }
export interface ApplicationAdapter {
  describe(): AdapterDescription;
  snapshot(): Promise<State>;
  apply(transition: Transition, options?: AdapterOptions): Promise<AdapterResult>;
  exportArtifact(options?: AdapterOptions): Promise<Artifact>;
  importArtifact(native: string, options?: AdapterOptions): Promise<AdapterResult>;
  close(): Promise<void>;
}
/** What the host-side live mirror needs beyond PADR-0007 (PADR-0011, PADR-0045); every adapter in
 * the registry provides it. */
export interface MirrorAdapter extends ApplicationAdapter {
  /** Requests the app's page made that the adapter refused, in order. */
  networkAttempts(): string[];
  /** Host-only resynchronisation, always checked against real read-back. */
  restoreState(state: State, options?: AdapterOptions): Promise<AdapterResult>;
  /** The current scene as PNG, rendered by the real app. */
  renderPng(): Promise<Uint8Array>;
  /** Cancel pending browser work before recovery; deliberately bypasses the write queue. */
  terminate(): Promise<void>;
}
