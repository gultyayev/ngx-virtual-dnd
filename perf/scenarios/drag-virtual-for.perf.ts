import { expect, test } from '@playwright/test';
import { PerfPage } from '../fixtures/perf.page';
import { runScenario } from '../fixtures/scenario';

const CPU_THROTTLE = 4;
const TARGET_INDEX = 4;
const POINTER_STEPS = 20;
const SELECTOR = '[data-droppable-id="viewport-a"]';

test.describe('Drag Within *vdndVirtualFor List Performance', () => {
  test('drag row 0 to row 4 in a vdnd-virtual-viewport list', async ({ page }, testInfo) => {
    const perfPage = new PerfPage(page);
    let sourceId = '';
    let coordinates = { startX: 0, startY: 0, endX: 0, endY: 0 };
    await runScenario(
      page,
      testInfo,
      {
        scenario: 'drag-within-virtual-for-list',
        kind: 'fixed-work',
        cpuThrottle: CPU_THROTTLE,
        workload: {
          items: 60,
          sourceIndex: 0,
          destinationIndex: TARGET_INDEX,
          pointerSteps: POINTER_STEPS,
          reset: 'fresh-document',
          route: '/virtual-viewport',
        },
      },
      {
        setup: async () => {
          await perfPage.goto('/virtual-viewport');
          sourceId = await perfPage.getDraggableId('viewport-a', 0);
          expect(sourceId).toBe('a-1');
          const source = await perfPage.getDraggableBox('viewport-a', 0);
          const target = await perfPage.getDraggableBox('viewport-a', TARGET_INDEX);
          if (!source || !target) throw new Error('Missing virtual-for drag source or target');
          coordinates = {
            startX: source.x + source.width / 2,
            startY: source.y + source.height / 2,
            endX: target.x + target.width / 2,
            endY: target.y + target.height / 2,
          };
          const container = await page.locator(SELECTOR).boundingBox();
          if (!container) throw new Error('Missing virtual-for scroll container');
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
          await expect(page.getByTestId('viewport-demo')).toHaveAttribute(
            'data-last-drop-source-index',
            '0',
          );
          await expect(page.getByTestId('viewport-demo')).toHaveAttribute(
            'data-last-drop-destination-index',
            String(TARGET_INDEX),
          );
          await perfPage.expectRenderedOrder('viewport-a', [
            'a-2',
            'a-3',
            'a-4',
            'a-5',
            'a-1',
            'a-6',
          ]);
          await expect(page.getByTestId('viewport-a-count')).toHaveText('60');
          Object.assign(
            workload,
            await perfPage.observeDrop({
              hostSelector: '[data-testid="viewport-demo"]',
              destinationDroppableId: 'viewport-a',
              sourceId,
            }),
          );
        },
      },
    );
  });
});
