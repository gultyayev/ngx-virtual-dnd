import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  compareExperiment,
  validateExperiment,
  medianInterval,
  GATED_METRICS,
  EXIT_CODES,
  renderComparisonMarkdown,
  type ComparisonOptions,
} from './compare-metrics.ts';
import { makeExperiment } from './experiment-fixture.ts';
import { computeFrameOverBudgetMs, countJankIntervals } from './metric-math.ts';

function changeHead(experiment: ReturnType<typeof makeExperiment>, delta: number) {
  for (const block of experiment.blocks)
    for (const run of block.runs)
      if (run.variant === 'head') {
        run.scenarios[0].raw[0].taskDuration += delta;
      }
}
test('A/A passes every primary budget without trusting stored aggregates', () => {
  const experiment = makeExperiment();
  for (const block of experiment.blocks)
    for (const run of block.runs) run.scenarios[0]['taskDuration'] = { median: 1e9 };
  assert.deepEqual(validateExperiment(experiment), []);
  const result = compareExperiment(experiment);
  assert.equal(result.verdict, 'pass');
  assert.equal(result.rows.length, 15);
  assert.deepEqual(result.rows[0].interval, [-10, -10]);
});
test('a sustained 20% paired slowdown is detected with simultaneous bounds', () => {
  const experiment = makeExperiment();
  changeHead(experiment, 20);
  const result = compareExperiment(experiment);
  assert.equal(result.verdict, 'regression');
  assert.deepEqual(result.rows[0].interval, [10, 10]);
});
test('balanced means cancel linear environmental drift within each block', () => {
  const experiment = makeExperiment();
  for (const block of experiment.blocks)
    for (const [i, run] of block.runs.entries()) run.scenarios[0].raw[0].taskDuration += i * 50;
  const result = compareExperiment(experiment);
  assert.equal(result.verdict, 'pass');
  assert.equal(result.rows[0].delta, 0);
});
test('a burst in one head run preserves uncertainty instead of failing or erasing evidence', () => {
  const experiment = makeExperiment();
  experiment.blocks[0].runs[1].scenarios[0].raw[0].taskDuration += 1000;
  experiment.blocks[0].runs[1].scenarios[0].raw[0].counterWindowMs += 1000;
  const result = compareExperiment(experiment);
  assert.equal(result.verdict, 'inconclusive');
  assert.deepEqual(result.rows[0].interval, [-10, 490]);
});
test('too few blocks cannot make a confident pass or regression', () => {
  const experiment = makeExperiment(9);
  changeHead(experiment, 200);
  const result = compareExperiment(experiment);
  assert.equal(result.verdict, 'inconclusive');
  assert.deepEqual(result.rows[0].interval, [null, null]);
  assert.match(result.reasons.join(' '), /Too few/);
});
test('exact order-statistic interval has the advertised finite-sample binomial coverage', () => {
  assert.deepEqual(
    medianInterval(
      Array.from({ length: 9 }, (_, i) => i),
      0.05 / 15,
    ),
    [null, null],
  );
  assert.deepEqual(
    medianInterval(
      Array.from({ length: 10 }, (_, i) => i),
      0.05 / 15,
    ),
    [0, 9],
  );
  assert.deepEqual(
    medianInterval(
      Array.from({ length: 20 }, (_, i) => i),
      0.05,
    ),
    [5, 14],
  );
});
test('absolute budgets handle zero baselines without invented percent changes', () => {
  const experiment = makeExperiment();
  for (const block of experiment.blocks)
    for (const run of block.runs)
      run.scenarios[0].raw[0].layoutCount = run.variant === 'base' ? 0 : 1;
  const result = compareExperiment(experiment);
  assert.equal(result.verdict, 'pass');
  assert.equal(result.rows[1].changePercent, null);
  assert.deepEqual(result.rows[1].interval, [0, 0]);
});
test('paced metrics remain diagnostic even with a large slowdown', () => {
  const experiment = makeExperiment();
  for (const block of experiment.blocks)
    for (const run of block.runs)
      if (run.variant === 'head') run.scenarios.at(-1)!.raw[0].taskDuration = 1e6;
  for (const block of experiment.blocks)
    for (const run of block.runs)
      if (run.variant === 'head') run.scenarios.at(-1)!.raw[0].counterWindowMs = 1e6 + 1;
  assert.equal(compareExperiment(experiment).verdict, 'pass');
  assert.deepEqual(GATED_METRICS, ['taskDuration', 'layoutCount', 'recalcStyleCount']);
});
test('frame diagnostics use the collector’s exact frame budget and preserve severity', () => {
  const experiment = makeExperiment();
  const sample = experiment.blocks[0].runs[0].scenarios[0].raw[0];
  sample.frameTimes = [16.67, 33.33, 100];
  sample.frameCount = 3;
  sample.avgFrameTime = 50;
  sample.maxFrameGap = 100;
  sample.jankIntervalCount = countJankIntervals(sample.frameTimes);
  sample.frameOverBudgetMs = computeFrameOverBudgetMs(sample.frameTimes);
  assert.deepEqual(validateExperiment(experiment), []);
  sample.frameOverBudgetMs = 2;
  assert.equal(compareExperiment(experiment).verdict, 'invalid');
});
test('extra overscan rows remain diagnostic when completed checkpoints match', () => {
  const experiment = makeExperiment();
  for (const block of experiment.blocks)
    for (const run of block.runs)
      if (run.variant === 'head') {
        const workload = run.scenarios[0].raw[0].workload;
        workload['visitedRows'] = [
          'extra-before',
          ...(workload['visitedRows'] as string[]),
          'extra-after',
        ];
        workload['renderedRanges'] = ['extra-before:extra-after'];
      }
  assert.deepEqual(validateExperiment(experiment), []);
  assert.equal(compareExperiment(experiment).verdict, 'pass');
  changeHead(experiment, 20);
  assert.equal(
    compareExperiment(experiment).verdict,
    'regression',
    'extra rendering work may still produce a real cost regression',
  );
});
test('a different completed scroll path cannot hide behind equal operation counts', () => {
  const experiment = makeExperiment();
  const workload = experiment.blocks[0].runs[1].scenarios[0].raw[0].workload;
  workload['checkpointRows'] = ['3', '2'];
  workload['visitedRows'] = ['0', '1', '2', '3'];
  assert.equal(compareExperiment(experiment).verdict, 'invalid');
});
const invalidCases: [string, (experiment: ReturnType<typeof makeExperiment>) => void][] = [
  ['empty experiment', (experiment) => (experiment.blocks = [])],
  ['missing browser metadata', (experiment) => delete experiment.environment['browserVersion']],
  ['missing viewport', (experiment) => delete experiment.environment['viewport']],
  ['missing harness identity', (experiment) => (experiment.harnessHash = '')],
  ['missing dependency identity', (experiment) => (experiment.variants.base.dependencyHash = '')],
  ['missing library source identity', (experiment) => (experiment.variants.base.libraryHash = '')],
  ['different dependencies', (experiment) => (experiment.variants.head.dependencyHash = 'other')],
  ['duplicate index', (experiment) => (experiment.blocks[1].index = 0)],
  [
    'nonbalanced order',
    (experiment) => (experiment.blocks[0].order = ['base', 'base', 'head', 'head']),
  ],
  [
    'reused artifact',
    (experiment) =>
      (experiment.blocks[0].runs[1].sourceFile = experiment.blocks[0].runs[0].sourceFile),
  ],
  ['missing scenario', (experiment) => experiment.blocks[0].runs[0].scenarios.pop()],
  [
    'duplicate scenario',
    (experiment) =>
      experiment.blocks[0].runs[0].scenarios.push(experiment.blocks[0].runs[0].scenarios[0]),
  ],
  [
    'missing metric',
    (experiment) =>
      delete (
        experiment.blocks[0].runs[0].scenarios[0].raw[0] as unknown as Record<string, unknown>
      )['taskDuration'],
  ],
  [
    'NaN metric',
    (experiment) => (experiment.blocks[0].runs[0].scenarios[0].raw[0].taskDuration = NaN),
  ],
  [
    'negative metric',
    (experiment) => (experiment.blocks[0].runs[0].scenarios[0].raw[0].taskDuration = -1),
  ],
  ['missing raw evidence', (experiment) => (experiment.blocks[0].runs[0].scenarios[0].raw = [])],
  [
    'extra sample',
    (experiment) => {
      const s = experiment.blocks[0].runs[0].scenarios[0];
      s.raw.push(s.raw[0]);
      s.iterations = 2;
    },
  ],
  [
    'both same unsupported schema',
    (experiment) => {
      for (const block of experiment.blocks)
        for (const run of block.runs) for (const s of run.scenarios) s.metricsSchemaVersion = 999;
    },
  ],
  ['unknown throttle', (experiment) => (experiment.blocks[0].runs[0].scenarios[0].cpuThrottle = 1)],
  [
    'hidden page',
    (experiment) => (experiment.blocks[0].runs[0].scenarios[0].raw[0].visibilityState = 'hidden'),
  ],
  [
    'changed browser',
    (experiment) => (experiment.blocks[0].runs[0].scenarios[0].raw[0].browserVersion = 'other'),
  ],
  [
    'changed workload definition',
    (experiment) => (experiment.blocks[0].runs[0].scenarios[0].workload['checkpoints'] = 3),
  ],
  [
    'unequal operations',
    (experiment) => (experiment.blocks[0].runs[1].scenarios[0].raw[0].workload['operations'] = 1),
  ],
  [
    'unobserved completed checkpoints',
    (experiment) =>
      (experiment.blocks[0].runs[1].scenarios[0].raw[0].workload['visitedRows'] = ['99']),
  ],
  [
    'failed work',
    (experiment) =>
      (experiment.blocks[0].runs[0].scenarios[0].raw[0].workload['completed'] = false),
  ],
  [
    'unbracketed time',
    (experiment) => (experiment.blocks[0].runs[0].scenarios[0].raw[0].counterWindowMs = 1),
  ],
  [
    'unordered timestamps',
    (experiment) => (experiment.blocks[0].runs[1].startedAt = '1970-01-01T00:00:01.000Z'),
  ],
];
for (const [name, mutation] of invalidCases)
  test(`invalid evidence: ${name}`, () => {
    const experiment = makeExperiment();
    mutation(experiment);
    const result = compareExperiment(experiment);
    assert.equal(result.verdict, 'invalid');
    assert.ok(result.reasons.length > 0);
  });
