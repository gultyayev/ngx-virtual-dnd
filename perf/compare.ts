import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AggregatedMetrics } from './fixtures/statistics.ts';
import {
  evaluateMetric,
  incompatibleBaselineAdvice,
  GATED_METRICS,
} from './fixtures/compare-metrics.ts';
import { extractScenarios, type ScenarioReport } from './fixtures/extract-scenarios.ts';

function parseArg(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx !== -1 ? args[idx + 1] : undefined;
}

interface RunInfo {
  playwrightVersion?: string;
  /** ISO start time of the Playwright run. */
  startTime?: string;
  /** Short git hash the run was produced from (embedded by the JSON reporter). */
  gitShortHash?: string;
}

/** Read the run metadata embedded in a Playwright JSON reporter output file. */
function readRunInfo(filePath: string): RunInfo {
  try {
    const data = JSON.parse(readFileSync(filePath, 'utf-8')) as {
      config?: { version?: string; metadata?: { gitCommit?: { shortHash?: string } } };
      stats?: { startTime?: string };
    };
    return {
      playwrightVersion: data.config?.version,
      startTime: data.stats?.startTime,
      gitShortHash: data.config?.metadata?.gitCommit?.shortHash,
    };
  } catch {
    return {};
  }
}

interface SchemaInfo {
  /** Distinct numeric schema versions found across the run's scenarios. */
  versions: number[];
  /** Scenarios with no `metricsSchemaVersion` at all (pre-#42 collector). */
  unversioned: number;
}

/**
 * Collect the metrics schema versions present in a run. A healthy run has
 * exactly one distinct version on **every** scenario; multiple versions — or a
 * mix of versioned and unversioned scenarios — means the results file mixes
 * collector outputs (e.g. a stale file merged with a fresh one) and must not
 * be compared.
 */
function readSchemaVersions(scenarios: ScenarioReport[]): SchemaInfo {
  const versions = new Set<number>();
  let unversioned = 0;
  for (const s of scenarios) {
    if (typeof s.metricsSchemaVersion === 'number') versions.add(s.metricsSchemaVersion);
    else unversioned++;
  }
  return { versions: [...versions].sort((a, b) => a - b), unversioned };
}

/** Age of the baseline relative to the current run, in whole days (NaN if unknown). */
function baselineAgeDays(baselineStart?: string, currentStart?: string): number {
  if (!baselineStart || !currentStart) return NaN;
  const ms = Date.parse(currentStart) - Date.parse(baselineStart);
  return Number.isNaN(ms) ? NaN : Math.floor(ms / 86_400_000);
}

/** Baselines older than this get a staleness warning (non-fatal). */
const STALE_BASELINE_DAYS = 60;

