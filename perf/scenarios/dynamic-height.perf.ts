import { test } from '@playwright/test';
import {
  MetricsCollector,
  ScenarioMetrics,
  METRICS_SCHEMA_VERSION,
} from '../fixtures/metrics-collector';
import { PerfPage } from '../fixtures/perf.page';
import { aggregate } from '../fixtures/statistics';

const ITERATIONS = 5;
const WARMUP_ITERATIONS = 1;
const CPU_THROTTLE = 4;
const LONG_LIST_COUNT = 100_000;
/** Pixels scrolled per run: about 250 rows of the demo's 56-120px rows */
const LONG_LIST_SCROLL_DISTANCE = 20_000;

test.describe('Dynamic Height Scroll Performance', () => {
  test('scroll through dynamic height list', async ({ page }, testInfo) => {
    const perfPage = new PerfPage(page);
    const collector = new MetricsCollector(page);
    await collector.init();
    await collector.setCpuThrottling(CPU_THROTTLE);

    // Navigate to the dynamic height demo (150 tasks by default with varying heights)
    await perfPage.goto('/dynamic-height');

    const results: ScenarioMetrics[] = [];
    const totalRuns = WARMUP_ITERATIONS + ITERATIONS;

    for (let i = 0; i < totalRuns; i++) {
      // Reset scroll to top via Ionic's IonContent scroll container
      await page.evaluate(() => {
        const scrollable = document.querySelector('[vdndScrollable]') as HTMLElement;
        if (scrollable) scrollable.scrollTop = 0;
      });
      await page.waitForTimeout(300);

      const metrics = await collector.measureScenario(async () => {
        // Scroll to the bottom of the dynamic-height list
        // 150 items * ~80px estimated height = ~12000px, but heights vary
        await page.evaluate(() => {
          return new Promise<void>((resolve) => {
            const scrollable = document.querySelector('[vdndScrollable]') as HTMLElement;
            if (!scrollable) {
              resolve();
              return;
            }
            const target = scrollable.scrollHeight;
            const start = scrollable.scrollTop;
            const delta = target - start;
            const duration = 2000;
            const startTime = performance.now();
            const step = () => {
              const elapsed = performance.now() - startTime;
              const progress = Math.min(elapsed / duration, 1);
              const eased =
                progress < 0.5 ? 2 * progress * progress : 1 - (-2 * progress + 2) ** 2 / 2;
              scrollable.scrollTop = start + delta * eased;
              if (progress < 1) {
                requestAnimationFrame(step);
              } else {
                resolve();
              }
            };
            requestAnimationFrame(step);
          });
        });
      });

      if (i >= WARMUP_ITERATIONS) {
        results.push(metrics);
      }
    }

    const report = {
      scenario: 'dynamic-height-scroll',
      metricsSchemaVersion: METRICS_SCHEMA_VERSION,
      cpuThrottle: CPU_THROTTLE,
      iterations: ITERATIONS,
      totalBlockingTime: aggregate(results.map((r) => r.totalBlockingTime)),
      longTaskCount: aggregate(results.map((r) => r.longTaskCount)),
      layoutCount: aggregate(results.map((r) => r.layoutCount)),
      recalcStyleCount: aggregate(results.map((r) => r.recalcStyleCount)),
      avgFrameTime: aggregate(results.map((r) => r.avgFrameTime)),
      maxFrameGap: aggregate(results.map((r) => r.maxFrameGap)),
      droppedFrames: aggregate(results.map((r) => r.droppedFrames)),
      p99FrameTime: aggregate(results.map((r) => r.p99FrameTime)),
    };

    testInfo.attach('dynamic-height-scroll', {
      body: JSON.stringify(report, null, 2),
      contentType: 'application/json',
    });

    await collector.dispose();
  });

  test('scroll through rows never measured in a long dynamic height list', async ({
    page,
  }, testInfo) => {
    const perfPage = new PerfPage(page);
    const collector = new MetricsCollector(page);
    await collector.init();
    await collector.setCpuThrottling(CPU_THROTTLE);

    // Every frame of this scroll measures rows rendered for the first time, then reads the list's
    // offsets and height: the interleaved measure/lookup pattern of a long list (issue #29).
    await perfPage.goto(`/dynamic-height?count=${LONG_LIST_COUNT}`);

    const results: ScenarioMetrics[] = [];
    const totalRuns = WARMUP_ITERATIONS + ITERATIONS;

    for (let i = 0; i < totalRuns; i++) {
      // Each run starts where the previous one ended, so all but its first screen of rows are
      // unmeasured
      const start = i * LONG_LIST_SCROLL_DISTANCE;
      await page.evaluate((top) => {
        const scrollable = document.querySelector('[vdndScrollable]') as HTMLElement;
        scrollable.scrollTop = top;
      }, start);
      await page.waitForTimeout(300);

      const metrics = await collector.measureScenario(() =>
        perfPage.smoothScroll('[vdndScrollable]', start + LONG_LIST_SCROLL_DISTANCE, 2000),
      );

      if (i >= WARMUP_ITERATIONS) {
        results.push(metrics);
      }
    }

    const report = {
      scenario: 'dynamic-height-long-list-scroll',
      metricsSchemaVersion: METRICS_SCHEMA_VERSION,
      cpuThrottle: CPU_THROTTLE,
      iterations: ITERATIONS,
      totalBlockingTime: aggregate(results.map((r) => r.totalBlockingTime)),
      longTaskCount: aggregate(results.map((r) => r.longTaskCount)),
      layoutCount: aggregate(results.map((r) => r.layoutCount)),
      recalcStyleCount: aggregate(results.map((r) => r.recalcStyleCount)),
      avgFrameTime: aggregate(results.map((r) => r.avgFrameTime)),
      maxFrameGap: aggregate(results.map((r) => r.maxFrameGap)),
      droppedFrames: aggregate(results.map((r) => r.droppedFrames)),
      p99FrameTime: aggregate(results.map((r) => r.p99FrameTime)),
    };

    testInfo.attach('dynamic-height-long-list-scroll', {
      body: JSON.stringify(report, null, 2),
      contentType: 'application/json',
    });

    await collector.dispose();
  });
});
