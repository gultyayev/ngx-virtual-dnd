/** Build the instrumented consumer separately from the demo and the npm library. */
import { spawn } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { stageFixture } from './build.ts';

const root = process.cwd();
const staging = mkdtempSync(resolve(tmpdir(), 'perf-contracts-'));
const output = resolve(root, 'dist/perf-contracts/browser');
const failureReport = resolve(root, 'perf/results/build-failure.md');
rmSync(output, { recursive: true, force: true });
rmSync(failureReport, { force: true });
let interrupted: NodeJS.Signals | undefined;
try {
  const fixture = stageFixture(root, root, staging);
  cpSync(resolve(root, 'perf/consumer'), resolve(staging, 'src/contract'), { recursive: true });
  writeFileSync(
    resolve(staging, 'src/contract/index.html'),
    '<!doctype html><html><head><base href="/"></head><body><app-root></app-root></body></html>',
  );
  const angular = JSON.parse(readFileSync(resolve(staging, 'angular.json'), 'utf8'));
  angular.projects[fixture.project].architect.build.options = {
    browser: 'src/contract/main.ts',
    index: 'src/contract/index.html',
    tsConfig: 'tsconfig.perf.json',
    assets: [],
    styles: [],
  };
  writeFileSync(resolve(staging, 'angular.json'), JSON.stringify(angular));
  writeFileSync(
    resolve(staging, 'tsconfig.perf.json'),
    JSON.stringify({
      extends: './tsconfig.app.json',
      compilerOptions: { paths: { 'ngx-virtual-dnd': ['./dist/ngx-virtual-dnd'] } },
      files: ['src/contract/main.ts'],
      include: [],
    }),
  );
  let compilerOutput = '';
  try {
    await new Promise<void>((resolveBuild, reject) => {
      const child = spawn(
        process.execPath,
        [
          resolve(root, 'node_modules/@angular/cli/bin/ng.js'),
          'build',
          fixture.project,
          '--configuration',
          'production',
          '--output-path',
          'dist/dnd',
        ],
        { cwd: staging, stdio: ['ignore', 'pipe', 'pipe'] },
      );
      const interrupt = (signal: NodeJS.Signals) => {
        interrupted = signal;
        child.kill(signal);
      };
      const sigint = () => interrupt('SIGINT');
      const sigterm = () => interrupt('SIGTERM');
      process.once('SIGINT', sigint);
      process.once('SIGTERM', sigterm);
      for (const [stream, destination] of [
        [child.stdout, process.stdout],
        [child.stderr, process.stderr],
      ] as const)
        stream!.on('data', (data: Buffer) => {
          compilerOutput += data.toString();
          destination.write(data);
        });
      child.once('error', reject);
      child.once('close', (code, signal) => {
        process.removeListener('SIGINT', sigint);
        process.removeListener('SIGTERM', sigterm);
        if (code === 0 && !interrupted) resolveBuild();
        else
          reject(
            new Error(
              `Instrumented consumer build failed (${signal ?? code}).\n${compilerOutput.slice(-12_000)}`,
            ),
          );
      });
    });
  } finally {
    mkdirSync(resolve(root, 'perf/results'), { recursive: true });
    writeFileSync(resolve(root, 'perf/results/build-contracts.log'), compilerOutput);
  }
  cpSync(fixture.outputDirectory, output, { recursive: true });
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  mkdirSync(resolve(root, 'perf/results'), { recursive: true });
  writeFileSync(
    failureReport,
    '**Instrumented consumer build failed**\n\n```text\n' +
      message.replaceAll('```', "'''") +
      '\n```\n',
  );
  console.error(error);
  process.exitCode = interrupted === 'SIGINT' ? 130 : interrupted ? 143 : 1;
} finally {
  rmSync(staging, { recursive: true, force: true });
}
