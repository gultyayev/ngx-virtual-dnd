import { expect, Locator, Page } from '@playwright/test';
import { settleDragPosition, waitForActiveDroppable } from './drag-sync';

export type ListName = 'list1' | 'list2';

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Initial main-demo settings, applied through URL params (see DemoComponent). Tests start from
 * the state they need instead of clicking through the settings panel; use the panel only when
 * the test is about changing a setting at runtime.
 */
export interface DemoSettings {
  /** Total items, split between both lists (default 100) */
  itemCount?: number;
  lockAxis?: 'x' | 'y';
  dragEnabled?: boolean;
  dragDelay?: number;
  dragHandle?: boolean;
  api?: 'simplified' | 'verbose';
  constrainToContainer?: boolean;
  list2Disabled?: boolean;
  /** Shift animation duration in ms */
  shiftAnimation?: number;
}

export class DemoPage {
  readonly page: Page;
  readonly list1Container: Locator;
  readonly list2Container: Locator;
  readonly list1Items: Locator;
  readonly list2Items: Locator;
  readonly dragPreview: Locator;
  readonly list1VirtualScroll: Locator;
  readonly list2VirtualScroll: Locator;
  readonly settingsCollapse: Locator;
  readonly lockAxisSelect: Locator;
  readonly placeholder: Locator;
  /** Demo host element, which mirrors the last drag events in data-last-* attributes */
  readonly host: Locator;

  constructor(page: Page) {
    this.page = page;
    this.list1Container = page.locator('[data-droppable-id="list-1"]');
    this.list2Container = page.locator('[data-droppable-id="list-2"]');
    this.list1VirtualScroll = this.list1Container.locator('[data-item-height]').first();
    this.list2VirtualScroll = this.list2Container.locator('[data-item-height]').first();
    this.list1Items = this.list1Container.locator('[data-draggable-id]');
    this.list2Items = this.list2Container.locator('[data-draggable-id]');
    // Use data-testid for library components (stable selectors)
    this.dragPreview = page.getByTestId('vdnd-drag-preview');
    this.settingsCollapse = page.getByTestId('settings-collapse');
    this.lockAxisSelect = page.getByTestId('lock-axis-select');
    // Placeholder visible class is a documented public API for styling, making it a stable selector
    this.placeholder = page.locator('.vdnd-drag-placeholder-visible');
    this.host = page.locator('app-demo');
  }

  async goto(settings: DemoSettings = {}): Promise<void> {
    const params = new URLSearchParams();
    for (const [name, value] of Object.entries(settings)) {
      params.set(name, String(value));
    }
    const query = params.size > 0 ? `?${params}` : '';
    await this.page.goto(`/${query}`, { waitUntil: 'domcontentloaded' });
    // Wait for items to be rendered using auto-waiting assertion
    await expect(this.list1Items.first()).toBeVisible();
    // Fail fast instead of flaking: an animating settings panel shifts both lists while tests
    // read geometry. The demo only animates the panel when the user toggles it.
    expect(
      await this.settingsCollapse.evaluate((element) => element.getAnimations().length),
      'The settings panel must not animate on page load',
    ).toBe(0);
    // Center the lists in the viewport (the hero and settings panel push them down)
    await this.list1Container.evaluate((el) =>
      el.scrollIntoView({ block: 'center', inline: 'nearest' }),
    );
  }

  /**
   * Switch the API mode at runtime through the settings panel. To START in simplified mode, use
   * `goto({ api: 'simplified' })` instead.
   */
  async enableSimplifiedApi(): Promise<void> {
    const simplifiedButton = this.page.getByTestId('simplified-api-checkbox');
    await simplifiedButton.click();
    // The old (verbose) lists satisfy every check below, so first wait for the render that swaps
    // the trees: aria-pressed updates in the same change detection pass as the @if swap
    await expect(simplifiedButton).toHaveAttribute('aria-pressed', 'true');
    // Wait for items to render in the new component tree
    await expect(this.list1Items.first()).toBeVisible();
    // The @if template swap destroys and recreates scroll containers.
    // Items can be visible before the virtual scroll computes its content height.
    // Verify BOTH scroll areas are ready (scrollHeight > containerHeight of 400px).
    await expect(async () => {
      const h1 = await this.list1VirtualScroll.evaluate((el) => el.scrollHeight);
      const h2 = await this.list2VirtualScroll.evaluate((el) => el.scrollHeight);
      expect(h1).toBeGreaterThan(400);
      expect(h2).toBeGreaterThan(400);
    }).toPass({ timeout: 2000 });
  }

