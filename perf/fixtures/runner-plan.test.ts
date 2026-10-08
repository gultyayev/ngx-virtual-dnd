import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { blockOrder, hashPaths, LIBRARY_PATHS } from './runner-plan.ts';

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
