/** Synthetic observations for comparison/report tests; never used by the benchmark runner. */
import {
  EXPECTED_SCENARIOS,
  type BenchmarkProfile,
  type Experiment,
  type ScenarioReport,
} from './run-types.ts';
export function makeExperiment(blocks = 10, profile?: BenchmarkProfile): Experiment {
  const reports = (): ScenarioReport[] =>
    Object.entries(EXPECTED_SCENARIOS).map(([scenario, kind]) => {
      const scroll = kind === 'fixed-work' && scenario.includes('scroll');
      const report = {
        scenario,
        kind,
        metricsSchemaVersion: 4,
        cpuThrottle: 4,
        setupCpuThrottle: 1,
        iterations: 1,
        completed: true,
        warmupIterations: profile === 'counts' ? 0 : 1,
        warmupRaw: [],
        workload: scroll ? { checkpoints: 2, items: 2000 } : { pointerSteps: 20, items: 1000 },
        raw: [
          {
            taskDuration: 100,
            layoutCount: 20,
            recalcStyleCount: 40,
            scriptDuration: 60,
            durationMs: kind === 'paced' ? 4000 : 1000,
            windowStartMs: 100,
            windowEndMs: kind === 'paced' ? 4100 : 1100,
            counterWindowMs: kind === 'paced' ? 4001 : 1001,
            frameCount: 2,
            frameTimes: [1000 / 60, 1000 / 60],
            avgFrameTime: 1000 / 60,
            maxFrameGap: 1000 / 60,
            jankIntervalCount: 0,
            frameOverBudgetMs: 0,
            longTaskCount: 0,
            totalBlockingTime: 0,
            longTasks: [],
            visibilityState: 'visible',
            browserVersion: 'test-browser',
            workload: scroll
              ? {
                  operations: 2,
                  completed: true,
                  startScrollTop: 0,
                  endScrollTop: 100,
                  scrollDistance: 100,
                  visitedRows: ['0', '1', '2'],
                  checkpointRows: ['1', '2'],
                  finalTargetRow: '2',
                }
              : {
                  operations: 21,
                  completed: true,
                  startScrollTop: 0,
                  endScrollTop: kind === 'paced' ? 100 : 0,
                  scrollDistance: kind === 'paced' ? 100 : 0,
                  sourceId: '0',
                  destinationIndex: 4,
                  ...(kind === 'paced' ? { holdDurationMs: 3000, holdElapsedMs: 3010 } : {}),
                },
          },
        ],
      } as ScenarioReport;
      report['warmupRaw'] = profile === 'counts' ? [] : structuredClone(report.raw);
      return report;
    });
  const health = (ms: number) => ({
    timestamp: new Date(ms).toISOString(),
    loadAverage: [0, 0, 0],
    freeMemoryBytes: 1024,
    cpuTime: { idle: ms, total: ms * 2 },
    pressure: { cpu: null },
  });
  return {
    formatVersion: 1,
    requestedBlocks: blocks,
    completed: true,
    mode: 'comparison',
    ...(profile === undefined ? {} : { profile }),
    harnessHash: 'common-harness',
    environment: {
      nodeVersion: '24',
      playwrightVersion: '1.63',
      browserVersion: 'test-browser',
      viewport: { width: 1280, height: 720 },
      deviceScaleFactor: 1,
      headless: true,
      cpuThrottle: 4,
    },
    variants: {
      base: { commit: 'base-sha', dependencyHash: 'common-deps', libraryHash: 'a'.repeat(64) },
      head: { commit: 'head-sha', dependencyHash: 'common-deps', libraryHash: 'b'.repeat(64) },
    },
    blocks: Array.from({ length: blocks }, (_, index) => {
      const order: ('base' | 'head')[] =
        index % 2 ? ['head', 'base', 'base', 'head'] : ['base', 'head', 'head', 'base'];
      return {
        index,
        order,
        runs: order.map((variant, position) => {
          const ms = 100000 + (index * 4 + position) * 1000;
          return {
            variant,
            startedAt: new Date(ms + 1).toISOString(),
            sourceFile: `${index}-${position}.json`,
            healthBefore: health(ms),
            healthAfter: health(ms + 500),
            scenarios: reports(),
          };
        }),
      };
    }),
  };
}
