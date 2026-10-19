// PADR-0049 decision 2.8: the workflow allowlist check. The repository's workflows pass; each negative
// fixture (a parent of the draw.io home, ${{ runner.temp }}, a glob, an environment variable, a path set
// through $GITHUB_ENV, actions/cache/save, an unlisted third-party upload action, two different homes,
// the sandbox variable on the job, and more) is refused by name.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { checkAllowlist, checkRepository, checkWorkflow, type WorkflowAllowlist } from '../../tools/check-workflows.ts';

const SHA = 'a'.repeat(40);
const allow: WorkflowAllowlist = {
  paths: ['.local/native-transfer/', '.local/drawio-conformance/summary.json', '${{ runner.temp }}/practonaut-out/'],
  releaseAssets: ['release/practonaut.tgz'],
  actions: { [`actions/checkout@${SHA}`]: 'checks out' },
};
const HOME = '${{ runner.temp }}/practonaut-drawio-home';
const workflow = (o: { jobEnv?: string; lift?: boolean; setupHome?: string; layerHome?: string; deleteHome?: string; required?: string; deleteIf?: string; extraSteps?: string; preSteps?: string } = {}): string => `name: t
on:
  push:
jobs:
  test:
    runs-on: ubuntu-latest${o.jobEnv ? `\n    env:\n      ${o.jobEnv}` : ''}
    steps:
      - uses: actions/checkout@${SHA}
${o.preSteps ?? ''}      - name: lift
        env:
          PRACTONAUT_CHROMIUM_SANDBOX: require
        run: |
          ${o.lift === false ? 'echo nothing' : 'sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0'}
      - name: setup
        env:
          PRACTONAUT_HOME: ${o.setupHome ?? HOME}
        run: node src/cli/main.ts setup --app drawio
      - name: layer
        env:
          PN_DRAWIO_HOME: ${o.layerHome ?? HOME}
          PN_DRAWIO_REQUIRED: '${o.required ?? '1'}'
        run: npm run test:drawio
${o.extraSteps ?? ''}      - name: delete
        if: ${o.deleteIf ?? '${{ always() }}'}
        env:
          PN_DRAWIO_HOME: ${o.deleteHome ?? HOME}
        run: rm -rf "$PN_DRAWIO_HOME"
`;
const upload = (action: string, path: string): string => `      - uses: ${action}\n        with:\n          path: ${path}\n`;
const problems = (text: string): string[] => checkWorkflow('t.yml', text, allow);

test('the repository\'s workflows and allowlist pass, and the base fixture passes', () => {
  assert.deepEqual(checkRepository(fileURLToPath(new URL('../../', import.meta.url))), []);
  assert.deepEqual(problems(workflow()), []);
  assert.deepEqual(problems(workflow({ extraSteps: upload(`actions/upload-artifact@${SHA}`, '.local/drawio-conformance/summary.json') })), []);
});