  items(list: ListName): Locator {
    return list === 'list1' ? this.list1Items : this.list2Items;
  }

  container(list: ListName): Locator {
    return list === 'list1' ? this.list1Container : this.list2Container;
  }

  virtualScroll(list: ListName): Locator {
    return list === 'list1' ? this.list1VirtualScroll : this.list2VirtualScroll;
  }

  /**
   * The list's item-count badge: its logical size (virtual scroll renders only part of it).
   * Assert with `toHaveText()` so the check waits for the render after a drop.
   */
  countBadge(list: ListName): Locator {
    return this.page.getByTestId(list === 'list1' ? 'list-1-count' : 'list-2-count');
  }

  async getItemCount(list: ListName): Promise<number> {
    const text = await this.countBadge(list).textContent();
    const count = Number.parseInt(text?.trim() ?? '', 10);
    if (Number.isNaN(count)) {
      throw new Error(`Item count badge of ${list} shows "${text}"`);
    }
    return count;
  }

  /**
   * Text of the rendered item at `index` (DOM order). Both lists are named "Item 1…Item N", so
   * compare `getItemId()` instead when an item may have moved between lists.
   */
  async getItemText(list: ListName, index: number): Promise<string> {
    const text = await this.items(list).nth(index).textContent();
    return text?.trim() ?? '';
  }

  /** `data-draggable-id` of the rendered item at `index` (DOM order), e.g. `list1-0`. */
  async getItemId(list: ListName, index: number): Promise<string | null> {
    return this.items(list).nth(index).getAttribute('data-draggable-id');
  }

  /** `data-draggable-id` of every rendered item, in DOM order, read in one round trip. */
  async getItemIds(list: ListName): Promise<(string | null)[]> {
    return this.items(list).evaluateAll((items) =>
      items.map((item) => item.getAttribute('data-draggable-id')),
    );
  }

  /**
   * Logical index of the rendered item `id` in a fixed-height list (from its offset in the
   * scroll content), or null when it is not rendered. Works wherever the list is scrolled.
   */
  async getRenderedIndexOf(list: ListName, id: string): Promise<number | null> {
    return this.virtualScroll(list).evaluate((container, draggableId) => {
      const item = container.querySelector(`[data-draggable-id="${draggableId}"]`);
      if (!item) return null;
      const itemHeight = Number(container.getAttribute('data-item-height'));
      const contentTop =
        item.getBoundingClientRect().top -
        container.getBoundingClientRect().top +
        container.scrollTop;
      return Math.round(contentTop / itemHeight);
    }, id);
  }

  /**
   * Whether the rendered items cover the list's whole visible area (no blank band at the top
   * or bottom), which a virtual list must maintain after scrolling or resizing.
   */
  async coversVisibleArea(list: ListName): Promise<boolean> {
    return this.virtualScroll(list).evaluate((container) => {
      const view = container.getBoundingClientRect();
      const rects = Array.from(container.querySelectorAll('[data-draggable-id]'))
        .map((item) => item.getBoundingClientRect())
        .filter((rect) => rect.height > 0);
      if (rects.length === 0) return false;
      const top = Math.min(...rects.map((rect) => rect.top));
      const bottom = Math.max(...rects.map((rect) => rect.bottom));
      const contentBottom = view.top - container.scrollTop + container.scrollHeight;
      return top <= view.top + 1 && bottom >= Math.min(view.bottom, contentBottom) - 1;
    });
  }

