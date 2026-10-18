/**
 * Messages about an adapter's downloaded app runtime (PADR-0049 decision 1.3): the values that name the
 * app and its download, and the refusal text for an absent or damaged runtime. The app's name is the
 * world table's fixed display name, never world text.
 */
import { ADAPTER_REGISTRY, type AdapterRegistration, type AdapterRegistry, type RuntimeStatus } from '../adapters/registry.ts';
import { AdapterInitializationError, AppRuntimeFault } from '../adapters/browser/shell.ts';
import { appDisplayName } from '../world/apps.ts';
import { cliText, getCliLanguage } from './messages.ts';
import { safeText } from './output.ts';

/** Catalog values that name a downloaded app and its download. */
export function appValues(registration: { id: string; download?: AdapterRegistration['download'] }): Record<string, string | number> {
  return { app: appDisplayName(registration.id, getCliLanguage()), id: registration.id, name: registration.download?.name ?? registration.id, bytes: registration.download?.bytes ?? 0, size: Math.round((registration.download?.bytes ?? 0) / 1_000_000) };
}
/** The refusal of a runtime that is absent or does not match its pin. */
export function appRuntimeMessage(registration: { id: string; download?: AdapterRegistration['download'] }, status: Extract<RuntimeStatus, { ok: false }>): string {
  return status.code === 'app_runtime_missing' ? cliText('appRuntimeMissing', appValues(registration)) : cliText('appRuntimeUnverified', { ...appValues(registration), detail: safeText(status.detail) });
}
/**
 * The adapter's own start found its downloaded runtime absent or changed after the CLI's check
 * (PADR-0049 decision 2.6): the runtime's code and refusal text, or `undefined` for any other error.
 */
export function appRuntimeFailure(error: unknown, registry: AdapterRegistry = ADAPTER_REGISTRY): { code: AppRuntimeFault['runtimeCode']; message: string; registration: AdapterRegistration } | undefined {
  const primary = error instanceof AdapterInitializationError ? error.primaryError : error;
  if (!(primary instanceof AppRuntimeFault) || !Object.hasOwn(registry, primary.adapterId)) return undefined;
  const registration = registry[primary.adapterId]!;
  return { code: primary.runtimeCode, message: appRuntimeMessage(registration, { ok: false, code: primary.runtimeCode, detail: primary.message }), registration };
}
