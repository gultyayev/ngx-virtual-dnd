import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  blockOrder,
  hashPaths,
  installedDependencyHash,
  LIBRARY_PATHS,
  runnerProfile,
} from './runner-plan.ts';

test('balanced block order cancels a linear temporal effect and reverses between blocks', () => {
  for (const index of [0, 1]) {
    const order = blockOrder(index);
    const base = order.flatMap((v, i) => (v === 'base' ? [100 + i * 10] : []));
    const head = order.flatMap((v, i) => (v === 'head' ? [100 + i * 10] : []));
    assert.equal(
      base.reduce((a, b) => a + b),
      head.reduce((a, b) => a + b),
    );
  }
  assert.notDeepEqual(blockOrder(0), blockOrder(1));
  assert.throws(() => blockOrder(-1));
});

test('workload identity detects content, deleted inputs and renamed files', () => {
  const root = mkdtempSync(join(tmpdir(), 'perf-hash-'));
  try {
    mkdirSync(join(root, 'fixture'));
    writeFileSync(join(root, 'fixture', 'a.txt'), 'same');
    const original = hashPaths(root, ['fixture']);
    writeFileSync(join(root, 'fixture', 'a.txt'), 'changed');
    assert.notEqual(hashPaths(root, ['fixture']), original);
    writeFileSync(join(root, 'fixture', 'a.txt'), 'same');
    renameSync(join(root, 'fixture', 'a.txt'), join(root, 'fixture', 'b.txt'));
    assert.notEqual(hashPaths(root, ['fixture']), original);
    assert.throws(() => hashPaths(root, ['missing']));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('library identity includes every production compilation configuration', () => {
  const root = mkdtempSync(join(tmpdir(), 'perf-library-hash-'));
  try {
    for (const input of LIBRARY_PATHS) {
      if (input.endsWith('/src')) mkdirSync(join(root, input), { recursive: true });
      else {
        mkdirSync(join(root, input, '..'), { recursive: true });
        writeFileSync(join(root, input), '{}');
      }
    }
    const original = hashPaths(root, LIBRARY_PATHS);
    for (const configuration of [
      'ng-package.json',
      'tsconfig.lib.json',
      'tsconfig.lib.prod.json',
    ]) {
      const path = join(root, 'projects/ngx-virtual-dnd', configuration);
      writeFileSync(path, '{"changed":true}');
      assert.notEqual(hashPaths(root, LIBRARY_PATHS), original, configuration);
      writeFileSync(path, '{}');
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('runner profiles keep quick count evidence separate from warmed timing evidence', () => {
  assert.deepEqual(runnerProfile('counts'), { profile: 'counts', blocks: 3, warmupIterations: 0 });
  assert.deepEqual(runnerProfile('timing'), { profile: 'timing', blocks: 20, warmupIterations: 1 });
  assert.throws(() => runnerProfile('unknown'), /profile must be counts or timing/);
});

test('installed fingerprints reject stale dependency locks and package files without depending on checkout paths', () => {
  const roots = [
    mkdtempSync(join(tmpdir(), 'perf-install-a-')),
    mkdtempSync(join(tmpdir(), 'perf-install-b-')),
  ];
  const install = (
    root: string,
    declaredVersion: string,
    installedVersion: string,
    actualVersion: string,
  ) => {
    mkdirSync(join(root, 'node_modules/example'), { recursive: true });
    writeFileSync(join(root, 'package.json'), '{}');
    const declared = { '': {}, 'node_modules/example': { version: declaredVersion } };
    const installed = { 'node_modules/example': { version: installedVersion } };
    writeFileSync(join(root, 'package-lock.json'), JSON.stringify({ packages: declared }));
    writeFileSync(
      join(root, 'node_modules/.package-lock.json'),
      JSON.stringify({ packages: installed }),
    );
    writeFileSync(
      join(root, 'node_modules/example/package.json'),
      JSON.stringify({ name: 'example', version: actualVersion, _where: root }),
    );
  };
  try {
    for (const root of roots) install(root, '1.0.0', '1.0.0', '1.0.0');
    assert.equal(installedDependencyHash(roots[0]), installedDependencyHash(roots[1]));
    install(roots[0], '2.0.0', '1.0.0', '1.0.0');
    assert.throws(() => installedDependencyHash(roots[0]), /differs from the declared lock/);
    install(roots[0], '2.0.0', '2.0.0', '1.0.0');
    assert.throws(() => installedDependencyHash(roots[0]), /package files.*stale or incomplete/);
    writeFileSync(join(roots[0], 'node_modules/.package-lock.json'), '{"packages":{}}');
    assert.throws(() => installedDependencyHash(roots[0]), /Required dependency.*not installed/);
    writeFileSync(
      join(roots[0], 'package-lock.json'),
      '{"packages":{"":{},"node_modules/optional":{"version":"1.0.0","optional":true}}}',
    );
    assert.equal(typeof installedDependencyHash(roots[0]), 'string');
  } finally {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
  }
});
