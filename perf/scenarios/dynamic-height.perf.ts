import { expect, test } from '@playwright/test';
import { PerfPage } from '../fixtures/perf.page';
import { runScenario } from '../fixtures/scenario';

const CHECKPOINTS = 120;
const CPU_THROTTLE = 4;
const LONG_LIST_COUNT = 100_000;
const SELECTOR = '[data-testid="task-scroll-container"]';

for (const config of [
  {
    scenario: 'dynamic-height-scroll',
    title: 'scroll through dynamic height list',
    count: 150,
    rowStep: 1,
  },
  {
    scenario: 'dynamic-height-long-list-scroll',
    title: 'scroll through rows never measured in a long dynamic height list',
    count: LONG_LIST_COUNT,
    rowStep: 3,
  },
]) {
  test.describe('Dynamic Height Scroll Performance', () => {
    test(config.title, async ({ page }, testInfo) => {
      const perfPage = new PerfPage(page);
      const finalTargetRow = `task-${CHECKPOINTS * config.rowStep}`;
      await runScenario(
        page,
        testInfo,
        {
          scenario: config.scenario,
          kind: 'fixed-work',
          cpuThrottle: CPU_THROTTLE,
          workload: {
            items: config.count,
            checkpoints: CHECKPOINTS,
            rowStep: config.rowStep,
            firstRow: 'task-0',
            finalTargetRow,
            reset: 'fresh-document',
            route: '/dynamic-height',
          },
        },
        {
          setup: async () => {
            // Recreate the height cache and row data for each sample, including warmup. Every
            // long-list iteration now traverses the same newly measured region.
            await perfPage.goto(`/dynamic-height?count=${config.count}`);
            await perfPage.scrollRowToTop(SELECTOR, 'task-0');
            await expect(page.locator(`${SELECTOR} [data-draggable-id="task-0"]`)).toBeInViewport();
            await expect(
              page.locator(`${SELECTOR} [data-draggable-id="${finalTargetRow}"]`),
            ).toHaveCount(0);
          },
          run: () =>
            perfPage.scrollCheckpoints({
              selector: SELECTOR,
              checkpoints: CHECKPOINTS,
              rowPrefix: 'task-',
              rowStep: config.rowStep,
            }),
          verify: async ({ workload }) => {
            expect(workload['operations']).toBe(CHECKPOINTS);
            expect(workload['completed']).toBe(true);
            expect(workload['checkpointRows']).toEqual(
              Array.from({ length: CHECKPOINTS }, (_, i) => `task-${(i + 1) * config.rowStep}`),
            );
            expect(workload['finalTargetRow']).toBe(finalTargetRow);
            expect(Number(workload['maxCheckpointOffsetPx'])).toBeLessThanOrEqual(2);
            expect(Number(workload['scrollDistance'])).toBeGreaterThan(0);
            await expect(
              page.locator(`${SELECTOR} [data-draggable-id="${finalTargetRow}"]`),
            ).toBeInViewport();
            await expect(page.locator(`${SELECTOR} [data-draggable-id="task-0"]`)).toHaveCount(0);
          },
        },
      );
    });
  });
}
