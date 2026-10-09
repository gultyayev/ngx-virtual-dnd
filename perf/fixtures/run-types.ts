import type { ScenarioMetrics } from './metric-math.ts';

export const EXPECTED_SCENARIOS = {
  'scroll-2000-items': 'fixed-work',
  'drag-within-list-1000': 'fixed-work',
  'drag-within-virtual-for-list': 'fixed-work',
  'dynamic-height-scroll': 'fixed-work',
  'dynamic-height-long-list-scroll': 'fixed-work',
  'drag-between-lists-autoscroll-1000': 'paced',
} as const;

export type Variant = 'base' | 'head';
export type BenchmarkProfile = 'counts' | 'timing';
export type WorkloadDefinition = Record<string, string | number | boolean>;

export interface ScenarioReport {
  scenario: string;
  kind: 'fixed-work' | 'paced';
  metricsSchemaVersion: number;
  cpuThrottle: number;
  setupCpuThrottle: number;
  iterations: number;
  warmupIterations: number;
  completed: boolean;
  workload: WorkloadDefinition;
  raw: ScenarioMetrics[];
  warmupRaw: ScenarioMetrics[];
  [metric: string]: unknown;
}

export interface HealthSnapshot {
  timestamp: string;
  loadAverage: number[];
  freeMemoryBytes: number;
  cpuTime: { idle: number; total: number };
  pressure: Record<string, number | null>;
}

export interface BenchmarkRun {
  variant: Variant;
  startedAt: string;
  sourceFile: string;
  healthBefore: HealthSnapshot;
  healthAfter: HealthSnapshot;
  scenarios: ScenarioReport[];
}

export interface BalancedBlock {
  index: number;
  order: Variant[];
  runs: BenchmarkRun[];
}

export interface Experiment {
  formatVersion: 1;
  /** Predeclared plan; a cancelled prefix must never become a completed experiment. */
  requestedBlocks: number;
  completed: boolean;
  mode: 'comparison' | 'calibration';
  /** Omitted by historical experiments, which use the timing decision. */
  profile?: BenchmarkProfile;
  harnessHash: string;
  environment: Record<string, unknown>;
  variants: Record<Variant, { commit: string; dependencyHash: string; libraryHash: string }>;
  blocks: BalancedBlock[];
}

export type Verdict = 'pass' | 'regression' | 'inconclusive' | 'invalid';

export interface ComparisonRow {
  scenario: string;
  metric: string;
  baseline: number;
  current: number;
  changePercent: number | null;
  delta: number;
  /** Timing: simultaneous median budget-excess interval. Counts: no interval, both bounds null. */
  interval: [number | null, number | null];
  verdict: Exclude<Verdict, 'invalid'>;
}

export interface Comparison {
  profile?: BenchmarkProfile;
  verdict: Verdict;
  reasons: string[];
  rows: ComparisonRow[];
  blocks: number;
  thresholdPercent: number;
}
