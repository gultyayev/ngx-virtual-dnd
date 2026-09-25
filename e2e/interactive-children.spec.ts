import { expect, test } from '@playwright/test';

/**
 * Controls inside a draggable keep their own behavior. Fixture: /interactive-children, a plain
 * list whose rows hold a text field, a radio group and a button.
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
});
