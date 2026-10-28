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
const ITEM_COUNT = 2000;
const SCROLL_DURATION_MS = 2000;
const CPU_THROTTLE = 4;

test.describe('Scroll Performance', () => {
  test('large list scroll - 2000 items', async ({ page }, testInfo) => {
    const perfPage = new PerfPage(page);
    const collector = new MetricsCollector(page);
    await collector.init();
    await collector.setCpuThrottling(CPU_THROTTLE);

    await perfPage.goto();
    await perfPage.setItemCount(ITEM_COUNT);

    const results: ScenarioMetrics[] = [];
    const totalRuns = WARMUP_ITERATIONS + ITERATIONS;

    for (let i = 0; i < totalRuns; i++) {
      await perfPage.resetScrollPositions();
      // Allow GC and settling between iterations
      await page.waitForTimeout(300);

      const maxScroll = (ITEM_COUNT / 2) * 50 - 400; // half items * height - container
      const metrics = await collector.measureScenario(async () => {
        await perfPage.smoothScroll(
          '[data-droppable-id="list-1"] vdnd-virtual-scroll',
          maxScroll,
          SCROLL_DURATION_MS,
        );
      });

      // Skip warmup iterations
      if (i >= WARMUP_ITERATIONS) {
        results.push(metrics);
      }
    }

    const report = {
      scenario: 'scroll-2000-items',
      metricsSchemaVersion: METRICS_SCHEMA_VERSION,
      cpuThrottle: CPU_THROTTLE,
      iterations: ITERATIONS,
      ...aggregateScenarioMetrics(results),
    };

    testInfo.attach('scroll-2000-items', {
      body: JSON.stringify(report, null, 2),
      contentType: 'application/json',
    });

    await collector.dispose();
  });
});
