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

  async setItemCount(count: number): Promise<void> {
    await this.page.locator('input[type="number"]').first().fill(String(count));
    await this.page.locator('button', { hasText: 'Regenerate' }).click();
    await expect(this.page.getByTestId('list-1-count')).toHaveText(String(Math.floor(count / 2)));
    await this.waitForFrames(3);
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

  /**
   * Perform known scroll checkpoints, yielding two rendering opportunities after EVERY write.
   * Unlike elapsed-time interpolation, a slow renderer cannot skip intermediate row updates.
   * Dynamic rows advance by IDs already rendered in the preceding viewport, so fresh height
   * estimates cannot change the intended sequence of rows.
   */
  async scrollCheckpoints(options: {
    selector: string;
    checkpoints: number;
    rowPrefix: string;
    rowStep?: number;
    targetScrollTop?: number;
    itemHeight?: number;
  }): Promise<WorkloadEvidence> {
    return this.page.evaluate(async (opts) => {
      const element = document.querySelector<HTMLElement>(opts.selector);
      if (!element) throw new Error(`Missing scroll container ${opts.selector}`);
      const rows = () =>
        Array.from(element.querySelectorAll('[data-draggable-id]')).map(
          (row) => row.getAttribute('data-draggable-id')!,
        );
      const nextFrame = () =>
        new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const startScrollTop = element.scrollTop;
      const visitedRows = new Set(rows());
      const renderedRanges: string[] = [];
      const checkpointRows: string[] = [];
      let operations = 0;
      let maxCheckpointOffsetPx = 0;
      for (let i = 1; i <= opts.checkpoints; i++) {
        let targetId: string;
        if (opts.targetScrollTop !== undefined) {
          const position =
            startScrollTop + ((opts.targetScrollTop - startScrollTop) * i) / opts.checkpoints;
          targetId = `${opts.rowPrefix}${Math.floor(position / opts.itemHeight!)}`;
          element.scrollTop = position;
        } else {
          targetId = `${opts.rowPrefix}${i * (opts.rowStep ?? 1)}`;
          const row = element.querySelector(`[data-draggable-id="${targetId}"]`);
          if (!row) throw new Error(`Checkpoint ${i}: row ${targetId} was not rendered`);
          const scrollport = element.getBoundingClientRect();
          element.scrollTop += row.getBoundingClientRect().top - scrollport.top - element.clientTop;
        }
        await nextFrame();
        await nextFrame();
        // Wait for the actual virtual render, not just acceptance of the scroll write.
        let rendered = rows();
        for (let retry = 0; !rendered.includes(targetId) && retry < 8; retry++) {
          await nextFrame();
          rendered = rows();
        }
        if (!rendered.includes(targetId)) {
          throw new Error(`Checkpoint ${i}: row ${targetId} did not render`);
        }
        if (opts.targetScrollTop === undefined) {
          const row = element.querySelector(`[data-draggable-id="${targetId}"]`)!;
          maxCheckpointOffsetPx = Math.max(
            maxCheckpointOffsetPx,
            Math.abs(
              row.getBoundingClientRect().top -
                element.getBoundingClientRect().top -
                element.clientTop,
            ),
          );
        }
        for (const id of rendered) visitedRows.add(id);
        checkpointRows.push(targetId);
        renderedRanges.push(`${rendered[0]}:${rendered.at(-1)}`);
        operations++;
      }
      return {
        operations,
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
