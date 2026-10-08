import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  compareExperiment,
  validateExperiment,
  medianInterval,
  GATED_METRICS,
  EXIT_CODES,
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
