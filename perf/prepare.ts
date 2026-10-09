import { spawnSync } from 'node:child_process';
import { cpSync, realpathSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { DEPENDENCY_PATHS } from './fixtures/runner-plan.ts';

const { values } = parseArgs({ options: { base: { type: 'string' }, head: { type: 'string' } } });
if (!values.base) throw new Error('Use --base with a clean, disposable baseline checkout.');
const base = realpathSync(resolve(values.base));
const head = realpathSync(resolve(values.head ?? '.'));
if (base === head) throw new Error('Baseline must be a separate checkout.');
const status = spawnSync('git', ['status', '--porcelain', '--untracked-files=all'], {
  cwd: base,
  encoding: 'utf8',
});
if (status.status !== 0 || status.stdout.trim())
  throw new Error('Baseline checkout must be clean before preparing the common fixture.');
for (const name of [...DEPENDENCY_PATHS, 'perf', 'scripts']) {
  rmSync(resolve(base, name), { recursive: true, force: true });
  cpSync(resolve(head, name), resolve(base, name), { recursive: true });
}
console.log(
  `Common harness and dependency manifests prepared in ${base}; the baseline consumer fixture, library and Git revision are preserved. Install dependencies in both checkouts and run npm run perf:build -- --fixture ${base} in each.`,
);
