import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  compareExperiment,
  EXIT_CODES,
  renderComparisonMarkdown,
  validateScenarios,
} from './fixtures/compare-metrics.ts';
import { extractScenarios } from './fixtures/extract-scenarios.ts';
import type { Comparison } from './fixtures/run-types.ts';

function argument(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value.`);
  return value;
}
function historicalComparison(
  baselinePath: string,
  currentPath: string,
  thresholdPercent: number,
): Comparison {
  const baseline = extractScenarios(resolve(baselinePath));
  const current = extractScenarios(resolve(currentPath));
  const reasons = [
    ...validateScenarios(baseline).map((reason) => `Baseline: ${reason}`),
    ...validateScenarios(current).map((reason) => `Current: ${reason}`),
  ];
  const readInfo = (file: string) => {
    const data = JSON.parse(readFileSync(resolve(file), 'utf8'));
    if (
      typeof data.config?.version !== 'string' ||
      !data.config.version ||
      typeof data.stats?.startTime !== 'string' ||
      !Number.isFinite(Date.parse(data.stats.startTime))
    )
      reasons.push(`${file}: missing Playwright version or start timestamp.`);
    return { browser: data.config?.version, start: data.stats?.startTime };
  };
  const b = readInfo(baselinePath);
  const c = readInfo(currentPath);
  if (b.browser !== c.browser) reasons.push('Historical runs use different Playwright versions.');
  for (const scenario of baseline) {
    const other = current.find((report) => report.scenario === scenario.scenario);
    if (!other) continue;
    if (JSON.stringify(scenario.workload) !== JSON.stringify(other.workload))
      reasons.push(`${scenario.scenario}: historical workload definitions differ.`);
    if (scenario.raw.some((sample) => sample.browserVersion !== other.raw[0]?.browserVersion))
      reasons.push(`${scenario.scenario}: historical browser versions differ.`);
  }
  if (reasons.length) return { verdict: 'invalid', reasons, rows: [], blocks: 0, thresholdPercent };
  return {
    verdict: 'inconclusive',
    reasons: [
      'Historical standalone runs have no adjacent balanced blocks or common experiment identity. They cannot support a regression gate; collect an experiment with npm run perf:ab.',
    ],
    rows: [],
    blocks: 0,
    thresholdPercent,
  };
}

export function main(args = process.argv.slice(2)): number {
  let result: Comparison;
  let output: string | undefined;
  let json: string | undefined;
  let thresholdPercent = 10;
  try {
    const allowed = new Set([
      '--experiment',
      '--baseline',
      '--current',
      '--threshold',
      '--output',
      '--json',
    ]);
    for (let i = 0; i < args.length; i += 2)
      if (!allowed.has(args[i]))
        throw new Error(`Unknown option ${args[i]}. Incompatible evidence cannot bypass the gate.`);
    output = argument(args, '--output');
    json = argument(args, '--json');
    thresholdPercent = Number(argument(args, '--threshold') ?? '10');
    if (!Number.isFinite(thresholdPercent) || thresholdPercent < 0)
      throw new Error('--threshold must be finite and nonnegative.');
    const baseline = argument(args, '--baseline');
    const current = argument(args, '--current');
    const experimentPath = argument(args, '--experiment');
    if (baseline !== undefined || current !== undefined) {
      if (!baseline || !current || experimentPath)
        throw new Error(
          'Historical comparison requires --baseline and --current together, without --experiment.',
        );
      result = historicalComparison(baseline, current, thresholdPercent);
    } else {
      const experiment = JSON.parse(
        readFileSync(
          resolve(experimentPath ?? resolve(import.meta.dirname, 'results/experiment.json')),
          'utf8',
        ),
      );
      result = compareExperiment(experiment, { thresholdPercent });
    }
  } catch (error) {
    result = {
      verdict: 'invalid',
      reasons: [error instanceof Error ? error.message : String(error)],
      rows: [],
      blocks: 0,
      thresholdPercent,
    };
  }
  const markdown = renderComparisonMarkdown(result);
  console.log(markdown);
  try {
    if (output) writeFileSync(resolve(output), markdown);
    if (json) writeFileSync(resolve(json), JSON.stringify(result, null, 2) + '\n');
  } catch (error) {
    console.error(
      `Failed to save comparison evidence: ${error instanceof Error ? error.message : String(error)}`,
    );
    return EXIT_CODES.invalid;
  }
  return EXIT_CODES[result.verdict];
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  process.exitCode = main();
