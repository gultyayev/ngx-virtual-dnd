import { CDPSession, Page } from '@playwright/test';
import {
  computeTotalBlockingTime,
  countDroppedFrames,
  filterLongTasksSince,
  percentile,
  METRICS_SCHEMA_VERSION,
  type LongTask,
} from './metric-math';

export type { LongTask };
export { METRICS_SCHEMA_VERSION };

/** Page globals shared between injectObservers() and collectObserverResults(). */
interface PerfWindow extends Window {
  __perfObserver?: PerformanceObserver;
  __perfLongTasks?: LongTask[];
  __perfFrames?: number[];
  __perfLastFrameTime?: number;
  __perfTrackingActive?: boolean;
  __perfScenarioStart?: number;
}

export interface PerfSnapshot {
  timestamp: number;
  layoutCount: number;
  recalcStyleCount: number;
}

export interface ScenarioMetrics {
  durationMs: number;
  longTaskCount: number;
  totalBlockingTime: number;
  layoutCount: number;
  recalcStyleCount: number;
  frameCount: number;
  avgFrameTime: number;
  maxFrameGap: number;
  droppedFrames: number;
  p99FrameTime: number;
}

export class MetricsCollector {
  #page: Page;
  #cdp: CDPSession | null = null;

  constructor(page: Page) {
    this.#page = page;
  }

  async init(): Promise<void> {
    this.#cdp = await this.#page.context().newCDPSession(this.#page);
    await this.#cdp.send('Performance.enable');
  }

  async setCpuThrottling(rate: number): Promise<void> {
    await this.#cdp!.send('Emulation.setCPUThrottlingRate', { rate });
  }

  async clearCpuThrottling(): Promise<void> {
    await this.#cdp!.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  }

  async getSnapshot(): Promise<PerfSnapshot> {
    const { metrics } = await this.#cdp!.send('Performance.getMetrics');
    const get = (name: string) => metrics.find((m) => m.name === name)?.value ?? 0;
    return {
      timestamp: Date.now(),
      layoutCount: get('LayoutCount'),
      recalcStyleCount: get('RecalcStyleCount'),
    };
  }

  /**
   * Inject a PerformanceObserver for long tasks and an rAF-based frame tracker into the page.
   * Must be called immediately before the scenario runs.
   *
   * A single observer is kept on `window.__perfObserver`; any observer left over
   * from a previous iteration is disconnected first so stale observers can't push
   * duplicate long tasks into the current iteration's array (issue #42, problem 1).
   * `buffered` is intentionally omitted so history from page load / warmup isn't
   * replayed into the measured window (issue #42, problem 2).
   */
  async injectObservers(): Promise<void> {
    await this.#page.evaluate(() => {
      const w = window as PerfWindow;

      w.__perfObserver?.disconnect();

      w.__perfLongTasks = [];
      w.__perfFrames = [];
      w.__perfLastFrameTime = 0;
      w.__perfTrackingActive = true;
      w.__perfScenarioStart = performance.now();

      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          w.__perfLongTasks?.push({ startTime: entry.startTime, duration: entry.duration });
        }
      });
      observer.observe({ type: 'longtask' });
      w.__perfObserver = observer;

      const trackFrame = () => {
        const now = performance.now();
        const lastFrameTime = w.__perfLastFrameTime ?? 0;
        if (lastFrameTime > 0) {
          w.__perfFrames?.push(now - lastFrameTime);
        }
        w.__perfLastFrameTime = now;
        if (w.__perfTrackingActive) {
          requestAnimationFrame(trackFrame);
        }
      };
      requestAnimationFrame(trackFrame);
    });
  }

  async collectObserverResults(): Promise<{
    longTasks: LongTask[];
    frameTimes: number[];
    scenarioStart: number;
  }> {
    return this.#page.evaluate(() => {
      const w = window as PerfWindow;
      w.__perfTrackingActive = false;
      const longTasks = w.__perfLongTasks ?? [];
      const observer = w.__perfObserver;
      if (observer) {
        // Flush any records not yet delivered to the callback, then disconnect
        // so this observer can never fire into a later iteration's array.
        for (const entry of observer.takeRecords()) {
          longTasks.push({ startTime: entry.startTime, duration: entry.duration });
        }
        observer.disconnect();
        w.__perfObserver = undefined;
      }
      return {
        longTasks,
        frameTimes: w.__perfFrames ?? [],
        scenarioStart: w.__perfScenarioStart ?? 0,
      };
    });
  }

  /**
   * Measure a scenario: takes snapshots, injects observers, runs the scenario,
   * then collects all metrics.
   */
  async measureScenario(scenario: () => Promise<void>): Promise<ScenarioMetrics> {
    const before = await this.getSnapshot();
    await this.injectObservers();
    const startTime = Date.now();

    await scenario();

    const durationMs = Date.now() - startTime;
    const after = await this.getSnapshot();
    const { longTasks, frameTimes, scenarioStart } = await this.collectObserverResults();

    // Attribute only long tasks that started within the measured window.
    const scenarioTasks = filterLongTasksSince(longTasks, scenarioStart);
    const totalBlockingTime = computeTotalBlockingTime(scenarioTasks);

    const frameCount = frameTimes.length;
    const avgFrameTime = frameCount > 0 ? frameTimes.reduce((a, b) => a + b, 0) / frameCount : 0;
    const maxFrameGap = frameCount > 0 ? Math.max(...frameTimes) : 0;
    const droppedFrames = countDroppedFrames(frameTimes);
    const p99FrameTime = percentile(frameTimes, 0.99);

    return {
      durationMs,
      longTaskCount: scenarioTasks.length,
      totalBlockingTime,
      layoutCount: after.layoutCount - before.layoutCount,
      recalcStyleCount: after.recalcStyleCount - before.recalcStyleCount,
      frameCount,
      avgFrameTime,
      maxFrameGap,
      droppedFrames,
      p99FrameTime,
    };
  }

  async dispose(): Promise<void> {
    await this.clearCpuThrottling();
    if (this.#cdp) {
      await this.#cdp.detach();
    }
  }
}
