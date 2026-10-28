import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { test } from 'node:test';

const script = resolve(import.meta.dirname, '../build-contracts.ts');
for (const stage of ['library', 'contract-consumer']) {
  test(`${stage} compiler failure preserves the diagnostic and invalidates old output`, () => {
    const root = mkdtempSync(resolve(tmpdir(), 'contract-build-failure-'));
    try {
      for (const path of [
        'node_modules/@angular/cli/bin',
        'perf/consumer',
        'perf/results',
        'dist/perf-contracts/browser',
      ])
        mkdirSync(resolve(root, path), { recursive: true });
      writeFileSync(resolve(root, 'perf/consumer/main.ts'), '');
      writeFileSync(resolve(root, 'tsconfig.json'), '{}');
      writeFileSync(resolve(root, 'dist/perf-contracts/browser/index.html'), 'stale');
      writeFileSync(resolve(root, 'perf/results/check.json'), 'stale passing evidence');
      writeFileSync(
        resolve(root, 'node_modules/@angular/cli/bin/ng.js'),
        `
        if (${JSON.stringify(stage)} === 'library' || process.argv.includes('contracts')) {
          console.error('NG8002: removedInput cannot be bound'); process.exit(1);
        }
      `,
      );
      const env = { ...process.env };
      delete env['NODE_TEST_CONTEXT'];
      const result = spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8', env });
      assert.equal(result.status, 1);
      const report = readFileSync(resolve(root, 'perf/results/build-failure.md'), 'utf8');
      assert.match(report, new RegExp(stage));
      assert.match(report, /NG8002: removedInput/);
      assert.match(
        readFileSync(resolve(root, `perf/results/build-${stage}.log`), 'utf8'),
        /NG8002/,
      );
      assert.equal(existsSync(resolve(root, 'dist/perf-contracts/browser')), false);
      assert.equal(existsSync(resolve(root, 'perf/results/check.json')), false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}
