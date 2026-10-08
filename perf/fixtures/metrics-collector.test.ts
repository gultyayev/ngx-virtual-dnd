import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Page } from '@playwright/test';
import { MetricsCollector } from './metrics-collector.ts';

/** Execute page callbacks against a small browser model, without a real renderer. */
function browserModel() {
  const originalGlobals = new Map<string, PropertyDescriptor | undefined>();
  const replace = (name: string, value: unknown) => {
    originalGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, value });
  };
  let now = 100;
  let disconnected = 0;
  let snapshots = 0;
  let versionReads = 0;
  let closed = false;
  let detachFailure: Error | undefined;
  let rafId = 0;
  const frames = new Map<number, FrameRequestCallback>();
  const tick = (ms: number) => {
    now += ms;
    const pending = [...frames.values()];
    frames.clear();
    for (const callback of pending) callback(now);
  };
  const visibilityListeners = new Set<() => void>();
  const w: Record<string, unknown> = {};
  class Observer {
    #entries: { startTime: number; duration: number }[] = [];
    observe() {
      /* This model only delivers records when takeRecords is called. */
    }
    takeRecords() {
      return this.#entries.splice(0);
    }
    disconnect() {
      disconnected++;
    }
    append(startTime: number, duration: number) {
      this.#entries.push({ startTime, duration });
    }
  }
  replace('window', w);
  const doc = {
    visibilityState: 'visible',
    addEventListener: (_event: string, callback: () => void) => visibilityListeners.add(callback),
    removeEventListener: (_event: string, callback: () => void) =>
      visibilityListeners.delete(callback),
  };
  replace('document', doc);
  replace('performance', { now: () => now });
  replace('PerformanceObserver', Observer);
  replace('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++rafId, callback);
    return rafId;
  });
  replace('cancelAnimationFrame', (id: number) => frames.delete(id));
  const cdp = {
    send: async (method: string) => {
      if (closed) throw new Error('Target page, context or browser has been closed');
      if (method !== 'Performance.getMetrics') return {};
      snapshots++;
      return {
        metrics: [
          { name: 'Timestamp', value: now / 1000 },
          { name: 'LayoutCount', value: snapshots * 4 },
          { name: 'RecalcStyleCount', value: snapshots * 6 },
          { name: 'ScriptDuration', value: snapshots * 0.04 },
          { name: 'TaskDuration', value: snapshots * 0.06 },
        ],
      };
    },
    detach: async () => {
      if (closed) throw new Error('Target page, context or browser has been closed');
      if (detachFailure) throw detachFailure;
    },
  };
  const page = {
    context: () => ({
      newCDPSession: async () => cdp,
      browser: () => ({
        version: () => {
          versionReads++;
          return 'test-browser';
        },
        isConnected: () => true,
      }),
    }),
    isClosed: () => closed,
    evaluate: async (callback: () => unknown, injectedWorkMs?: number) => {
      if (closed) throw new Error('Target page, context or browser has been closed');
      if (injectedWorkMs !== undefined) {
        now += injectedWorkMs;
        return;
      }
      const result = callback();
      // Awaited page work that schedules an animation frame advances the model
      // to the next rendering opportunity, as a real browser event loop would.
      if (result instanceof Promise) tick(16.67);
      return result;
    },
  } as unknown as Page;
  return {
    page,
    w,
    frames,
    visibilityListeners,
    get disconnected() {
      return disconnected;
    },
    get versionReads() {
      return versionReads;
    },
    close: () => {
      closed = true;
      frames.clear();
      visibilityListeners.clear();
    },
    failDetach: (error: Error) => {
      detachFailure = error;
    },
    advance: (ms: number) => {
      now += ms;
    },
    visibility: (state: string) => {
      doc.visibilityState = state;
      for (const listener of visibilityListeners) listener();
    },
    tick,
    appendTask: (startTime: number, duration: number) =>
      (w['__perfObserver'] as Observer).append(startTime, duration),
    restore: () => {
      for (const [name, descriptor] of originalGlobals) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else Reflect.deleteProperty(globalThis, name);
      }
    },
  };
}

test('failed workloads always stop frame collection and disconnect their observer', async () => {
  const model = browserModel();
  try {
    const collector = new MetricsCollector(model.page);
    await collector.init();
    await assert.rejects(
      collector.measureScenario(async () => {
        model.tick(16.67);
        throw new Error('workload failed');
      }),
      /workload failed/,
    );
    assert.equal(model.w['__perfTrackingActive'], false);
    assert.equal(model.disconnected, 1);
    assert.equal(model.frames.size, 0);
  } finally {
    model.restore();
  }
});

