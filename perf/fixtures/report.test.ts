import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { generateExperimentReport, generateStandaloneReport, main } from '../report.ts';
import { makeExperiment } from './experiment-fixture.ts';
import { compareExperiment } from './compare-metrics.ts';

function countsExperiment() {
  const experiment = makeExperiment(3);
  experiment.profile = 'counts';
  for (const block of experiment.blocks) {
    for (const run of block.runs) {
      for (const scenario of run.scenarios) {
        scenario.warmupIterations = 0;
        scenario.warmupRaw = [];
      }
    }
  }
  return experiment;
}

test('invalid experiment reports the original runner failure before derivative integrity errors', () => {
  const experiment = makeExperiment(1);
  experiment.completed = false;
  experiment.blocks[0].runs = [];
  experiment.environment['failureReason'] =
    'Head workload failed: final checkpoint was not rendered.';
  for (const details of [false, true]) {
    const report = generateExperimentReport(experiment, 10, { details });
    assert.match(report, /Verdict: INVALID/);
    const firstError = report.split('\n').find((line) => line.startsWith('- '));
    assert.equal(firstError, '- Head workload failed: final checkpoint was not rendered.');
  }
});

test('failure cause is escaped and capped compactly while full details retain it without duplicates', () => {
  const experiment = makeExperiment(1);
  experiment.completed = false;
  const failure = `Head failed | browser\n${'x'.repeat(300)} end of original cause`;
  experiment.environment['failureReason'] = failure;
  const compact = generateExperimentReport(experiment);
  const detailed = generateExperimentReport(experiment, 10, { details: true });
  assert.match(compact, /Head failed \\\| browser/);
  assert.doesNotMatch(compact, /end of original cause/);
  assert.match(detailed, /end of original cause/);
  const duplicate = compareExperiment(experiment).reasons[0];
  experiment.environment['failureReason'] = duplicate;
  const deduplicated = generateExperimentReport(experiment, 10, { details: true });
  assert.equal(deduplicated.split('\n').filter((line) => line === `- ${duplicate}`).length, 1);
});

test('counts profile passes work-count checks despite slow task timings and keeps all scenarios', () => {
  const experiment = countsExperiment();
  for (const block of experiment.blocks) {
    for (const run of block.runs) {
      if (run.variant === 'head') {
        for (const scenario of run.scenarios) scenario.raw[0].taskDuration += 700;
      }
    }
  }
  const report = generateExperimentReport(experiment);
  assert.match(report, /Verdict: PASS/);
  assert.match(report, /work-count budget/);
  assert.match(report, /Task time.*[Dd]iagnostic/);
  assert.match(report, /\| Fixed-height scroll \| 100 → 800 \| \+700\.0% \| 0 \| 0 \| Pass \|/);
  assert.match(report, /\| Cross-list autoscroll \|.*\| Diagnostic \|/);
  assert.equal(report.split('\n').filter((line) => line.startsWith('|')).length, 8);
  assert.ok(report.length < 2000);
  assert.doesNotMatch(report, /Inconclusive: task time|Regression: task time/);
});

test('counts profile names layout and style regressions while task time stays diagnostic', () => {
  const experiment = countsExperiment();
  for (const block of experiment.blocks) {
    for (const run of block.runs) {
      if (run.variant === 'head') {
        for (const scenario of run.scenarios) {
          if (scenario.scenario === 'scroll-2000-items') scenario.raw[0].layoutCount += 5;
          if (scenario.scenario === 'drag-within-list-1000') scenario.raw[0].recalcStyleCount += 10;
        }
      }
    }
  }
  const report = generateExperimentReport(experiment);
  assert.match(report, /Verdict: REGRESSION/);
  assert.match(report, /Regression: layouts/);
  assert.match(report, /Regression: style recalculations/);
  assert.doesNotMatch(report, /Regression: task time/);
});

test('unchanged library source is described as a harness check in compact and detailed reports', () => {
  const experiment = countsExperiment();
  experiment.variants.head.libraryHash = experiment.variants.base.libraryHash;
  experiment.environment['libraryUnchanged'] = true;
  for (const details of [false, true]) {
    const report = generateExperimentReport(experiment, 10, { details });
    assert.match(report, /Library source unchanged: this checks the benchmark harness/);
  }
});

test('default comparison gives one readable row per scenario with the verdict and primary metrics', () => {
  const report = generateExperimentReport(makeExperiment());
  assert.match(report, /Verdict: PASS/);
  assert.match(report, /\| Fixed-height scroll \|/);
  assert.match(report, /\| Cross-list autoscroll \|.*\| Diagnostic \|/);
  assert.equal(report.split('\n').filter((line) => line.startsWith('|')).length, 8);
  assert.ok(report.length < 2000, 'Default report should fit comfortably in a PR comment');
  assert.doesNotMatch(
    report,
    /###|Harness hash|Environment|Runner health|MAD|Workload definition|taskDuration/,
  );
});

