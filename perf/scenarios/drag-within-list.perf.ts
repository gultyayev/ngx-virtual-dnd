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
const ITEM_COUNT = 1000;
const CPU_THROTTLE = 4;

test.describe('Drag Within List Performance', () => {
  test('drag item 0 to item 7 - 1000 items', async ({ page }, testInfo) => {
    const perfPage = new PerfPage(page);
    const collector = new MetricsCollector(page);
    await collector.init();
    await collector.setCpuThrottling(CPU_THROTTLE);

    await perfPage.goto();
    await perfPage.setItemCount(ITEM_COUNT);

    const results: ScenarioMetrics[] = [];
    const totalRuns = WARMUP_ITERATIONS + ITERATIONS;

    for (let i = 0; i < totalRuns; i++) {
      // Reload page to get a clean state for each drag iteration
      await perfPage.goto();
      await perfPage.setItemCount(ITEM_COUNT);
      await page.waitForTimeout(300);

      const sourceBox = await perfPage.getItemBox('list1', 0);
      const targetBox = await perfPage.getItemBox('list1', 7);

      if (!sourceBox || !targetBox) {
        throw new Error('Could not get bounding boxes');
      }

      const metrics = await collector.measureScenario(async () => {
        await perfPage.simulateDrag({
          startX: sourceBox.x + sourceBox.width / 2,
          startY: sourceBox.y + sourceBox.height / 2,
          // Target item ~7 visible positions down (items 0-7 in viewport)
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
      scenario: 'drag-within-list-1000',
      metricsSchemaVersion: METRICS_SCHEMA_VERSION,
      cpuThrottle: CPU_THROTTLE,
      iterations: ITERATIONS,
      ...aggregateScenarioMetrics(results),
    };

    testInfo.attach('drag-within-list-1000', {
      body: JSON.stringify(report, null, 2),
      contentType: 'application/json',
    });

    await collector.dispose();
  });
});
