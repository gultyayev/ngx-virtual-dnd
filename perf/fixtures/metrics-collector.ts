import type { CDPSession, Page } from '@playwright/test';
import {
  aggregateScenarioMetrics,
  computeFrameOverBudgetMs,
  computeTotalBlockingTime,
  countJankIntervals,
  filterLongTasksInWindow,
  readCdpMetric,
  readPerfCounters,
  METRICS_SCHEMA_VERSION,
  type LongTask,
  type PerfCounters,
  type ScenarioMetrics,
  type WorkloadEvidence,
} from './metric-math.ts';

export type { LongTask, ScenarioMetrics, WorkloadEvidence };
export { aggregateScenarioMetrics, METRICS_SCHEMA_VERSION };

/** Page globals shared between injectObservers() and collectObserverResults(). */
interface PerfWindow extends Window {
  __perfObserver?: PerformanceObserver;
  __perfLongTasks?: LongTask[];
  __perfFrames?: number[];
  __perfLastFrameTime?: number;
  __perfTrackingActive?: boolean;
  __perfScenarioStart?: number;
  __perfScenarioVisibility?: string;
  __perfVisibilityHandler?: () => void;
  __perfFrameRequest?: number;
}

export interface PerfSnapshot extends PerfCounters {
  timestamp: number;
}

export class MetricsCollector {
  #page: Page;
  #cdp: CDPSession | null = null;
  #browserVersion = '';
  #controlWorkMs = 0;

  constructor(page: Page) {
    this.#page = page;
  }

  async init(): Promise<void> {
    this.#controlWorkMs = Number(process.env['PERF_CONTROL_WORK_MS'] ?? 0);
    if (
      !Number.isFinite(this.#controlWorkMs) ||
      this.#controlWorkMs < 0 ||
      this.#controlWorkMs > 1000
    ) {
      throw new Error('PERF_CONTROL_WORK_MS must be a finite value between 0 and 1000');
    }
    this.#browserVersion = this.#page.context().browser()?.version() ?? '';
    if (!this.#browserVersion) throw new Error('Cannot measure without browser version metadata');
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
    return { timestamp: readCdpMetric(metrics, 'Timestamp') * 1000, ...readPerfCounters(metrics) };
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
      if (w.__perfFrameRequest !== undefined) cancelAnimationFrame(w.__perfFrameRequest);
      if (w.__perfVisibilityHandler)
        document.removeEventListener('visibilitychange', w.__perfVisibilityHandler);

      w.__perfLongTasks = [];
      w.__perfFrames = [];
      // Frame intervals require consecutive observed callbacks. The leading
      // partial window before the first callback is excluded; duration and
      // long-task observations still cover the complete scenario window.
      w.__perfLastFrameTime = 0;
      w.__perfTrackingActive = true;
      w.__perfScenarioStart = performance.now();
      w.__perfScenarioVisibility = document.visibilityState;
      w.__perfVisibilityHandler = () => {
        if (document.visibilityState !== 'visible') w.__perfScenarioVisibility = 'hidden';
      };
      document.addEventListener('visibilitychange', w.__perfVisibilityHandler);

      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          w.__perfLongTasks?.push({ startTime: entry.startTime, duration: entry.duration });
        }
      });
      observer.observe({ type: 'longtask' });
      w.__perfObserver = observer;

