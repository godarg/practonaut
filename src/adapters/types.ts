import type { Action, Failure, State } from "../world/types.ts";
export interface AdapterDescription {
  id: "excalidraw"; appVersion: "0.18.1"; adapterVersion: string;
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