test('invalid options fail closed and verdicts have distinct exit codes', () => {
  assert.equal(compareExperiment(makeExperiment(), { thresholdPercent: NaN }).verdict, 'invalid');
  assert.equal(compareExperiment(makeExperiment(), { familyAlpha: 0 }).verdict, 'invalid');
  assert.deepEqual(EXIT_CODES, { pass: 0, regression: 1, inconclusive: 2, invalid: 3 });
});

test('completion and warmup provenance cannot be omitted from both variants', () => {
  for (const field of ['completed', 'warmupIterations']) {
    const experiment = makeExperiment();
    for (const block of experiment.blocks)
      for (const run of block.runs) for (const scenario of run.scenarios) delete scenario[field];
    assert.equal(compareExperiment(experiment).verdict, 'invalid');
  }
});

test('finite but physically impossible renderer durations are invalid', () => {
  const experiment = makeExperiment();
  for (const block of experiment.blocks)
    for (const run of block.runs) run.scenarios[0].raw[0].taskDuration = 1e6;
  assert.equal(compareExperiment(experiment).verdict, 'invalid');
  assert.match(compareExperiment(experiment).reasons.join(' '), /counter window/);
  const scripts = makeExperiment();
  scripts.blocks[0].runs[0].scenarios[0].raw[0].scriptDuration = 500;
  assert.equal(compareExperiment(scripts).verdict, 'invalid');
});