function main(): void {
  const args = process.argv.slice(2);
  const threshold = parseFloat(parseArg(args, '--threshold') ?? '25');
  const outputPath = parseArg(args, '--output');
  // By default an incompatible baseline (different Playwright build or metrics
  // schema) fails closed — the numbers are not comparable. This escape hatch
  // downgrades that to a warning for local experimentation.
  const allowMismatch = args.includes('--allow-baseline-mismatch');

  const baselinePath = resolve(
    parseArg(args, '--baseline') ?? resolve(import.meta.dirname, 'baselines/baseline.json'),
  );
  const latestPath = resolve(
    parseArg(args, '--current') ?? resolve(import.meta.dirname, 'results/latest.json'),
  );

  if (!existsSync(baselinePath)) {
    console.log('No baseline found. Run `npm run perf:baseline` to create one.');
    process.exit(0);
  }

  if (!existsSync(latestPath)) {
    console.error('No latest results found. Run `npm run perf` first.');
    process.exit(1);
  }

  const baselineArr = extractScenarios(baselinePath);
  const latestArr = extractScenarios(latestPath);
  const baseline = new Map(baselineArr.map((s) => [s.scenario, s]));
  const latest = new Map(latestArr.map((s) => [s.scenario, s]));

  const lines: string[] = [];
  const emit = (line: string) => {
    console.log(line);
    lines.push(line);
  };
  const finish = (exitCode: number) => {
    if (outputPath) writeFileSync(outputPath, lines.join('\n') + '\n');
    process.exit(exitCode);
  };

  if (baseline.size === 0) {
    emit('Baseline contains no scenario data. Re-run `npm run perf:baseline`.');
    finish(allowMismatch ? 0 : 1);
    return;
  }

  emit(`\n## Performance Comparison (threshold: ${threshold}% on median)\n`);

  // Environment / harness metadata: surface the Playwright build and the metrics
  // schema on both sides so browser-build or semantics drift isn't silently
  // attributed to code (issue #42, problem 6).
  const baselineInfo = readRunInfo(baselinePath);
  const currentInfo = readRunInfo(latestPath);
  const baselineVersion = baselineInfo.playwrightVersion;
  const currentVersion = currentInfo.playwrightVersion;
  const baselineSchemas = readSchemaVersions(baselineArr);
  const currentSchemas = readSchemaVersions(latestArr);
  // A side has a well-defined schema only when every scenario carries the same
  // numeric version — a partially unversioned run is as unhealthy as a mixed one.
  const schemaOf = (info: SchemaInfo) =>
    info.versions.length === 1 && info.unversioned === 0 ? info.versions[0] : undefined;
  const baselineSchema = schemaOf(baselineSchemas);
  const currentSchema = schemaOf(currentSchemas);

  const describeOrigin = (info: RunInfo) => {
    const parts: string[] = [];
    if (info.gitShortHash) parts.push(`commit \`${info.gitShortHash}\``);
    if (info.startTime) parts.push(info.startTime.slice(0, 10));
    return parts.length > 0 ? ` (${parts.join(', ')})` : '';
  };
  emit(
    `- Baseline Playwright: **${baselineVersion ?? 'unknown'}** · metrics schema: **${baselineSchema ?? 'unknown (pre-#42)'}**${describeOrigin(baselineInfo)}`,
  );
  emit(
    `- Current Playwright: **${currentVersion ?? 'unknown'}** · metrics schema: **${currentSchema ?? 'unknown'}**${describeOrigin(currentInfo)}`,
  );

  // Staleness is a warning, not a gate. In CI both sides are measured in the
  // same workflow run, so this only fires for local comparisons against an old
  // saved baseline whose absolute numbers no longer reflect the current code.
  const ageDays = baselineAgeDays(baselineInfo.startTime, currentInfo.startTime);
  if (ageDays > STALE_BASELINE_DAYS) {
    emit(
      `\n> ⚠️ **Stale baseline:** the baseline run is ${ageDays} days older than the current run. ` +
        'Regenerate it (`npm run perf:baseline`) so the comparison reflects current code.',
    );
  }

  const versionMismatch =
    !!baselineVersion && !!currentVersion && baselineVersion !== currentVersion;
  const describeSchemas = (info: SchemaInfo) =>
    [...info.versions, ...(info.unversioned > 0 ? [`${info.unversioned} unversioned`] : [])].join(
      ', ',
    );
  const mixedSchemas = (info: SchemaInfo) =>
    info.versions.length > 1 || (info.versions.length > 0 && info.unversioned > 0);
  const hasMixedSchemas = mixedSchemas(baselineSchemas) || mixedSchemas(currentSchemas);
  const schemaMismatch = hasMixedSchemas || baselineSchema !== currentSchema;
  const incompatible = versionMismatch || schemaMismatch;

  if (incompatible) {
    const reasons: string[] = [];
    if (hasMixedSchemas) {
      reasons.push(
        `a single run contains scenarios from different collector versions (baseline [${describeSchemas(baselineSchemas)}] vs current [${describeSchemas(currentSchemas)}]) — the results file mixes collector outputs`,
      );
    } else if (schemaMismatch) {
      reasons.push(
        `metrics schema differs (baseline ${baselineSchema ?? 'pre-#42'} vs current ${currentSchema ?? 'unknown'}) — the numbers measure different things`,
      );
    }
    if (versionMismatch) {
      reasons.push(
        `Playwright differs (baseline ${baselineVersion} vs current ${currentVersion}) — different browser builds`,
      );
    }
    emit(`\n> ⚠️ **Incompatible baseline:** ${reasons.join('; ')}.`);
    for (const line of incompatibleBaselineAdvice({
      schemaMismatch,
      mixedSchemas: hasMixedSchemas,
      playwrightMismatch: versionMismatch,
    })) {
      emit(`> ${line}`);
    }

    if (!allowMismatch) {
      emit('');
      emit(
        '**Comparison gated: baseline is not comparable to the current run.** ' +
          'Pass `--allow-baseline-mismatch` to compare anyway (results will be unreliable).',
      );
      finish(1);
      return;
    }
    emit('> Proceeding anyway because `--allow-baseline-mismatch` was set.');
  }
  emit('');

  emit('| Scenario | Metric | Baseline median | Current median | Change | Status |');
  emit('|----------|--------|-----------------|----------------|--------|--------|');

  let hasRegression = false;
  let hasMissing = false;

  for (const [name, baselineReport] of baseline) {
    const currentReport = latest.get(name);
    if (!currentReport) {
      // A benchmark that exists in the baseline but not the current run has
      // silently vanished (renamed / skipped / crashed) — fail, don't ignore.
      emit(`| ${name} | * | - | - | - | MISSING SCENARIO |`);
      hasMissing = true;
      continue;
    }

    for (const metric of GATED_METRICS) {
      const bMetric = baselineReport[metric] as AggregatedMetrics | undefined;
      if (!bMetric) continue;

      const cMetric = currentReport[metric] as AggregatedMetrics | undefined;
      if (!cMetric) {
        emit(`| ${name} | ${metric} | ${bMetric.median.toFixed(1)} | - | - | MISSING METRIC |`);
        hasMissing = true;
        continue;
      }

      const evaluation = evaluateMetric(metric, bMetric, cMetric, threshold);
      const changeStr = `${evaluation.percentChange >= 0 ? '+' : ''}${evaluation.percentChange.toFixed(1)}%`;
      let status = 'ok';
      if (evaluation.regression) {
        status = 'REGRESSION';
        hasRegression = true;
      } else if (evaluation.suppressed) {
        status =
          evaluation.suppressedReason === 'within-noise-band'
            ? 'noise (within band)'
            : 'noise (below floor)';
      }

      emit(
        `| ${name} | ${metric} | ${evaluation.baseline.toFixed(1)} | ${evaluation.current.toFixed(1)} | ${changeStr} | ${status} |`,
      );
    }
  }

  // Scenarios present in the current run but absent from the baseline are new
  // benchmarks with nothing to compare against yet. Surface them (instead of
  // silently ignoring them) so a freshly added scenario is visibly ungated
  // until the baseline is regenerated.
  let hasNew = false;
  for (const name of latest.keys()) {
    if (!baseline.has(name)) {
      emit(`| ${name} | * | - | - | - | NEW (no baseline) |`);
      hasNew = true;
    }
  }

  emit('');

  if (hasRegression) {
    emit(`**Performance regression detected** (>${threshold}% on median, above the noise floor).`);
  }
  if (hasMissing) {
    emit(
      '**Missing benchmark data** — a baseline scenario or metric was absent from the current run.',
    );
  }
  if (hasNew) {
    emit(
      '**New benchmark scenario(s)** without a committed baseline — ungated until the baseline is regenerated.',
    );
  }
  if (!hasRegression && !hasMissing) {
    emit('No significant regressions detected.');
  }

  finish(hasRegression || hasMissing ? 1 : 0);
}

main();
