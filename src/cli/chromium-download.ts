/**
 * The one download the real Excalidraw mirror needs: Playwright's Chromium headless shell. The
 * mirror only ever starts Chromium headless, and Playwright starts the headless shell for that, so
 * `practonaut setup` installs no headed Chromium (`install --only-shell chromium`). Playwright adds
 * what every Chromium install of it brings along: its small ffmpeg build, and on Windows `winldd`.
 *
 * Sizes are measured, not estimated: the `Content-Length` of each pinned archive on Playwright's
 * CDN, as `node tools/measure-headless-shell.ts --write` reads and writes them below. A Playwright
 * update changes them; a unit test fails until the tool has been run for the new pin. Nothing here
 * makes a network call.
 */
// measure-headless-shell:begin (written by tools/measure-headless-shell.ts --write)
export const HEADLESS_SHELL = Object.freeze({
  name: 'Chromium headless shell',
  playwright: '1.64.0',
  browserVersion: '156.0.8078.4',
  measured: '2026-10-14',
  /** Bytes per platform: the sum of the archives Playwright downloads for `install --only-shell chromium`. */
  bytes: Object.freeze({
    'darwin-arm64': 103_778_487 + 1_430_308,
    'darwin-x64': 109_130_614 + 1_549_708,
    'linux-x64': 125_797_539 + 2_302_701,
    'linux-arm64': 125_711_061 + 2_037_513,
    'win32-x64': 123_826_519 + 1_663_577 + 128_684,
  } as Record<string, number>),
});
// measure-headless-shell:end

/** The download size in whole megabytes (10^6 bytes) for this platform; the largest measured size
 * where the platform is not in the table, so an unknown platform is never told too little. */
export function headlessShellMegabytes(platform: NodeJS.Platform = process.platform, arch: string = process.arch): number {
  const bytes = HEADLESS_SHELL.bytes[`${platform}-${arch}`] ?? Math.max(...Object.values(HEADLESS_SHELL.bytes));
  return Math.round(bytes / 1_000_000);
}

/** Catalogue values `{name}` and `{size}` for every message that names the download. */
export function headlessShellDownload(platform: NodeJS.Platform = process.platform, arch: string = process.arch): { name: string; size: number } {
  return { name: HEADLESS_SHELL.name, size: headlessShellMegabytes(platform, arch) };
}
