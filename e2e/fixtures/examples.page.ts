import { expect, Locator, Page } from '@playwright/test';
import { settleDragPosition, waitForActiveDroppable } from './drag-sync';

export type ExampleSlug = 'quick-start' | 'multiple-lists' | 'drag-handle' | 'dynamic-height';

/**
 * Page object for the docs live examples (`/examples/<slug>`), which the docs site embeds
 * in iframes. Each page is a minimal, copy-pasteable use of the library.
 */
export class ExamplesPage {
  readonly page: Page;
  readonly dragPreview: Locator;

  constructor(page: Page) {
    this.page = page;
    this.dragPreview = page.getByTestId('vdnd-drag-preview');
  }

  async goto(slug: ExampleSlug, query = ''): Promise<void> {
    await this.page.goto(`/examples/${slug}${query}`, { waitUntil: 'domcontentloaded' });
    await expect(this.page.locator('[data-draggable-id]').first()).toBeVisible();
  }

  droppable(droppableId: string): Locator {
    return this.page.locator(`[data-droppable-id="${droppableId}"]`);
  }

  draggable(draggableId: string): Locator {
    return this.page.locator(`[data-draggable-id="${draggableId}"]`);
  }

  /** IDs of the rendered (visible + overscan) draggables in a droppable, in visual order. */
  async renderedIds(droppableId: string): Promise<string[]> {
    return this.droppable(droppableId).evaluate((container) =>
      Array.from(container.querySelectorAll<HTMLElement>('[data-draggable-id]'))
        .filter((el) => el.offsetParent !== null)
        .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)
        .map((el) => el.dataset['draggableId'] ?? ''),
    );
  }

  /** `isDragging` as processed by the drag scheduler (hidden drag-state-debug element). */
  async isDragging(): Promise<boolean> {
    const raw = await this.page.getByTestId('drag-state-debug').textContent();
    return (JSON.parse(raw ?? '{}') as { isDragging?: boolean }).isDragging === true;
  }

  /** Wait for two animation frames so any pending drag start would have been processed. */
  async settleFrames(): Promise<void> {
    await this.page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve(undefined))),
        ),
    );
  }

  /** Press on (x, y) and move past the drag threshold. Does not assert that a drag started. */
  async pressAndMove(x: number, y: number): Promise<void> {
    await this.page.mouse.move(x, y);
    await this.page.mouse.down();
    await this.page.mouse.move(x + 10, y + 10, { steps: 2 });
  }

  /**
   * Drag a row by its centre to (targetX, targetY) and release once the scheduler has
   * processed the release point over `targetDroppableId` (see e2e/fixtures/drag-sync.ts).
   */
  async dragTo(
    draggableId: string,
    targetX: number,
    targetY: number,
    targetDroppableId: string,
  ): Promise<void> {
    const source = this.draggable(draggableId);
    const box = await source.boundingBox();
    if (!box) throw new Error(`No bounding box for draggable ${draggableId}`);

    await this.pressAndMove(box.x + box.width / 2, box.y + box.height / 2);
    await expect(this.dragPreview).toBeVisible({ timeout: 2000 });

    await this.page.mouse.move(targetX, targetY, { steps: 15 });
    await settleDragPosition(this.page, targetX, targetY);
    await waitForActiveDroppable(this.page, targetDroppableId);
    await this.page.mouse.up();
    await expect(this.dragPreview).not.toBeVisible({ timeout: 2000 });
  }
}