  /** Whether the visible placeholder lies fully inside the list's visible scroll area. */
  async isPlaceholderInView(list: ListName): Promise<boolean> {
    return this.virtualScroll(list).evaluate((container) => {
      const placeholder = container.querySelector('.vdnd-drag-placeholder-visible');
      if (!placeholder) return false;
      const rect = placeholder.getBoundingClientRect();
      const view = container.getBoundingClientRect();
      return rect.top >= view.top - 1 && rect.bottom <= view.bottom + 1;
    });
  }

  /**
   * Press on the center of `source`, move past the drag threshold and wait for the preview.
   *
   * One attempt only: a drag that does not start is a failure (E2E.md rule #5), not something to
   * retry. Returns the press point.
   */
  async startDrag(source: Locator | Box): Promise<{ x: number; y: number }> {
    let box: Box | null;
    if ('boundingBox' in source) {
      await source.scrollIntoViewIfNeeded();
      box = await source.boundingBox();
    } else {
      box = source;
    }
    if (!box) {
      throw new Error('startDrag: the drag source has no bounding box');
    }

    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await this.page.mouse.move(x, y);
    await this.page.mouse.down();
    await this.page.mouse.move(x + 10, y + 10, { steps: 2 });
    await expect(this.dragPreview, 'The drag should start').toBeVisible({ timeout: 2000 });
    return { x, y };
  }

  /**
   * Box of the last item that is visible inside both the list's scroll container and the
   * viewport, clipped to its visible part (a safe grab point after programmatic scrolling).
   */
  async getLastVisibleItemBox(list: ListName): Promise<Box | null> {
    return this.virtualScroll(list).evaluate((container) => {
      const containerRect = container.getBoundingClientRect();
      const viewportBottom = window.innerHeight;
      let lastVisible: { x: number; y: number; width: number; height: number } | null = null;
      for (const item of container.querySelectorAll('[data-draggable-id]')) {
        const rect = item.getBoundingClientRect();
        const visibleTop = Math.max(rect.top, containerRect.top, 0);
        const visibleBottom = Math.min(rect.bottom, containerRect.bottom, viewportBottom);
        const visibleHeight = visibleBottom - visibleTop;
        if (visibleHeight > 10 && rect.width > 0) {
          lastVisible = { x: rect.x, y: visibleTop, width: rect.width, height: visibleHeight };
        }
      }
      return lastVisible;
    });
  }

  async dragItemToList(
    sourceList: ListName,
    itemIndex: number,
    targetList: ListName,
    targetIndex: number,
  ): Promise<void> {
    const sourceItem = this.items(sourceList).nth(itemIndex);
    const targetContainer = this.virtualScroll(targetList);

    await sourceItem.scrollIntoViewIfNeeded();
    await targetContainer.scrollIntoViewIfNeeded();
    const targetBox = await targetContainer.boundingBox();
    if (!targetBox) {
      throw new Error('Could not get the target list bounding box for drag operation');
    }

    const targetItem = this.items(targetList).nth(targetIndex);
    const hasTargetItem = (await targetItem.count()) > 0;
    let targetX = targetBox.x + targetBox.width / 2;
    let targetY: number;

    if (hasTargetItem) {
      await targetItem.scrollIntoViewIfNeeded();
      const targetItemBox = await targetItem.boundingBox();
      if (!targetItemBox) {
        throw new Error('Could not get target item bounding box for drag operation');
      }
      targetX = targetItemBox.x + targetItemBox.width / 2;
      targetY = targetItemBox.y + targetItemBox.height / 2;
    } else {
      // Out-of-range index indicates "drop at end of list"; empty target uses a top-safe drop zone.
      targetY =
        targetIndex > 0
          ? targetBox.y + targetBox.height - 10
          : Math.min(targetBox.y + 50, targetBox.y + targetBox.height - 10);
    }

    await this.startDrag(sourceItem);
    await this.page.mouse.move(targetX, targetY, { steps: 15 });

    // Guarantee the drop outcome: wait until the drag scheduler has processed the exact release
    // coordinates (placeholderIndex/activeDroppable are committed in the same tick), then confirm
    // the release point resolved to the intended droppable.
    await this.settleDragPosition(targetX, targetY);
    await this.waitForActiveDroppable(targetList);
    await this.page.mouse.up();
    // The drop (and the list update it triggers) renders in the same pass that hides the preview
    await expect(this.dragPreview).not.toBeVisible({ timeout: 2000 });
  }

