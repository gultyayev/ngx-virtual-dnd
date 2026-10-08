import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  compareExperiment,
  renderComparisonMarkdown,
  validateScenarios,
} from './fixtures/compare-metrics.ts';
import { extractScenarios } from './fixtures/extract-scenarios.ts';
import { SCENARIO_METRICS, type ScenarioMetricName } from './fixtures/metric-math.ts';
import {
  EXPECTED_SCENARIOS,
  type BenchmarkRun,
  type Comparison,
  type ComparisonRow,
  type Experiment,
  type ScenarioReport,
} from './fixtures/run-types.ts';
import { aggregate } from './fixtures/statistics.ts';

export interface ReportOptions {
  details?: boolean;
}

const SCENARIO_NAMES: Record<keyof typeof EXPECTED_SCENARIOS, string> = {
  'scroll-2000-items': 'Fixed-height scroll',
  'drag-within-list-1000': 'Within-list drag',
  'drag-within-virtual-for-list': 'Virtual viewport drag',
  'dynamic-height-scroll': 'Dynamic-height scroll',
  'dynamic-height-long-list-scroll': 'Long-list dynamic scroll',
  'drag-between-lists-autoscroll-1000': 'Cross-list autoscroll',
};

const RESULT_METRIC_NAMES: Record<string, string> = {
  taskDuration: 'task time',
  layoutCount: 'layouts',
  recalcStyleCount: 'style recalculations',
};

const METRIC_LABELS: Record<ScenarioMetricName, { label: string; unit: string }> = {
  durationMs: { label: 'Observed duration', unit: 'ms' },
  frameCount: { label: 'Observed frame intervals', unit: '' },
  taskDuration: { label: 'Main-thread task time', unit: 'ms' },
  scriptDuration: { label: 'Script time', unit: 'ms' },
  layoutCount: { label: 'Layouts', unit: '' },
  recalcStyleCount: { label: 'Style recalculations', unit: '' },
  longTaskCount: { label: 'Long tasks (>50 ms)', unit: '' },
  totalBlockingTime: { label: 'Total Blocking Time', unit: 'ms' },
  avgFrameTime: { label: 'Average frame interval', unit: 'ms' },
  maxFrameGap: { label: 'Maximum frame gap', unit: 'ms' },
  jankIntervalCount: { label: 'Jank intervals (>25 ms)', unit: '' },
  frameOverBudgetMs: { label: 'Time over 16.67 ms frame budget', unit: 'ms' },
};

function escape(value: unknown): string {
  const string = typeof value === 'string' ? value : JSON.stringify(value);
  return (string ?? 'unavailable').replaceAll('|', '\\|').replace(/[\r\n]/g, ' ');
}

function formatValue(value: number, unit = ''): string {
  const rounded = Math.round(value * 10) / 10;
  return unit ? `${rounded} ${unit}` : `${rounded}`;
}

function signedValue(value: number): string {
  return `${value > 0 ? '+' : ''}${formatValue(value)}`;
}

function percent(value: number | null): string {
  return value === null ? 'n/a (zero base)' : `${value > 0 ? '+' : ''}${value.toFixed(1)}%`;
}

function scenarioResult(rows: ComparisonRow[]): string {
  const verdict = rows.some((row) => row.verdict === 'regression')
    ? 'regression'
    : rows.some((row) => row.verdict === 'inconclusive')
      ? 'inconclusive'
      : 'pass';
  if (verdict === 'pass') return 'Pass';
  const affected = rows
    .filter((row) => row.verdict === verdict)
    .map((row) => RESULT_METRIC_NAMES[row.metric]);
  const label = verdict === 'regression' ? 'Regression' : 'Inconclusive';
  const uncertain =
    verdict === 'regression'
      ? rows
          .filter((row) => row.verdict === 'inconclusive')
          .map((row) => RESULT_METRIC_NAMES[row.metric])
      : [];
  return `${label}: ${affected.join(', ')}${uncertain.length ? `; uncertain: ${uncertain.join(', ')}` : ''}`;
}

