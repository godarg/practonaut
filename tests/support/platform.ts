// Windows has no POSIX mode bits and no numeric file owner (`fs.Stats.uid` is 0, `process.getuid`
// is absent). The product checks type, links and symlinks there and relies on the user-profile ACL
// for privacy (src/platform/private-fs.ts). Assertions about modes, owners, uid/gid and chmod-based
// refusals are POSIX properties; they run on macOS and Linux and are not asserted on Windows.
export const POSIX = process.platform !== 'win32';
/** `skip` value for tests that are entirely about POSIX owners, modes or uid/gid. */
export const POSIX_ONLY: string | false = POSIX ? false : 'POSIX owners, modes and uid/gid do not exist on Windows (src/platform/private-fs.ts)';
/** `skip` value for supervised client evaluation (tools/agent-runs.ts, src/evaluation/client.ts): it
 * binds the client to the caller's POSIX uid/gid and refuses Windows by name (tests/unit/evaluation.test.ts). */
export const SUPERVISED_EVALUATION: string | false = POSIX ? false : 'supervised client evaluation is POSIX-only; Windows is refused by name';
