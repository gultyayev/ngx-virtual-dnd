import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { makeExperiment } from './experiment-fixture.ts';

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
    const run = () =>
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
        ],
        { encoding: 'utf8' },
      );
    assert.equal(run().status, 2);
    assert.match(
      JSON.parse(readFileSync(comparison, 'utf8')).reasons.join(' '),
      /Historical standalone/,
    );
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
