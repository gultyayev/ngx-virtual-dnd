import { expect, Page, test } from '@playwright/test';
import {
  afterInputHandled,
  settleDragPosition,
  waitForActiveDroppable,
} from './fixtures/drag-sync';

/** IDs of the rows of a list, in page order */
function rowIds(page: Page, listId: string): Promise<(string | null)[]> {
  return page
    .locator(`[data-droppable-id="${listId}"] [data-draggable-id]`)
    .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-draggable-id')));
}

/** Drag a list's first row by the pointer and drop it below its last row. */
async function dragFirstRowToEnd(page: Page, listId: string, ids: string[]): Promise<void> {
  const list = page.locator(`[data-droppable-id="${listId}"]`);
  await list.scrollIntoViewIfNeeded();
  const source = await list.locator(`[data-draggable-id="${ids[0]}"]`).boundingBox();
  if (!source) throw new Error('Could not get source row bounding box');
  const x = source.x + source.width / 2;
  const y = source.y + source.height / 2;

  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + 10, { steps: 2 });
  await expect(page.getByTestId('vdnd-drag-preview')).toBeVisible();

  // Measured after the drag starts: the dragged row is hidden, and these plain lists render no
  // placeholder, so the rows below it have moved up
  const target = await list.locator(`[data-draggable-id="${ids[ids.length - 1]}"]`).boundingBox();
  if (!target) throw new Error('Could not get target row bounding box');
  const targetY = target.y + target.height * 0.75;
  await page.mouse.move(x, targetY, { steps: 10 });
  await settleDragPosition(page, x, targetY);
  await waitForActiveDroppable(page, listId);
  await page.mouse.up();
}

/**
 * Controls inside a draggable keep their own behavior, presses inside a `no-drag` element never
 * start a drag, and the default drag preview (a clone of the row) must not change the controls'
 * state. Only controls inside a row count: a row inside a contenteditable region or a row that
 * is a button itself drags. Fixture: /interactive-children, a plain list whose rows hold a text
 * field, a radio group, a `no-drag` tag and a button, a list inside a contenteditable region, a
 * list of button rows and a list of rows that are their own editing host, dragged by a grip.
 */
