import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { dependencyHash, FIXTURE_PATHS, hashPaths, LIBRARY_PATHS } from './fixtures/runner-plan.ts';

const root = process.cwd();
const manifest = resolve(root, 'dist/perf-build.json');
rmSync(manifest, { force: true });
const inputIdentity = () => ({
  fixtureHash: hashPaths(root, FIXTURE_PATHS),
  libraryHash: hashPaths(root, LIBRARY_PATHS),
  dependencyHash: dependencyHash(root),
});
const before = inputIdentity();
for (const script of ['build:lib', 'build']) {
  const result = spawnSync('npm', ['run', script], { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
if (JSON.stringify(before) !== JSON.stringify(inputIdentity())) {
  throw new Error(
    'Benchmark inputs changed during the production build. Rebuild from stable source.',
  );
}
mkdirSync(resolve(root, 'dist'), { recursive: true });
writeFileSync(
  manifest,
  JSON.stringify(
    {
      formatVersion: 1,
      ...before,
      outputHash: hashPaths(root, ['dist/dnd/browser']),
    },
    null,
    2,
  ) + '\n',
);
