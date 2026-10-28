/**
 * Pure regression-gating logic for `compare.ts`.
 *
 * Kept free of I/O and `import.meta`/`process.exit` so it can be unit-tested
 * with `node --test` (see `compare-metrics.test.ts`).
 *
 * All gated metrics are "higher is worse", so only increases are treated as
 * regressions. A change is gated only when it is worse on the **median** by
 * more than the percent threshold AND by more than the noise floor — a
 * per-metric absolute minimum combined with a robust MAD-based band. This
 * removes the "p95-of-5 = max", "zero-baseline = +100%", and single-noisy-run
 * failure modes (issue #42, problems 4 & 5).
 *
 * Within-run guards cannot correct for cross-run/host drift — a run on a
 * different machine shifts *all* samples together (PR #63's own benchmark
 * disproved a min-based "sustained" guard exactly this way). That failure mode
 * is instead eliminated structurally: CI measures the PR's base and head on the
 * same runner in the same workflow run (see `.github/workflows/perf.yml`).
 */

import type { AggregatedMetrics } from './statistics.ts';

/**
 * Metrics evaluated by the regression gate, in report order. `p99FrameTime` is
 * deliberately absent: with the <300 frame intervals our scenarios collect,
 * nearest-rank p99 resolves to (or next to) the maximum, so it duplicates
 * `maxFrameGap` — the same noisy value must not be gated twice with different
 * floors. `scriptDuration` is absent too: runs of the same code drifted by up to
 * 26% (pages reload each iteration, so JIT and GC timing vary), past the percent
 * threshold; `taskDuration` includes script time and drifted at most 19%. Both stay
 * in the benchmark report as informational context.
 */
export const GATED_METRICS = [
  'totalBlockingTime',
  'longTaskCount',
  'layoutCount',
  'recalcStyleCount',
  'taskDuration',
  'avgFrameTime',
  'maxFrameGap',
  'droppedFrames',
] as const;

/**
 * Multiplier applied to the baseline **MAD** (median absolute deviation) to form
 * the per-metric noise band. MAD is used instead of stddev because a single
 * outlier in only five samples inflates stddev enough to mask a real, sustained
 * regression (e.g. a baseline of `[0,0,0,0,500]` has stddev ≈224 but MAD 0).
 * `3 × MAD` ≈ `2σ` for normally distributed data (σ̂ = 1.4826 × MAD).
 */
export const REGRESSION_MAD_MULTIPLIER = 3;

/**
 * Absolute minimum change (in each metric's own unit) that must be exceeded
 * before a percent regression is gated. Below these, a change is reported as
 * informational only. Values are deliberately conservative; see `perf/README.md`.
 */
export const MIN_ABS_DELTA: Record<string, number> = {
  totalBlockingTime: 20, // ms
  longTaskCount: 2, // tasks
  // Layout/style-recalc counts are near-deterministic (baseline MAD ≈ 0), so the
  // floor only needs to guard genuinely small baselines. 25 was larger than the
  // drag-within-list baseline median (24) — a full doubling of layout work slipped
  // under it as "noise". Without the demo's debug panel (#97) the drag layout
  // baselines are 10 (drag-within-list) and 6 (drag-within-virtual-for-list, where
  // one forced layout per placeholder move adds 4).
  layoutCount: 3, // count
  recalcStyleCount: 10, // count
  // Main-thread task time over the whole scenario, under 4x CPU throttling. Runs of
  // the same code on one machine differed by up to 28 ms on the ~200 ms
  // drag-within-virtual-for-list baseline (25% of it is 50 ms); the percent
  // threshold covers larger baselines (at most +19% drift, 68 ms on ~360 ms).
  taskDuration: 50, // ms
  avgFrameTime: 1.5, // ms
  maxFrameGap: 15, // ms
  droppedFrames: 3, // frames
  // p99FrameTime has no floor because it is not gated: the scenarios collect
  // fewer than ~300 frame intervals, so nearest-rank p99 resolves to (or next
  // to) the maximum — gating it would evaluate the same noisy value as
  // maxFrameGap a second time, with a contradictory tolerance.
};

