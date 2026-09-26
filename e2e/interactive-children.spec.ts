import { expect, test } from '@playwright/test';
import { afterInputHandled } from './fixtures/drag-sync';

/**
 * Controls inside a draggable keep their own behavior, presses inside a `no-drag` element never
 * start a drag, and the default drag preview (a clone of the row) must not change the controls'
 * state. Fixture: /interactive-children, a plain list whose rows hold a text field, a radio
 * group, a `no-drag` tag and a button.
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
});