test('A/A calibration verifies source identity and names false alarms', () => {
  const experiment = makeExperiment();
  experiment.mode = 'calibration';
  experiment.environment['control'] = 'none';
  experiment.variants.head.commit = experiment.variants.base.commit;
  assert.equal(
    compareExperiment(experiment).verdict,
    'invalid',
    'matching commits cannot mask different dirty source trees',
  );
  experiment.variants.head.libraryHash = experiment.variants.base.libraryHash;
  changeHead(experiment, 20);
  const result = compareExperiment(experiment);
  assert.equal(result.verdict, 'regression');
  assert.match(result.reasons.join(' '), /false alarm/);
});
test('cancelled and incomplete experiment prefixes cannot masquerade as complete evidence', () => {
  const cancelled = makeExperiment(10);
  cancelled.requestedBlocks = 20;
  cancelled.completed = false;
  assert.equal(compareExperiment(cancelled).verdict, 'invalid');
  cancelled.completed = true;
  assert.equal(
    compareExperiment(cancelled).verdict,
    'invalid',
    'a forged completion flag cannot override the declared plan',
  );
  const unfinished = makeExperiment(10);
  unfinished.completed = false;
  assert.equal(
    compareExperiment(unfinished).verdict,
    'invalid',
    'all planned samples still require explicit experiment completion',
  );
});
test('requested block provenance must be a positive safe integer', () => {
  for (const requestedBlocks of [0, -1, 1.5, NaN, Infinity]) {
    const experiment = makeExperiment();
    experiment.requestedBlocks = requestedBlocks;
    assert.equal(compareExperiment(experiment).verdict, 'invalid');
  }
  const missing = makeExperiment() as unknown as Record<string, unknown>;
  delete missing['requestedBlocks'];
  assert.equal(compareExperiment(missing).verdict, 'invalid');
});
test('retained warmup observations are required and receive the same integrity checks', () => {
  const missing = makeExperiment();
  delete (missing.blocks[0].runs[0].scenarios[0] as unknown as Record<string, unknown>)[
    'warmupRaw'
  ];
  assert.equal(compareExperiment(missing).verdict, 'invalid');
  const empty = makeExperiment();
  empty.blocks[0].runs[0].scenarios[0]['warmupRaw'] = [];
  assert.equal(compareExperiment(empty).verdict, 'invalid');
  const corrupted = makeExperiment();
  (
    corrupted.blocks[0].runs[0].scenarios[0]['warmupRaw'] as { taskDuration: number }[]
  )[0].taskDuration = -1;
  assert.equal(compareExperiment(corrupted).verdict, 'invalid');
  assert.match(compareExperiment(corrupted).reasons.join(' '), /warmup sample/);
});
test('warmup costs remain diagnostic and do not enter primary inference', () => {
  const experiment = makeExperiment();
  for (const block of experiment.blocks)
    for (const run of block.runs)
      if (run.variant === 'head')
        (run.scenarios[0]['warmupRaw'] as { taskDuration: number }[])[0].taskDuration = 500;
  assert.equal(compareExperiment(experiment).verdict, 'pass');
  const noWarmup = makeExperiment();
  for (const block of noWarmup.blocks)
    for (const run of block.runs)
      for (const scenario of run.scenarios) {
        scenario['warmupIterations'] = 0;
        scenario['warmupRaw'] = [];
      }
  assert.equal(compareExperiment(noWarmup).verdict, 'pass');
});
test('setup CPU throttling must be explicit and use the same unthrottled preparation protocol', () => {
  const missing = makeExperiment();
  delete (missing.blocks[0].runs[0].scenarios[0] as unknown as Record<string, unknown>)[
    'setupCpuThrottle'
  ];
  assert.equal(compareExperiment(missing).verdict, 'invalid');
  const wrong = makeExperiment();
  wrong.blocks[0].runs[0].scenarios[0].setupCpuThrottle = 4;
  assert.equal(compareExperiment(wrong).verdict, 'invalid');
  assert.match(compareExperiment(wrong).reasons.join(' '), /setup CPU throttle/);
});