/** Paced totals are descriptive; use the same block summary as primary rows. */
function pacedMetric(
  experiment: Experiment,
  name: string,
  metric: 'taskDuration' | 'layoutCount' | 'recalcStyleCount',
): Pick<ComparisonRow, 'baseline' | 'current' | 'delta' | 'changePercent'> {
  const pairs = experiment.blocks.map((block) => {
    const cost = (variant: 'base' | 'head') => {
      const values = block.runs
        .filter((run) => run.variant === variant)
        .map(
          (run) =>
            (run.scenarios.find((scenario) => scenario.scenario === name) as ScenarioReport).raw[0][
              metric
            ],
        );
      return aggregate(values).mean;
    };
    return { base: cost('base'), head: cost('head') };
  });
  const baseline = aggregate(pairs.map((pair) => pair.base)).median;
  const current = aggregate(pairs.map((pair) => pair.head)).median;
  return {
    baseline,
    current,
    delta: aggregate(pairs.map((pair) => pair.head - pair.base)).median,
    changePercent:
      baseline === 0 ? (current === 0 ? 0 : null) : ((current - baseline) / baseline) * 100,
  };
}

function compactExperimentReport(experiment: Experiment, comparison: Comparison): string {
  const reason =
    comparison.verdict === 'pass'
      ? 'All primary checks fit the allowed budget.'
      : comparison.verdict === 'regression'
        ? 'At least one fixed-work metric exceeded the allowed budget.'
        : comparison.rows.some((row) => row.interval[0] === null)
          ? 'More balanced blocks are needed to decide.'
          : 'The results are too uncertain to call a pass or regression.';
  const reference = experiment.blocks[0].runs[0].scenarios[0];
  const samples = sampleCount(
    experiment.blocks
      .flatMap((block) => block.runs)
      .filter((run) => run.variant === 'base')
      .flatMap((run) =>
        run.scenarios.filter((scenario) => scenario.scenario === reference.scenario),
      ),
  );
  const lines = [
    '## Performance benchmarks',
    '',
    `**Verdict: ${comparison.verdict.toUpperCase()}** — ${reason}`,
    '',
    `${comparison.blocks} balanced blocks · ${samples} measured samples per side/scenario · ${reference.warmupIterations} warmup per suite · ${reference.cpuThrottle}× CPU throttle · ${comparison.thresholdPercent}% budget with minimum allowances.`,
    '',
    '| Scenario | Task time, ms (base → head) | Change | Layout Δ | Style Δ | Result |',
    '| --- | ---: | ---: | ---: | ---: | --- |',
  ];
  for (const [name, label] of Object.entries(SCENARIO_NAMES)) {
    const rows = comparison.rows.filter((row) => row.scenario === name);
    const diagnostic = EXPECTED_SCENARIOS[name as keyof typeof EXPECTED_SCENARIOS] === 'paced';
    const metric = (key: 'taskDuration' | 'layoutCount' | 'recalcStyleCount') =>
      diagnostic
        ? pacedMetric(experiment, name, key)
        : (rows.find((row) => row.metric === key) as ComparisonRow);
    const task = metric('taskDuration');
    lines.push(
      `| ${label} | ${formatValue(task.baseline)} → ${formatValue(task.current)} | ${percent(task.changePercent)} | ${signedValue(metric('layoutCount').delta)} | ${signedValue(metric('recalcStyleCount').delta)} | ${diagnostic ? 'Diagnostic' : scenarioResult(rows)} |`,
    );
  }
  if (experiment.mode === 'calibration') {
    const control = experiment.environment['control'] ?? 'none';
    lines.push(
      '',
      control === 'none'
        ? comparison.verdict === 'regression'
          ? 'Unchanged-code calibration (A/A): this flag is a false alarm of the decision procedure.'
          : 'Unchanged-code calibration (A/A): repeated experiments are needed to calibrate false alarms.'
        : `Calibration control: ${escape(control)}. This tests sensitivity to deliberate work or CPU contention.`,
    );
  }
  return lines.join('\n') + '\n';
}

