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
 * a change alters what a number means (long-task attribution window, dropped-frame
 * threshold, aggregation, the page a scenario measures, …). `compare.ts` fails closed
 * when a baseline was produced by a different schema, because old and new numbers are
 * then not comparable — the pre-#42 harness (leaking observer, `buffered: true`,
 * >16.7ms dropped frames) is schema 1; schema 2 measured the main demo with its debug
 * panel, which re-rendered the whole demo every drag frame (#97); this collector is
 * schema 3 (pages without drag-state debug output, plus CPU time).
 */
export const METRICS_SCHEMA_VERSION = 3;

/**
 * Frame intervals below this are treated as ordinary 60Hz scheduling jitter.
 * ~1.5x the 16.67ms vsync interval, so a 16.8ms frame is no longer classified
 * the same as a real ~50ms stall (issue #42, problem 3).
 */
export const DROPPED_FRAME_THRESHOLD_MS = 25;

/**
 * Keep only long tasks that started at/after the scenario window began.
 * Guards against buffered/stale-observer entries from page load or warmup
 * leaking into the measured window (issue #42, problems 1 & 2).
 */
export function filterLongTasksSince(longTasks: LongTask[], sinceMs: number): LongTask[] {
  return longTasks.filter((task) => task.startTime >= sinceMs);
}

/** Total Blocking Time: sum of each long task's duration beyond the 50ms budget. */
export function computeTotalBlockingTime(longTasks: LongTask[]): number {
  return longTasks.reduce((sum, task) => sum + Math.max(0, task.duration - 50), 0);
}

/** Count frame intervals that exceed the dropped-frame hysteresis threshold. */
export function countDroppedFrames(
  frameTimes: number[],
  threshold: number = DROPPED_FRAME_THRESHOLD_MS,
): number {
  return frameTimes.filter((t) => t > threshold).length;
}

/** Nearest-rank percentile (0-1) matching the aggregation used elsewhere. */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil(sorted.length * p) - 1;
  return sorted[Math.min(Math.max(index, 0), sorted.length - 1)];
}

/** One entry of CDP `Performance.getMetrics`. */
export interface CdpMetric {
  name: string;
  value: number;
}

/** Cumulative renderer counters; a scenario's value is the delta across it. */
export interface PerfCounters {
  layoutCount: number;
  recalcStyleCount: number;
  /** Main-thread time spent running script, in ms. */
  scriptDuration: number;
  /** Main-thread time spent in tasks (script, style, layout, paint, …), in ms. */
  taskDuration: number;
}

/** Read the counters from CDP `Performance.getMetrics`, which reports durations in seconds. */
export function readPerfCounters(metrics: CdpMetric[]): PerfCounters {
  const get = (name: string) => metrics.find((m) => m.name === name)?.value ?? 0;
  return {
    layoutCount: get('LayoutCount'),
    recalcStyleCount: get('RecalcStyleCount'),
    scriptDuration: get('ScriptDuration') * 1000,
    taskDuration: get('TaskDuration') * 1000,
  };
}

/** What one measured iteration of a scenario produced. */
export interface ScenarioMetrics extends PerfCounters {
  durationMs: number;
  longTaskCount: number;
  totalBlockingTime: number;
  frameCount: number;
  avgFrameTime: number;
  maxFrameGap: number;
  droppedFrames: number;
  p99FrameTime: number;
}

/** The metrics every scenario report carries, in report order. */
export const SCENARIO_METRICS = [
  'totalBlockingTime',
  'longTaskCount',
  'layoutCount',
  'recalcStyleCount',
  'scriptDuration',
  'taskDuration',
  'avgFrameTime',
  'maxFrameGap',
  'droppedFrames',
  'p99FrameTime',
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
