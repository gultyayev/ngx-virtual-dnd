import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { generateExperimentReport, generateStandaloneReport, main } from '../report.ts';
import { makeExperiment } from './experiment-fixture.ts';

test('report marks empty benchmark evidence invalid instead of succeeding silently', () => {
  const result = generateStandaloneReport([]);
  assert.match(result, /invalid/i);
  assert.match(result, /scenario|evidence/i);
});

test('report marks malformed experiment evidence invalid without claiming a passing result', () => {
  const result = generateExperimentReport({ formatVersion: 1, blocks: [] });
  assert.match(result, /invalid/i);
  assert.doesNotMatch(result, /verdict:.*pass/i);
});

test('report uses measured metadata and retains exposure, workload, and collapsed blocking evidence', () => {
  const scenarios = makeExperiment(1).blocks[0].runs[0].scenarios;
  const result = generateStandaloneReport(scenarios);
  assert.match(result, /inconclusive/);
  assert.match(result, /Measured samples: \*\*1\*\*/);
  assert.match(result, /CPU throttle: \*\*4×\*\*/);
  assert.match(result, /Browser: \*\*test-browser\*\*/);
  assert.match(result, /Observed duration/);
  assert.match(result, /Observed frame intervals/);
  assert.match(result, /Warmups per suite: \*\*1\*\*/);
  assert.match(result, /Counter exposure: \*\*1001 ms\*\*/);
  assert.match(result, /operations=2/);
  assert.match(result, /scrollDistance=100/);
  assert.match(result, /zero long tasks and zero Total Blocking Time in all \*\*1\*\*/);
  assert.doesNotMatch(result, /p95|p99|Dropped Frames|Samples: \*\*5\*\*/);
});

test('report explains an inconclusive small experiment and shows runner context without causal claims', () => {
  const result = generateExperimentReport(makeExperiment(1));
  assert.match(result, /inconclusive/);
  assert.match(result, /Balanced blocks: \*\*1\*\*/);
  assert.match(result, /common-harness/);
  assert.match(result, /base-sha/);
  assert.match(result, /head-sha/);
  assert.match(result, /Main-thread task time/);
  assert.match(result, /Host CPU busy during suite/);
  assert.match(result, /Pressure cpu before/);
  assert.match(result, /do not establish the cause/);
});

test('report restores blocking diagnostic rows when any raw measurement contains a stall', () => {
  const scenarios = makeExperiment(1).blocks[0].runs[0].scenarios;
  const sample = scenarios[0].raw[0];
  sample.longTasks = [{ startTime: sample.windowStartMs + 10, duration: 100 }];
  sample.longTaskCount = 1;
  sample.totalBlockingTime = 50;
  const result = generateStandaloneReport(scenarios);
  const scrollSection = result.split('### scroll-2000-items')[1].split('### ')[0];
  assert.match(scrollSection, /\| Long tasks \(>50 ms\) \| \*\*1/);
  assert.match(scrollSection, /\| Total Blocking Time \| \*\*50/);
  assert.doesNotMatch(scrollSection, /zero long tasks/);
});

test('unchanged-code calibration labels a regression verdict as a false alarm', () => {
  const experiment = makeExperiment();
  experiment.mode = 'calibration';
  experiment.environment['control'] = 'none';
  experiment.variants.head.commit = experiment.variants.base.commit;
  experiment.variants.head.libraryHash = experiment.variants.base.libraryHash;
  for (const block of experiment.blocks) {
    for (const run of block.runs) {
      if (run.variant === 'head') {
        for (const scenario of run.scenarios) scenario.raw[0].taskDuration += 30;
      }
    }
  }
  const result = generateExperimentReport(experiment);
  assert.match(result, /Verdict: REGRESSION/);
  assert.match(result, /false alarm/i);
  assert.match(result, /unchanged.code calibration/i);
});

test('rerendering an output file replaces the prior verdict with the current evidence', (context) => {
  context.mock.method(console, 'log', () => undefined);
  const directory = mkdtempSync(resolve(tmpdir(), 'perf-report-output-'));
  const input = resolve(directory, 'experiment.json');
  const output = resolve(directory, 'report.md');
  const experiment = makeExperiment(1);
  try {
    writeFileSync(input, JSON.stringify(experiment));
    writeFileSync(output, '**Verdict: REGRESSION**\nStale experiment evidence.\n');
    assert.equal(main(['--input', input, '--output', output]), 0);
    const current = readFileSync(output, 'utf8');
    assert.equal(current, `${generateExperimentReport(experiment)}\n`);
    assert.match(current, /Verdict: INCONCLUSIVE/);
    assert.doesNotMatch(current, /Verdict: REGRESSION|Stale experiment evidence/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

function standaloneReporter() {
  const scenarios = makeExperiment(1).blocks[0].runs[0].scenarios;
  return {
    errors: [],
    stats: { expected: scenarios.length, unexpected: 0, skipped: 0, flaky: 0 },
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
}

test('default report prioritizes a current failed experiment over an older successful standalone suite', (context) => {
  let rendered = '';
  context.mock.method(console, 'log', (value: string) => {
    rendered = value;
  });
  const directory = mkdtempSync(resolve(tmpdir(), 'perf-report-default-'));
  try {
    writeFileSync(resolve(directory, 'latest.json'), JSON.stringify(standaloneReporter()));
    writeFileSync(
      resolve(directory, 'comparison.json'),
      JSON.stringify({
        verdict: 'invalid',
        reasons: ['Current experiment preflight failed: stale build.'],
        rows: [],
        blocks: 0,
        thresholdPercent: 10,
      }),
    );
    assert.equal(main([], directory), 3);
    assert.match(rendered, /invalid/i);
    assert.match(rendered, /Current experiment preflight failed: stale build/);
    assert.doesNotMatch(rendered, /standalone suite|Observed duration/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('a comparison summary without raw evidence cannot supply a passing verdict', (context) => {
  let rendered = '';
  context.mock.method(console, 'log', (value: string) => {
    rendered = value;
  });
  const directory = mkdtempSync(resolve(tmpdir(), 'perf-report-summary-'));
  try {
    writeFileSync(resolve(directory, 'latest.json'), JSON.stringify(standaloneReporter()));
    writeFileSync(
      resolve(directory, 'comparison.json'),
      JSON.stringify({
        verdict: 'pass',
        reasons: [],
        rows: [],
        blocks: 10,
        thresholdPercent: 10,
      }),
    );
    assert.equal(main([], directory), 3);
    assert.match(rendered, /invalid/i);
    assert.match(rendered, /no raw experiment evidence/);
    assert.doesNotMatch(rendered, /Verdict: PASS|standalone suite/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
