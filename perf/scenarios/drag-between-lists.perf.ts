import { expect, test } from '@playwright/test';
import { PerfPage } from '../fixtures/perf.page';
import { runScenario } from '../fixtures/scenario';

const ITEM_COUNT = 1000;
const AUTOSCROLL_HOLD_MS = 3000;
const CPU_THROTTLE = 4;
const POINTER_STEPS = 20;
const TARGET_SELECTOR = '[data-droppable-id="list-2"] vdnd-virtual-scroll';

test.describe('Drag Between Lists Performance', () => {
  test('drag from list1 to list2 with autoscroll - 1000 items', async ({ page }, testInfo) => {
    const perfPage = new PerfPage(page);
    let sourceId = '';
    let coordinates = { startX: 0, startY: 0, endX: 0, endY: 0 };
    await runScenario(
      page,
      testInfo,
      {
        scenario: 'drag-between-lists-autoscroll-1000',
        kind: 'paced',
        cpuThrottle: CPU_THROTTLE,
        workload: {
          items: ITEM_COUNT,
          pointerSteps: POINTER_STEPS,
          holdDurationMs: AUTOSCROLL_HOLD_MS,
          edgeInsetPx: 20,
          sourceIndex: 0,
          reset: 'fresh-document',
          route: '/',
        },
      },
      {
        setup: async () => {
          await perfPage.goto(`/?itemCount=${ITEM_COUNT}`);
          await expect(page.getByTestId('list-1-count')).toHaveText(String(ITEM_COUNT / 2));
          await expect(page.getByTestId('list-2-count')).toHaveText(String(ITEM_COUNT / 2));
          sourceId = await perfPage.getDraggableId('list-1', 0);
          expect(sourceId).toBe('list1-0');
          const source = await perfPage.getItemBox('list1', 0);
          const target = await perfPage.getContainerBox('list2');
          if (!source || !target) throw new Error('Missing cross-list drag source or target');
          coordinates = {
            startX: source.x + source.width / 2,
            startY: source.y + source.height / 2,
            endX: target.x + target.width / 2,
            endY: target.y + target.height - 20,
          };
          expect(await perfPage.scrollTop(TARGET_SELECTOR)).toBe(0);
        },
        run: async () => {
          const result = await perfPage.simulateDrag({
            ...coordinates,
            steps: POINTER_STEPS,
            holdDurationMs: AUTOSCROLL_HOLD_MS,
          });
          const endScrollTop = await perfPage.scrollTop(TARGET_SELECTOR);
          return {
            operations: result.operations,
            holdElapsedMs: result.holdElapsedMs,
            holdDurationMs: AUTOSCROLL_HOLD_MS,
            startScrollTop: 0,
            endScrollTop,
            scrollDistance: endScrollTop,
            completed: false,
          };
        },
        verify: async ({ workload }) => {
          expect(workload['operations']).toBe(POINTER_STEPS + 1);
          expect(Number(workload['scrollDistance'])).toBeGreaterThan(0);
          expect(Number(workload['holdElapsedMs'])).toBeGreaterThanOrEqual(AUTOSCROLL_HOLD_MS);
          await expect(page.getByTestId('vdnd-drag-preview')).not.toBeVisible();
          await expect(page.getByTestId('list-1-count')).toHaveText(String(ITEM_COUNT / 2 - 1));
          await expect(page.getByTestId('list-2-count')).toHaveText(String(ITEM_COUNT / 2 + 1));
          await expect(
            page.locator(`${TARGET_SELECTOR} [data-draggable-id="list1-0"]`),
          ).toBeInViewport();
          await expect(
            page.locator('[data-droppable-id="list-1"] [data-draggable-id="list1-0"]'),
          ).toHaveCount(0);
          await expect(page.locator('app-demo')).toHaveAttribute(
            'data-last-drop-source-index',
            '0',
          );
          Object.assign(
            workload,
            await perfPage.observeDrop({
              hostSelector: '[data-last-drop-source-index][data-last-drop-destination-index]',
              destinationDroppableId: 'list-2',
              sourceId,
            }),
          );
        },
      },
    );
  });
});