function compactStandaloneReport(scenarios: ScenarioReport[]): string {
  const lines = [
    '## Performance benchmarks',
    '',
    '**Verdict: INCONCLUSIVE** — A standalone suite has no base/head comparison.',
    '',
    `${range(scenarios.map((scenario) => scenario.raw.length))} measured samples per scenario · ${range(scenarios.map((scenario) => scenario.warmupIterations))} warmup per suite · ${range(scenarios.map((scenario) => scenario.cpuThrottle))}× CPU throttle. Values are medians.`,
    '',
    '| Scenario | Task time, ms | Layouts | Style recalculations | Result |',
    '| --- | ---: | ---: | ---: | --- |',
  ];
  for (const [name, label] of Object.entries(SCENARIO_NAMES)) {
    const scenario = scenarios.find((report) => report.scenario === name) as ScenarioReport;
    const median = (metric: 'taskDuration' | 'layoutCount' | 'recalcStyleCount') =>
      formatValue(aggregate(scenario.raw.map((sample) => sample[metric])).median);
    lines.push(
      `| ${label} | ${median('taskDuration')} | ${median('layoutCount')} | ${median('recalcStyleCount')} | Diagnostic |`,
    );
  }
  return lines.join('\n') + '\n';
}

function range(values: number[], unit = ''): string {
  if (values.length === 0) return 'unavailable';
  const min = Math.min(...values);
  const max = Math.max(...values);
  return min === max ? formatValue(min, unit) : `${formatValue(min)}–${formatValue(max, unit)}`;
}

function summary(scenarios: ScenarioReport[], metric: ScenarioMetricName): string {
  const values = scenarios.flatMap((scenario) => scenario.raw.map((sample) => sample[metric]));
  if (values.length === 0) return 'unavailable';
  const stats = aggregate(values);
  const { unit } = METRIC_LABELS[metric];
  return `**${formatValue(stats.median)} ±${formatValue(stats.mad)}** / ${formatValue(stats.mean)} / ${formatValue(stats.max, unit)}`;
}

function sampleCount(scenarios: ScenarioReport[]): number {
  return scenarios.reduce((count, scenario) => count + scenario.raw.length, 0);
}

function workloadSummary(scenarios: ScenarioReport[]): string {
  const samples = scenarios.flatMap((scenario) => scenario.raw);
  const keys = new Set(samples.flatMap((sample) => Object.keys(sample.workload)));
  const fields: string[] = [];
  for (const key of keys) {
    const values = samples.map((sample) => sample.workload[key]);
    if (values.every((value): value is number => typeof value === 'number')) {
      fields.push(`${escape(key)}=${range(values)}`);
    } else if (values.every((value): value is boolean => typeof value === 'boolean')) {
      fields.push(`${escape(key)}=${escape([...new Set(values)].join('/'))}`);
    } else if (values.every((value): value is string => typeof value === 'string')) {
      fields.push(`${escape(key)}=${escape([...new Set(values)].join('/'))}`);
    } else if (values.every((value): value is string[] => Array.isArray(value))) {
      fields.push(`${escape(key)} length=${range(values.map((value) => value.length))}`);
    }
  }
  return fields.join('; ') || 'unavailable';
}

