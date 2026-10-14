/**
 * The one download the real Excalidraw mirror needs: Playwright's Chromium headless shell. The
 * mirror only ever starts Chromium headless, and Playwright starts the headless shell for that, so
 * `practonaut setup` installs nothing else (`install --only-shell chromium`; Playwright adds its
 * small ffmpeg build to every Chromium install).
 *
 * Sizes are measured, not estimated: the `Content-Length` of each pinned archive on Playwright's
 * CDN (headless shell plus ffmpeg), read on 2026-10-14 for playwright-core 1.63.0 (Chrome for
 * Testing 153.0.8010.12, ffmpeg r1011). A Playwright update changes them; a unit test fails until
 * they are measured again for the new pin. Nothing here makes a network call.
 */
export const HEADLESS_SHELL = Object.freeze({
  name: 'Chromium headless shell',
  playwright: '1.63.0',
  browserVersion: '153.0.8010.12',
  /** Bytes per platform: headless shell archive + ffmpeg archive. */
  bytes: Object.freeze({
    'darwin-arm64': 98_831_293 + 1_097_141,
    'darwin-x64': 104_060_463 + 1_353_430,
    'linux-x64': 119_809_080 + 2_376_500,
    'linux-arm64': 120_278_638 + 1_717_234,
    'win32-x64': 120_200_717 + 1_411_741,
  } as Record<string, number>),
});

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
