import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import { CONTRACT_CASES } from './contracts/cases.ts';

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
    interface Spec {
      title: string;
      tests: { status: string; results: { status: string; retry: number }[] }[];
    }
    interface Suite {
      specs?: Spec[];
      suites?: Suite[];
    }
    const specs: Spec[] = [];
    const collect = (suite: Suite) => {
      specs.push(...(suite.specs ?? []));
      suite.suites?.forEach(collect);
    };
    (report.suites as Suite[]).forEach(collect);
    const titles = new Set(specs.map((spec) => spec.title));
    valid =
      specs.length === CONTRACT_CASES.length &&
      titles.size === specs.length &&
      CONTRACT_CASES.every(({ title }) => titles.has(title)) &&
      specs.every(
        (spec) =>
          spec.tests.length === 1 &&
          spec.tests.every(
            (test) =>
              test.status === 'expected' &&
              test.results.length === 1 &&
              test.results[0].status === 'passed' &&
              test.results[0].retry === 0,
          ),
      ) &&
      stats.unexpected === 0 &&
      stats.skipped === 0 &&
      stats.flaky === 0 &&
      stats.expected === CONTRACT_CASES.length &&
      report.errors?.length === 0;
    lines.push(
      valid
        ? '**Virtualization contracts passed.**'
        : '**Virtualization checks failed or are incomplete.**',
    );
    lines.push(
      '',
      '1k / 10k / 100k items · both renderers · fixed and dynamic heights · no retries',
      '',
      '| Renderer / heights | Host checks (1k / 10k / 100k) | Row checks | ID reads | Layouts:styles | Pooled at destroy | Initial render, ms |',
      '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
    );
    const errors = new Set<string>();
    const drags: string[] = [];
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
          pooled: number;
          metrics: { layoutCount: number; recalcStyleCount: number };
          work: { hostChecks: number; rowChecks: number; keyReads: number };
        }[];
        lines.push(
          `| ${data.renderer} / ${data.dynamic ? 'dynamic' : 'fixed'} | ${rows.map((r) => r.work.hostChecks).join(' / ')} | ${rows.map((r) => r.work.rowChecks).join(' / ')} | ${rows.map((r) => r.work.keyReads).join(' / ')} | ${rows.map((r) => `${r.metrics.layoutCount}:${r.metrics.recalcStyleCount}`).join(' / ')} | ${rows.map((r) => r.pooled).join(' / ')} | ${rows.map((r) => r.mountMs.toFixed(1)).join(' / ')} |`,
        );
      }
      if (item['name'] === 'placeholder-work' && typeof item['body'] === 'string') {
        const data = JSON.parse(Buffer.from(item['body'], 'base64').toString('utf8'));
        drags.push(
          `| ${data.renderer} / ${data.dynamic ? 'dynamic' : 'fixed'} | ${data.work.hostChecks} / ${data.work.rowChecks} | ${data.metrics.layoutCount} / ${data.metrics.recalcStyleCount} |`,
        );
      }
      Object.values(item).forEach(walk);
    };
    walk(report);
    if (drags.length)
      lines.push(
        '',
        '| Placeholder movement | Host / row checks | Layouts / styles |',
        '| --- | ---: | ---: |',
        ...drags,
      );
    if (errors.size)
      lines.push(
        '',
        '```text',
        [...errors].join('\n').slice(0, 6000).replaceAll('```', "'''"),
        '```',
      );
    lines.push(
      '',
      'Checks enforce bounded DOM and retained views, limited row checks and ID reads, bounded layout/style passes and long tasks, release on destroy, and coarse 500ms mount / 250ms scroll-stall limits at normal CPU speed. They do not certify 60 FPS or rule out smaller computational regressions.',
    );
  }
} catch (error) {
  valid = false;
  lines.splice(2, lines.length - 2, '**Invalid check evidence.** ' + String(error));
}
writeFileSync(output, lines.join('\n') + '\n');
console.log(lines.join('\n'));
process.exitCode = valid ? 0 : 1;
