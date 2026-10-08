/**
 * Pure metric-derivation helpers shared by the in-browser collector and unit tests.
 *
 * Kept free of any Playwright imports so it can be exercised directly with
 * `node --test` (see `metric-math.test.ts`).
 */

import { aggregate, type AggregatedMetrics } from './statistics.ts';

export interface LongTask {
  startTime: number;
  duration: number;
}

/**
 * Version of the metric *semantics* produced by the collector. Bump this whenever
 * a change alters what a number means (long-task attribution window, frame interval
 * threshold, aggregation, the page a scenario measures, …). `compare.ts` fails closed
 * when a baseline was produced by a different schema, because old and new numbers are
 * then not comparable — the pre-#42 harness (leaking observer, `buffered: true`,
 * >16.7ms dropped frames) is schema 1; schema 2 measured the main demo with its debug
 * panel, which re-rendered the whole demo every drag frame (#97); this collector is
 * schema 4 preserves raw measurements and workload evidence, bounds observers by
 * the page's monotonic clock, and measures stalled-frame severity separately from count.
 */
export const METRICS_SCHEMA_VERSION = 4;

/**
 * Frame intervals below this are treated as ordinary 60Hz scheduling jitter.
 * ~1.5x the 16.67ms vsync interval, so a 16.8ms frame is no longer classified
 * the same as a real ~50ms stall (issue #42, problem 3).
 */
export const JANK_INTERVAL_THRESHOLD_MS = 25;
export const FRAME_BUDGET_MS = 16.67;

/**
 * Keep only long tasks that started at/after the scenario window began.
 * Guards against buffered/stale-observer entries from page load or warmup
 * leaking into the measured window (issue #42, problems 1 & 2).
 */
export function filterLongTasksInWindow(
  longTasks: LongTask[],
  startMs: number,
  endMs: number,
): LongTask[] {
  return longTasks.filter((task) => task.startTime >= startMs && task.startTime < endMs);
}

/** Total Blocking Time: sum of each long task's duration beyond the 50ms budget. */
export function computeTotalBlockingTime(longTasks: LongTask[]): number {
  return longTasks.reduce((sum, task) => sum + Math.max(0, task.duration - 50), 0);
}

/** Count intervals exceeding the jank threshold; this is not a missed-frame count. */
export function countJankIntervals(
  frameTimes: number[],
  threshold: number = JANK_INTERVAL_THRESHOLD_MS,
): number {
  return frameTimes.filter((t) => t > threshold).length;
}

/** Sum stalled time beyond the 60Hz budget, preserving the severity of long gaps. */
export function computeFrameOverBudgetMs(frameTimes: number[]): number {
  return frameTimes.reduce((sum, gap) => sum + Math.max(0, gap - FRAME_BUDGET_MS), 0);
}

/** One entry of CDP `Performance.getMetrics`. */
export interface CdpMetric {
  name: string;
  value: number;
}

/** CDP counters must be present exactly once, finite and nonnegative. */
export function readCdpMetric(metrics: CdpMetric[], name: string): number {
  const matches = metrics.filter((metric) => metric.name === name);
  if (matches.length !== 1) {
    throw new Error(`CDP Performance.getMetrics must report ${name} exactly once`);
  }
  const value = matches[0].value;
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`CDP Performance.getMetrics reported invalid ${name}: ${value}`);
  }
  return value;
}

/** Cumulative renderer counters; a scenario's value is the delta across it. */
export interface PerfCounters {
  layoutCount: number;
  recalcStyleCount: number;
  /** Main-thread wall time spent running script, in ms. */
  scriptDuration: number;
  /** Main-thread wall time spent in tasks (script, style, layout, paint, …), in ms. */
  taskDuration: number;
}

/**
 * Read the counters from CDP `Performance.getMetrics`, which reports durations in seconds.
 * Throws when a counter is missing: reading it as 0 on both sides of a comparison would pass
 * the gate without measuring anything.
 */
export function readPerfCounters(metrics: CdpMetric[]): PerfCounters {
  const get = (name: string) => readCdpMetric(metrics, name);
  return {
    layoutCount: get('LayoutCount'),
    recalcStyleCount: get('RecalcStyleCount'),
    scriptDuration: get('ScriptDuration') * 1000,
    taskDuration: get('TaskDuration') * 1000,
  };
}

export type WorkloadEvidence = Record<string, number | string | boolean | string[]>;

/** What one measured iteration of a scenario produced. */
export interface ScenarioMetrics extends PerfCounters {
  durationMs: number;
  longTaskCount: number;
  totalBlockingTime: number;
  frameCount: number;
  avgFrameTime: number;
  maxFrameGap: number;
  jankIntervalCount: number;
  frameOverBudgetMs: number;
  frameTimes: number[];
  longTasks: LongTask[];
  windowStartMs: number;
  windowEndMs: number;
  visibilityState: string;
  browserVersion: string;
  /** Counter snapshots bracket the observer window and include transport/setup overhead. */
  counterWindowMs: number;
  workload: WorkloadEvidence;
}

/** The metrics every scenario report carries, in report order. */
export const SCENARIO_METRICS = [
  'durationMs',
  'frameCount',
  'taskDuration',
  'scriptDuration',
  'layoutCount',
  'recalcStyleCount',
  'longTaskCount',
  'totalBlockingTime',
  'avgFrameTime',
  'maxFrameGap',
  'jankIntervalCount',
  'frameOverBudgetMs',
] as const satisfies readonly (keyof ScenarioMetrics)[];

export type ScenarioMetricName = (typeof SCENARIO_METRICS)[number];

/** Aggregate each reported metric over a scenario's measured iterations. */
export function aggregateScenarioMetrics(
  results: ScenarioMetrics[],
): Record<ScenarioMetricName, AggregatedMetrics> {
  return Object.fromEntries(
    SCENARIO_METRICS.map((metric) => [metric, aggregate(results.map((r) => r[metric]))]),
  ) as Record<ScenarioMetricName, AggregatedMetrics>;
}
