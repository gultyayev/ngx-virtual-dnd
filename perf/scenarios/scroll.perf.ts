import { expect, test } from '@playwright/test';
import { PerfPage } from '../fixtures/perf.page';
import { runScenario } from '../fixtures/scenario';

const ITEM_COUNT = 2000;
const CHECKPOINTS = 120;
const CPU_THROTTLE = 4;
const ROW_STEP = Math.floor((ITEM_COUNT / 2 - 1) / CHECKPOINTS);
const FINAL_TARGET_ROW = `list1-${CHECKPOINTS * ROW_STEP}`;
const SELECTOR = '[data-droppable-id="list-1"] vdnd-virtual-scroll';

test.describe('Scroll Performance', () => {
  test('large list scroll - 2000 items', async ({ page }, testInfo) => {
    const perfPage = new PerfPage(page);
    await runScenario(
      page,
      testInfo,
      {
        scenario: 'scroll-2000-items',
        kind: 'fixed-work',
        cpuThrottle: CPU_THROTTLE,
        workload: {
          items: ITEM_COUNT,
          checkpoints: CHECKPOINTS,
          rowStep: ROW_STEP,
          firstRow: 'list1-0',
          finalTargetRow: FINAL_TARGET_ROW,
          reset: 'fresh-document',
          route: '/',
        },
      },
      {
        setup: async () => {
          await perfPage.goto(`/?itemCount=${ITEM_COUNT}`);
          await expect(page.getByTestId('list-1-count')).toHaveText(String(ITEM_COUNT / 2));
          expect(await perfPage.scrollTop(SELECTOR)).toBe(0);
        },
        run: () =>
          perfPage.scrollCheckpoints({
            selector: SELECTOR,
            checkpoints: CHECKPOINTS,
            rowPrefix: 'list1-',
            rowStep: ROW_STEP,
          }),
        verify: async ({ workload }) => {
          expect(workload['operations']).toBe(CHECKPOINTS);
          expect(workload['completed']).toBe(true);
          expect(workload['checkpointRows']).toEqual(
            Array.from({ length: CHECKPOINTS }, (_, i) => `list1-${(i + 1) * ROW_STEP}`),
          );
          expect(workload['finalTargetRow']).toBe(FINAL_TARGET_ROW);
          expect(Number(workload['maxCheckpointOffsetPx'])).toBeLessThanOrEqual(2);
          expect(Number(workload['scrollDistance'])).toBeGreaterThan(0);
          expect(workload['visitedRows']).toContain(FINAL_TARGET_ROW);
          await expect(
            page.locator(`${SELECTOR} [data-draggable-id="${FINAL_TARGET_ROW}"]`),
          ).toBeInViewport();
        },
      },
    );
  });
});
