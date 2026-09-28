import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DROPPED_FRAME_THRESHOLD_MS,
  METRICS_SCHEMA_VERSION,
  SCENARIO_METRICS,
  aggregateScenarioMetrics,
  computeTotalBlockingTime,
  countDroppedFrames,
  filterLongTasksSince,
  percentile,
  readPerfCounters,
  type LongTask,
  type ScenarioMetrics,
} from './metric-math.ts';

test('metrics schema version is a positive integer (bumped when semantics change)', () => {
  // Schema 3 (#97): CPU-time metrics, and no drag-state debug output on the measured pages.
  assert.ok(Number.isInteger(METRICS_SCHEMA_VERSION) && METRICS_SCHEMA_VERSION >= 3);
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
    droppedFrames: 0,
    p99FrameTime: 20,
  });
  const report = aggregateScenarioMetrics([sample(100), sample(120), sample(110)]);

  assert.deepEqual(Object.keys(report), [...SCENARIO_METRICS]);
  assert.ok(SCENARIO_METRICS.includes('scriptDuration'));
  assert.ok(SCENARIO_METRICS.includes('taskDuration'));
  assert.equal(report.scriptDuration.median, 110);
  assert.equal(report.taskDuration.median, 220);
  assert.equal(report.layoutCount.samples, 3);
});

test('filterLongTasksSince drops tasks that started before the scenario window', () => {
  // Issue #42, problems 1 & 2: buffered history / stale-observer entries from
  // before the measured window must not be attributed to the scenario.
  const tasks: LongTask[] = [
    { startTime: 10, duration: 80 }, // page load
    { startTime: 40, duration: 60 }, // warmup
    { startTime: 120, duration: 51 }, // in-window
    { startTime: 200, duration: 70 }, // in-window
  ];
  const inWindow = filterLongTasksSince(tasks, 100);
  assert.equal(inWindow.length, 2);
  assert.deepEqual(
    inWindow.map((t) => t.startTime),
    [120, 200],
  );
});

test('filterLongTasksSince keeps tasks that start exactly at the boundary', () => {
  const tasks: LongTask[] = [{ startTime: 100, duration: 55 }];
  assert.equal(filterLongTasksSince(tasks, 100).length, 1);
});

test('computeTotalBlockingTime sums only the blocking time beyond 50ms', () => {
  const tasks: LongTask[] = [
    { startTime: 0, duration: 51 }, // 1ms blocking
    { startTime: 0, duration: 90 }, // 40ms blocking
    { startTime: 0, duration: 30 }, // not a long task, 0 blocking
  ];
  assert.equal(computeTotalBlockingTime(tasks), 41);
});

test('countDroppedFrames uses a ~25ms hysteresis threshold, ignoring 60Hz jitter', () => {
  // Issue #42, problem 3: 16.8ms jitter must not count the same as a real stall.
  const frames = [16.6, 16.8, 17.2, 24.9, 25.1, 50];
  assert.equal(DROPPED_FRAME_THRESHOLD_MS, 25);
  assert.equal(countDroppedFrames(frames), 2); // only 25.1 and 50
});

test('countDroppedFrames accepts an explicit threshold', () => {
  const frames = [16.6, 16.8, 17.2, 50];
  assert.equal(countDroppedFrames(frames, 16.7), 3);
});

test('percentile matches nearest-rank indexing and clamps edge cases', () => {
  const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  assert.equal(percentile(values, 0.99), 10);
  assert.equal(percentile(values, 0.5), 5);
  assert.equal(percentile([], 0.99), 0);
  assert.equal(percentile([42], 0.99), 42);
});
