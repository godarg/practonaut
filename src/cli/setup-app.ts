/**
 * `practonaut setup --app drawio [--from <file>]` (PADR-0049 decision 2.1): Chromium first, exactly as
 * plain setup; then Chromium under draw.io's sandbox policy, said before the download; then the pinned
 * release, named with its file, source, exact size and full SHA-256, and checked before it is kept.
 * Loaded only for `--app`, so plain `setup` keeps its own small set of modules.
 */
import { cliText, getCliLanguage } from './messages.ts';
import { displayPath, safeText } from './output.ts';
import { browserAdvice, chromiumStarts, type StartResult } from './browser-start.ts';
import { RuntimeError } from './runtime.ts';
import type { AdapterSandboxPolicy } from '../adapters/browser/chromium.ts';
import { DrawioInstallError, installDrawio, installDrawioFrom, PRODUCT_SCHEMES, type InstallOptions, type InstallResult } from '../adapters/drawio/download.ts';
import { DRAWIO_PIN } from '../adapters/drawio/pin.ts';
import { appDisplayName } from '../world/apps.ts';
import { resolvedDataPaths } from '../platform/paths.ts';

/** Seams for tests: where the runtime goes, the network, the browser checks. */
export interface SetupSeams {
  home?: string;
  chromium?: (adapterId: string) => Promise<number>;
  starts?: (policy: AdapterSandboxPolicy) => Promise<StartResult>;
  install?: (options: InstallOptions) => Promise<InstallResult>;
  installFrom?: (file: string, options: Omit<InstallOptions, 'allowedSchemes' | 'fetch'>) => Promise<InstallResult>;
}
/** Chromium first, exactly as plain setup; then Chromium under draw.io's sandbox policy, said
 * before the download; then the pinned release, checked before it is kept. */
export async function setupDrawio(from: string | undefined, seams: SetupSeams): Promise<number> {
  const chromium = await seams.chromium!('drawio');
  if (chromium !== 0) return chromium;
  const values = { app: appDisplayName('drawio', getCliLanguage()), id: 'drawio', version: DRAWIO_PIN.version };
  const started = await (seams.starts ?? (policy => chromiumStarts(undefined, policy)))('required');
  if (!started.ok) process.stdout.write(cliText('setupAppSandbox', { ...values, detail: started.detail, advice: browserAdvice() }));
  const home = seams.home ?? (await resolvedDataPaths()).home;
  const notice = cliText('setupAppNotice');
  try {
    let result: InstallResult;
    if (from !== undefined) {
      process.stdout.write(cliText('setupAppFrom', { ...values, path: safeText(from), bytes: DRAWIO_PIN.size, hash: DRAWIO_PIN.sha256, notice }));
      result = await (seams.installFrom ?? installDrawioFrom)(from, { home });
    } else {
      process.stdout.write(cliText('setupAppStart', { ...values, asset: DRAWIO_PIN.asset, bytes: DRAWIO_PIN.size, hash: DRAWIO_PIN.sha256, source: DRAWIO_PIN.source, notice }));
      result = await (seams.install ?? installDrawio)({ home, allowedSchemes: PRODUCT_SCHEMES });
    }
    const path = safeText(displayPath(result.path));
    if (result.status === 'already') process.stdout.write(cliText('setupAppAlready', { ...values, path }));
    else {
      if (result.replaced) process.stdout.write(cliText('setupAppReplaced', { path }));
      process.stdout.write(cliText('setupAppDone', { ...values, path, bytes: result.bytes }));
    }
    return 0;
  } catch (error) {
    if (!(error instanceof DrawioInstallError)) throw error;
    const d = error.details;
    const message = error.code === 'app_install_busy' ? cliText('appInstallBusy', values)
      : error.code === 'app_download_mismatch' ? cliText('appDownloadMismatch', { ...values, reason: error.reason, expectedBytes: d.expectedBytes ?? DRAWIO_PIN.size, expectedHash: d.expectedSha256 ?? DRAWIO_PIN.sha256, actualBytes: d.actualBytes ?? '?', actualHash: d.actualSha256 ?? '?' })
      : cliText('appDownloadFailed', { ...values, reason: error.reason, detail: safeText(error.message), source: DRAWIO_PIN.source });
    throw new RuntimeError(error.code, message);
  }
}