test('counts profile reports only count decisions and leaves slow task time diagnostic', () => {
  const experiment = makeExperiment(3, 'counts');
  changeHead(experiment, 400);
  const result = compareExperiment(experiment);
  assert.equal(result.profile, 'counts');
  assert.equal(result.verdict, 'pass');
  assert.equal(result.rows.length, 10);
  assert.ok(
    result.rows.every((row) => row.metric === 'layoutCount' || row.metric === 'recalcStyleCount'),
  );
  assert.ok(result.rows.every((row) => row.interval[0] === null && row.interval[1] === null));
  assert.doesNotMatch(renderComparisonMarkdown(result), /95%|Bonferroni|simultaneous/i);
});
test('three balanced blocks detect count regressions without claiming inferential intervals', () => {
  const experiment = makeExperiment(3, 'counts');
  for (const block of experiment.blocks)
    for (const run of block.runs)
      if (run.variant === 'head') {
        run.scenarios[0].raw[0].layoutCount += 4;
        run.scenarios[0].raw[0].recalcStyleCount += 6;
      }
  const result = compareExperiment(experiment);
  assert.equal(result.verdict, 'regression');
  assert.equal(result.rows[0].verdict, 'regression');
  assert.equal(result.rows[1].verdict, 'regression');
  assert.deepEqual(result.rows[0].interval, [null, null]);
  assert.match(result.reasons.join(' '), /median/);
  assert.doesNotMatch(result.reasons.join(' '), /confidence interval|simultaneous/i);
});
test('counts decision uses the median paired block budget excess, not unpaired side medians', () => {
  const experiment = makeExperiment(3, 'counts');
  for (const [i, block] of experiment.blocks.entries())
    for (const run of block.runs)
      run.scenarios[0].raw[0].layoutCount =
        run.variant === 'base' ? [100, 100, 1000][i] : [125, 50, 1050][i];
  const result = compareExperiment(experiment);
  assert.equal(result.rows[0].baseline, 100);
  assert.equal(result.rows[0].current, 125);
  assert.equal(result.rows[0].verdict, 'pass');
});
test('counts profile honors the absolute floor at zero baseline without invented ratios', () => {
  const experiment = makeExperiment(3, 'counts');
  for (const block of experiment.blocks)
    for (const run of block.runs)
      run.scenarios[0].raw[0].layoutCount = run.variant === 'base' ? 0 : 1;
  const boundary = compareExperiment(experiment);
  assert.equal(boundary.verdict, 'pass');
  assert.equal(boundary.rows[0].changePercent, null);
  for (const block of experiment.blocks)
    for (const run of block.runs)
      if (run.variant === 'head') run.scenarios[0].raw[0].layoutCount = 2;
  assert.equal(compareExperiment(experiment).verdict, 'regression');
});
test('timing remains the default for historical experiments and retains all fifteen checks', () => {
  const legacy = compareExperiment(makeExperiment());
  assert.equal(legacy.profile, 'timing');
  assert.equal(legacy.rows.length, 15);
  const experiment = makeExperiment(20, 'timing');
  changeHead(experiment, 20);
  const result = compareExperiment(experiment);
  assert.equal(result.verdict, 'regression');
  assert.deepEqual(result.rows[0].interval, [10, 10]);
});
test('unknown profiles and missing scenario evidence still fail closed in the counts profile', () => {
  const unknown = makeExperiment(3, 'counts') as unknown as Record<string, unknown>;
  unknown['profile'] = 'unsupported';
  assert.equal(compareExperiment(unknown).verdict, 'invalid');
  const missing = makeExperiment(3, 'counts');
  missing.blocks[0].runs[0].scenarios.pop();
  assert.equal(compareExperiment(missing).verdict, 'invalid');
});
test('matching logical scroll checkpoints remain comparable across different pixel geometries', () => {
  const experiment = makeExperiment(3, 'counts');
  for (const block of experiment.blocks)
    for (const run of block.runs)
      if (run.variant === 'head') {
        const workload = run.scenarios[0].raw[0].workload;
        workload['startScrollTop'] = 50;
        workload['endScrollTop'] = 350;
        workload['scrollDistance'] = 300;
      }
  assert.deepEqual(validateExperiment(experiment), []);
  assert.equal(compareExperiment(experiment).verdict, 'pass');
  experiment.blocks[0].runs[1].scenarios[0].raw[0].workload['scrollDistance'] = 301;
  assert.equal(
    compareExperiment(experiment).verdict,
    'invalid',
    'pixel observations must remain internally consistent',
  );
});
test('zero frame intervals are valid clock quantization while negative intervals remain invalid', () => {
  const experiment = makeExperiment();
  const sample = experiment.blocks[0].runs[0].scenarios[0].raw[0];
  sample.frameTimes = [0, 16.67];
  sample.avgFrameTime = 8.335;
  sample.maxFrameGap = 16.67;
  assert.deepEqual(validateExperiment(experiment), []);
  sample.frameTimes[0] = -0.1;
  assert.equal(compareExperiment(experiment).verdict, 'invalid');
});
test('a counts decision from timing evidence does not gate a task-only regression or mutate its protocol', () => {
  const experiment = makeExperiment(20, 'timing');
  changeHead(experiment, 20);
  const source = JSON.stringify(experiment);
  assert.equal(compareExperiment(experiment).verdict, 'regression');
  const counts = compareExperiment(experiment, { decisionProfile: 'counts' });
  assert.equal(counts.verdict, 'pass');
  assert.equal(counts.profile, 'counts');
  assert.equal(counts.blocks, 20);
  assert.equal(counts.rows.length, 10);
  assert.equal(experiment.profile, 'timing');
  assert.equal(experiment.blocks[0].runs[0].scenarios[0].warmupIterations, 1);
  assert.equal(JSON.stringify(experiment), source);
});
test('mandatory count budgets still detect regressions from the same opt-in timing experiment', () => {
  const experiment = makeExperiment(20, 'timing');
  for (const block of experiment.blocks)
    for (const run of block.runs)
      if (run.variant === 'head') run.scenarios[0].raw[0].layoutCount += 4;
  const counts = compareExperiment(experiment, { decisionProfile: 'counts' });
  assert.equal(counts.verdict, 'regression');
  assert.equal(counts.rows[0].verdict, 'regression');
  assert.deepEqual(counts.rows[0].interval, [null, null]);
});
test('decision overrides cannot bypass invalid source profiles or warmup evidence', () => {
  const unknown = makeExperiment(20, 'timing') as unknown as Record<string, unknown>;
  unknown['profile'] = 'unsupported';
  assert.equal(compareExperiment(unknown, { decisionProfile: 'counts' }).verdict, 'invalid');
  const corrupt = makeExperiment(20, 'timing');
  corrupt.blocks[0].runs[0].scenarios[0].warmupRaw = [];
  const result = compareExperiment(corrupt, { decisionProfile: 'counts' });
  assert.equal(result.verdict, 'invalid');
  assert.match(result.reasons.join(' '), /warmup/);
});
test('invalid decision override values fail closed and insufficient timing evidence remains inconclusive', () => {
  const invalid = { decisionProfile: 'unsupported' } as unknown as ComparisonOptions;
  assert.equal(compareExperiment(makeExperiment(), invalid).verdict, 'invalid');
  const experiment = makeExperiment(3, 'counts');
  const timing = compareExperiment(experiment, { decisionProfile: 'timing' });
  assert.equal(timing.profile, 'timing');
  assert.equal(timing.verdict, 'inconclusive');
  assert.equal(experiment.profile, 'counts');
});