test('compact standalone output stays diagnostic and shows one row per scenario', () => {
  const report = generateStandaloneReport(makeExperiment(1).blocks[0].runs[0].scenarios);
  assert.match(report, /Verdict: INCONCLUSIVE/);
  assert.match(report, /standalone|base.*head/i);
  assert.equal(report.split('\n').filter((line) => line.startsWith('|')).length, 8);
  assert.equal(report.split('\n').filter((line) => /\| Diagnostic \|$/.test(line)).length, 6);
  assert.ok(report.length < 1500);
  assert.doesNotMatch(report, /###|Workload definition|MAD|Script time|frame gap/i);
});

test('compact result identifies a style regression even when task time passes', () => {
  const experiment = makeExperiment();
  for (const block of experiment.blocks) {
    for (const run of block.runs) {
      if (run.variant === 'head') {
        const scenario = run.scenarios.find(
          (report) => report.scenario === 'drag-within-list-1000',
        );
        assert.ok(scenario);
        scenario.raw[0].recalcStyleCount += 10;
      }
    }
  }
  const report = generateExperimentReport(experiment);
  assert.match(report, /Verdict: REGRESSION/);
  assert.match(
    report,
    /\| Within-list drag \|.*\| 0\.0% \| 0 \| \+10 \| Regression: style recalculations \|/,
  );
});

test('compact result identifies task-time regression and does not promote paced costs into a gate', () => {
  const experiment = makeExperiment();
  for (const block of experiment.blocks) {
    for (const run of block.runs) {
      if (run.variant === 'head') {
        for (const scenario of run.scenarios) {
          if (scenario.scenario === 'scroll-2000-items') scenario.raw[0].taskDuration += 30;
          if (scenario.kind === 'paced') scenario.raw[0].taskDuration += 700;
        }
      }
    }
  }
  const report = generateExperimentReport(experiment);
  assert.match(
    report,
    /\| Fixed-height scroll \|.*\| \+30\.0% \| 0 \| 0 \| Regression: task time \|/,
  );
  assert.match(report, /\| Cross-list autoscroll \|.*\| Diagnostic \|/);
});

test('compact result keeps a layout-only uncertainty inconclusive', () => {
  const experiment = makeExperiment();
  for (const block of experiment.blocks) {
    for (const run of block.runs) {
      if (run.variant === 'head' && block.index >= 5) {
        const scenario = run.scenarios.find((report) => report.scenario === 'scroll-2000-items');
        assert.ok(scenario);
        scenario.raw[0].layoutCount += 5;
      }
    }
  }
  const report = generateExperimentReport(experiment);
  assert.match(report, /Verdict: INCONCLUSIVE/);
  assert.match(report, /\| Fixed-height scroll \|.*\| Inconclusive: layouts \|/);
});

test('a task regression takes priority while an uncertain layout check remains visible', () => {
  const experiment = makeExperiment();
  for (const block of experiment.blocks) {
    for (const run of block.runs) {
      if (run.variant === 'head') {
        const scenario = run.scenarios.find((report) => report.scenario === 'scroll-2000-items');
        assert.ok(scenario);
        scenario.raw[0].taskDuration += 30;
        if (block.index >= 5) scenario.raw[0].layoutCount += 5;
      }
    }
  }
  const report = generateExperimentReport(experiment);
  assert.match(report, /Verdict: REGRESSION/);
  assert.match(
    report,
    /\| Fixed-height scroll \|.*\| Regression: task time; uncertain: layouts \|/,
  );
});

test('a short experiment names all uncertain checks instead of hiding them behind a summary label', () => {
  const report = generateExperimentReport(makeExperiment(1));
  assert.match(report, /More balanced blocks are needed/);
  assert.match(report, /Inconclusive: task time, layouts, style recalculations/);
});

test('compact invalid output caps repeated problems while detailed output preserves every reason', () => {
  const compact = generateStandaloneReport([]);
  const detailed = generateStandaloneReport([], { details: true });
  assert.match(compact, /invalid/i);
  assert.match(compact, /more|further/);
  assert.doesNotMatch(compact, /drag-between-lists-autoscroll-1000/);
  assert.match(detailed, /drag-between-lists-autoscroll-1000/);
});

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
  const result = generateStandaloneReport(scenarios, { details: true });
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
  const result = generateExperimentReport(makeExperiment(1), 10, { details: true });
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
  const result = generateStandaloneReport(scenarios, { details: true });
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

test('the boolean details flag renders the retained diagnostics without consuming an input argument', (context) => {
  let rendered = '';
  context.mock.method(console, 'log', (value: string) => {
    rendered = value;
  });
  const directory = mkdtempSync(resolve(tmpdir(), 'perf-report-details-'));
  const input = resolve(directory, 'experiment.json');
  const experiment = makeExperiment(1);
  try {
    writeFileSync(input, JSON.stringify(experiment));
    assert.equal(main(['--details', '--input', input]), 0);
    assert.equal(rendered, generateExperimentReport(experiment, 10, { details: true }));
    assert.match(rendered, /Harness hash|Runner health/);
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
