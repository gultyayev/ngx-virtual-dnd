import { expect, test } from '@playwright/test';
import { PerfPage } from '../fixtures/perf.page';
import { runScenario } from '../fixtures/scenario';

const ITEM_COUNT = 1000;
const CPU_THROTTLE = 4;
const TARGET_INDEX = 4;
const POINTER_STEPS = 20;
const SELECTOR = '[data-droppable-id="list-1"] vdnd-virtual-scroll';

test.describe('Drag Within List Performance', () => {
  test('drag item 0 to item 4 - 1000 items', async ({ page }, testInfo) => {
    const perfPage = new PerfPage(page);
    let sourceId = '';
    let coordinates = { startX: 0, startY: 0, endX: 0, endY: 0 };
    await runScenario(
      page,
      testInfo,
      {
        scenario: 'drag-within-list-1000',
        kind: 'fixed-work',
        cpuThrottle: CPU_THROTTLE,
        workload: {
          items: ITEM_COUNT,
          sourceIndex: 0,
          destinationIndex: TARGET_INDEX,
          pointerSteps: POINTER_STEPS,
          reset: 'fresh-document',
          route: '/',
        },
      },
      {
        setup: async () => {
          await perfPage.goto(`/?itemCount=${ITEM_COUNT}`);
          await expect(page.getByTestId('list-1-count')).toHaveText(String(ITEM_COUNT / 2));
          sourceId = await perfPage.getDraggableId('list-1', 0);
          expect(sourceId).toBe('list1-0');
          const source = await perfPage.getItemBox('list1', 0);
          const target = await perfPage.getItemBox('list1', TARGET_INDEX);
          if (!source || !target) throw new Error('Missing within-list drag source or target');
          coordinates = {
            startX: source.x + source.width / 2,
            startY: source.y + source.height / 2,
            endX: target.x + target.width / 2,
            endY: target.y + target.height / 2,
          };
          const container = await perfPage.getContainerBox('list1');
          if (!container) throw new Error('Missing within-list scroll container');
          expect(coordinates.endY).toBeGreaterThan(container.y + 50);
          expect(coordinates.endY).toBeLessThan(container.y + container.height - 50);
          expect(await perfPage.scrollTop(SELECTOR)).toBe(0);
        },
        run: async () => {
          const result = await perfPage.simulateDrag({ ...coordinates, steps: POINTER_STEPS });
          const endScrollTop = await perfPage.scrollTop(SELECTOR);
          return {
            operations: result.operations,
            startScrollTop: 0,
            endScrollTop,
            scrollDistance: endScrollTop,
            completed: false,
          };
        },
        verify: async ({ workload }) => {
          expect(workload['operations']).toBe(POINTER_STEPS + 1);
          expect(workload['scrollDistance']).toBe(0);
          await expect(page.getByTestId('vdnd-drag-preview')).not.toBeVisible();
          await expect(page.locator('app-demo')).toHaveAttribute(
            'data-last-drop-source-index',
            '0',
          );
          await expect(page.locator('app-demo')).toHaveAttribute(
            'data-last-drop-destination-index',
            String(TARGET_INDEX),
          );
          await perfPage.expectRenderedOrder('list-1', [
            'list1-1',
            'list1-2',
            'list1-3',
            'list1-4',
            'list1-0',
            'list1-5',
          ]);
          await expect(page.getByTestId('list-1-count')).toHaveText(String(ITEM_COUNT / 2));
          Object.assign(
            workload,
            await perfPage.observeDrop({
              hostSelector: '[data-last-drop-source-index][data-last-drop-destination-index]',
              destinationDroppableId: 'list-1',
              sourceId,
            }),
          );
        },
      },
    );
  });
});
