import { expect, test, type Page } from '@playwright/test';
import { PerfPage } from '../fixtures/perf.page';
import { MetricsCollector } from '../fixtures/metrics-collector';
import type { ContractConsumer, Renderer, WorkCounters } from '../consumer/protocol';

const VIEWPORT = '[data-item-height], [data-virtual-viewport]';
const SIZES = [1_000, 10_000, 100_000];
// 400px / shortest 40px row + two 3-row overscans + boundary/sticky allowances.
const MAX_ROWS = 18;
const MAX_LIVE_VIEWS = MAX_ROWS + 20;
const CHECKPOINTS = 24;
// Coarse, unthrottled catastrophic-stall limits. These do not certify 60 FPS or
// replace calibrated relative timing; changing a budget requires review.
const MAX_MOUNT_MS = 500;
const MAX_FRAME_GAP_MS = 250;

async function open(page: Page): Promise<void> {
  await page.goto('http://127.0.0.1:4302');
  await page.waitForFunction(() => !!window.__vdndContract);
}

async function mount(page: Page, options: Parameters<ContractConsumer['mount']>[0]) {
  return page.evaluate((value) => window.__vdndContract.mount(value), options);
}

async function scroll(page: Page): Promise<WorkCounters> {
  await page.evaluate(() => window.__vdndContract.reset());
  const collector = new MetricsCollector(page);
  await collector.init();
  try {
    const metrics = await collector.measureScenario(() =>
      new PerfPage(page).scrollCheckpoints({
        selector: VIEWPORT,
        checkpoints: CHECKPOINTS,
        rowPrefix: 'row-',
        rowStep: 3,
      }),
    );
    expect(
      metrics.maxFrameGap,
      'ordinary scroll must not stall a frame for 250ms',
    ).toBeLessThanOrEqual(MAX_FRAME_GAP_MS);
  } finally {
    await collector.dispose();
  }
  return page.evaluate(() => window.__vdndContract.snapshot());
}

function checkWork(work: WorkCounters, renderer: Renderer = 'component'): void {
  // Counts include real consumer template checks even if they write nothing to the DOM.
  // Directive view insertion also refreshes its declaration view. The component
  // renderer isolates that work from its host; neither may scale with list size.
  expect(work.hostChecks, 'scroll must bound consumer host checks').toBeLessThanOrEqual(
    renderer === 'directive' ? CHECKPOINTS : 0,
  );
  // Re-inserting a recycled view also schedules a refresh of transplanted views.
  // Allow one visible-window pass plus new/boundary rows, independent of data size.
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

for (const renderer of ['component', 'directive'] as const) {
  for (const dynamic of [false, true]) {
    test(`${renderer}, ${dynamic ? 'dynamic' : 'fixed'} heights: work stays bounded from 1k to 100k`, async ({
      page,
    }, testInfo) => {
      await open(page);
      const results: { count: number; mountMs: number; work: WorkCounters }[] = [];
      for (const count of SIZES) {
        const initial = await mount(page, { count, renderer, dynamic });
        expect(
          initial.mountMs,
          'initial rendering, excluding caller data allocation',
        ).toBeLessThanOrEqual(MAX_MOUNT_MS);
        expect(await page.locator('[data-draggable-id]').count()).toBeLessThanOrEqual(MAX_ROWS);
        expect(initial.counters.live).toBeLessThanOrEqual(MAX_LIVE_VIEWS);
        if (!dynamic)
          expect(
            initial.counters.keyReads,
            'fixed-height mount must not scan the data',
          ).toBeLessThan(500);
        const work = await scroll(page);
        checkWork(work, renderer);
        expect(await page.locator('[data-draggable-id]').count()).toBeLessThanOrEqual(MAX_ROWS);
        // Traverse the same distant screens repeatedly. Count live Angular directives,
        // including detached views; DOM counts alone cannot detect an unbounded pool.
        await page.evaluate(async (selector) => {
          const viewport = document.querySelector(selector)!;
          for (let i = 0; i < 32; i++) {
            viewport.scrollTop = (i % 2 ? 50 : 700) * 50;
            for (let f = 0; f < 2; f++)
              await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
            if (document.querySelectorAll('[data-draggable-id]').length > 18)
              throw new Error('Rendered row budget exceeded while recycling');
          }
        }, VIEWPORT);
        expect(
          (await page.evaluate(() => window.__vdndContract.snapshot())).live,
        ).toBeLessThanOrEqual(MAX_LIVE_VIEWS);
        await page.evaluate(() => window.__vdndContract.unmount());
        expect(
          (await page.evaluate(() => window.__vdndContract.snapshot())).live,
          'destroying the list must release every row view',
        ).toBe(0);
        results.push({ count, mountMs: initial.mountMs, work });
      }
      for (const result of results.slice(1)) {
        expect(result.work.rowChecks).toBeLessThanOrEqual(results[0].work.rowChecks + 12);
        expect(result.work.keyReads).toBeLessThanOrEqual(results[0].work.keyReads + 150);
      }
      await testInfo.attach('virtualization-scaling', {
        body: JSON.stringify({ renderer, dynamic, results }),
        contentType: 'application/json',
      });
    });
  }

  test(`${renderer}: placeholder movement does not re-check consumer rows`, async ({ page }) => {
    await open(page);
    await mount(page, { count: 10_000, renderer, dynamic: false });
    const source = await page.locator('[data-draggable-id="row-0"]').boundingBox();
    expect(source).not.toBeNull();
    const x = source!.x + source!.width / 2;
    const y = source!.y + source!.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 12, y + 12, { steps: 3 });
    await expect(page.getByTestId('vdnd-drag-preview')).toBeVisible();
    await new PerfPage(page).waitForFrames(3);
    await page.evaluate(() => window.__vdndContract.reset());
    for (const delta of [100, 150, 200, 100, 200]) {
      await page.mouse.move(x, y + delta);
      await new PerfPage(page).waitForFrames(2);
    }
    const work = await page.evaluate(() => window.__vdndContract.snapshot());
    await page.mouse.up();
    expect(work.hostChecks).toBe(0);
    expect(work.rowChecks, 'placeholder-only updates must not re-check row templates').toBe(0);
    expect(work.keyReads, 'pointer updates must not scan the complete list').toBeLessThanOrEqual(
      500,
    );
  });
}

test('positive controls detect extra checks, full-list scans, excessive DOM and stalls', async ({
  page,
}) => {
  await open(page);
  for (const control of ['checks', 'scan'] as const) {
    await mount(page, { count: 10_000, renderer: 'component', dynamic: false, control });
    const work = await scroll(page);
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
  await expect(scroll(page)).rejects.toThrow('ordinary scroll must not stall a frame for 250ms');
});