/** Why an over-threshold change was suppressed instead of gated. */
export type SuppressedReason = 'below-floor' | 'within-noise-band';

export interface MetricEvaluation {
  metric: string;
  /** Baseline median. */
  baseline: number;
  /** Current median. */
  current: number;
  absDelta: number;
  percentChange: number;
  /** Gated as a regression. */
  regression: boolean;
  /** Nominally over the percent threshold but suppressed as noise/below floor. */
  suppressed: boolean;
  /** Set when `suppressed` is true: which guard kept the change from gating. */
  suppressedReason?: SuppressedReason;
}

/**
 * Percent change from baseline to current. A zero baseline yields +100% for any
 * nonzero current (and 0% when both are zero); the absolute floor in
 * {@link evaluateMetric} keeps that from gating on its own.
 */
export function percentChange(baseline: number, current: number): number {
  if (baseline === 0) return current === 0 ? 0 : 100;
  return ((current - baseline) / Math.abs(baseline)) * 100;
}

/** Evaluate one metric's baseline vs current aggregates against the threshold. */
export function evaluateMetric(
  metric: string,
  baseline: AggregatedMetrics,
  current: AggregatedMetrics,
  threshold: number,
): MetricEvaluation {
  const b = baseline.median;
  const c = current.median;
  const absDelta = c - b;
  const pct = percentChange(b, c);

  const floor = MIN_ABS_DELTA[metric] ?? 0;
  const noiseBand = REGRESSION_MAD_MULTIPLIER * (baseline.mad ?? 0);

  const worse = absDelta > 0;
  const overThreshold = pct > threshold;
  const overFloor = absDelta >= floor;
  const overNoise = absDelta > noiseBand;

  const regression = worse && overThreshold && overFloor && overNoise;
  const suppressed = worse && overThreshold && !regression;

  let suppressedReason: SuppressedReason | undefined;
  if (suppressed) {
    suppressedReason = !overFloor ? 'below-floor' : 'within-noise-band';
  }

  return {
    metric,
    baseline: b,
    current: c,
    absDelta,
    percentChange: pct,
    regression,
    suppressed,
    suppressedReason,
  };
}

/** Why `compare.ts` refused to compare a baseline with the current run. */
export interface BaselineIncompatibility {
  /** The two sides were produced by different metrics schemas. */
  schemaMismatch: boolean;
  /** One side's results file mixes scenarios from different collector versions. */
  mixedSchemas: boolean;
  /** The two sides ran on different Playwright (browser) builds. */
  playwrightMismatch: boolean;
}

/**
 * What to do about an incompatible baseline. CI never reads a saved baseline: it measures each
 * PR's base commit on the same runner (`.github/workflows/perf.yml`), so only a local saved
 * baseline is ever regenerated.
 */
export function incompatibleBaselineAdvice(reason: BaselineIncompatibility): string[] {
  if (reason.mixedSchemas) {
    return [
      'A results file mixes collector outputs (e.g. a stale file merged with a fresh one). ' +
        'Re-run `npm run perf` for a clean one (for a saved local baseline, `npm run perf:baseline`).',
    ];
  }
  const advice: string[] = [];
  if (reason.schemaMismatch) {
    advice.push(
      'This is expected on the PR that changes the metrics schema: its base commit still runs ' +
        'the old harness. CI measures each PR’s base commit afresh, so there is no baseline to ' +
        'regenerate; the next PR based on a commit with this schema compares normally.',
    );
  }
  if (reason.playwrightMismatch) {
    advice.push(
      'CI measures both sides with the head’s Playwright, so this comes from a saved local baseline.',
    );
  }
  advice.push(
    'Local comparisons: save a new baseline on the current harness (`npm run perf:baseline`).',
  );
  return advice;
}