function scenarioDiagnostics(
  name: string,
  base: ScenarioReport[],
  head?: ScenarioReport[],
): string[] {
  const all = [...base, ...(head ?? [])];
  const reference = all[0];
  const lines = [
    `### ${escape(name)} (${reference.kind})`,
    '',
    `Measured samples: ${head ? `base **${sampleCount(base)}**, head **${sampleCount(head)}**` : `**${sampleCount(base)}**`}. CPU throttle: **${range(all.map((scenario) => scenario.cpuThrottle))}×**. Schema: **${reference.metricsSchemaVersion}**.`,
    '',
    `Warmups per suite: **${range(all.map((scenario) => Number(scenario['warmupIterations'])))}**. Counter exposure: **${range(
      all.flatMap((scenario) => scenario.raw.map((sample) => sample.counterWindowMs)),
      'ms',
    )}**.`,
    '',
    `Workload definition: ${escape(reference.workload)}.`,
    '',
    `${head ? 'Base workload' : 'Actual workload'}: ${workloadSummary(base)}.`,
  ];
  if (head) lines.push('', `Head workload: ${workloadSummary(head)}.`);
  lines.push(
    '',
    `Each cell shows **median ± MAD / mean / maximum** across raw measurements. ${head ? 'These summaries describe the observations; the decision above uses balanced blocks.' : 'These are standalone diagnostics.'}`,
    '',
    head ? '| Metric | Base | Head |' : '| Metric | Observed |',
    head ? '| --- | --- | --- |' : '| --- | --- |',
  );
  const zeroBlocking = all.every((scenario) =>
    scenario.raw.every((sample) => sample.longTaskCount === 0 && sample.totalBlockingTime === 0),
  );
  for (const metric of SCENARIO_METRICS) {
    if (zeroBlocking && (metric === 'longTaskCount' || metric === 'totalBlockingTime')) continue;
    const label = METRIC_LABELS[metric].label;
    lines.push(
      head
        ? `| ${label} | ${summary(base, metric)} | ${summary(head, metric)} |`
        : `| ${label} | ${summary(base, metric)} |`,
    );
  }
  if (zeroBlocking) {
    lines.push(
      '',
      `Blocking diagnostics: zero long tasks and zero Total Blocking Time in all **${sampleCount(all)}** measurements. Raw evidence is retained.`,
    );
  }
  lines.push('');
  return lines;
}

function healthReport(runs: BenchmarkRun[]): string[] {
  const lines = [
    '### Runner health',
    '',
    'Ranges across suite runs. Host load and pressure provide context; they do not establish the cause of a timing change.',
    '',
    '| Observation | Base | Head |',
    '| --- | --- | --- |',
  ];
  const byVariant = {
    base: runs.filter((run) => run.variant === 'base'),
    head: runs.filter((run) => run.variant === 'head'),
  };
  const row = (label: string, measure: (run: BenchmarkRun) => number | null, unit = '') => {
    const values = (variant: 'base' | 'head') =>
      byVariant[variant].map(measure).filter((value): value is number => value !== null);
    lines.push(`| ${label} | ${range(values('base'), unit)} | ${range(values('head'), unit)} |`);
  };
  row('1-minute load before', (run) => run.healthBefore.loadAverage[0]);
  row('1-minute load after', (run) => run.healthAfter.loadAverage[0]);
  row('Free memory before', (run) => run.healthBefore.freeMemoryBytes / 1024 ** 2, 'MiB');
  row('Free memory after', (run) => run.healthAfter.freeMemoryBytes / 1024 ** 2, 'MiB');
  row(
    'Host CPU busy during suite',
    (run) => {
      const total = run.healthAfter.cpuTime.total - run.healthBefore.cpuTime.total;
      const idle = run.healthAfter.cpuTime.idle - run.healthBefore.cpuTime.idle;
      return total > 0 ? (100 * (total - idle)) / total : null;
    },
    '%',
  );
  const pressureKeys = new Set(runs.flatMap((run) => Object.keys(run.healthBefore.pressure)));
  for (const key of pressureKeys) {
    row(`Pressure ${escape(key)} before`, (run) => run.healthBefore.pressure[key] ?? null);
    row(`Pressure ${escape(key)} after`, (run) => run.healthAfter.pressure[key] ?? null);
    row(
      `Pressure ${escape(key)} suite delta`,
      (run) => {
        const before = run.healthBefore.pressure[key];
        const after = run.healthAfter.pressure[key];
        return typeof before === 'number' && typeof after === 'number' && after >= before
          ? after - before
          : null;
      },
      key.endsWith('Us') ? 'µs' : '',
    );
  }
  lines.push('');
  return lines;
}

