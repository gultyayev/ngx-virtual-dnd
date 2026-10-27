import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { test } from 'node:test';

const script = resolve(import.meta.dirname, '../check-report.ts');

test('check report rejects missing, skipped, failed and incomplete inventories', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'perf-check-report-'));
  const env = { ...process.env };
  delete env['NODE_TEST_CONTEXT'];
  const run = () => spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8', env });
  try {
    assert.equal(run().status, 1);
    for (const stats of [
      { expected: 13, unexpected: 0, skipped: 1, flaky: 0 },
      { expected: 12, unexpected: 1, skipped: 0, flaky: 0 },
      { expected: 12, unexpected: 0, skipped: 0, flaky: 0 },
      { expected: 13, unexpected: 0, skipped: 0, flaky: 1 },
    ]) {
      writeFileSync(
        resolve(root, 'perf/results/check.json'),
        JSON.stringify({ stats, errors: [] }),
      );
      assert.equal(run().status, 1);
      assert.match(
        readFileSync(resolve(root, 'perf/results/check.md'), 'utf8'),
        /failed or are incomplete/,
      );
    }
    writeFileSync(
      resolve(root, 'perf/results/check.json'),
      JSON.stringify({
        stats: { expected: 13, unexpected: 0, skipped: 0, flaky: 0 },
        errors: [],
      }),
    );
    assert.equal(run().status, 0);
    writeFileSync(resolve(root, 'perf/results/check.json'), '{invalid');
    assert.equal(run().status, 1);
    assert.match(
      readFileSync(resolve(root, 'perf/results/check.md'), 'utf8'),
      /Invalid check evidence/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('setup failure report shows the compiler error instead of a previous pass', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'perf-check-build-failure-'));
  try {
    mkdirSync(resolve(root, 'perf/results'), { recursive: true });
    writeFileSync(
      resolve(root, 'perf/results/check.json'),
      JSON.stringify({
        stats: { expected: 13, unexpected: 0, skipped: 0, flaky: 0 },
        errors: [],
      }),
    );
    writeFileSync(
      resolve(root, 'perf/results/build-failure.md'),
      'Consumer build failed: NG8002 removedInput',
    );
    const env = { ...process.env };
    delete env['NODE_TEST_CONTEXT'];
    const result = spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8', env });
    assert.equal(result.status, 1);
    assert.match(result.stdout, /NG8002 removedInput/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