test('cache and upload paths: only listed literals; roots, globs, variables and unlisted actions are refused', () => {
  const refused = (extra: string, pattern: RegExp): void => { const found = problems(workflow({ extraSteps: extra })); assert.ok(found.some(p => pattern.test(p)), `${extra} → ${JSON.stringify(found)}`); };
  refused(upload(`actions/upload-artifact@${SHA}`, '${{ runner.temp }}/'), /whole root/);
  refused(upload(`actions/upload-artifact@${SHA}`, '${{ runner.temp }}'), /whole root/);
  refused(upload(`actions/upload-artifact@${SHA}`, '.local'), /whole root/);
  refused(upload(`actions/upload-artifact@${SHA}`, '.'), /whole root/);
  refused(upload(`actions/upload-artifact@${SHA}`, '.local/**/*.json'), /glob/);
  refused(upload(`actions/upload-artifact@${SHA}`, '$PN_DRAWIO_HOME'), /expression or variable/);
  refused(upload(`actions/upload-artifact@${SHA}`, '${{ env.HOME_DIR }}/draw.war'), /expression or variable/);
  refused(upload(`actions/upload-artifact@${SHA}`, '.local/other/'), /not in the workflow allowlist/);
  refused(upload(`actions/cache/save@${SHA}`, `${HOME}/apps/`), /not in the workflow allowlist/);
  refused(upload(`actions/upload-pages-artifact@${SHA}`, `${HOME}`), /not in the workflow allowlist/);
  refused(upload(`someone/upload-files@${SHA}`, '.local/native-transfer/'), /not on the list of actions/);
  refused(upload('actions/upload-artifact@v7', '.local/native-transfer/'), /not pinned by a commit SHA/);
  refused('      - run: gh release upload v1 release/practonaut.tgz draw.war --clobber\n', /release asset "draw\.war"/);
  // The list itself is held to the same rules, and a listed parent of the home is refused.
  assert.ok(checkAllowlist({ ...allow, paths: ['${{ runner.temp }}/'] }).some(p => /whole root/.test(p)));
  assert.ok(checkAllowlist({ ...allow, actions: { [`actions/upload-artifact@${SHA}`]: 'no' } }).some(p => /saves or publishes/.test(p)));
  assert.ok(checkWorkflow('t.yml', workflow(), { ...allow, paths: [...allow.paths, '${{ runner.temp }}/practonaut-drawio-home/apps/'] }).some(p => /would reach the draw\.io home/.test(p)));
});

test('the draw.io steps: one literal home, the flag, always() deletion, after the lift, no sandbox variable, nothing through $GITHUB_ENV', () => {
  const refused = (options: Parameters<typeof workflow>[0], pattern: RegExp): void => { const found = problems(workflow(options)); assert.ok(found.some(p => pattern.test(p)), `${JSON.stringify(options)} → ${JSON.stringify(found)}`); };
  refused({ layerHome: '${{ runner.temp }}/other-home' }, /layer's PN_DRAWIO_HOME is not setup's home/);
  refused({ deleteHome: '${{ runner.temp }}/other-home' }, /deletion's PN_DRAWIO_HOME is not setup's home/);
  refused({ setupHome: '${{ runner.temp }}' }, /one literal folder/);
  refused({ setupHome: '/tmp/home' }, /one literal folder/);
  refused({ setupHome: '${{ env.H }}' }, /one literal folder/);
  refused({ required: '0' }, /PN_DRAWIO_REQUIRED=1/);
  refused({ deleteIf: '${{ success() }}' }, /always\(\)/);
  refused({ lift: false }, /after the step that lifts/);
  // A job that runs only on macOS and Windows needs no lift; one whose matrix holds Linux does.
  const offLinux = (os: string): string => workflow({ lift: false }).replace('    runs-on: ubuntu-latest', `    strategy:\n      matrix:\n        os: [${os}]\n    runs-on: \${{ matrix.os }}`);
  assert.deepEqual(problems(offLinux('macos-latest, windows-latest')), []);
  assert.ok(problems(offLinux('macos-latest, ubuntu-latest')).some(p => /after the step that lifts/.test(p)));
  refused({ jobEnv: 'PRACTONAUT_CHROMIUM_SANDBOX: require' }, /PRACTONAUT_CHROMIUM_SANDBOX is set at the job level/);
  refused({ jobEnv: `PN_DRAWIO_HOME: ${HOME}` }, /PN_DRAWIO_HOME is set at the job level/);
  refused({ preSteps: `      - run: echo "PN_DRAWIO_HOME=$RUNNER_TEMP/x" >> "$GITHUB_ENV"\n` }, /through \$GITHUB_ENV/);
  assert.ok(checkWorkflow('t.yml', `env:\n  PRACTONAUT_CHROMIUM_SANDBOX: require\n${workflow()}`, allow).some(p => /set at the workflow level/.test(p)));
  // Without the layer there is nothing to check in that job; a missing deletion is refused.
  assert.ok(problems(workflow().replace(/      - name: delete[\s\S]*$/, '')).some(p => /exactly one setup, one layer and one deletion/.test(p)));
});
