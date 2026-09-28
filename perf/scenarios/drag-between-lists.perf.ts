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
const AUTOSCROLL_HOLD_MS = 3000;
const CPU_THROTTLE = 4;

test.describe('Drag Between Lists Performance', () => {
  test('drag from list1 to list2 with autoscroll - 1000 items', async ({ page }, testInfo) => {
    const perfPage = new PerfPage(page);
    const collector = new MetricsCollector(page);
    await collector.init();
    await collector.setCpuThrottling(CPU_THROTTLE);

    await perfPage.goto();
    await perfPage.setItemCount(ITEM_COUNT);

    const results: ScenarioMetrics[] = [];
    const totalRuns = WARMUP_ITERATIONS + ITERATIONS;

    for (let i = 0; i < totalRuns; i++) {
      // Reload for clean drag state
      await perfPage.goto();
      await perfPage.setItemCount(ITEM_COUNT);
      await page.waitForTimeout(300);

      const sourceBox = await perfPage.getItemBox('list1', 0);
      const list2Box = await perfPage.getContainerBox('list2');

      if (!sourceBox || !list2Box) {
        throw new Error('Could not get bounding boxes');
      }

      const metrics = await collector.measureScenario(async () => {
        // Start drag from list1 item 0
        await page.mouse.move(
          sourceBox.x + sourceBox.width / 2,
          sourceBox.y + sourceBox.height / 2,
        );
        await page.mouse.down();
        await page.mouse.move(
          sourceBox.x + sourceBox.width / 2 + 5,
          sourceBox.y + sourceBox.height / 2 + 5,
          { steps: 2 },
        );

        const dragPreview = page.getByTestId('vdnd-drag-preview');
        await dragPreview.waitFor({ state: 'visible', timeout: 2000 });

        // Move to list2 bottom edge to trigger autoscroll
        const nearBottomY = list2Box.y + list2Box.height - 20;
        const centerX = list2Box.x + list2Box.width / 2;
        await page.mouse.move(centerX, nearBottomY, { steps: 15 });
        await page.mouse.move(centerX, nearBottomY);

        // Hold at edge to accumulate autoscroll
        await page.waitForTimeout(AUTOSCROLL_HOLD_MS);

        // Release
        await page.evaluate(() => new Promise((r) => requestAnimationFrame(r)));
        await page.mouse.up();
        await dragPreview.waitFor({ state: 'hidden', timeout: 2000 });
      });

      if (i >= WARMUP_ITERATIONS) {
        results.push(metrics);
      }
    }

    const report = {
      scenario: 'drag-between-lists-autoscroll-1000',
      metricsSchemaVersion: METRICS_SCHEMA_VERSION,
      cpuThrottle: CPU_THROTTLE,
      iterations: ITERATIONS,
      autoscrollHoldMs: AUTOSCROLL_HOLD_MS,
      ...aggregateScenarioMetrics(results),
    };

    testInfo.attach('drag-between-lists-autoscroll-1000', {
      body: JSON.stringify(report, null, 2),
      contentType: 'application/json',
    });

    await collector.dispose();
  });
});