test('samples preserve raw bounded observations, monotonic duration, and workload evidence', async () => {
  const model = browserModel();
  try {
    const collector = new MetricsCollector(model.page);
    await collector.init();
    const sample = await collector.measureScenario(async () => {
      model.tick(16.67);
      model.tick(50);
      model.appendTask(99, 80);
      model.appendTask(120, 60);
      model.appendTask(200, 75);
      return { operations: 2, scrollDistance: 300, visitedRows: ['1', '2'] };
    });
    assert.ok(Math.abs(sample.durationMs - 83.34) < 0.001);
    assert.equal(sample.windowStartMs, 100);
    assert.ok(Math.abs(sample.windowEndMs - 183.34) < 0.001);
    assert.deepEqual(sample.longTasks, [{ startTime: 120, duration: 60 }]);
    assert.equal(sample.frameTimes.length, 2);
    assert.ok(Math.abs(sample.frameTimes[0] - 50) < 0.001);
    assert.equal(sample.jankIntervalCount, 1);
    assert.ok(Math.abs(sample.frameOverBudgetMs - 33.33) < 0.001);
    assert.equal(sample.visibilityState, 'visible');
    assert.equal(sample.browserVersion, 'test-browser');
    assert.ok(sample.counterWindowMs >= sample.durationMs - 0.001);
    assert.deepEqual(sample.workload, {
      operations: 2,
      scrollDistance: 300,
      visitedRows: ['1', '2'],
    });
    assert.equal(model.versionReads, 1);
    assert.equal(model.frames.size, 0);
  } finally {
    model.restore();
  }
});

test('a page hidden briefly during the workload is recorded as invalid visibility and listeners are removed', async () => {
  const model = browserModel();
  try {
    const collector = new MetricsCollector(model.page);
    await collector.init();
    const sample = await collector.measureScenario(async () => {
      model.visibility('hidden');
      model.advance(10);
      model.visibility('visible');
      return { operations: 1 };
    });
    assert.equal(sample.visibilityState, 'hidden');
    assert.equal(model.visibilityListeners.size, 0);
  } finally {
    model.restore();
  }
});

test('positive-control work is included in the measured window and preserved in evidence', async () => {
  const model = browserModel();
  const previous = process.env['PERF_CONTROL_WORK_MS'];
  process.env['PERF_CONTROL_WORK_MS'] = '50';
  try {
    const collector = new MetricsCollector(model.page);
    await collector.init();
    const sample = await collector.measureScenario(async () => {
      model.tick(16.67);
      model.advance(20);
      return { operations: 1 };
    });
    assert.ok(Math.abs(sample.durationMs - 103.34) < 0.001);
    assert.equal(sample.workload['injectedWorkMs'], 50);
    assert.ok(Math.abs(sample.counterWindowMs - 103.34) < 0.001);
    assert.ok(sample.maxFrameGap > 50, 'the injected stall must reach frame telemetry');
  } finally {
    if (previous === undefined) delete process.env['PERF_CONTROL_WORK_MS'];
    else process.env['PERF_CONTROL_WORK_MS'] = previous;
    model.restore();
  }
});

test('invalid positive-control configuration fails before measuring anything', async () => {
  const model = browserModel();
  const previous = process.env['PERF_CONTROL_WORK_MS'];
  try {
    for (const value of ['-1', 'NaN', '1001']) {
      process.env['PERF_CONTROL_WORK_MS'] = value;
      const collector = new MetricsCollector(model.page);
      await assert.rejects(collector.init(), /PERF_CONTROL_WORK_MS/);
    }
  } finally {
    if (previous === undefined) delete process.env['PERF_CONTROL_WORK_MS'];
    else process.env['PERF_CONTROL_WORK_MS'] = previous;
    model.restore();
  }
});

test('a final workload stall is observed by the next frame before the measurement closes', async () => {
  const model = browserModel();
  try {
    const collector = new MetricsCollector(model.page);
    await collector.init();
    const sample = await collector.measureScenario(async () => {
      model.tick(16.67);
      model.tick(16.67);
      model.advance(100);
      return { operations: 1 };
    });
    assert.ok(sample.maxFrameGap >= 100, 'the last stall must remain visible in the raw intervals');
    assert.ok(sample.frameOverBudgetMs >= 99.999);
    assert.equal(sample.jankIntervalCount, 1);
    assert.equal(model.frames.size, 0);
  } finally {
    model.restore();
  }
});

test('closed-page cleanup preserves the original workload failure and disposal succeeds', async () => {
  const model = browserModel();
  try {
    const collector = new MetricsCollector(model.page);
    await collector.init();
    const failure = new Error('Workload timed out');
    await assert.rejects(
      collector.measureScenario(async () => {
        model.close();
        throw failure;
      }),
      (error) => error === failure,
    );
    await collector.dispose();
  } finally {
    model.restore();
  }
});

test('genuine CDP cleanup failures on a live page remain failures', async () => {
  const model = browserModel();
  try {
    const collector = new MetricsCollector(model.page);
    await collector.init();
    const failure = new Error('CDP detach failed');
    model.failDetach(failure);
    await assert.rejects(collector.dispose(), (error) => error === failure);
  } finally {
    model.restore();
  }
});

test('a closed target after workload completion never produces a successful sample', async () => {
  const model = browserModel();
  try {
    const collector = new MetricsCollector(model.page);
    await collector.init();
    await assert.rejects(
      collector.measureScenario(async () => {
        model.close();
        return { operations: 1 };
      }),
      /Target.*closed/,
    );
    await collector.dispose();
  } finally {
    model.restore();
  }
});
