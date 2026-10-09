import { expect, Page } from '@playwright/test';
import type { WorkloadEvidence } from './metrics-collector';

/** Debug views re-render every drag frame; disable them on every benchmark document. */
const NO_DRAG_STATE_DEBUG = 'dragStateDebug=false';

export class PerfPage {
  constructor(readonly page: Page) {}

  async goto(route = '/'): Promise<void> {
    const separator = route.includes('?') ? '&' : '?';
    await this.page.goto(`${route}${separator}${NO_DRAG_STATE_DEBUG}`);
    await this.page.waitForLoadState('networkidle');
    await this.page.locator('[data-draggable-id]').first().waitFor({ state: 'visible' });
    await this.page.evaluate(async () => {
      await document.fonts.ready;
    });
    if (route.split('?')[0] === '/') {
      // Settings push the main demo's lists below the fold. Keep both complete
      // scrollports on screen before taking coordinates or starting observers.
      await this.page
        .locator('[data-droppable-id="list-1"] vdnd-virtual-scroll')
        .evaluate((element) => element.scrollIntoView({ block: 'center', inline: 'nearest' }));
    }
    await this.waitForFrames(3);
    await expect(this.page.getByTestId('drag-state-debug')).toHaveCount(0);
  }

  async waitForFrames(count = 2): Promise<void> {
    await this.page.evaluate(async (frames) => {
      for (let i = 0; i < frames; i++) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      }
    }, count);
  }

  async scrollTop(selector: string): Promise<number> {
    return this.page.locator(selector).evaluate((element) => element.scrollTop);
  }

  /** Prepare row zero after the dynamic list's static header, before measuring. */
  async scrollRowToTop(selector: string, rowId: string): Promise<void> {
    await this.page.locator(selector).evaluate((element, id) => {
      const row = element.querySelector(`[data-draggable-id="${id}"]`);
      if (!row) throw new Error(`Missing scroll checkpoint row ${id}`);
      const scrollport = element.getBoundingClientRect();
      element.scrollTop += row.getBoundingClientRect().top - scrollport.top - element.clientTop;
    }, rowId);
    await this.waitForFrames(3);
  }

  /** Deliver a fixed sequence of logical rows, allowing the renderer's pixel geometry to vary. */
  async scrollCheckpoints(options: {
    selector: string;
    checkpoints: number;
    rowPrefix: string;
    rowStep?: number;
  }): Promise<WorkloadEvidence> {
    return this.page.evaluate(async (opts) => {
      const element = document.querySelector<HTMLElement>(opts.selector);
      if (!element) throw new Error(`Missing scroll container ${opts.selector}`);
      const rowStep = opts.rowStep ?? 1;
      if (
        !Number.isSafeInteger(opts.checkpoints) ||
        opts.checkpoints < 1 ||
        !Number.isSafeInteger(rowStep) ||
        rowStep < 1
      ) {
        throw new Error('Scroll checkpoints and rowStep must be positive integers');
      }
      const rows = () => Array.from(element.querySelectorAll<HTMLElement>('[data-draggable-id]'));
      const ids = () => rows().map((row) => row.getAttribute('data-draggable-id')!);
      const nextFrame = () =>
        new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const rowOffset = (row: HTMLElement) =>
        row.getBoundingClientRect().top - element.getBoundingClientRect().top - element.clientTop;
      const targetRow = (id: string) =>
        rows().find((row) => row.getAttribute('data-draggable-id') === id);
      const writeCheckpoint = (targetIndex: number, targetId: string) => {
        const target = targetRow(targetId);
        if (target && target.getBoundingClientRect().height > 0) {
          element.scrollTop += rowOffset(target);
          return;
        }
        // With zero overscan the next logical target can be outside the DOM. Use
        // a rendered row only to estimate pixels, then settle the actual target.
        const anchors = rows()
          .flatMap((row) => {
            const id = row.getAttribute('data-draggable-id')!;
            const suffix = id.startsWith(opts.rowPrefix) ? id.slice(opts.rowPrefix.length) : '';
            if (!/^\d+$/.test(suffix)) return [];
            const index = Number(suffix);
            const height = row.getBoundingClientRect().height;
            return Number.isSafeInteger(index) && height > 0 ? [{ row, index, height }] : [];
          })
          .sort((a, b) => Math.abs(a.index - targetIndex) - Math.abs(b.index - targetIndex));
        const anchor = anchors[0];
        if (!anchor) throw new Error(`No measurable row geometry for checkpoint ${targetId}`);
        element.scrollTop += rowOffset(anchor.row) + (targetIndex - anchor.index) * anchor.height;
      };
      const startScrollTop = element.scrollTop;
      const visitedRows = new Set(ids());
      const renderedRanges: string[] = [];
      const checkpointRows: string[] = [];
      let operations = 0;
      let scrollWrites = 0;
      let maxCheckpointOffsetPx = 0;
      for (let i = 1; i <= opts.checkpoints; i++) {
        const targetIndex = i * rowStep;
        const targetId = `${opts.rowPrefix}${targetIndex}`;
        let alignedOffset: number | undefined;
        for (let attempt = 0; attempt < 9; attempt++) {
          writeCheckpoint(targetIndex, targetId);
          scrollWrites++;
          await nextFrame();
          await nextFrame();
          // Presence is insufficient: a target can already exist in overscan before
          // the scroll. Wait for its actual position after rendering/height updates.
          const target = targetRow(targetId);
          if (target && target.getBoundingClientRect().height > 0) {
            const offset = Math.abs(rowOffset(target));
            if (offset <= 2) {
              alignedOffset = offset;
              break;
            }
          }
        }
        if (alignedOffset === undefined) {
          throw new Error(
            `Checkpoint ${i}: row ${targetId} did not render aligned with the scrollport`,
          );
        }
        maxCheckpointOffsetPx = Math.max(maxCheckpointOffsetPx, alignedOffset);
        const rendered = ids();
        for (const id of rendered) visitedRows.add(id);
        checkpointRows.push(targetId);
        renderedRanges.push(`${rendered[0]}:${rendered.at(-1)}`);
        operations++;
      }
      return {
        operations,
        scrollWrites,
        startScrollTop,
        endScrollTop: element.scrollTop,
        scrollDistance: element.scrollTop - startScrollTop,
        checkpointRows,
        visitedRows: [...visitedRows],
        renderedRanges,
        finalTargetRow: checkpointRows.at(-1)!,
        maxCheckpointOffsetPx,
        completed: true,
      };
    }, options);
  }

  /** Read verified drop evidence after the performance window has closed. */
  async observeDrop(options: {
    hostSelector: string;
    destinationDroppableId: string;
    sourceId: string;
  }): Promise<WorkloadEvidence> {
    return this.page.evaluate(({ hostSelector, destinationDroppableId, sourceId }) => {
      const host = document.querySelector(hostSelector);
      if (!host) throw new Error(`Missing drop outcome host ${hostSelector}`);
      const index = (attribute: string) => {
        const value = host.getAttribute(attribute);
        if (value === null || !/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) {
          throw new Error(`Missing or invalid drop outcome ${attribute}`);
        }
        return Number(value);
      };
      const sourceIndex = index('data-last-drop-source-index');
      const destinationIndex = index('data-last-drop-destination-index');
      const destination = Array.from(document.querySelectorAll('[data-droppable-id]')).find(
        (element) => element.getAttribute('data-droppable-id') === destinationDroppableId,
      );
      const observedRow =
        destination &&
        Array.from(destination.querySelectorAll('[data-draggable-id]')).find(
          (row) => row.getAttribute('data-draggable-id') === sourceId,
        );
      if (!observedRow)
        throw new Error(
          `Dragged item ${sourceId} was not observed in destination ${destinationDroppableId}`,
        );
      return {
        sourceIndex,
        destinationIndex,
        sourceId: observedRow.getAttribute('data-draggable-id')!,
        completed: true,
      };
    }, options);
  }

  async getDraggableId(droppableId: string, index: number): Promise<string> {
    const id = await this.page
      .locator(`[data-droppable-id="${droppableId}"] [data-draggable-id]`)
      .nth(index)
      .getAttribute('data-draggable-id');
    if (!id) throw new Error(`Missing draggable ${index} in ${droppableId}`);
    return id;
  }

  /**
   * Every pointer position receives two rendering opportunities before the next input. This
   * prevents the library's per-frame coalescing from doing less work on a slower runner.
   */
  async simulateDrag(opts: {
    startX: number;
    startY: number;
    endX: number;
    endY: number;
    steps?: number;
    holdDurationMs?: number;
  }): Promise<{ operations: number; holdElapsedMs: number }> {
    const { startX, startY, endX, endY, steps = 20, holdDurationMs = 0 } = opts;
    await this.page.mouse.move(startX, startY);
    await this.page.mouse.down();
    await this.page.mouse.move(startX + 5, startY + 5);
    await this.waitForFrames();
    await expect(this.page.getByTestId('vdnd-drag-preview')).toBeVisible({ timeout: 2000 });
    for (let i = 1; i <= steps; i++) {
      await this.page.mouse.move(
        startX + 5 + ((endX - startX - 5) * i) / steps,
        startY + 5 + ((endY - startY - 5) * i) / steps,
      );
      await this.waitForFrames();
    }
    const holdStart = await this.page.evaluate(() => performance.now());
    if (holdDurationMs) await this.page.waitForTimeout(holdDurationMs);
    const holdElapsedMs = (await this.page.evaluate(() => performance.now())) - holdStart;
    await this.page.mouse.up();
    await this.waitForFrames();
    return { operations: steps + 1, holdElapsedMs };
  }

  async getContainerBox(list: 'list1' | 'list2') {
    const droppableId = list === 'list1' ? 'list-1' : 'list-2';
    return this.page
      .locator(`[data-droppable-id="${droppableId}"] vdnd-virtual-scroll`)
      .boundingBox();
  }

  async getItemBox(list: 'list1' | 'list2', index: number) {
    return this.getDraggableBox(list === 'list1' ? 'list-1' : 'list-2', index);
  }

  async getDraggableBox(droppableId: string, index: number) {
    return this.page
      .locator(`[data-droppable-id="${droppableId}"] [data-draggable-id]`)
      .nth(index)
      .boundingBox();
  }

  async expectRenderedOrder(droppableId: string, ids: string[]): Promise<void> {
    const rows = this.page.locator(`[data-droppable-id="${droppableId}"] [data-draggable-id]`);
    await expect(async () => {
      expect(
        await rows.evaluateAll((elements) =>
          elements.map((el) => el.getAttribute('data-draggable-id')),
        ),
      ).toEqual(expect.arrayContaining(ids));
      for (let i = 0; i < ids.length; i++) {
        expect(await rows.nth(i).getAttribute('data-draggable-id')).toBe(ids[i]);
      }
    }).toPass({ timeout: 5000 });
  }
}
