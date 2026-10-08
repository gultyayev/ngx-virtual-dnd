/** Paired benchmark decisions. Raw observations, rather than stored aggregates, are authoritative. */
import {
  EXPECTED_SCENARIOS,
  type Comparison,
  type Experiment,
  type ScenarioReport,
} from './run-types.ts';
import {
  computeFrameOverBudgetMs,
  computeTotalBlockingTime,
  countJankIntervals,
  METRICS_SCHEMA_VERSION,
} from './metric-math.ts';

export const GATED_METRICS = ['taskDuration', 'layoutCount', 'recalcStyleCount'] as const;
export const MIN_ABS_DELTA = { taskDuration: 5, layoutCount: 1, recalcStyleCount: 3 } as const;
export const EXIT_CODES = { pass: 0, regression: 1, inconclusive: 2, invalid: 3 } as const;
export interface ComparisonOptions {
  thresholdPercent?: number;
  familyAlpha?: number;
}

const SCALAR_METRICS = [
  'taskDuration',
  'layoutCount',
  'recalcStyleCount',
  'scriptDuration',
  'durationMs',
  'frameCount',
  'avgFrameTime',
  'maxFrameGap',
  'jankIntervalCount',
  'frameOverBudgetMs',
  'longTaskCount',
  'totalBlockingTime',
  'windowStartMs',
  'windowEndMs',
  'counterWindowMs',
] as const;
const FIXED_SCENARIOS = Object.entries(EXPECTED_SCENARIOS)
  .filter(([, kind]) => kind === 'fixed-work')
  .map(([name]) => name);
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const nonempty = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;
const nonnegative = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;
const timestamp = (value: unknown): value is string =>
  nonempty(value) &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
  Number.isFinite(Date.parse(value));
