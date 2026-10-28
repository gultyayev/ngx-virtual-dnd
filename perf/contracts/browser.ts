import { expect, type Page } from '@playwright/test';

export const VIEWPORT = '[data-item-height], [data-virtual-viewport]';
export interface BrowserWork {
  layoutCount: number;
  recalcStyleCount: number;
  maxFrameGap: number;
  frameGaps: number[];
  longTasks: { startTime: number; duration: number }[];
}
interface Observation {
  frameGaps: number[];
  longTasks: { startTime: number; duration: number }[];
  visible: boolean;
}
declare global {
  interface Window {
    __contractObservation?: { stop(): Observation };
  }
}

export async function waitForFrames(page: Page, count = 2): Promise<void> {
  await page.evaluate(async (frames) => {
    for (let i = 0; i < frames; i++)
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }, count);
}

/** Measure only the fixed interaction, excluding setup and assertions. Chromium only. */
export async function measure(page: Page, interaction: () => Promise<void>): Promise<BrowserWork> {
  const cdp = await page.context().newCDPSession(page);
  const counters = async () => {
    const { metrics } = await cdp.send('Performance.getMetrics');
    return ['LayoutCount', 'RecalcStyleCount'].map((name) => {
      const value = metrics.find((metric) => metric.name === name)?.value;
      if (value === undefined || !Number.isFinite(value) || value < 0)
        throw new Error(`Missing or invalid renderer metric: ${name}`);
      return value;
    });
  };
  try {
    await cdp.send('Performance.enable');
    await page.evaluate(() => {
      window.__contractObservation?.stop();
      const start = performance.now();
      const frameGaps: number[] = [];
      const longTasks: Observation['longTasks'] = [];
      let lastFrame: number | undefined;
      let visible = document.visibilityState === 'visible';
      const visibility = () => {
        visible &&= document.visibilityState === 'visible';
      };
      document.addEventListener('visibilitychange', visibility);
      const addTasks = (entries: PerformanceEntry[]) => {
        for (const { startTime, duration } of entries)
          if (startTime >= start) longTasks.push({ startTime, duration });
      };
      const observer = new PerformanceObserver((list) => addTasks(list.getEntries()));
      observer.observe({ type: 'longtask' });
      const frame = () => {
        const now = performance.now();
        if (lastFrame !== undefined) frameGaps.push(now - lastFrame);
        lastFrame = now;
        frameRequest = requestAnimationFrame(frame);
      };
      let frameRequest = requestAnimationFrame(frame);
      window.__contractObservation = {
        stop: () => {
          cancelAnimationFrame(frameRequest);
          document.removeEventListener('visibilitychange', visibility);
          addTasks(observer.takeRecords());
          observer.disconnect();
          delete window.__contractObservation;
          return {
            frameGaps,
            longTasks,
            visible: visible && document.visibilityState === 'visible',
          };
        },
      };
    });
    // Establish the first full frame before any input; include a trailing frame
    // so a stall on the final input cannot disappear from the observation.
    await waitForFrames(page);
    const before = await counters();
    await interaction();
    await waitForFrames(page);
    const after = await counters();
    const observation = await page.evaluate(() => window.__contractObservation!.stop());
    expect(observation.visible, 'measurements require a visible page').toBe(true);
    expect(observation.frameGaps.length, 'measurements require observed frames').toBeGreaterThan(0);
    const layoutCount = after[0] - before[0];
    const recalcStyleCount = after[1] - before[1];
    expect(layoutCount).toBeGreaterThanOrEqual(0);
    expect(recalcStyleCount).toBeGreaterThanOrEqual(0);
    return {
      layoutCount,
      recalcStyleCount,
      maxFrameGap: Math.max(...observation.frameGaps),
      frameGaps: observation.frameGaps,
      longTasks: observation.longTasks,
    };
  } finally {
    if (!page.isClosed()) await page.evaluate(() => window.__contractObservation?.stop());
    await cdp.detach();
  }
}

/** Each target is already rendered in overscan. Verify its logical position after scrolling. */
export async function scrollCheckpoints(page: Page, checkpoints = 24, rowStep = 3): Promise<void> {
  await page.evaluate(
    async ({ selector, checkpoints, rowStep }) => {
      const viewport = document.querySelector<HTMLElement>(selector)!;
      for (let i = 1; i <= checkpoints; i++) {
        const id = `row-${i * rowStep}`;
        const row = () => viewport.querySelector<HTMLElement>(`[data-draggable-id="${id}"]`);
        if (!row()) throw new Error(`Missing logical scroll target ${id}`);
        const offset = () =>
          row()!.getBoundingClientRect().top -
          viewport.getBoundingClientRect().top -
          viewport.clientTop;
        viewport.scrollTop += offset();
        for (let frame = 0; frame < 2; frame++)
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        if (!row() || Math.abs(offset()) > 2) throw new Error(`Scroll target ${id} did not align`);
      }
    },
    { selector: VIEWPORT, checkpoints, rowStep },
  );
}
