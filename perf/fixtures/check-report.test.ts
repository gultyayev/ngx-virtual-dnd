import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { CONTRACT_CASES } from '../contracts/cases.ts';

const script = resolve(import.meta.dirname, '../check-report.ts');
const report = () => ({
  stats: { expected: CONTRACT_CASES.length, unexpected: 0, skipped: 0, flaky: 0 },
  errors: [],
  suites: [
    {
      specs: CONTRACT_CASES.map(({ title }) => ({
        title,
        tests: [{ status: 'expected', results: [{ status: 'passed', retry: 0 }] }],
      })),
    },
  ],
});
function fixture(run: (root: string, invoke: () => ReturnType<typeof spawnSync>) => void) {
  const root = mkdtempSync(resolve(tmpdir(), 'perf-check-report-'));
  const env = { ...process.env };
  delete env['NODE_TEST_CONTEXT'];
  mkdirSync(resolve(root, 'perf/results'), { recursive: true });
  try {
    run(root, () => spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8', env }));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('report requires every registered contract exactly once, not a hard-coded count', () => {
  fixture((root, invoke) => {
    const write = (value: unknown) =>
      writeFileSync(resolve(root, 'perf/results/check.json'), JSON.stringify(value));
    write(report());
    assert.equal(invoke().status, 0);
    for (const mutation of [
      'missing',
      'duplicate',
      'unknown',
      'skipped',
      'retry',
      'empty',
    ] as const) {
      const value = report();
      const specs = value.suites[0].specs;
      if (mutation === 'missing') specs.pop();
      if (mutation === 'duplicate') specs[1] = specs[0];
      if (mutation === 'unknown') specs[0].title = 'unregistered check';
      if (mutation === 'skipped') specs[0].tests[0].results[0].status = 'skipped';
      if (mutation === 'retry') specs[0].tests[0].results[0].retry = 1;
      if (mutation === 'empty') specs[0].tests = [];
      write(value);
      assert.equal(invoke().status, 1, mutation);
      assert.match(
        readFileSync(resolve(root, 'perf/results/check.md'), 'utf8'),
        /failed or are incomplete/,
      );
    }
  });
});

test('missing, malformed and failed reports cannot keep a passing verdict', () => {
  fixture((root, invoke) => {
    assert.equal(invoke().status, 1);
    writeFileSync(resolve(root, 'perf/results/check.json'), '{invalid');
    assert.equal(invoke().status, 1);
    assert.match(
      readFileSync(resolve(root, 'perf/results/check.md'), 'utf8'),
      /Invalid check evidence/,
    );
    const value = report();
    value.stats.unexpected++;
    writeFileSync(resolve(root, 'perf/results/check.json'), JSON.stringify(value));
    assert.equal(invoke().status, 1);
  });
});

test('setup failure report shows the compiler error instead of a previous pass', () => {
  fixture((root, invoke) => {
    writeFileSync(resolve(root, 'perf/results/check.json'), JSON.stringify(report()));
    writeFileSync(
      resolve(root, 'perf/results/build-failure.md'),
      'Consumer build failed: NG8002 removedInput',
    );
    const result = invoke();
    assert.equal(result.status, 1);
    assert.match(String(result.stdout), /NG8002 removedInput/);
  });
});