test.describe('Interactive children', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/interactive-children', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-draggable-id="row-1"]')).toBeVisible();
  });

  test('Space typed into a text field inside a row goes into the field', async ({ page }) => {
    const row = page.locator('[data-draggable-id="row-1"]');
    const note = row.getByTestId('row-note');

    await note.click();
    await page.keyboard.type('a b');

    await expect(note).toHaveValue('a b');
    await expect(row).toHaveAttribute('aria-grabbed', 'false');
    await expect(page.getByTestId('vdnd-drag-preview')).toBeHidden();
  });

  test('Space on a button inside a row clicks the button', async ({ page }) => {
    const row = page.locator('[data-draggable-id="row-1"]');

    await row.getByTestId('row-button').focus();
    await page.keyboard.press('Space');

    await expect(row.getByTestId('row-clicks')).toHaveText('1');
    await expect(row).toHaveAttribute('aria-grabbed', 'false');
    await expect(page.getByTestId('vdnd-drag-preview')).toBeHidden();
  });

  test('pressing inside a no-drag element in a row does not start a drag', async ({ page }) => {
    const row = page.locator('[data-draggable-id="row-1"]');
    const label = row.getByTestId('row-no-drag-label');
    const box = await label.boundingBox();
    if (!box) throw new Error('Could not get no-drag label bounding box');
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;

    // The press lands on the tag's child, not on the no-drag element itself
    await page.mouse.move(x, y);
    await page.mouse.down();
    await afterInputHandled(page, 'mousemove', () => page.mouse.move(x + 30, y + 30));

    await expect(page.getByTestId('vdnd-drag-preview')).toBeHidden();
    await expect(row).toHaveAttribute('aria-grabbed', 'false');
    await page.mouse.up();
  });

  test('dragging a row keeps its selected radio checked', async ({ page }) => {
    const row = page.locator('[data-draggable-id="row-1"]');
    const preview = page.getByTestId('vdnd-drag-preview');
    const high = row.getByTestId('row-priority-high');
    await expect(high).toBeChecked();

    // Press on the row's name (not a control) and move past the drag threshold
    const name = row.getByTestId('row-name');
    const box = await name.boundingBox();
    if (!box) throw new Error('Could not get row name bounding box');
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;

    await name.hover();
    await page.mouse.down();
    await page.mouse.move(x + 10, y + 10, { steps: 2 });
    // The preview is a clone of the row, radio buttons included
    await expect(preview).toBeVisible();

    await page.mouse.move(x, y);
    await page.mouse.up();
    await expect(preview).toBeHidden();

    await expect(high).toBeChecked();
    await expect(row.getByTestId('row-priority-low')).not.toBeChecked();
  });

  test('a row inside a contenteditable region drags with the pointer', async ({ page }) => {
    await expect(page.getByTestId('editor')).toHaveAttribute('contenteditable', 'true');

    await dragFirstRowToEnd(page, 'blocks', ['block-1', 'block-2', 'block-3']);

    await expect(async () => {
      expect(await rowIds(page, 'blocks')).toEqual(['block-2', 'block-3', 'block-1']);
    }).toPass();
  });

  test('a row that is a button drags with the pointer', async ({ page }) => {
    await dragFirstRowToEnd(page, 'buttons', ['button-1', 'button-2', 'button-3']);

    await expect(async () => {
      expect(await rowIds(page, 'buttons')).toEqual(['button-2', 'button-3', 'button-1']);
    }).toPass();
  });

  test('Space typed into an editable row goes into its text', async ({ page }) => {
    const row = page.locator('[data-draggable-id="editable-block-1"]');
    const text = row.getByTestId('block-text');
    await row.scrollIntoViewIfNeeded();

    // The press places the caret instead of starting a drag
    await text.click();
    await page.keyboard.press('End');
    await page.keyboard.type('x y');

    await expect(text).toContainText('x y');
    await expect(row).toHaveAttribute('aria-grabbed', 'false');
    await expect(page.getByTestId('vdnd-drag-preview')).toBeHidden();
  });

  test('Space on the grip of an editable row picks the row up', async ({ page }) => {
    const row = page.locator('[data-draggable-id="editable-block-1"]');

    await row.getByTestId('block-grip').focus();
    await page.keyboard.press('Space');

    await expect(page.getByTestId('vdnd-drag-preview')).toBeVisible();
    await expect(row).toHaveAttribute('aria-grabbed', 'true');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('vdnd-drag-preview')).toBeHidden();
  });

  test('an editable row drags with the pointer by its grip', async ({ page }) => {
    const list = page.locator('[data-droppable-id="editable-blocks"]');
    await list.scrollIntoViewIfNeeded();
    const grip = await list
      .locator('[data-draggable-id="editable-block-1"]')
      .getByTestId('block-grip')
      .boundingBox();
    if (!grip) throw new Error('Could not get grip bounding box');
    const x = grip.x + grip.width / 2;
    const y = grip.y + grip.height / 2;

    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + 10, { steps: 2 });
    await expect(page.getByTestId('vdnd-drag-preview')).toBeVisible();

    // Dropped below the last row, measured once the dragged row is hidden
    const target = await list.locator('[data-draggable-id="editable-block-3"]').boundingBox();
    if (!target) throw new Error('Could not get target row bounding box');
    const targetY = target.y + target.height * 0.75;
    await page.mouse.move(x, targetY, { steps: 10 });
    await settleDragPosition(page, x, targetY);
    await waitForActiveDroppable(page, 'editable-blocks');
    await page.mouse.up();

    await expect(async () => {
      expect(await rowIds(page, 'editable-blocks')).toEqual([
        'editable-block-2',
        'editable-block-3',
        'editable-block-1',
      ]);
    }).toPass();
  });

  test('Space on a row that is a button picks it up', async ({ page }) => {
    const row = page.locator('[data-draggable-id="button-1"]');

    await row.focus();
    await page.keyboard.press('Space');

    await expect(page.getByTestId('vdnd-drag-preview')).toBeVisible();
    await expect(row).toHaveAttribute('aria-grabbed', 'true');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('vdnd-drag-preview')).toBeHidden();
  });
});