      const trackFrame = () => {
        if (!w.__perfTrackingActive) return;
        const now = performance.now();
        const lastFrameTime = w.__perfLastFrameTime ?? 0;
        if (lastFrameTime > 0) {
          w.__perfFrames?.push(now - lastFrameTime);
        }
        w.__perfLastFrameTime = now;
        if (w.__perfTrackingActive) {
          w.__perfFrameRequest = requestAnimationFrame(trackFrame);
        }
      };
      w.__perfFrameRequest = requestAnimationFrame(trackFrame);
    });
  }

  async collectObserverResults(): Promise<{
    longTasks: LongTask[];
    frameTimes: number[];
    scenarioStart: number;
    scenarioEnd: number;
    visibilityState: string;
  }> {
    return this.#page.evaluate(() => {
      const w = window as PerfWindow;
      const scenarioEnd = performance.now();
      w.__perfTrackingActive = false;
      if (w.__perfFrameRequest !== undefined) cancelAnimationFrame(w.__perfFrameRequest);
      w.__perfFrameRequest = undefined;
      if (w.__perfVisibilityHandler)
        document.removeEventListener('visibilitychange', w.__perfVisibilityHandler);
      w.__perfVisibilityHandler = undefined;
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
        scenarioStart: w.__perfScenarioStart ?? NaN,
        scenarioEnd,
        visibilityState:
          w.__perfScenarioVisibility === 'visible' && document.visibilityState === 'visible'
            ? 'visible'
            : 'hidden',
      };
    });
  }

  /**
   * Measure a scenario: takes snapshots, injects observers, runs the scenario,
   * then collects all metrics.
   */
  async measureScenario(scenario: () => Promise<WorkloadEvidence>): Promise<ScenarioMetrics> {
    const before = await this.getSnapshot();
    let observation: Awaited<ReturnType<MetricsCollector['collectObserverResults']>> | undefined;
    let workload: WorkloadEvidence | undefined;
    let workloadFailed = false;
    let workloadFailure: unknown;
    let observerFailed = false;
    let observerFailure: unknown;
    try {
      await this.injectObservers();
      workload = await scenario();
      if (this.#controlWorkMs > 0) {
        await this.#page.evaluate(
          (workMs: number) =>
            new Promise<void>((resolve) => {
              // Direct Runtime.evaluate execution can be excluded from normal
              // script/long-task instrumentation. Schedule an ordinary browser
              // task so all renderer metrics can observe this positive control.
              setTimeout(() => {
                const until = performance.now() + workMs;
                while (performance.now() < until) {
                  /* calibrated positive control */
                }
                resolve();
              }, 0);
            }),
          this.#controlWorkMs,
        );
        workload = { ...workload, injectedWorkMs: this.#controlWorkMs };
      }
      // A stall after the last delivered callback only becomes observable at
      // the next callback. Keep that final rendering opportunity inside the
      // measured window, including any deliberate positive-control work.
      await this.#page.evaluate(
        () =>
          new Promise<void>((resolve, reject) => {
            const frameRequest = requestAnimationFrame(() => {
              clearTimeout(timeout);
              resolve();
            });
            const timeout = setTimeout(() => {
              cancelAnimationFrame(frameRequest);
              reject(new Error('No post-work animation frame was observed within 5 seconds'));
            }, 5000);
          }),
      );
    } catch (error) {
      workloadFailed = true;
      workloadFailure = error;
    } finally {
      // Also run when the workload or observer injection fails. A pending rAF
      // otherwise keeps recording and can contaminate the next iteration.
      try {
        observation = await this.collectObserverResults();
      } catch (cleanupError) {
        observerFailed = true;
        observerFailure = cleanupError;
      }
    }
    if (workloadFailed) {
      if (observerFailed && !this.#targetDestroyed()) {
        throw new AggregateError(
          [workloadFailure, observerFailure],
          'The benchmark workload and observer cleanup both failed',
          { cause: workloadFailure },
        );
      }
      // Target destruction already removes its observers. Preserve the
      // workload's original error instead of replacing it with Targetclosed.
      throw workloadFailure;
    }
    if (observerFailed) throw observerFailure;
    if (!observation) throw new Error('No observer measurement was collected');
    // The counter snapshots deliberately bracket (rather than coincide with)
    // the observer window. Persist their wider monotonic window so CDP transport
    // and observer setup costs remain visible in the evidence.
    const after = await this.getSnapshot();
    const { longTasks, frameTimes, scenarioStart, scenarioEnd, visibilityState } = observation;
    const durationMs = scenarioEnd - scenarioStart;
    const counterWindowMs = after.timestamp - before.timestamp;
    if (
      !Number.isFinite(durationMs) ||
      durationMs <= 0 ||
      !Number.isFinite(counterWindowMs) ||
      counterWindowMs < 0
    ) {
      throw new Error('Invalid monotonic measurement window');
    }
    if (
      !workload ||
      !Number.isFinite(workload['operations']) ||
      Number(workload['operations']) <= 0
    ) {
      throw new Error('Scenario did not report completed workload operations');
    }

    // Attribute only long tasks that started within the measured window.
    const scenarioTasks = filterLongTasksInWindow(longTasks, scenarioStart, scenarioEnd);
    const totalBlockingTime = computeTotalBlockingTime(scenarioTasks);

    const frameCount = frameTimes.length;
    const avgFrameTime = frameCount > 0 ? frameTimes.reduce((a, b) => a + b, 0) / frameCount : 0;
    const maxFrameGap = frameCount > 0 ? Math.max(...frameTimes) : 0;
    const jankIntervalCount = countJankIntervals(frameTimes);
    const frameOverBudgetMs = computeFrameOverBudgetMs(frameTimes);
    const counters = {
      layoutCount: after.layoutCount - before.layoutCount,
      recalcStyleCount: after.recalcStyleCount - before.recalcStyleCount,
      scriptDuration: after.scriptDuration - before.scriptDuration,
      taskDuration: after.taskDuration - before.taskDuration,
    };
    if (Object.values(counters).some((value) => !Number.isFinite(value) || value < 0)) {
      throw new Error('Renderer counters decreased or were nonfinite across the scenario');
    }

    return {
      durationMs,
      longTaskCount: scenarioTasks.length,
      totalBlockingTime,
      ...counters,
      frameCount,
      avgFrameTime,
      maxFrameGap,
      jankIntervalCount,
      frameOverBudgetMs,
      frameTimes,
      longTasks: scenarioTasks,
      windowStartMs: scenarioStart,
      windowEndMs: scenarioEnd,
      visibilityState,
      browserVersion: this.#browserVersion,
      counterWindowMs,
      workload,
    };
  }

  async dispose(): Promise<void> {
    const cdp = this.#cdp;
    if (!cdp) return;
    const failures: unknown[] = [];
    try {
      if (this.#targetDestroyed()) return;
      try {
        await this.clearCpuThrottling();
      } catch (error) {
        if (!this.#targetDestroyed()) failures.push(error);
      }
      try {
        await cdp.detach();
      } catch (error) {
        if (!this.#targetDestroyed()) failures.push(error);
      }
    } finally {
      this.#cdp = null;
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) throw new AggregateError(failures, 'CDP cleanup failed');
  }

  #targetDestroyed(): boolean {
    return this.#page.isClosed() || this.#page.context().browser()?.isConnected() === false;
  }
}
