import { expect, Locator, test } from '@playwright/test';
import { DemoPage } from './fixtures/demo.page';
import { afterInputHandled } from './fixtures/drag-sync';

/**
 * Long enough never to finish on its own during a test: the tests pause the animation and
 * seek it (WAAPI) to the moments they check, instead of waiting for them in real time.
 */
const DROP_MS = 60_000;

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Pause the element's animation at `progress` (0–1) and return its box at that moment. */
async function boxAt(locator: Locator, progress: number): Promise<Rect> {
  return locator.evaluate((el, fraction) => {
    const [animation] = el.getAnimations();
    const duration = Number(animation.effect?.getComputedTiming().duration ?? 0);
    animation.pause();
    animation.currentTime = duration * fraction;
    const { x, y, width, height } = el.getBoundingClientRect();
    return { x, y, width, height };
  }, progress);
}

async function finishAnimations(locator: Locator): Promise<void> {
  await locator.evaluate((el) => el.getAnimations().forEach((animation) => animation.finish()));
}

/** Current opacity, including running animations. */
async function opacity(locator: Locator): Promise<number> {
  return locator.evaluate((el) => Number(getComputedStyle(el).opacity));
}

function expectSameBox(actual: Rect, expected: Rect): void {
  expect(actual.x).toBeCloseTo(expected.x, 0);
  expect(actual.y).toBeCloseTo(expected.y, 0);
  expect(actual.width).toBeCloseTo(expected.width, 0);
  expect(actual.height).toBeCloseTo(expected.height, 0);
}

test.describe('Drop animation', () => {
  test('the preview disappears immediately on drop by default', async ({ page }) => {
    const demoPage = new DemoPage(page);
    await demoPage.goto();

    await demoPage.startKeyboardDrag('list1', 0);
    await expect(demoPage.dragPreview).toBeVisible();
    await demoPage.keyboardMoveDown();
    await afterInputHandled(page, 'keyup', () => demoPage.keyboardDrop());

    await expect(demoPage.dragPreview).toBeHidden();
    await expect(demoPage.dropGhost).toHaveCount(0);
  });

  test('the preview glides from the release point onto the dropped item', async ({ page }) => {
    const demoPage = new DemoPage(page);
    await demoPage.goto({ dropAnimation: DROP_MS });
    const draggedId = (await demoPage.getItemId('list1', 0))!;

    await demoPage.startKeyboardDrag('list1', 0);
    await expect(demoPage.dragPreview).toBeVisible();
    await demoPage.keyboardMoveDown(2);
    const releaseBox = (await demoPage.dragPreview.boundingBox())!;
    await demoPage.keyboardDrop();

    // The drop itself is not delayed: the list is already reordered
    await expect(demoPage.host).toHaveAttribute('data-last-drop-destination-index', '2');
    expect(await demoPage.getItemId('list1', 2)).toBe(draggedId);
    const dropped = demoPage.list1Container.locator(`[data-draggable-id="${draggedId}"]`);

    await expect(demoPage.dropGhost).toBeVisible();
    // The real item stays invisible while the ghost travels to it...
    expect(await opacity(dropped)).toBe(0);
    // ...the ghost starts where the drag was released...
    expectSameBox(await boxAt(demoPage.dropGhost, 0), releaseBox);
    // ...and lands exactly on the dropped item.
    expectSameBox(await boxAt(demoPage.dropGhost, 1), (await dropped.boundingBox())!);

    await finishAnimations(demoPage.dropGhost);
    await expect(demoPage.dropGhost).toHaveCount(0);
    expect(await opacity(dropped)).toBe(1);
  });

  test('a pointer drop into another list lands on the item there', async ({ page }) => {
    const demoPage = new DemoPage(page);
    await demoPage.goto({ dropAnimation: DROP_MS });
    const draggedId = (await demoPage.getItemId('list1', 0))!;

    await demoPage.dragItemToList('list1', 0, 'list2', 1);

    await expect(demoPage.host).toHaveAttribute('data-last-drop-destination-index', '1');
    const dropped = demoPage.list2Container.locator(`[data-draggable-id="${draggedId}"]`);
    await expect(demoPage.dropGhost).toBeVisible();
    expectSameBox(await boxAt(demoPage.dropGhost, 1), (await dropped.boundingBox())!);

    await finishAnimations(demoPage.dropGhost);
    await expect(demoPage.dropGhost).toHaveCount(0);
  });

  test('a cancelled drag glides back to the original slot', async ({ page }) => {
    const demoPage = new DemoPage(page);
    await demoPage.goto({ dropAnimation: DROP_MS });
    const original = demoPage.list1Items.nth(0);
    const originalBox = (await original.boundingBox())!;

    await demoPage.startKeyboardDrag('list1', 0);
    await expect(demoPage.dragPreview).toBeVisible();
    await demoPage.keyboardMoveDown(3);
    await demoPage.keyboardCancel();

    await expect(demoPage.dropGhost).toBeVisible();
    expectSameBox(await boxAt(demoPage.dropGhost, 1), originalBox);
    await finishAnimations(demoPage.dropGhost);
    await expect(demoPage.dropGhost).toHaveCount(0);
  });

  test('starting a new drag cuts the drop animation short', async ({ page }) => {
    const demoPage = new DemoPage(page);
    await demoPage.goto({ dropAnimation: DROP_MS });
    const draggedId = (await demoPage.getItemId('list1', 0))!;

    await demoPage.startKeyboardDrag('list1', 0);
    await expect(demoPage.dragPreview).toBeVisible();
    await demoPage.keyboardMoveDown();
    await demoPage.keyboardDrop();
    await expect(demoPage.dropGhost).toBeVisible();

    await demoPage.startKeyboardDrag('list1', 3);
    await expect(demoPage.dragPreview).toBeVisible();
    await expect(demoPage.dropGhost).toHaveCount(0);
    // The previously dropped item is revealed right away
    const dropped = demoPage.list1Container.locator(`[data-draggable-id="${draggedId}"]`);
    expect(await opacity(dropped)).toBe(1);

    await demoPage.keyboardCancel();
  });
});
