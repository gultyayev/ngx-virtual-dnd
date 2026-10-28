import { expect, test, type Page } from '@playwright/test';
import { CONTRACT_CASES } from './cases';
import { measure, scrollCheckpoints, waitForFrames, VIEWPORT, type BrowserWork } from './browser';
import type { ContractConsumer, Renderer, WorkCounters } from '../consumer/protocol';

const SIZES = [1_000, 10_000, 100_000];
// 400px / shortest 40px row + two 3-row overscans + boundary/sticky allowances.
const MAX_ROWS = 18;
const MAX_LIVE_VIEWS = MAX_ROWS + 20;
const CHECKPOINTS = 24;
const MAX_MOUNT_MS = 500;
const MAX_FRAME_GAP_MS = 250;
// One incidental GC/host scheduling pause is tolerated; per-step 60ms work is not.
const MAX_LONG_TASKS = 1;

async function open(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => !!window.__vdndContract);
}
async function mount(page: Page, options: Parameters<ContractConsumer['mount']>[0]) {
  return page.evaluate((value) => window.__vdndContract.mount(value), options);
}
async function scroll(page: Page) {
  await page.evaluate(() => window.__vdndContract.reset());
  const metrics = await measure(page, () => scrollCheckpoints(page));
  return { work: await page.evaluate(() => window.__vdndContract.snapshot()), metrics };
}
function checkResponsiveness(metrics: BrowserWork): void {
  expect(
    metrics.maxFrameGap,
    'ordinary scroll must not stall a frame for 250ms',
  ).toBeLessThanOrEqual(MAX_FRAME_GAP_MS);
  expect(metrics.longTasks.length, 'scroll must not repeatedly block for 50ms').toBeLessThanOrEqual(
    MAX_LONG_TASKS,
  );
}
function checkRendering(metrics: BrowserWork): void {
  expect(metrics.layoutCount, 'one layout per logical scroll checkpoint').toBeLessThanOrEqual(
    CHECKPOINTS,
  );
  expect(
    metrics.recalcStyleCount,
    'bounded style recalculations during scroll',
  ).toBeLessThanOrEqual(CHECKPOINTS);
}
function checkWork(work: WorkCounters, renderer: Renderer = 'component'): void {
  // Pooled-view insertion currently refreshes visible templates and, for the
  // directive, its declaration view. The separate no-reuse case permits neither.
  expect(work.hostChecks, 'scroll must bound consumer host checks').toBeLessThanOrEqual(
    renderer === 'directive' ? CHECKPOINTS : 0,
  );
  expect(work.rowChecks, 'row checks must stay bounded by the visible window').toBeLessThanOrEqual(
    CHECKPOINTS * 24,
  );
  expect(work.keyReads, 'ordinary scrolling must not scan all item IDs').toBeLessThanOrEqual(
    CHECKPOINTS * 150,
  );
  expect(work.live, 'detached/recycled row views must remain bounded').toBeLessThanOrEqual(
    MAX_LIVE_VIEWS,
  );
  expect(work.peakLive, 'transient row views must remain bounded').toBeLessThanOrEqual(
    2 * MAX_LIVE_VIEWS,
  );
}

