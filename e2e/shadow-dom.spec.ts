import { expect, Locator, Page, test } from '@playwright/test';
import { collectPageErrors } from './fixtures/page-errors';
import {
  settleDragPosition,
  waitForActiveDroppable,
  waitForAutoscroll,
} from './fixtures/drag-sync';

/**
 * Issue #36: lists, items and the drag preview rendered inside an open shadow root
 * (`ViewEncapsulation.ShadowDom`). Playwright's CSS locators pierce open shadow roots.
 */
test.describe('Lists inside an open shadow root', () => {
  let errors: ReturnType<typeof collectPageErrors>;

  const list = (page: Page, id: string): Locator => page.locator(`[data-droppable-id="${id}"]`);
  const items = (page: Page, id: string): Locator => list(page, id).locator('[data-draggable-id]');
  const scroller = (page: Page, id: string): Locator =>
    list(page, id).locator('vdnd-virtual-scroll');
  const preview = (page: Page): Locator => page.getByTestId('vdnd-drag-preview');

  async function startDrag(page: Page, item: Locator): Promise<void> {
    const box = await item.boundingBox();
    if (!box) throw new Error('The drag source has no bounding box');
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 10, y + 10, { steps: 2 });
    await expect(preview(page), 'The drag should start').toBeVisible({ timeout: 2000 });
  }

  test.beforeEach(async ({ page }) => {
    errors = collectPageErrors(page);
    await page.goto('/shadow-dom', { waitUntil: 'domcontentloaded' });
    await expect(items(page, 'shadow-todo').first()).toBeVisible();
    await expect(items(page, 'shadow-done').first()).toBeVisible();
  });

  test.afterEach(() => {
    expect(errors.unexpected()).toEqual([]);
  });

  test('renders the lists inside the shadow root', async ({ page }) => {
    const insideShadowRoot = await list(page, 'shadow-todo').evaluate(
      (el) => el.getRootNode() instanceof ShadowRoot,
    );
    expect(insideShadowRoot).toBe(true);
  });

  test('moves an item to the other list with the pointer', async ({ page }) => {
    const movedId = await items(page, 'shadow-todo').first().getAttribute('data-draggable-id');

    await startDrag(page, items(page, 'shadow-todo').first());
    // The preview is teleported out of the shadow root, to the page's overlay container
    await expect(
      page.locator('body > .vdnd-overlay-container [data-testid="vdnd-drag-preview"]'),
    ).toBeVisible();

    const target = items(page, 'shadow-done').nth(1);
    const box = await target.boundingBox();
    if (!box) throw new Error('The drop target has no bounding box');
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2 + 4;
    await page.mouse.move(x, y, { steps: 10 });
    await settleDragPosition(page, x, y);
    await waitForActiveDroppable(page, 'shadow-done');
    // The placeholder renders inside the target list, in the shadow root
    await expect(list(page, 'shadow-done').locator('.vdnd-drag-placeholder-visible')).toHaveCount(
      1,
    );
    const debug = JSON.parse((await page.getByTestId('drag-state-debug').textContent()) ?? '{}');
    const placeholderIndex = debug.placeholderIndex as number;
    expect([1, 2]).toContain(placeholderIndex);
    await page.mouse.up();

    await expect(page.getByTestId('shadow-todo-count')).toHaveText('49');
    await expect(page.getByTestId('shadow-done-count')).toHaveText('51');
    // The list is scrolled to the top, so the rendered rows start at index 0
    await expect(items(page, 'shadow-done').nth(placeholderIndex)).toHaveAttribute(
      'data-draggable-id',
      movedId!,
    );
  });

  test('reorders a list with the keyboard and keeps focus on the moved item', async ({ page }) => {
    const first = items(page, 'shadow-todo').first();
    const movedId = await first.getAttribute('data-draggable-id');

    await first.focus();
    await page.keyboard.press('Space');
    await expect(preview(page)).toBeVisible();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Space');

    await expect(preview(page)).not.toBeVisible();
    const moved = items(page, 'shadow-todo').nth(2);
    await expect(moved).toHaveAttribute('data-draggable-id', movedId!);
    await expect(moved).toBeFocused();
  });

  test('autoscrolls a list inside the shadow root', async ({ page }) => {
    await startDrag(page, items(page, 'shadow-todo').first());

    const box = await scroller(page, 'shadow-todo').boundingBox();
    if (!box) throw new Error('The list has no bounding box');
    const x = box.x + box.width / 2;
    const y = box.y + box.height - 25;
    await page.mouse.move(x, y, { steps: 10 });
    await page.mouse.move(x, y);

    await waitForAutoscroll(scroller(page, 'shadow-todo'), 'down', 300);
    await page.mouse.up();
    await expect(preview(page)).not.toBeVisible();
  });
});