const sameNumber = (a: number, b: number) => Math.abs(a - b) <= Math.max(0.001, Math.abs(b) * 1e-9);
const strings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(nonempty);
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (object(value))
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(',')}}`;
  return JSON.stringify(value) ?? 'undefined';
}
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const half = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[half] : (sorted[half - 1] + sorted[half]) / 2;
}
const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;

/** Invalid or missing metadata always fails closed, including when both sides omit the same field. */
export function validateScenarios(
  input: unknown,
  options: { sampleCount?: number; browserVersion?: string } = {},
): string[] {
  const errors: string[] = [];
  if (!Array.isArray(input)) return ['Scenarios must be an array.'];
  const seen = new Set<string>();
  for (const [index, scenario] of input.entries()) {
    const prefix = `scenario ${index}`;
    if (!object(scenario) || !nonempty(scenario['scenario'])) {
      errors.push(`${prefix}: missing scenario identity.`);
      continue;
    }
    const name = scenario['scenario'];
    if (seen.has(name)) errors.push(`${name}: duplicate scenario.`);
    seen.add(name);
    if (!(name in EXPECTED_SCENARIOS)) errors.push(`${name}: unknown scenario.`);
    if (scenario['kind'] !== EXPECTED_SCENARIOS[name as keyof typeof EXPECTED_SCENARIOS])
      errors.push(`${name}: wrong or missing workload kind.`);
    if (scenario['metricsSchemaVersion'] !== METRICS_SCHEMA_VERSION)
      errors.push(`${name}: unsupported metrics schema; schema 4 is required.`);
    if (scenario['cpuThrottle'] !== 4) errors.push(`${name}: missing or unsupported CPU throttle.`);
    if (scenario['setupCpuThrottle'] !== 1)
      errors.push(`${name}: missing or unsupported setup CPU throttle.`);
    if (scenario['completed'] !== true)
      errors.push(`${name}: scenario did not complete successfully.`);
    if (
      !Number.isSafeInteger(scenario['warmupIterations']) ||
      Number(scenario['warmupIterations']) < 0
    )
      errors.push(`${name}: missing or invalid warmup iteration count.`);
    if (!object(scenario['workload']) || Object.keys(scenario['workload']).length === 0)
      errors.push(`${name}: missing workload definition.`);
    else if (
      Object.values(scenario['workload']).some(
        (value) => !(typeof value === 'string' || typeof value === 'boolean' || nonnegative(value)),
      )
    )
      errors.push(`${name}: invalid workload definition.`);
    const raw = scenario['raw'];
    if (!Array.isArray(raw) || raw.length === 0) {
      errors.push(`${name}: missing raw samples.`);
      continue;
    }
    if (
      !Number.isInteger(scenario['iterations']) ||
      scenario['iterations'] !== raw.length ||
      (options.sampleCount !== undefined && raw.length !== options.sampleCount)
    )
      errors.push(`${name}: raw sample count does not match the experiment/iterations.`);
    const warmupRaw = scenario['warmupRaw'];
    if (!Array.isArray(warmupRaw) || warmupRaw.length !== scenario['warmupIterations'])
      errors.push(`${name}: retained warmup sample count does not match warmup iterations.`);
    const observations = [
      ...raw.map((sample, i) => ({ sample, label: `${name} sample ${i}` })),
      ...(Array.isArray(warmupRaw)
        ? warmupRaw.map((sample, i) => ({ sample, label: `${name} warmup sample ${i}` }))
        : []),
    ];
    for (const { sample, label } of observations) {
      if (!object(sample)) {
        errors.push(`${label}: invalid raw sample.`);
        continue;
      }
      for (const metric of SCALAR_METRICS)
        if (!nonnegative(sample[metric]))
          errors.push(`${label}: ${metric} must be a finite nonnegative number.`);
      // One renderer main thread cannot spend more wall time in tasks than
      // the counter window. Allow 1ms for the counter snapshots' rounding.
      if (
        nonnegative(sample['taskDuration']) &&
        nonnegative(sample['counterWindowMs']) &&
        sample['taskDuration'] > sample['counterWindowMs'] + 1
      )
        errors.push(`${label}: task duration exceeds the counter window.`);
      if (
        nonnegative(sample['scriptDuration']) &&
        nonnegative(sample['taskDuration']) &&
        sample['scriptDuration'] > sample['taskDuration'] + 1
      )
        errors.push(`${label}: script duration exceeds total task duration.`);
      for (const metric of [
        'layoutCount',
        'recalcStyleCount',
        'frameCount',
        'jankIntervalCount',
        'longTaskCount',
      ])
        if (!Number.isInteger(sample[metric]))
          errors.push(`${label}: ${metric} must be an integer.`);
      if (sample['visibilityState'] !== 'visible')
        errors.push(`${label}: page was not visibly measured.`);
      if (
        !nonempty(sample['browserVersion']) ||
        (options.browserVersion !== undefined &&
          sample['browserVersion'] !== options.browserVersion)
      )
        errors.push(`${label}: missing or inconsistent browser version.`);
      if (
        nonnegative(sample['windowStartMs']) &&
        nonnegative(sample['windowEndMs']) &&
        nonnegative(sample['durationMs'])
      ) {
        if (
          sample['windowEndMs'] <= sample['windowStartMs'] ||
          !sameNumber(sample['durationMs'], sample['windowEndMs'] - sample['windowStartMs'])
        )
          errors.push(`${label}: inconsistent measurement timestamps/duration.`);
        if (
          !nonnegative(sample['counterWindowMs']) ||
          sample['counterWindowMs'] + 0.001 < sample['durationMs']
        )
          errors.push(`${label}: counters do not bracket the measurement window.`);
      }
      const frameTimes = sample['frameTimes'];
      if (
        !Array.isArray(frameTimes) ||
        frameTimes.length === 0 ||
        !frameTimes.every((value) => nonnegative(value) && value > 0)
      )
        errors.push(`${label}: missing or invalid frame intervals.`);
      else {
        if (
          sample['frameCount'] !== frameTimes.length ||
          !sameNumber(Number(sample['avgFrameTime']), mean(frameTimes)) ||
          !sameNumber(Number(sample['maxFrameGap']), Math.max(...frameTimes)) ||
          sample['jankIntervalCount'] !== countJankIntervals(frameTimes) ||
          !sameNumber(Number(sample['frameOverBudgetMs']), computeFrameOverBudgetMs(frameTimes))
        )
          errors.push(`${label}: frame diagnostics disagree with raw intervals.`);
        if (frameTimes.reduce((sum, gap) => sum + gap, 0) > Number(sample['durationMs']) + 0.001)
          errors.push(`${label}: frame intervals exceed the measurement window.`);
      }
      const tasks = sample['longTasks'];
      if (
        !Array.isArray(tasks) ||
        tasks.some(
          (task) =>
            !object(task) ||
            !nonnegative(task['startTime']) ||
            !nonnegative(task['duration']) ||
            task['startTime'] < Number(sample['windowStartMs']) ||
            task['startTime'] >= Number(sample['windowEndMs']),
        )
      )
        errors.push(`${label}: missing or out-of-window long tasks.`);
      else if (
        sample['longTaskCount'] !== tasks.length ||
        !sameNumber(Number(sample['totalBlockingTime']), computeTotalBlockingTime(tasks))
      )
        errors.push(`${label}: task diagnostics disagree with raw long tasks.`);
      const workload = sample['workload'];
      if (
        !object(workload) ||
        !Number.isInteger(workload['operations']) ||
        Number(workload['operations']) <= 0 ||
        workload['completed'] !== true
      ) {
        errors.push(`${label}: missing completed workload evidence.`);
        continue;
      }
      if (
        Object.values(workload).some(
          (value) =>
            !(
              typeof value === 'string' ||
              typeof value === 'boolean' ||
              nonnegative(value) ||
              strings(value)
            ),
        )
      )
        errors.push(`${label}: invalid workload observation.`);
      const definition = scenario['workload'];
      if (
        object(definition) &&
        ((definition['checkpoints'] !== undefined &&
          workload['operations'] !== definition['checkpoints']) ||
          (definition['pointerSteps'] !== undefined &&
            workload['operations'] !== Number(definition['pointerSteps']) + 1))
      )
        errors.push(`${label}: completed operations differ from the workload definition.`);
      if (name.startsWith('drag-')) {
        if (!nonempty(workload['sourceId'])) errors.push(`${label}: missing drag source outcome.`);
        for (const field of ['startScrollTop', 'endScrollTop', 'scrollDistance'])
          if (!nonnegative(workload[field]))
            errors.push(`${label}: missing drag outcome ${field}.`);
        if (scenario['kind'] === 'fixed-work') {
          if (
            !Number.isInteger(workload['destinationIndex']) ||
            Number(workload['destinationIndex']) < 0 ||
            (object(definition) &&
              definition['destinationIndex'] !== undefined &&
              workload['destinationIndex'] !== definition['destinationIndex'])
          )
            errors.push(`${label}: missing or incorrect drag destination outcome.`);
          if (workload['scrollDistance'] !== 0)
            errors.push(`${label}: fixed reorder unexpectedly scrolled.`);
        } else if (
          !nonnegative(workload['holdDurationMs']) ||
          Number(workload['holdDurationMs']) <= 0 ||
          !nonnegative(workload['holdElapsedMs']) ||
          workload['holdElapsedMs'] < workload['holdDurationMs'] ||
          Number(workload['scrollDistance']) <= 0
        )
          errors.push(`${label}: missing paced autoscroll progress/hold evidence.`);
      }
      if (name.includes('scroll') && scenario['kind'] === 'fixed-work') {
        const visitedRows = workload['visitedRows'];
        const checkpointRows = workload['checkpointRows'];
        if (
          !strings(visitedRows) ||
          visitedRows.length === 0 ||
          !strings(checkpointRows) ||
          checkpointRows.length !== workload['operations'] ||
          !nonempty(workload['finalTargetRow'])
        )
          errors.push(`${label}: missing fixed scroll checkpoints/visited rows.`);
        else if (
          checkpointRows.some((row) => !visitedRows.includes(row)) ||
          checkpointRows.at(-1) !== workload['finalTargetRow']
        )
          errors.push(
            `${label}: completed scroll checkpoints are absent from the observed rows/final target.`,
          );
        for (const field of ['startScrollTop', 'endScrollTop', 'scrollDistance'])
          if (!nonnegative(workload[field]))
            errors.push(`${label}: missing scroll outcome ${field}.`);
      }
    }
  }
  for (const name of Object.keys(EXPECTED_SCENARIOS))
    if (!seen.has(name)) errors.push(`${name}: missing expected scenario.`);
  return errors;
}

function validateHealth(value: unknown, label: string): string[] {
  if (!object(value)) return [`${label}: missing runner health snapshot.`];
  const errors: string[] = [];
  if (!timestamp(value['timestamp'])) errors.push(`${label}: missing timestamp.`);
  if (
    !Array.isArray(value['loadAverage']) ||
    value['loadAverage'].length !== 3 ||
    !value['loadAverage'].every(nonnegative)
  )
    errors.push(`${label}: invalid load average.`);
  if (!nonnegative(value['freeMemoryBytes'])) errors.push(`${label}: invalid free memory.`);
  if (
    !object(value['cpuTime']) ||
    !nonnegative(value['cpuTime']['idle']) ||
    !nonnegative(value['cpuTime']['total']) ||
    value['cpuTime']['idle'] > value['cpuTime']['total']
  )
    errors.push(`${label}: invalid CPU counters.`);
  if (
    !object(value['pressure']) ||
    Object.values(value['pressure']).some((number) => number !== null && !nonnegative(number))
  )
    errors.push(`${label}: missing or invalid pressure diagnostics.`);
  return errors;
}

export function validateExperiment(input: unknown): string[] {
  if (!object(input)) return ['Experiment must be an object.'];
  const errors: string[] = [];
  if (input['formatVersion'] !== 1)
    errors.push('Unsupported experiment format; version 1 is required.');
  if (!Number.isSafeInteger(input['requestedBlocks']) || Number(input['requestedBlocks']) < 1)
    errors.push('Missing or invalid predeclared requested block count.');
  if (input['completed'] !== true)
    errors.push('Experiment is incomplete or cancelled; completed evidence is required.');
  if (input['mode'] !== 'comparison' && input['mode'] !== 'calibration')
    errors.push('Missing or unsupported experiment mode.');
  if (!nonempty(input['harnessHash'])) errors.push('Missing common harness hash.');
  const environment = input['environment'];
  if (!object(environment)) errors.push('Missing experiment environment.');
  else {
    for (const key of ['nodeVersion', 'playwrightVersion', 'browserVersion'])
      if (!nonempty(environment[key])) errors.push(`Missing environment ${key}.`);
    if (
      !object(environment['viewport']) ||
      environment['viewport']['width'] !== 1280 ||
      environment['viewport']['height'] !== 720
    )
      errors.push('Missing or incompatible viewport.');
    if (
      environment['deviceScaleFactor'] !== 1 ||
      environment['headless'] !== true ||
      environment['cpuThrottle'] !== 4
    )
      errors.push('Missing or incompatible browser/throttle settings.');
  }
  const variants = input['variants'];
  if (!object(variants) || !object(variants['base']) || !object(variants['head']))
    errors.push('Missing base/head variant identity.');
  else {
    for (const variant of ['base', 'head']) {
      const identity = variants[variant] as Record<string, unknown>;
      if (!nonempty(identity['commit']) || !nonempty(identity['dependencyHash']))
        errors.push(`${variant}: missing commit or dependency hash.`);
      if (!nonempty(identity['libraryHash']) || !/^[a-f0-9]{64}$/.test(identity['libraryHash']))
        errors.push(`${variant}: missing or invalid measured library source hash.`);
    }
    if (variants['base']['dependencyHash'] !== variants['head']['dependencyHash'])
      errors.push('Dependency hashes differ; the common consumer stack is not comparable.');
    if (
      input['mode'] === 'calibration' &&
      variants['base']['commit'] !== variants['head']['commit']
    )
      errors.push('Calibration must measure the same commit on both sides.');
    if (
      input['mode'] === 'calibration' &&
      variants['base']['libraryHash'] !== variants['head']['libraryHash']
    )
      errors.push('Calibration must measure identical library source on both sides.');
  }
  const blocks = input['blocks'];
  if (!Array.isArray(blocks) || blocks.length === 0) return [...errors, 'Missing balanced blocks.'];
  if (blocks.length !== input['requestedBlocks'])
    errors.push('Completed block count does not match the predeclared experiment plan.');
  const seenIndices = new Set<number>();
  const seenFiles = new Set<string>();
  let previousEnd = -Infinity;
  let referenceDefinitions: string | undefined;
  for (const [index, block] of blocks.entries()) {
    const label = `block ${index}`;
    if (!object(block)) {
      errors.push(`${label}: invalid block.`);
      continue;
    }
    if (block['index'] !== index || seenIndices.has(Number(block['index'])))
      errors.push(`${label}: duplicate or non-contiguous block index.`);
    seenIndices.add(Number(block['index']));
    const order = block['order'];
    if (
      canonical(order) !== canonical(['base', 'head', 'head', 'base']) &&
      canonical(order) !== canonical(['head', 'base', 'base', 'head'])
    )
      errors.push(`${label}: order must be ABBA or BAAB.`);
    const runs = block['runs'];
    if (!Array.isArray(runs) || runs.length !== 4) {
      errors.push(`${label}: exactly four runs are required.`);
      continue;
    }
    const workloadReference = new Map<string, Record<string, unknown>>();
    for (const [runIndex, run] of runs.entries()) {
      const runLabel = `${label} run ${runIndex}`;
      if (!object(run)) {
        errors.push(`${runLabel}: invalid run.`);
        continue;
      }
      if (!Array.isArray(order) || run['variant'] !== order[runIndex])
        errors.push(`${runLabel}: variant differs from declared order.`);
      if (!timestamp(run['startedAt'])) errors.push(`${runLabel}: missing start timestamp.`);
      if (!nonempty(run['sourceFile']) || seenFiles.has(run['sourceFile']))
        errors.push(`${runLabel}: missing or reused source file.`);
      if (nonempty(run['sourceFile'])) seenFiles.add(run['sourceFile']);
      errors.push(
        ...validateHealth(run['healthBefore'], `${runLabel} before`),
        ...validateHealth(run['healthAfter'], `${runLabel} after`),
      );
      if (
        object(run['healthBefore']) &&
        object(run['healthAfter']) &&
        timestamp(run['healthBefore']['timestamp']) &&
        timestamp(run['healthAfter']['timestamp']) &&
        timestamp(run['startedAt'])
      ) {
        const before = Date.parse(run['healthBefore']['timestamp']);
        const after = Date.parse(run['healthAfter']['timestamp']);
        const start = Date.parse(run['startedAt']);
        if (before < previousEnd || before > start || start > after)
          errors.push(`${runLabel}: measurement/health timestamps are out of order.`);
        previousEnd = after;
      }
      errors.push(
        ...validateScenarios(run['scenarios'], {
          sampleCount: 1,
          browserVersion:
            object(environment) && nonempty(environment['browserVersion'])
              ? environment['browserVersion']
              : undefined,
        }).map((reason) => `${runLabel}: ${reason}`),
      );
      if (!Array.isArray(run['scenarios'])) continue;
      const scenarios = run['scenarios'].filter(object);
      const definitions = canonical(
        scenarios
          .map((scenario) => ({
            scenario: scenario['scenario'],
            kind: scenario['kind'],
            schema: scenario['metricsSchemaVersion'],
            throttle: scenario['cpuThrottle'],
            setupThrottle: scenario['setupCpuThrottle'],
            warmupIterations: scenario['warmupIterations'],
            workload: scenario['workload'],
          }))
          .sort((a, b) => String(a.scenario).localeCompare(String(b.scenario))),
      );
      referenceDefinitions ??= definitions;
      if (definitions !== referenceDefinitions)
        errors.push(`${runLabel}: workload definitions/settings differ between runs.`);
      for (const scenario of scenarios) {
        if (
          scenario['kind'] !== 'fixed-work' ||
          !nonempty(scenario['scenario']) ||
          !Array.isArray(scenario['raw']) ||
          !object(scenario['raw'][0]) ||
          !object(scenario['raw'][0]['workload'])
        )
          continue;
        const workload = scenario['raw'][0]['workload'];
        const old = workloadReference.get(scenario['scenario']);
        workloadReference.set(scenario['scenario'], workload);
        if (!old) continue;
        for (const key of [
          'operations',
          'checkpointRows',
          'sourceId',
          'destinationIndex',
          'finalTargetRow',
        ])
          if (canonical(old[key]) !== canonical(workload[key]))
            errors.push(`${runLabel} ${scenario['scenario']}: unequal completed work (${key}).`);
        // Overscan/rendering strategies may legitimately render different extra
        // rows. Completed checkpoint IDs define equal user-visible work; the
        // full visitedRows/renderedRanges remain diagnostic evidence.
        for (const key of ['startScrollTop', 'endScrollTop', 'scrollDistance'])
          if (old[key] !== undefined || workload[key] !== undefined) {
            if (
              !nonnegative(old[key]) ||
              !nonnegative(workload[key]) ||
              Math.abs(old[key] - workload[key]) > 1
            )
              errors.push(
                `${runLabel} ${scenario['scenario']}: unequal scroll outcome (${key}, tolerance 1px).`,
              );
          }
      }
    }
  }
  return [...new Set(errors)];
}

/** Exact distribution-free median interval. null means the available blocks cannot bound that side. */
export function medianInterval(values: number[], alpha: number): [number | null, number | null] {
  const n = values.length;
  if (n === 0) return [null, null];
  const sorted = [...values].sort((a, b) => a - b);
  // P(Binomial(n,.5) <= k-1) computed from exact binomial coefficients.
  let probability = 2 ** -n;
  let tail = 0;
  let accepted = 0;
  for (let k = 1; k <= Math.floor((n + 1) / 2); k++) {
    tail += probability;
    if (2 * tail <= alpha) accepted = k;
    else break;
    probability *= (n - k + 1) / k;
  }
  return accepted === 0 ? [null, null] : [sorted[accepted - 1], sorted[n - accepted]];
}

export function compareExperiment(input: unknown, options: ComparisonOptions = {}): Comparison {
  const thresholdPercent = options.thresholdPercent ?? 10;
  const familyAlpha = options.familyAlpha ?? 0.05;
  const reasons = validateExperiment(input);
  if (!Number.isFinite(thresholdPercent) || thresholdPercent < 0)
    reasons.push('Threshold must be finite and nonnegative.');
  if (!Number.isFinite(familyAlpha) || familyAlpha <= 0 || familyAlpha >= 1)
    reasons.push('Family alpha must be between zero and one.');
  const blocks = object(input) && Array.isArray(input['blocks']) ? input['blocks'].length : 0;
  if (reasons.length) return { verdict: 'invalid', reasons, rows: [], blocks, thresholdPercent };
  const experiment = input as Experiment;
  const rows: Comparison['rows'] = [];
  const checks = FIXED_SCENARIOS.length * GATED_METRICS.length;
  for (const scenario of FIXED_SCENARIOS)
    for (const metric of GATED_METRICS) {
      const pairs = experiment.blocks.map((block) => {
        const cost = (variant: 'base' | 'head') =>
          mean(
            block.runs
              .filter((run) => run.variant === variant)
              .map(
                (run) =>
                  (run.scenarios.find((report) => report.scenario === scenario) as ScenarioReport)
                    .raw[0][metric],
              ),
          );
        const base = cost('base');
        const head = cost('head');
        return {
          base,
          head,
          excess: head - base - Math.max(MIN_ABS_DELTA[metric], (base * thresholdPercent) / 100),
        };
      });
      const baseline = median(pairs.map((pair) => pair.base));
      const current = median(pairs.map((pair) => pair.head));
      const interval = medianInterval(
        pairs.map((pair) => pair.excess),
        familyAlpha / checks,
      );
      const verdict =
        interval[0] !== null && interval[0] > 0
          ? 'regression'
          : interval[1] !== null && interval[1] <= 0
            ? 'pass'
            : 'inconclusive';
      rows.push({
        scenario,
        metric,
        baseline,
        current,
        delta: median(pairs.map((pair) => pair.head - pair.base)),
        changePercent:
          baseline === 0 ? (current === 0 ? 0 : null) : ((current - baseline) / baseline) * 100,
        interval,
        verdict,
      });
    }
  const verdict = rows.some((row) => row.verdict === 'regression')
    ? 'regression'
    : rows.some((row) => row.verdict === 'inconclusive')
      ? 'inconclusive'
      : 'pass';
  if (rows.some((row) => row.interval[0] === null))
    reasons.push(
      'Too few independent balanced blocks for simultaneous median confidence bounds; collect more blocks.',
    );
  if (rows.some((row) => row.verdict === 'inconclusive' && row.interval[0] !== null))
    reasons.push(
      'A confidence interval overlaps the practical regression budget; the available evidence is inconclusive.',
    );
  if (verdict === 'regression')
    reasons.push(
      'At least one simultaneous confidence interval is wholly above its practical regression budget.',
    );
  if (
    experiment.mode === 'calibration' &&
    experiment.environment['control'] === 'none' &&
    verdict === 'regression'
  )
    reasons.push(
      'Unchanged-code calibration produced a false alarm of the decision procedure; this is calibration evidence, not a library change.',
    );
  if (
    experiment.mode === 'calibration' &&
    experiment.environment['control'] !== undefined &&
    experiment.environment['control'] !== 'none'
  )
    reasons.push(
      `Calibration control ${experiment.environment['control']} measures gate sensitivity; its verdict is not a PR regression.`,
    );
  if (verdict === 'pass')
    reasons.push(
      'Every primary confidence interval is within its practical regression budget. Paced interaction diagnostics do not gate.',
    );
  return { verdict, reasons, rows, blocks, thresholdPercent };
}

export function renderComparisonMarkdown(result: Comparison): string {
  const number = (value: number | null) => (value === null ? 'unbounded' : value.toFixed(2));
  const lines = [
    '## Performance comparison',
    '',
    `**Verdict: ${result.verdict.toUpperCase()}** · ${result.blocks} balanced blocks · ${result.thresholdPercent}% practical budget`,
    '',
    ...result.reasons.map((reason) => `- ${reason}`),
  ];
  if (result.rows.length)
    lines.push(
      '',
      '| Scenario | Metric | Base | Head | Change | Median budget excess interval | Verdict |',
      '|---|---|---:|---:|---:|---|---|',
      ...result.rows.map(
        (row) =>
          `| ${row.scenario} | ${row.metric} | ${number(row.baseline)} | ${number(row.current)} | ${row.changePercent === null ? 'undefined (zero base)' : `${row.changePercent.toFixed(1)}%`} | [${number(row.interval[0])}, ${number(row.interval[1])}] | ${row.verdict} |`,
      ),
      '',
      'Intervals are simultaneous distribution-free median bounds over independent balanced blocks (Bonferroni across primary checks, 95% by default). The budget is the larger of the percent threshold and each metric’s absolute floor. Raw samples are authoritative; paced workloads are diagnostic.',
    );
  return lines.join('\n') + '\n';
}
