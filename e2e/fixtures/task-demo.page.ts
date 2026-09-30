import { expect, Locator, Page } from '@playwright/test';
import { settleDragPosition, waitForActiveDroppable } from './drag-sync';

export const taskDemoSelectors = {
  scrollContainer: '[data-testid="task-scroll-container"]',
  virtualContent: '[data-testid="task-virtual-content"]',
  header: '[data-testid="task-page-header"]',
  footer: '[data-testid="add-task-footer"]',
  item: '[data-draggable-id]',
  title: '[data-testid="task-title"]',
  category: '[data-testid="task-category"]',
  dragPreview: '[data-testid="vdnd-drag-preview"]',
  placeholder: '.vdnd-drag-placeholder',
  visiblePlaceholder: '.vdnd-drag-placeholder-visible',
  contentWrapper: '.vdnd-content-wrapper',
} as const;

export interface ElementBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface VisibleTask {
  id: string;
  top: number;
  height: number;
}

export interface VisibleListCoverage {
  maxGap: number;
  renderedItemCount: number;
  visibleHeight: number;
}

export class TaskDemoPage {
  readonly scrollContainer: Locator;
  readonly virtualContent: Locator;
  readonly header: Locator;
  readonly footer: Locator;
  readonly items: Locator;
  readonly dragPreview: Locator;
  readonly placeholder: Locator;
  readonly visiblePlaceholder: Locator;

  constructor(readonly page: Page) {
    this.scrollContainer = page.getByTestId('task-scroll-container');
    this.virtualContent = page.getByTestId('task-virtual-content');
    this.header = page.getByTestId('task-page-header');
    this.footer = page.getByTestId('add-task-footer');
    this.items = page.locator(taskDemoSelectors.item);
    this.dragPreview = page.getByTestId('vdnd-drag-preview');
    this.placeholder = page.locator(taskDemoSelectors.placeholder);
    this.visiblePlaceholder = page.locator(taskDemoSelectors.visiblePlaceholder);
  }

  /** Open a task demo. `count` sets the number of tasks (`/dynamic-height` only). */
  async goto(
    path: '/page-scroll' | '/dynamic-height',
    options: { count?: number } = {},
  ): Promise<void> {
    const query = options.count === undefined ? '' : `?count=${options.count}`;
    await this.page.goto(`${path}${query}`, { waitUntil: 'domcontentloaded' });
    await this.waitUntilReady();
  }

  async waitUntilReady(): Promise<void> {
    await expect(this.items.first()).toBeVisible();
  }

  categoryFilter(category: 'all' | 'work' | 'personal' | 'urgent'): Locator {
    return this.page.locator(`[data-category-filter="${category}"]`);
  }

  taskTitle(item: Locator): Locator {
    return item.locator(taskDemoSelectors.title);
  }

  taskCategory(item: Locator): Locator {
    return item.locator(taskDemoSelectors.category);
  }

  async getTaskTitle(index: number): Promise<string> {
    const text = await this.taskTitle(this.items.nth(index)).textContent();
    return text?.trim() ?? '';
  }

  async getTaskCategoryTexts(): Promise<string[]> {
    return this.page
      .locator(taskDemoSelectors.category)
      .evaluateAll((categories) =>
        categories.map((category) => category.textContent?.trim() ?? ''),
      );
  }

  /**
   * Guarantee the drop uses the release coordinates — see settleDragPosition in ./drag-sync.
   */
  async settleDragPosition(x: number, y: number): Promise<void> {
    await settleDragPosition(this.page, x, y);
  }

  /**
   * Wait until the processed drag state has resolved to the given droppable id.
   */
  async waitForActiveDroppable(droppableId: string): Promise<void> {
    await waitForActiveDroppable(this.page, droppableId);
  }

  async scrollTo(scrollTop: number): Promise<void> {
    await this.scrollContainer.evaluate((el, top) => {
      el.scrollTop = top;
      el.dispatchEvent(new Event('scroll'));
    }, scrollTop);
  }

  async getScrollTop(): Promise<number> {
    return this.scrollContainer.evaluate((el) => el.scrollTop);
  }

  async getHeaderHeight(): Promise<number> {
    return this.header.evaluate((el) => el.getBoundingClientRect().height);
  }

  async getVisibleTasks(): Promise<VisibleTask[]> {
    return this.page.evaluate((selectors) => {
      const container = document.querySelector(selectors.scrollContainer);
      if (!container) {
        return [];
      }

      const containerRect = container.getBoundingClientRect();
      const visible: VisibleTask[] = [];

      for (const item of document.querySelectorAll(selectors.item)) {
        const rect = item.getBoundingClientRect();
        if (rect.bottom > containerRect.top && rect.top < containerRect.bottom) {
          visible.push({
            id: item.getAttribute('data-draggable-id') ?? '',
            top: rect.top,
            height: rect.height,
          });
        }
      }

      visible.sort((a, b) => a.top - b.top);
      return visible;
    }, taskDemoSelectors);
  }

