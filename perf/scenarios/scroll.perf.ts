import { expect, test } from '@playwright/test';
import { PerfPage } from '../fixtures/perf.page';
import { runScenario } from '../fixtures/scenario';

const ITEM_COUNT = 2000;
const CHECKPOINTS = 120;
const CPU_THROTTLE = 4;
const SELECTOR = '[data-droppable-id="list-1"] vdnd-virtual-scroll';

test.describe('Scroll Performance', () => {
  test('large list scroll - 2000 items', async ({ page }, testInfo) => {
    const perfPage = new PerfPage(page);
    let targetScrollTop = 0;
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
          itemHeight: 50,
          reset: 'fresh-document',
          route: '/',
        },
      },
      {
        setup: async () => {
          await perfPage.goto(`/?itemCount=${ITEM_COUNT}`);
          await expect(page.getByTestId('list-1-count')).toHaveText(String(ITEM_COUNT / 2));
          targetScrollTop = await page
            .locator(SELECTOR)
            .evaluate((element) => element.scrollHeight - element.clientHeight);
          expect(targetScrollTop).toBeGreaterThan(0);
          expect(await perfPage.scrollTop(SELECTOR)).toBe(0);
        },
        run: () =>
          perfPage.scrollCheckpoints({
            selector: SELECTOR,
            checkpoints: CHECKPOINTS,
            rowPrefix: 'list1-',
            targetScrollTop,
            itemHeight: 50,
          }),
        verify: async ({ workload }) => {
          expect(workload['operations']).toBe(CHECKPOINTS);
          expect(workload['completed']).toBe(true);
          expect(Math.abs(Number(workload['endScrollTop']) - targetScrollTop)).toBeLessThanOrEqual(
            1,
          );
          expect(Number(workload['scrollDistance'])).toBeGreaterThan(0);
          expect(workload['visitedRows']).toContain(`list1-${ITEM_COUNT / 2 - 1}`);
          await expect(
            page.locator(`${SELECTOR} [data-draggable-id="list1-${ITEM_COUNT / 2 - 1}"]`),
          ).toBeInViewport();
        },
      },
    );
  });
});
