import { expect, test } from '@playwright/test';
import { ExamplesPage } from './fixtures/examples.page';

/**
 * The docs site embeds these pages as live examples and shows their source verbatim,
 * so they must keep working exactly as documented.
 */
test.describe('Docs live examples', () => {
  let examples: ExamplesPage;

  test.beforeEach(({ page }) => {
    examples = new ExamplesPage(page);
  });

  test('quick start virtualizes 1,000 items and reorders by drag', async () => {
    await examples.goto('quick-start');

    const before = await examples.renderedIds('backlog');
    expect(before[0]).toBe('task-1');
    // Only the visible rows plus overscan are in the DOM.
    expect(before.length).toBeLessThan(30);

    const list = await examples.droppable('backlog').boundingBox();
    if (!list) throw new Error('No bounding box for the list');
    // Release over the third row slot: task-1 moves below task-2 and task-3.
    await examples.dragTo('task-1', list.x + list.width / 2, list.y + 48 * 2.5, 'backlog');

    await expect
      .poll(async () => (await examples.renderedIds('backlog')).slice(0, 3))
      .toEqual(['task-2', 'task-3', 'task-1']);
  });

  test('multiple lists move an item across lists', async ({ page }) => {
    await examples.goto('multiple-lists');

    const todoHeading = page.getByRole('heading', { name: /^To do/ });
    const doneHeading = page.getByRole('heading', { name: /^Done/ });
    await expect(todoHeading).toContainText('200');
    await expect(doneHeading).toContainText('200');

    const done = await examples.droppable('done').boundingBox();
    if (!done) throw new Error('No bounding box for the done list');
    await examples.dragTo('todo-1', done.x + done.width / 2, done.y + 24, 'done');

    await expect(todoHeading).toContainText('199');
    await expect(doneHeading).toContainText('201');
    await expect(examples.droppable('done').locator('[data-draggable-id="todo-1"]')).toBeVisible();
    await expect(examples.droppable('todo').locator('[data-draggable-id="todo-1"]')).toHaveCount(0);
  });

  test('drag handle: only the handle starts a drag', async ({ page }) => {
    await examples.goto('drag-handle');

    const row = examples.draggable('track-1');
    const rowBox = await row.boundingBox();
    if (!rowBox) throw new Error('No bounding box for the row');
    const before = await examples.renderedIds('playlist');

    // Pressing the row outside the handle does not start a drag, even after a long move.
    const startX = rowBox.x + rowBox.width - 40;
    const startY = rowBox.y + rowBox.height / 2;
    await examples.pressAndMove(startX, startY);
    await page.mouse.move(startX, startY + 120, { steps: 10 });
    await examples.settleFrames();
    expect(await examples.isDragging()).toBe(false);
    await expect(examples.dragPreview).toBeHidden();
    await page.mouse.up();
    expect(await examples.renderedIds('playlist')).toEqual(before);

    // Pressing the handle does.
    const handleBox = await row.locator('[data-drag-handle]').boundingBox();
    if (!handleBox) throw new Error('No bounding box for the handle');
    await examples.pressAndMove(
      handleBox.x + handleBox.width / 2,
      handleBox.y + handleBox.height / 2,
    );
    await expect(examples.dragPreview).toBeVisible({ timeout: 2000 });
    expect(await examples.isDragging()).toBe(true);
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await expect(examples.dragPreview).toBeHidden();
  });

  test('dynamic height renders rows of different heights', async ({ page }) => {
    await examples.goto('dynamic-height');

    await expect(async () => {
      const heights = await page
        .locator('[data-droppable-id="notes"] [data-draggable-id]')
        .evaluateAll((rows) => rows.map((row) => Math.round(row.getBoundingClientRect().height)));
      expect(new Set(heights).size).toBeGreaterThan(1);
    }).toPass({ timeout: 2000 });
  });

  test('shift animation slides displaced rows and counts placeholder moves', async ({ page }) => {
    // The slide is skipped under reduced motion; pin it so the host OS setting cannot leak in.
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await examples.goto('shift-animation');
    const moves = page.locator('[data-placeholder-moves]');
    await expect(moves).toHaveText('0');

    await examples.draggable('task-1').focus();
    await page.keyboard.press('Space');
    await expect(examples.dragPreview).toBeVisible();
    // Picking up does not move the placeholder.
    await expect(moves).toHaveText('0');

    // Record which rows start an animation (the 200 ms slide is too short to poll reliably).
    await page.evaluate(() => {
      const animated: string[] = [];
      (window as unknown as { animatedRows: string[] }).animatedRows = animated;
      const animate = Element.prototype.animate;
      Element.prototype.animate = function (this: HTMLElement, ...args) {
        animated.push(this.dataset['draggableId'] ?? '');
        return animate.apply(this, args);
      };
    });

    await page.keyboard.press('ArrowDown');
    await expect(moves).toHaveText('1');
    await expect(page.locator('[data-last-placeholder-move]')).toHaveText('0 → 1');
    // task-2 was displaced by the placeholder and slides into its new slot.
    await expect
      .poll(() =>
        page.evaluate(() => (window as unknown as { animatedRows: string[] }).animatedRows),
      )
      .toContain('task-2');

    await page.keyboard.press('Escape');
    await expect(examples.dragPreview).toBeHidden();
    expect((await examples.renderedIds('tasks')).slice(0, 2)).toEqual(['task-1', 'task-2']);
  });

  test('?theme=dark applies the dark theme without persisting it', async ({ page }) => {
    // Same URL shape as the docs' <LiveDemo> iframe (trailing slash + query).
    await page.goto('/examples/quick-start/?theme=dark', { waitUntil: 'domcontentloaded' });
    await expect(examples.draggable('task-1')).toBeVisible();

    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    expect(await page.evaluate(() => localStorage.getItem('vdnd-theme'))).toBeNull();
  });
});
