import { appendFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AggregatedMetrics } from './fixtures/statistics.ts';
import { extractScenarios } from './fixtures/extract-scenarios.ts';

const METRIC_LABELS: Record<string, { label: string; unit: string }> = {
  totalBlockingTime: { label: 'Total Blocking Time', unit: 'ms' },
  longTaskCount: { label: 'Long Tasks (>50ms)', unit: '' },
  layoutCount: { label: 'Layouts', unit: '' },
  recalcStyleCount: { label: 'Style Recalcs', unit: '' },
  scriptDuration: { label: 'Script Time', unit: 'ms' },
  taskDuration: { label: 'Main-Thread Task Time', unit: 'ms' },
  avgFrameTime: { label: 'Avg Frame Time', unit: 'ms' },
  maxFrameGap: { label: 'Max Frame Gap', unit: 'ms' },
  droppedFrames: { label: 'Dropped Frames (>25ms)', unit: '' },
  // Informational only — not gated: at the frame counts our scenarios collect,
  // nearest-rank p99 resolves to the maximum, duplicating Max Frame Gap.
  p99FrameTime: { label: 'p99 Frame Time (not gated)', unit: 'ms' },
};

function formatValue(value: number, unit: string): string {
  const rounded = Math.round(value * 10) / 10;
  return unit ? `${rounded} ${unit}` : `${rounded}`;
}

function generateReport(scenarios: { scenario: string; [k: string]: unknown }[]): string {
  const lines: string[] = [];

  lines.push('## Performance Benchmark Results');
  lines.push('');
  lines.push(`> CPU throttling: **4x** · Samples: **5** (1 warmup iteration excluded)`);
  lines.push(
    '> The regression gate compares **medians** (noise band = 3 × baseline MAD); Max shows the worst single iteration.',
  );
  lines.push('');

  for (const scenario of scenarios) {
    lines.push(`### ${scenario.scenario}`);
    lines.push('');
    lines.push('| Metric | Median | MAD | Mean | Max |');
    lines.push('|--------|--------|-----|------|-----|');

    for (const [key, meta] of Object.entries(METRIC_LABELS)) {
      const m = scenario[key] as AggregatedMetrics | undefined;
      if (!m) continue;

      lines.push(
        `| ${meta.label} | **${formatValue(m.median, meta.unit)}** | ±${formatValue(m.mad ?? 0, meta.unit)} | ${formatValue(m.mean, meta.unit)} | ${formatValue(m.max, meta.unit)} |`,
      );
    }

    lines.push('');
  }

  return lines.join('\n');
}

function main(): void {
  const args = process.argv.slice(2);
  const inputIdx = args.indexOf('--input');
  const inputPath =
    inputIdx !== -1 && args[inputIdx + 1]
      ? resolve(args[inputIdx + 1])
      : resolve(import.meta.dirname, 'results/latest.json');

  const outputIdx = args.indexOf('--output');
  const outputPath = outputIdx !== -1 ? args[outputIdx + 1] : undefined;

  if (!existsSync(inputPath)) {
    console.error(`Results file not found: ${inputPath}`);
    process.exit(1);
  }

  const scenarios = extractScenarios(inputPath);
  if (scenarios.length === 0) {
    console.log('No benchmark data found in results.');
    process.exit(0);
  }

  const report = generateReport(scenarios);
  console.log(report);

  if (outputPath) {
    appendFileSync(outputPath, report + '\n');
  }
}

main();
