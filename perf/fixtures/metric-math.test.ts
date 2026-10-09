import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  JANK_INTERVAL_THRESHOLD_MS,
  METRICS_SCHEMA_VERSION,
  SCENARIO_METRICS,
  aggregateScenarioMetrics,
  computeTotalBlockingTime,
  computeFrameOverBudgetMs,
  countJankIntervals,
  filterLongTasksInWindow,
  readPerfCounters,
  type LongTask,
  type ScenarioMetrics,
} from './metric-math.ts';

test('metrics schema version is a positive integer (bumped when semantics change)', () => {
  assert.equal(METRICS_SCHEMA_VERSION, 4);
});

test('readPerfCounters converts CDP durations from seconds to milliseconds', () => {
  const counters = readPerfCounters([
    { name: 'LayoutCount', value: 12 },
    { name: 'RecalcStyleCount', value: 30 },
    { name: 'ScriptDuration', value: 0.25 },
    { name: 'TaskDuration', value: 1.5 },
    { name: 'Nodes', value: 900 },
  ]);
  assert.deepEqual(counters, {
    layoutCount: 12,
    recalcStyleCount: 30,
    scriptDuration: 250,
    taskDuration: 1500,
  });
});

test('readPerfCounters fails when CDP stops reporting a counter', () => {
  // Reading it as 0 on both sides would pass the gate without measuring anything.
  assert.throws(
    () =>
      readPerfCounters([
        { name: 'LayoutCount', value: 12 },
        { name: 'RecalcStyleCount', value: 30 },
        { name: 'ScriptDuration', value: 0.25 },
      ]),
    /TaskDuration/,
  );
});

test('readPerfCounters rejects invalid renderer counters instead of producing a valid-looking sample', () => {
  for (const value of [NaN, Infinity, -1]) {
    assert.throws(
      () =>
        readPerfCounters([
          { name: 'LayoutCount', value },
          { name: 'RecalcStyleCount', value: 30 },
          { name: 'ScriptDuration', value: 0.25 },
          { name: 'TaskDuration', value: 1.5 },
        ]),
      /LayoutCount/,
    );
  }
});

test('aggregateScenarioMetrics aggregates every reported metric, main-thread time included', () => {
  const sample = (scriptDuration: number): ScenarioMetrics => ({
    durationMs: 1000,
    longTaskCount: 0,
    totalBlockingTime: 0,
    layoutCount: 4,
    recalcStyleCount: 20,
    scriptDuration,
    taskDuration: scriptDuration * 2,
    frameCount: 60,
    avgFrameTime: 16.7,
    maxFrameGap: 20,
    jankIntervalCount: 0,
    frameOverBudgetMs: 0,
    frameTimes: [16.7],
    longTasks: [],
    windowStartMs: 100,
    windowEndMs: 1100,
    visibilityState: 'visible',
    browserVersion: 'test-browser',
    counterWindowMs: 1001,
    workload: { operations: 1 },
  });
  const report = aggregateScenarioMetrics([sample(100), sample(120), sample(110)]);

  assert.deepEqual(Object.keys(report), [...SCENARIO_METRICS]);
  assert.ok(SCENARIO_METRICS.includes('scriptDuration'));
  assert.ok(SCENARIO_METRICS.includes('taskDuration'));
  assert.ok(SCENARIO_METRICS.includes('durationMs'));
  assert.ok(SCENARIO_METRICS.includes('frameCount'));
  assert.equal(report.scriptDuration.median, 110);
  assert.equal(report.taskDuration.median, 220);
  assert.equal(report.layoutCount.samples, 3);
});

test('filterLongTasksInWindow drops tasks outside either boundary of the scenario window', () => {
  // Issue #42, problems 1 & 2: buffered history / stale-observer entries from
  // before the measured window must not be attributed to the scenario.
  const tasks: LongTask[] = [
    { startTime: 10, duration: 80 }, // page load
    { startTime: 40, duration: 60 }, // warmup
    { startTime: 120, duration: 51 }, // in-window
    { startTime: 200, duration: 70 }, // in-window
    { startTime: 250, duration: 80 }, // after window
  ];
  const inWindow = filterLongTasksInWindow(tasks, 100, 250);
  assert.equal(inWindow.length, 2);
  assert.deepEqual(
    inWindow.map((t) => t.startTime),
    [120, 200],
  );
});

test('filterLongTasksInWindow includes the start boundary and excludes the end boundary', () => {
  const tasks: LongTask[] = [{ startTime: 100, duration: 55 }];
  assert.equal(filterLongTasksInWindow(tasks, 100, 200).length, 1);
  assert.equal(filterLongTasksInWindow(tasks, 0, 100).length, 0);
});

test('computeTotalBlockingTime sums only the blocking time beyond 50ms', () => {
  const tasks: LongTask[] = [
    { startTime: 0, duration: 51 }, // 1ms blocking
    { startTime: 0, duration: 90 }, // 40ms blocking
    { startTime: 0, duration: 30 }, // not a long task, 0 blocking
  ];
  assert.equal(computeTotalBlockingTime(tasks), 41);
});

test('countJankIntervals uses a 25ms threshold, ignoring ordinary 60Hz jitter', () => {
  // Issue #42, problem 3: 16.8ms jitter must not count the same as a real stall.
  const frames = [16.6, 16.8, 17.2, 24.9, 25.1, 50];
  assert.equal(JANK_INTERVAL_THRESHOLD_MS, 25);
  assert.equal(countJankIntervals(frames), 2); // only 25.1 and 50
});

test('countJankIntervals accepts an explicit threshold', () => {
  const frames = [16.6, 16.8, 17.2, 50];
  assert.equal(countJankIntervals(frames, 16.7), 3);
});

test('frame-over-budget severity distinguishes one large stall from several small stalls', () => {
  assert.ok(computeFrameOverBudgetMs([1000]) > computeFrameOverBudgetMs([33, 33, 33]));
  assert.equal(computeFrameOverBudgetMs([16.6, 16.67]), 0);
  assert.ok(Math.abs(computeFrameOverBudgetMs([20, 50]) - 36.66) < 0.001);
  assert.equal(computeFrameOverBudgetMs([]), 0);
});
