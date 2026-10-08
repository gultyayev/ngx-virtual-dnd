import { expect, test } from '@playwright/test';
import { collectPageErrors } from './fixtures/page-errors';
import { poll } from './fixtures/polling';
import { TaskDemoPage, taskDemoSelectors } from './fixtures/task-demo.page';
import { dispatchTouch } from './fixtures/touch';

/**
 * A touch drag in the page-scroll demo with its header and "Add task" button pinned inside the
 * scroll container (`?sticky=true`) and the drag kept inside it (`?constrain=true`).
 */
test.describe('Scroll insets (Mobile)', () => {
  test('a constrained touch drag pulled up over the sticky header stays below it', async ({
    page,
  }) => {
    const pageErrors = collectPageErrors(page);
    const taskDemo = new TaskDemoPage(page);
    await taskDemo.goto('/page-scroll', { sticky: true, constrain: true });
    await expect(taskDemo.virtualContent).toHaveAttribute('data-content-offset', /^[1-9]/);
    await expect(async () => {
      await taskDemo.scrollTo(1500);
      expect(await taskDemo.getScrollTop()).toBe(1500);
    }).toPass({ timeout: 3000 });

    // The first row below the header, once the list has rendered at that scroll position
    let layout: { containerTop: number; headerBottom: number } | null = null;
    let row: { id: string; x: number; y: number } | null = null;
    await expect(async () => {
      ({ layout, row } = await page.evaluate((selectors) => {
        const container = document.querySelector(selectors.scrollContainer)!;
        const header = document.querySelector(selectors.header)!.getBoundingClientRect();
        const rows = Array.from(document.querySelectorAll<HTMLElement>(selectors.item))
          .map((el) => ({ id: el.dataset['draggableId'] ?? '', rect: el.getBoundingClientRect() }))
          .filter(({ rect }) => rect.height > 0 && rect.top >= header.bottom - 1)
          .sort((a, b) => a.rect.top - b.rect.top);
        const first = rows[0];
        return {
          layout: {
            containerTop: container.getBoundingClientRect().top,
            headerBottom: header.bottom,
          },
          row: first
            ? {
                id: first.id,
                x: first.rect.left + first.rect.width / 2,
                y: first.rect.top + first.rect.height / 2,
              }
            : null,
        };
      }, taskDemoSelectors));
      expect(row).not.toBeNull();
    }).toPass({ timeout: 3000 });
    if (!layout || !row) throw new Error('No row below the header');
    const { containerTop, headerBottom } = layout;
    const { id, x, y } = row;

    const item = page.locator(`[data-draggable-id="${id}"]`);
    await dispatchTouch(item, 'touchstart', x, y);
    // The move that starts the drag is already over the header
    await dispatchTouch(item, 'touchmove', x, (containerTop + headerBottom) / 2);
    await expect(taskDemo.dragPreview).toBeVisible();
    await dispatchTouch(item, 'touchmove', x, containerTop + 5);

    await poll(async () => {
      const box = await taskDemo.dragPreview.boundingBox();
      return (box?.y ?? Number.NaN) - headerBottom;
    }).toBeCloseTo(1, 0);

    await dispatchTouch(item, 'touchend', x, containerTop + 5);
    await expect(taskDemo.dragPreview).toBeHidden();
    expect(pageErrors.unexpected(), 'Unexpected console or page errors').toEqual([]);
  });
});