  /**
   * Returns draggable tasks whose full bounding box is inside the scroll container's visible
   * viewport. Use this for raw mouse drag sources after scrolling, because partially clipped
   * items can have a geometric center outside the interactive area.
   */
  async getFullyVisibleTasks(): Promise<VisibleTask[]> {
    return this.page.evaluate((selectors) => {
      const container = document.querySelector(selectors.scrollContainer);
      if (!container) {
        return [];
      }

      const containerRect = container.getBoundingClientRect();
      const visible: VisibleTask[] = [];

      for (const item of document.querySelectorAll(selectors.item)) {
        const rect = item.getBoundingClientRect();
        if (
          rect.top >= containerRect.top &&
          rect.bottom <= containerRect.bottom &&
          rect.width > 0 &&
          rect.height > 0
        ) {
          visible.push({
            id: item.getAttribute('data-draggable-id') ?? '',
            top: rect.top,
            height: rect.height,
          });
        }
      }

      visible.sort((a, b) => a.top - b.top);
      return visible;
    }, taskDemoSelectors);
  }

  async getVisibleListCoverage(): Promise<VisibleListCoverage> {
    return this.page.evaluate((selectors) => {
      const scrollContainer = document.querySelector<HTMLElement>(selectors.scrollContainer);
      const virtualContent = document.querySelector<HTMLElement>(selectors.virtualContent);

      if (!scrollContainer || !virtualContent) {
        return { maxGap: 0, renderedItemCount: 0, visibleHeight: 0 };
      }

      const containerRect = scrollContainer.getBoundingClientRect();
      const contentRect = virtualContent.getBoundingClientRect();
      const projectedHeader = virtualContent.querySelector<HTMLElement>(selectors.header);
      const listTop = projectedHeader
        ? projectedHeader.getBoundingClientRect().bottom
        : contentRect.top;
      const visibleTop = Math.max(containerRect.top, listTop);
      const visibleBottom = Math.min(containerRect.bottom, contentRect.bottom);
      const visibleHeight = Math.max(0, visibleBottom - visibleTop);

      if (visibleHeight === 0) {
        return { maxGap: 0, renderedItemCount: 0, visibleHeight };
      }

      const intervals = Array.from(virtualContent.querySelectorAll<HTMLElement>(selectors.item))
        .map((item) => item.getBoundingClientRect())
        .filter(
          (rect) =>
            rect.width > 0 &&
            rect.height > 0 &&
            rect.bottom > visibleTop &&
            rect.top < visibleBottom,
        )
        .map((rect) => ({
          top: Math.max(rect.top, visibleTop),
          bottom: Math.min(rect.bottom, visibleBottom),
        }))
        .sort((a, b) => a.top - b.top);

      let cursor = visibleTop;
      let maxGap = 0;

      for (const interval of intervals) {
        if (interval.bottom <= cursor) {
          continue;
        }

        if (interval.top > cursor) {
          maxGap = Math.max(maxGap, interval.top - cursor);
        }

        cursor = Math.max(cursor, interval.bottom);
      }

      if (cursor < visibleBottom) {
        maxGap = Math.max(maxGap, visibleBottom - cursor);
      }

      return { maxGap, renderedItemCount: intervals.length, visibleHeight };
    }, taskDemoSelectors);
  }

  async getVisibleItemBoxAt(containerRatio: number): Promise<ElementBox | null> {
    return this.page.evaluate(
      ({ selectors, ratio }) => {
        const container = document.querySelector(selectors.scrollContainer);
        if (!container) {
          return null;
        }

        const containerRect = container.getBoundingClientRect();
        const targetY = containerRect.top + containerRect.height * ratio;
        const candidates = Array.from(document.querySelectorAll<HTMLElement>(selectors.item))
          .map((el) => {
            const rect = el.getBoundingClientRect();
            return {
              centerY: rect.top + rect.height / 2,
              visible:
                rect.bottom > containerRect.top + 12 &&
                rect.top < containerRect.bottom - 12 &&
                rect.height > 0 &&
                rect.width > 0,
              box: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
            };
          })
          .filter((item) => item.visible)
          .sort((a, b) => Math.abs(a.centerY - targetY) - Math.abs(b.centerY - targetY));

        return candidates[0]?.box ?? null;
      },
      { selectors: taskDemoSelectors, ratio: containerRatio },
    );
  }

  async getItemBoxContainingY(y: number): Promise<ElementBox | null> {
    return this.page.evaluate(
      ({ selectors, targetY }) => {
        for (const item of document.querySelectorAll<HTMLElement>(selectors.item)) {
          if (item.offsetParent === null) {
            continue;
          }

          const rect = item.getBoundingClientRect();
          if (rect.top < targetY && rect.bottom > targetY) {
            return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
          }
        }

        return null;
      },
      { selectors: taskDemoSelectors, targetY: y },
    );
  }
}
