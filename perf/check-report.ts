import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { stripVTControlCharacters } from 'node:util';

const input = resolve('perf/results/check.json');
const output = resolve('perf/results/check.md');
mkdirSync(resolve('perf/results'), { recursive: true });
const lines = ['## Virtualization checks', ''];
let valid = false;
const buildFailure = resolve('perf/results/build-failure.md');
try {
  if (!existsSync(input) || existsSync(buildFailure)) {
    lines.push(
      existsSync(buildFailure)
        ? readFileSync(buildFailure, 'utf8')
        : '**Checks did not finish.** See build/workflow logs.',
    );
  } else {
    const report = JSON.parse(readFileSync(input, 'utf8'));
    const stats = report.stats ?? {};
    valid =
      stats.unexpected === 0 &&
      stats.skipped === 0 &&
      stats.flaky === 0 &&
      stats.expected === 13 &&
      report.errors?.length === 0;
    lines.push(
      valid
        ? '**Virtualization contracts and candidate-demo smoke checks passed.**'
        : '**Virtualization checks failed or are incomplete.**',
    );
    lines.push(
      '',
      '1k / 10k / 100k items · both renderers · fixed and dynamic heights · no retries',
      '',
      '| Renderer / heights | Row checks (1k / 10k / 100k) | ID reads | Initial render, ms |',
      '| --- | ---: | ---: | ---: |',
    );
    const errors = new Set<string>();
    const walk = (value: unknown): void => {
      if (Array.isArray(value)) {
        value.forEach(walk);
        return;
      }
      if (!value || typeof value !== 'object') return;
      const item = value as Record<string, unknown>;
      if (Array.isArray(item['errors']))
        for (const error of item['errors']) {
          if (error?.message) errors.add(stripVTControlCharacters(String(error.message)));
        }
      if (item['name'] === 'virtualization-scaling' && typeof item['body'] === 'string') {
        const data = JSON.parse(Buffer.from(item['body'], 'base64').toString('utf8'));
        const rows = data.results as {
          mountMs: number;
          work: { rowChecks: number; keyReads: number };
        }[];
        lines.push(
          `| ${data.renderer} / ${data.dynamic ? 'dynamic' : 'fixed'} | ${rows.map((r) => r.work.rowChecks).join(' / ')} | ${rows.map((r) => r.work.keyReads).join(' / ')} | ${rows.map((r) => r.mountMs.toFixed(1)).join(' / ')} |`,
        );
      }
      Object.values(item).forEach(walk);
    };
    walk(report);
    if (errors.size)
      lines.push(
        '',
        '```text',
        [...errors].join('\n').slice(0, 6000).replaceAll('```', "'''"),
        '```',
      );
    lines.push(
      '',
      'Checks enforce bounded DOM and retained views, limited row checks and ID reads, release on destroy, and coarse 500ms mount / 250ms scroll-stall limits at normal CPU speed. They do not certify 60 FPS or rule out smaller computational regressions. Apply `perf:timing` for a paired timing investigation.',
    );
  }
} catch (error) {
  valid = false;
  lines.splice(2, lines.length - 2, '**Invalid check evidence.** ' + String(error));
}
writeFileSync(output, lines.join('\n') + '\n');
console.log(lines.join('\n'));
process.exitCode = valid ? 0 : 1;