export function generateExperimentReport(
  input: unknown,
  thresholdPercent = 10,
  options: ReportOptions = {},
): string {
  const comparison = compareExperiment(input, { thresholdPercent });
  if (!options.details) {
    return comparison.verdict === 'invalid'
      ? invalidReport(comparison.reasons, options)
      : compactExperimentReport(input as Experiment, comparison);
  }
  const lines = [renderComparisonMarkdown(comparison), ''];
  if (comparison.verdict === 'invalid') return lines.join('\n');
  const experiment = input as Experiment;
  if (experiment.mode === 'calibration') {
    const control = experiment.environment['control'] ?? 'none';
    if (control === 'none') {
      lines.push(
        comparison.verdict === 'regression'
          ? '**Unchanged-code calibration: this regression verdict is a false alarm of the decision procedure.**'
          : 'Unchanged-code calibration: this verdict measures the decision procedure on identical library revisions.',
        '',
      );
    } else {
      lines.push(
        `Calibration control: **${escape(control)}**. This result measures sensitivity to deliberate injected work or contention.`,
        '',
      );
    }
  }
  lines.push(
    `Mode: **${experiment.mode}**. Balanced blocks: **${experiment.blocks.length}** / **${experiment.requestedBlocks}** planned; experiment **complete**. Orders: **${[...new Set(experiment.blocks.map((block) => block.order.map((variant) => (variant === 'base' ? 'A' : 'B')).join('')))].join(', ')}** (A = base, B = head).`,
    '',
    `Harness hash: ${escape(experiment.harnessHash)}.`,
    '',
    '| Variant | Commit | Library source hash | Dependency hash |',
    '| --- | --- | --- | --- |',
    `| Base | ${escape(experiment.variants.base.commit)} | ${escape(experiment.variants.base.libraryHash)} | ${escape(experiment.variants.base.dependencyHash)} |`,
    `| Head | ${escape(experiment.variants.head.commit)} | ${escape(experiment.variants.head.libraryHash)} | ${escape(experiment.variants.head.dependencyHash)} |`,
    '',
    '| Environment | Value |',
    '| --- | --- |',
  );
  for (const [key, value] of Object.entries(experiment.environment)) {
    lines.push(`| ${escape(key)} | ${escape(value)} |`);
  }
  lines.push('');
  const runs = experiment.blocks.flatMap((block) => block.runs);
  const names = experiment.blocks[0].runs[0].scenarios.map((scenario) => scenario.scenario);
  for (const name of names) {
    const scenarios = (variant: 'base' | 'head') =>
      runs
        .filter((run) => run.variant === variant)
        .flatMap((run) => run.scenarios.filter((scenario) => scenario.scenario === name));
    lines.push(...scenarioDiagnostics(name, scenarios('base'), scenarios('head')));
  }
  lines.push(...healthReport(runs));
  return lines.join('\n');
}

export function generateStandaloneReport(input: unknown, options: ReportOptions = {}): string {
  const reasons = validateScenarios(input);
  if (reasons.length > 0) return invalidReport(reasons, options);
  const scenarios = input as ScenarioReport[];
  if (!options.details) return compactStandaloneReport(scenarios);
  const browserVersions = new Set(
    scenarios.flatMap((scenario) => scenario.raw.map((sample) => sample.browserVersion)),
  );
  const lines = [
    '## Performance Benchmark Results — inconclusive',
    '',
    'A standalone suite has no adjacent base/head blocks and cannot establish a regression verdict.',
    '',
    `Browser: **${escape([...browserVersions].join(', '))}**. Sample counts, throttle, exposure, and completed work are reported per scenario.`,
    '',
  ];
  for (const scenario of scenarios)
    lines.push(...scenarioDiagnostics(scenario.scenario, [scenario]));
  return lines.join('\n');
}

function invalidReport(reasons: string[], options: ReportOptions = {}): string {
  if (!options.details) {
    const shown = reasons.slice(0, 3);
    const lines = [
      '## Performance benchmarks',
      '',
      '**Verdict: INVALID** — The measurements are incomplete or incompatible.',
      '',
      ...shown.map(
        (reason) => `- ${escape(reason).slice(0, 200)}${escape(reason).length > 200 ? '…' : ''}`,
      ),
    ];
    if (reasons.length > shown.length)
      lines.push(
        '',
        `${reasons.length - shown.length} more problems are listed in the detailed report.`,
      );
    return lines.join('\n') + '\n';
  }
  return [
    '## Performance Benchmark Results — invalid',
    '',
    ...reasons.map((reason) => `- ${escape(reason)}`),
    '',
  ].join('\n');
}