for (const scenario of CONTRACT_CASES) {
  test(scenario.title, async ({ page }, testInfo) => {
    await open(page);
    if (scenario.kind === 'scaling') {
      const { renderer, dynamic } = scenario;
      const results: {
        count: number;
        mountMs: number;
        work: WorkCounters;
        metrics: BrowserWork;
        pooled: number;
      }[] = [];
      for (const count of SIZES) {
        const initial = await mount(page, { count, renderer, dynamic });
        expect(
          initial.mountMs,
          'initial rendering excludes caller data allocation',
        ).toBeLessThanOrEqual(MAX_MOUNT_MS);
        expect(await page.locator('[data-draggable-id]').count()).toBeLessThanOrEqual(MAX_ROWS);
        expect(initial.counters.live).toBeLessThanOrEqual(MAX_LIVE_VIEWS);
        if (!dynamic)
          expect(
            initial.counters.keyReads,
            'fixed-height mount must not scan the data',
          ).toBeLessThan(500);
        const { work, metrics } = await scroll(page);
        checkWork(work, renderer);
        checkRendering(metrics);
        checkResponsiveness(metrics);
        // Repeated distant scrolling exercises recycling and retained views.
        await page.evaluate(async (selector) => {
          const viewport = document.querySelector(selector)!;
          for (let i = 0; i < 32; i++) {
            viewport.scrollTop = (i % 2 ? 50 : 700) * 50;
            for (let f = 0; f < 2; f++)
              await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
            if (document.querySelectorAll('[data-draggable-id]').length > 18)
              throw new Error('Rendered row budget exceeded while recycling');
          }
          // The shorter final window leaves detached views in the pool. Destroying
          // a list with an empty pool would not exercise pool cleanup at all.
          viewport.scrollTop = viewport.scrollHeight;
        }, VIEWPORT);
        await waitForFrames(page, 3);
        await expect(page.locator(`[data-draggable-id="row-${count - 1}"]`)).toBeVisible();
        const beforeDestroy = await page.evaluate(() => window.__vdndContract.snapshot());
        const rendered = await page.locator('[data-draggable-id]').count();
        const pooled = beforeDestroy.live - rendered;
        expect(rendered).toBeLessThanOrEqual(MAX_ROWS);
        expect(beforeDestroy.live).toBeLessThanOrEqual(MAX_LIVE_VIEWS);
        expect(pooled, 'destruction must exercise a nonempty detached-view pool').toBeGreaterThan(
          0,
        );
        await page.evaluate(() => window.__vdndContract.unmount());
        expect(
          (await page.evaluate(() => window.__vdndContract.snapshot())).live,
          'destroy must release visible and pooled views',
        ).toBe(0);
        results.push({ count, mountMs: initial.mountMs, work, metrics, pooled });
      }
      for (const result of results.slice(1)) {
        expect(result.work.rowChecks).toBeLessThanOrEqual(results[0].work.rowChecks + 12);
        expect(result.work.keyReads).toBeLessThanOrEqual(results[0].work.keyReads + 150);
      }
      await testInfo.attach('virtualization-scaling', {
        body: JSON.stringify({ renderer, dynamic, results }),
        contentType: 'application/json',
      });
    } else if (scenario.kind === 'no-reuse') {
      const { renderer, dynamic } = scenario;
      const initial = await mount(page, { count: 10_000, renderer, dynamic });
      const initialIds = await page
        .locator('[data-draggable-id]')
        .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-draggable-id')));
      await page.evaluate(() => window.__vdndContract.reset());
      await scrollCheckpoints(page, 1, 3);
      const work = await page.evaluate(() => window.__vdndContract.snapshot());
      const ids = await page
        .locator('[data-draggable-id]')
        .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-draggable-id')));
      expect(
        initialIds.every((id) => ids.includes(id)),
        'no initial row may leave the rendered range',
      ).toBe(true);
      const created = work.created - initial.counters.created;
      expect(created, 'scroll must create newly exposed rows').toBeGreaterThan(0);
      expect(work.live).toBe(ids.length);
      expect(work.destroyed).toBe(initial.counters.destroyed);
      expect(
        work.hostChecks,
        'scroll without pool reuse must not mark the consumer for check',
      ).toBe(0);
      // The directive's former final row also changes its `last` context flag.
      expect(work.rowChecks, 'only new or context-changed rows may be checked').toBe(
        created + (renderer === 'directive' ? 1 : 0),
      );
    } else if (scenario.kind === 'placeholder') {
      const { renderer, dynamic } = scenario;
      await mount(page, { count: 10_000, renderer, dynamic });
      const source = (await page.locator('[data-draggable-id="row-0"]').boundingBox())!;
      const x = source.x + source.width / 2;
      const y = source.y + source.height / 2;
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + 12, y + 12, { steps: 3 });
      await expect(page.getByTestId('vdnd-drag-preview')).toBeVisible();
      await waitForFrames(page, 3);
      await page.evaluate(() => window.__vdndContract.reset());
      const metrics = await measure(page, async () => {
        for (const delta of [100, 150, 200, 100, 200]) {
          await page.mouse.move(x, y + delta);
          await waitForFrames(page);
        }
      });
      const work = await page.evaluate(() => window.__vdndContract.snapshot());
      await page.mouse.up();
      await testInfo.attach('placeholder-work', {
        body: JSON.stringify({ renderer, dynamic, work, metrics }),
        contentType: 'application/json',
      });
      expect(work.hostChecks).toBe(0);
      expect(work.rowChecks, 'placeholder-only updates must not re-check row templates').toBe(0);
      expect(work.keyReads, 'pointer updates must not scan the complete list').toBeLessThanOrEqual(
        500,
      );
      expect(
        metrics.layoutCount,
        'bounded layout passes during placeholder movement',
      ).toBeLessThanOrEqual(5);
      expect(
        metrics.recalcStyleCount,
        'bounded style passes during placeholder movement',
      ).toBeLessThanOrEqual(10);
    } else {
      for (const control of ['checks', 'scan'] as const) {
        await mount(page, { count: 10_000, renderer: 'component', dynamic: false, control });
        const { work } = await scroll(page);
        if (control === 'checks') expect(work.hostChecks).toBeGreaterThan(0);
        else expect(work.keyReads).toBeGreaterThan(CHECKPOINTS * 150);
        expect(() => checkWork(work)).toThrow();
      }
      await mount(page, { count: 64, renderer: 'component', dynamic: false, control: 'rows' });
      expect(await page.locator('[data-draggable-id]').count()).toBeGreaterThan(MAX_ROWS);
      const slowMount = await mount(page, {
        count: 1_000,
        renderer: 'component',
        dynamic: false,
        control: 'stall',
      });
      expect(slowMount.mountMs).toBeGreaterThan(MAX_MOUNT_MS);
      await mount(page, {
        count: 1_000,
        renderer: 'component',
        dynamic: false,
        control: 'scroll-stall',
      });
      const stalled = await scroll(page);
      expect(() => checkResponsiveness(stalled.metrics)).toThrow(
        'ordinary scroll must not stall a frame for 250ms',
      );
      await mount(page, {
        count: 1_000,
        renderer: 'component',
        dynamic: false,
        control: 'layout-thrash',
      });
      const thrashed = await scroll(page);
      expect(thrashed.metrics.layoutCount).toBeGreaterThan(CHECKPOINTS);
      expect(thrashed.metrics.recalcStyleCount).toBeGreaterThan(CHECKPOINTS);
      expect(() => checkRendering(thrashed.metrics)).toThrow();
      await mount(page, {
        count: 1_000,
        renderer: 'component',
        dynamic: false,
        control: 'long-tasks',
      });
      const blocked = await scroll(page);
      expect(blocked.metrics.longTasks.length).toBeGreaterThan(MAX_LONG_TASKS);
      expect(() => checkResponsiveness(blocked.metrics)).toThrow(
        'scroll must not repeatedly block for 50ms',
      );
    }
  });
}