  /**
   * Guarantee the drop uses the release coordinates — see settleDragPosition in ./drag-sync.
   */
  async settleDragPosition(x: number, y: number): Promise<void> {
    await settleDragPosition(this.page, x, y);
  }

  /**
   * Wait until the drag hit-test has resolved to the given list's droppable.
   * Reads the demo's drag-state debug panel, which mirrors DragStateService.activeDroppableId().
   * Use before mouseup on cross-list drags so the drop cannot land back in the source list when
   * the scheduler lags behind the pointer.
   */
  async waitForActiveDroppable(list: ListName): Promise<void> {
    await waitForActiveDroppable(this.page, list === 'list1' ? 'list-1' : 'list-2');
  }

  async scrollList(list: ListName, scrollTop: number): Promise<void> {
    await this.virtualScroll(list).evaluate((el, top) => {
      el.scrollTop = top;
      el.dispatchEvent(new Event('scroll'));
    }, scrollTop);
  }

  async getScrollTop(list: ListName): Promise<number> {
    return this.virtualScroll(list).evaluate((el) => el.scrollTop);
  }

  /** Change the lock axis at runtime through the settings panel. */
  async setLockAxis(axis: 'x' | 'y' | null): Promise<void> {
    await this.lockAxisSelect.selectOption(axis ?? '');
  }

  // Keyboard drag helper methods

  async startKeyboardDrag(list: ListName, itemIndex: number): Promise<void> {
    await this.items(list).nth(itemIndex).focus();
    await this.page.keyboard.press('Space');
  }

  async keyboardMoveDown(steps = 1): Promise<void> {
    for (let i = 0; i < steps; i++) {
      await this.page.keyboard.press('ArrowDown');
    }
  }

  async keyboardMoveUp(steps = 1): Promise<void> {
    for (let i = 0; i < steps; i++) {
      await this.page.keyboard.press('ArrowUp');
    }
  }

  async keyboardMoveToList(direction: 'left' | 'right'): Promise<void> {
    await this.page.keyboard.press(direction === 'left' ? 'ArrowLeft' : 'ArrowRight');
  }

  async keyboardDrop(): Promise<void> {
    await this.page.keyboard.press('Space');
  }

  async keyboardCancel(): Promise<void> {
    await this.page.keyboard.press('Escape');
  }

  /**
   * Count ghost elements - empty .item divs without text content.
   * These indicate broken placeholder rendering.
   * Uses atomic page.evaluate() to avoid TOCTOU races with virtual scroll re-renders.
   */
  async countGhostElements(list: ListName): Promise<number> {
    return this.virtualScroll(list).evaluate((el) => {
      const items = el.querySelectorAll('[data-draggable-id]:not([style*="display: none"])');
      return Array.from(items).filter((item) => {
        const text =
          item.querySelector('[data-testid="demo-item-text"]')?.textContent?.trim() ?? '';
        return text === '';
      }).length;
    });
  }

  /**
   * Get all rendered items with their content for inspection.
   * Uses atomic page.evaluate() to avoid TOCTOU races with virtual scroll re-renders.
   */
  async getRenderedItemsWithContent(
    list: ListName,
  ): Promise<{ text: string; tagName: string; isPlaceholder: boolean }[]> {
    return this.virtualScroll(list).evaluate((el) => {
      const elements = el.querySelectorAll(
        '[data-draggable-id]:not([style*="display: none"]), vdnd-drag-placeholder',
      );
      return Array.from(elements).map((element) => {
        const tagName = element.tagName.toLowerCase();
        const isPlaceholder = tagName === 'vdnd-drag-placeholder';
        const text = isPlaceholder
          ? ''
          : (element.querySelector('[data-testid="demo-item-text"]')?.textContent?.trim() ?? '');
        return { text, tagName, isPlaceholder };
      });
    });
  }
}
