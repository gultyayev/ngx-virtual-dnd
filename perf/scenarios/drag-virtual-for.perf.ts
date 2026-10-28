import { test } from '@playwright/test';
import {
  aggregateScenarioMetrics,
  MetricsCollector,
  ScenarioMetrics,
  METRICS_SCHEMA_VERSION,
} from '../fixtures/metrics-collector';
import { PerfPage } from '../fixtures/perf.page';

const ITERATIONS = 5;
const WARMUP_ITERATIONS = 1;
const CPU_THROTTLE = 4;
/** The 300px viewport shows rows 0-5 (50px rows), so row 4 is on screen without scrolling. */
const TARGET_INDEX = 4;

/**
 * The other drag scenarios drag in `vdnd-virtual-scroll` lists. This one drags in a
 * `vdnd-virtual-viewport` that renders its rows with `*vdndVirtualFor` (#93), crossing a few
 * rows so placeholder moves and cursor-only frames are both measured.
 */
test.describe('Drag Within *vdndVirtualFor List Performance', () => {
  test('drag row 0 to row 4 in a vdnd-virtual-viewport list', async ({ page }, testInfo) => {
    const perfPage = new PerfPage(page);
    const collector = new MetricsCollector(page);
    await collector.init();
    await collector.setCpuThrottling(CPU_THROTTLE);

    const results: ScenarioMetrics[] = [];
    const totalRuns = WARMUP_ITERATIONS + ITERATIONS;

    for (let i = 0; i < totalRuns; i++) {
      // Reload for the original row order (each drop reorders the list)
      await perfPage.goto('/virtual-viewport');
      await page.waitForTimeout(300);

      const sourceBox = await perfPage.getDraggableBox('viewport-a', 0);
      const targetBox = await perfPage.getDraggableBox('viewport-a', TARGET_INDEX);

      if (!sourceBox || !targetBox) {
        throw new Error('Could not get bounding boxes');
      }

      const metrics = await collector.measureScenario(async () => {
        await perfPage.simulateDrag({
          startX: sourceBox.x + sourceBox.width / 2,
          startY: sourceBox.y + sourceBox.height / 2,
          endX: targetBox.x + targetBox.width / 2,
          endY: targetBox.y + targetBox.height / 2,
          steps: 20,
        });
      });

      if (i >= WARMUP_ITERATIONS) {
        results.push(metrics);
      }
    }

    const report = {
      scenario: 'drag-within-virtual-for-list',
      metricsSchemaVersion: METRICS_SCHEMA_VERSION,
      cpuThrottle: CPU_THROTTLE,
      iterations: ITERATIONS,
      ...aggregateScenarioMetrics(results),
    };

    testInfo.attach('drag-within-virtual-for-list', {
      body: JSON.stringify(report, null, 2),
      contentType: 'application/json',
    });

    await collector.dispose();
  });
});