function invalidComparisonReasons(input: unknown): string[] {
  if (input !== null && typeof input === 'object' && !Array.isArray(input)) {
    const summary = input as Record<string, unknown>;
    const reasons = summary['reasons'];
    if (
      summary['verdict'] === 'invalid' &&
      Array.isArray(reasons) &&
      reasons.length > 0 &&
      reasons.every(
        (reason): reason is string => typeof reason === 'string' && reason.trim().length > 0,
      ) &&
      Array.isArray(summary['rows']) &&
      summary['rows'].length === 0 &&
      typeof summary['blocks'] === 'number' &&
      Number.isSafeInteger(summary['blocks']) &&
      summary['blocks'] >= 0 &&
      typeof summary['thresholdPercent'] === 'number' &&
      Number.isFinite(summary['thresholdPercent']) &&
      summary['thresholdPercent'] >= 0
    )
      return reasons;
  }
  throw new Error(
    'Comparison summary has no raw experiment evidence or a verified invalid verdict.',
  );
}

export function main(
  args = process.argv.slice(2),
  resultsDirectory = resolve(import.meta.dirname, 'results'),
): number {
  const experimentPath = resolve(resultsDirectory, 'experiment.json');
  const comparisonPath = resolve(resultsDirectory, 'comparison.json');
  let inputPath = existsSync(experimentPath)
    ? experimentPath
    : existsSync(comparisonPath)
      ? comparisonPath
      : resolve(resultsDirectory, 'latest.json');
  let comparisonSummary = inputPath === comparisonPath;
  let outputPath: string | undefined;
  let thresholdPercent = 10;
  const options: ReportOptions = {};
  let report: string;
  let invalid = false;
  try {
    for (let index = 0; index < args.length; index++) {
      const flag = args[index];
      if (flag === '--help') {
        console.log(
          'Usage: perf:report [--input file] [--output file] [--threshold percent] [--details]',
        );
        return 0;
      }
      if (flag === '--details') {
        options.details = true;
        continue;
      }
      if (
        !['--input', '--output', '--threshold'].includes(flag) ||
        !args[index + 1] ||
        args[index + 1].startsWith('--')
      ) {
        throw new Error(`Unknown or incomplete argument: ${flag}`);
      }
      const value = args[++index];
      if (flag === '--input') {
        inputPath = resolve(value);
        comparisonSummary = false;
      }
      if (flag === '--output') outputPath = resolve(value);
      if (flag === '--threshold') thresholdPercent = Number(value);
    }
    if (!Number.isFinite(thresholdPercent) || thresholdPercent < 0) {
      throw new Error('Threshold must be a finite, nonnegative percentage');
    }
    const data: unknown = JSON.parse(readFileSync(inputPath, 'utf8'));
    if (data !== null && typeof data === 'object' && 'formatVersion' in data) {
      const comparison = compareExperiment(data, { thresholdPercent });
      invalid = comparison.verdict === 'invalid';
      report = generateExperimentReport(data, thresholdPercent, options);
    } else if (
      comparisonSummary ||
      (data !== null && typeof data === 'object' && 'verdict' in data)
    ) {
      invalid = true;
      report = invalidReport(invalidComparisonReasons(data), options);
    } else {
      const scenarios = extractScenarios(inputPath);
      invalid = validateScenarios(scenarios).length > 0;
      report = generateStandaloneReport(scenarios, options);
    }
  } catch (error) {
    invalid = true;
    report = invalidReport([error instanceof Error ? error.message : String(error)], options);
  }
  console.log(report);
  if (outputPath) {
    try {
      writeFileSync(outputPath, `${report}\n`);
    } catch (error) {
      console.error(
        `Failed to save report: ${error instanceof Error ? error.message : String(error)}`,
      );
      invalid = true;
    }
  }
  return invalid ? 3 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  process.exitCode = main();
