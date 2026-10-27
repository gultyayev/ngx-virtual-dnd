import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { generateExperimentReport } from './report.ts';

const directory = resolve('perf/results');
mkdirSync(directory, { recursive: true });
const experiment = resolve(directory, 'experiment.json');
const lines = [
  'Virtualization contracts and candidate-demo smoke checks passed before this investigation.',
  '',
];
const failures = [
  resolve(directory, 'build-failure.md'),
  resolve('../base/perf/results/build-failure.md'),
];
if (existsSync(experiment)) {
  const data = JSON.parse(readFileSync(experiment, 'utf8'));
  lines.push(generateExperimentReport(data));
  writeFileSync(
    resolve(directory, 'report-details.md'),
    generateExperimentReport(data, 10, { details: true }),
  );
  const counts = resolve(directory, 'count-comparison.md');
  lines.push(
    '',
    '**Enforced layout/style count decision**',
    '',
    existsSync(counts)
      ? readFileSync(counts, 'utf8')
      : 'Count evidence is missing; the job must fail.',
  );
} else {
  const failure = failures.find(existsSync);
  lines.push(
    failure
      ? readFileSync(failure, 'utf8')
      : '**No completed timing evidence.** See the workflow logs for the original setup error.',
  );
}
lines.push(
  '',
  'Timing regressions and inconclusive bounds are advisory until hosted-runner calibration establishes useful detection and false-alarm rates. Count budgets and evidence integrity are enforced.',
);
writeFileSync(resolve(directory, 'report.md'), lines.join('\n') + '\n');
console.log(lines.join('\n'));
