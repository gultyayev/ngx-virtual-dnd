import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { makeExperiment } from './experiment-fixture.ts';

test('a count decision can gate a timing experiment without changing its recorded protocol', () => {
  const directory = mkdtempSync(resolve(tmpdir(), 'perf-decision-profile-'));
  try {
    const experimentFile = resolve(directory, 'experiment.json');
    const comparisonFile = resolve(directory, 'comparison.json');
    const experiment = makeExperiment(20, 'timing');
    for (const block of experiment.blocks)
      for (const run of block.runs)
        if (run.variant === 'head') run.scenarios[0].raw[0].taskDuration += 20;
    const writeExperiment = () => writeFileSync(experimentFile, JSON.stringify(experiment));
    const run = (...extra: string[]) =>
      spawnSync(
        process.execPath,
        [
          '--experimental-strip-types',
          resolve(import.meta.dirname, '../compare.ts'),
          '--experiment',
          experimentFile,
          '--json',
          comparisonFile,
          ...extra,
        ],
        { encoding: 'utf8' },
      );
    writeExperiment();
    assert.equal(run().status, 1, 'the recorded timing experiment exposes the task regression');
    assert.equal(run('--decision-profile', 'counts').status, 0);
    const counts = JSON.parse(readFileSync(comparisonFile, 'utf8'));
    assert.equal(counts.profile, 'counts');
    assert.equal(counts.verdict, 'pass');
    assert.equal(counts.rows.length, 10);
    assert.ok(
      counts.rows.every(
        (row: { metric: string }) =>
          row.metric === 'layoutCount' || row.metric === 'recalcStyleCount',
      ),
    );
    const retained = JSON.parse(readFileSync(experimentFile, 'utf8'));
    assert.equal(retained.profile, 'timing');
    assert.equal(retained.blocks.length, 20);
    assert.equal(retained.blocks[0].runs[0].scenarios[0].warmupIterations, 1);
    for (const block of experiment.blocks)
      for (const benchmark of block.runs)
        if (benchmark.variant === 'head') benchmark.scenarios[0].raw[0].layoutCount += 5;
    writeExperiment();
    assert.equal(run('--decision-profile', 'counts').status, 1);
    const regression = JSON.parse(readFileSync(comparisonFile, 'utf8'));
    assert.equal(regression.verdict, 'regression');
    assert.ok(
      regression.rows.some(
        (row: { metric: string; verdict: string }) =>
          row.metric === 'layoutCount' && row.verdict === 'regression',
      ),
    );
    assert.equal(run('--decision-profile', 'timing').status, 1);
    assert.equal(JSON.parse(readFileSync(comparisonFile, 'utf8')).profile, 'timing');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('comparison CLI rejects unknown or missing decision profiles rather than using a default gate', () => {
  const directory = mkdtempSync(resolve(tmpdir(), 'perf-invalid-decision-'));
  try {
    const experimentFile = resolve(directory, 'experiment.json');
    const comparisonFile = resolve(directory, 'comparison.json');
    writeFileSync(experimentFile, JSON.stringify(makeExperiment()));
    for (const extra of [['--decision-profile', 'speed'], ['--decision-profile']]) {
      const result = spawnSync(
        process.execPath,
        [
          '--experimental-strip-types',
          resolve(import.meta.dirname, '../compare.ts'),
          '--experiment',
          experimentFile,
          '--json',
          comparisonFile,
          ...extra,
        ],
        { encoding: 'utf8' },
      );
      assert.equal(result.status, 3);
      const comparison = JSON.parse(readFileSync(comparisonFile, 'utf8'));
      assert.equal(comparison.verdict, 'invalid');
      assert.match(comparison.reasons.join(' '), /requires a value|must be counts or timing/);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('comparison CLI produces evidence and distinct outcomes, including missing input', () => {
  const directory = mkdtempSync(resolve(tmpdir(), 'perf-comparison-'));
  try {
    const experimentFile = resolve(directory, 'experiment.json');
    const json = resolve(directory, 'comparison.json');
    const markdown = resolve(directory, 'comparison.md');
    const run = () =>
      spawnSync(
        process.execPath,
        [
          '--experimental-strip-types',
          resolve(import.meta.dirname, '../compare.ts'),
          '--experiment',
          experimentFile,
          '--json',
          json,
          '--output',
          markdown,
        ],
        { encoding: 'utf8' },
      );
    assert.equal(run().status, 3, 'missing evidence must fail closed');
    assert.equal(JSON.parse(readFileSync(json, 'utf8')).verdict, 'invalid');
    const experiment = makeExperiment();
    writeFileSync(experimentFile, JSON.stringify(experiment));
    assert.equal(run().status, 0);
    assert.equal(JSON.parse(readFileSync(json, 'utf8')).verdict, 'pass');
    assert.match(readFileSync(markdown, 'utf8'), /PASS/);
    for (const block of experiment.blocks)
      for (const benchmark of block.runs)
        if (benchmark.variant === 'head') benchmark.scenarios[0].raw[0].taskDuration += 20;
    writeFileSync(experimentFile, JSON.stringify(experiment));
    assert.equal(run().status, 1);
    assert.equal(JSON.parse(readFileSync(json, 'utf8')).verdict, 'regression');
    experiment.blocks.pop();
    experiment.requestedBlocks = 9;
    writeFileSync(experimentFile, JSON.stringify(experiment));
    assert.equal(run().status, 2);
    assert.equal(JSON.parse(readFileSync(json, 'utf8')).verdict, 'inconclusive');
    const escape = spawnSync(
      process.execPath,
      [
        '--experimental-strip-types',
        resolve(import.meta.dirname, '../compare.ts'),
        '--allow-baseline-mismatch',
      ],
      { encoding: 'utf8' },
    );
    assert.equal(escape.status, 3);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('historical standalone evidence is inconclusive, and old schemas remain invalid', () => {
  const directory = mkdtempSync(resolve(tmpdir(), 'perf-historical-'));
  try {
    const scenarios = makeExperiment().blocks[0].runs[0].scenarios;
    const data = {
      config: { version: '1.63' },
      errors: [],
      stats: {
        expected: 6,
        unexpected: 0,
        skipped: 0,
        flaky: 0,
        startTime: '2026-10-08T00:00:00.000Z',
      },
      suites: [
        {
          specs: scenarios.map((scenario) => ({
            ok: true,
            tests: [
              {
                expectedStatus: 'passed',
                status: 'expected',
                results: [
                  {
                    status: 'passed',
                    retry: 0,
                    errors: [],
                    attachments: [
                      {
                        name: scenario.scenario,
                        contentType: 'application/json',
                        body: Buffer.from(JSON.stringify(scenario)).toString('base64'),
                      },
                    ],
                  },
                ],
              },
            ],
          })),
        },
      ],
    };
    const baseline = resolve(directory, 'base.json');
    const current = resolve(directory, 'head.json');
    const comparison = resolve(directory, 'comparison.json');
    writeFileSync(baseline, JSON.stringify(data));
    writeFileSync(current, JSON.stringify(data));
    const run = (...extra: string[]) =>
      spawnSync(
        process.execPath,
        [
          '--experimental-strip-types',
          resolve(import.meta.dirname, '../compare.ts'),
          '--baseline',
          baseline,
          '--current',
          current,
          '--json',
          comparison,
          ...extra,
        ],
        { encoding: 'utf8' },
      );
    assert.equal(run().status, 2);
    assert.match(
      JSON.parse(readFileSync(comparison, 'utf8')).reasons.join(' '),
      /Historical standalone/,
    );
    assert.equal(run('--decision-profile', 'counts').status, 3);
    assert.match(
      JSON.parse(readFileSync(comparison, 'utf8')).reasons.join(' '),
      /decision profile.*balanced experiment/i,
    );
    data.config.version = '1.64';
    writeFileSync(current, JSON.stringify(data));
    assert.equal(run().status, 3);
    assert.match(
      JSON.parse(readFileSync(comparison, 'utf8')).reasons.join(' '),
      /different Playwright versions/,
    );
    data.config.version = '1.63';
    const old = { ...scenarios[0], metricsSchemaVersion: 3 };
    data.suites[0].specs[0].tests[0].results[0].attachments[0].body = Buffer.from(
      JSON.stringify(old),
    ).toString('base64');
    writeFileSync(current, JSON.stringify(data));
    assert.equal(run().status, 3);
    assert.match(
      JSON.parse(readFileSync(comparison, 'utf8')).reasons.join(' '),
      /unsupported metrics schema/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
