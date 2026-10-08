import type { Page, TestInfo } from '@playwright/test';
import {
  aggregateScenarioMetrics,
  MetricsCollector,
  METRICS_SCHEMA_VERSION,
  type ScenarioMetrics,
  type WorkloadEvidence,
} from './metrics-collector';

export interface ScenarioDefinition {
  scenario: string;
  kind: 'fixed-work' | 'paced';
  cpuThrottle: number;
  workload: Record<string, string | number | boolean>;
}

function iterationCount(name: string, fallback: number, minimum: number): number {
  const configured = process.env[name];
  if (configured === undefined) return fallback;
  const value = Number(configured);
  if (!/^\d+$/.test(configured) || !Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${name} must be an integer greater than or equal to ${minimum}`);
  }
  return value;
}

/** A sample always starts from the same document and data, including discarded warmups. */
export async function runScenario(
  page: Page,
  testInfo: TestInfo,
  definition: ScenarioDefinition,
  callbacks: {
    setup: () => Promise<void>;
    run: () => Promise<WorkloadEvidence>;
    verify: (metrics: ScenarioMetrics) => Promise<void>;
  },
): Promise<void> {
  const iterations = iterationCount('PERF_ITERATIONS', 5, 1);
  const warmupIterations = iterationCount('PERF_WARMUP_ITERATIONS', 1, 0);
  const collector = new MetricsCollector(page);
  const raw: ScenarioMetrics[] = [];
  const warmupRaw: ScenarioMetrics[] = [];
  let completed = false;
  try {
    await collector.init();
    // Browser/app startup and Playwright's utility-script compilation are preparation,
    // not the measured workload. Throttling their compilation can stall Chromium.
    await collector.clearCpuThrottling();
    for (let i = 0; i < warmupIterations + iterations; i++) {
      await callbacks.setup();
      await collector.setCpuThrottling(definition.cpuThrottle);
      let metrics: ScenarioMetrics;
      try {
        metrics = await collector.measureScenario(callbacks.run);
      } finally {
        // Keep snapshots/observers inside the throttled interval, then restore normal
        // speed before functional assertions and preparation of the next document.
        await collector.clearCpuThrottling();
      }
      if (i >= warmupIterations) raw.push(metrics);
      else warmupRaw.push(metrics);
      // Functional assertions stay outside the performance measurement. Invalid warmups
      // also fail: otherwise a broken workload could quietly warm up a different path.
      await callbacks.verify(metrics);
    }
    completed = true;
  } finally {
    try {
      // Preserve partial/invalid outcomes for diagnosis. Extraction requires a passing
      // Playwright test and a complete raw set, so this cannot turn a failure into a pass.
      await testInfo.attach(definition.scenario, {
        body: JSON.stringify(
          {
            ...definition,
            metricsSchemaVersion: METRICS_SCHEMA_VERSION,
            iterations,
            warmupIterations,
            setupCpuThrottle: 1,
            completed,
            warmupRaw,
            raw,
            ...(raw.length ? aggregateScenarioMetrics(raw) : {}),
          },
          null,
          2,
        ),
        contentType: 'application/json',
      });
    } finally {
      await collector.dispose();
    }
  }
}
