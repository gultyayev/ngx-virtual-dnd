/** Build only the library and its isolated production contract consumer. */
import { spawn, type ChildProcess } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

const root = process.cwd();
const staging = mkdtempSync(resolve(tmpdir(), 'perf-contracts-'));
const output = resolve(root, 'dist/perf-contracts/browser');
const results = resolve(root, 'perf/results');
const failureReport = resolve(results, 'build-failure.md');
mkdirSync(results, { recursive: true });
rmSync(output, { recursive: true, force: true });
rmSync(failureReport, { force: true });
// A failed new build must never be accompanied by a previous passing check.
rmSync(resolve(results, 'check.json'), { force: true });
let stage = 'library';
let child: ChildProcess | undefined;
let interrupted: NodeJS.Signals | undefined;
const interrupt = (signal: NodeJS.Signals) => {
  interrupted = signal;
  child?.kill(signal);
};
const sigint = () => interrupt('SIGINT');
const sigterm = () => interrupt('SIGTERM');
process.once('SIGINT', sigint);
process.once('SIGTERM', sigterm);
async function build(args: string[], cwd: string): Promise<void> {
  let compilerOutput = '';
  try {
    await new Promise<void>((resolveBuild, reject) => {
      child = spawn(
        process.execPath,
        [resolve(root, 'node_modules/@angular/cli/bin/ng.js'), ...args],
        { cwd, stdio: ['ignore', 'pipe', 'pipe'] },
      );
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
        if (code === 0 && !interrupted) resolveBuild();
        else
          reject(
            new Error(
              `${stage} build failed (${signal ?? code}).\n${compilerOutput.slice(-12_000)}`,
            ),
          );
      });
    });
  } finally {
    writeFileSync(resolve(results, `build-${stage}.log`), compilerOutput);
    child = undefined;
  }
}
try {
  await build(['build', 'ngx-virtual-dnd'], root);
  stage = 'contract-consumer';
  cpSync(resolve(root, 'perf/consumer'), resolve(staging, 'src'), { recursive: true });
  symlinkSync(resolve(root, 'node_modules'), resolve(staging, 'node_modules'), 'dir');
  writeFileSync(
    resolve(staging, 'src/index.html'),
    '<!doctype html><html><head><base href="/"></head><body><app-root></app-root></body></html>',
  );
  writeFileSync(
    resolve(staging, 'tsconfig.json'),
    JSON.stringify({
      extends: resolve(root, 'tsconfig.json'),
      compilerOptions: {
        paths: { 'ngx-virtual-dnd': [resolve(root, 'dist/ngx-virtual-dnd')] },
        types: [],
      },
      files: ['src/main.ts'],
      include: [],
      references: [],
    }),
  );
  writeFileSync(
    resolve(staging, 'angular.json'),
    JSON.stringify({
      version: 1,
      projects: {
        contracts: {
          projectType: 'application',
          root: '',
          sourceRoot: 'src',
          architect: {
            build: {
              builder: '@angular/build:application',
              options: {
                browser: 'src/main.ts',
                index: 'src/index.html',
                tsConfig: 'tsconfig.json',
                outputPath: 'dist/contracts',
                optimization: true,
                sourceMap: false,
                outputHashing: 'all',
              },
            },
          },
        },
      },
    }),
  );
  await build(['build', 'contracts'], staging);
  cpSync(resolve(staging, 'dist/contracts/browser'), output, { recursive: true });
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  writeFileSync(
    failureReport,
    `**Contract build failed (${stage})**\n\n\`\`\`text\n${message.replaceAll('```', "'''")}\n\`\`\`\n`,
  );
  console.error(error);
  process.exitCode = interrupted === 'SIGINT' ? 130 : interrupted ? 143 : 1;
} finally {
  process.removeListener('SIGINT', sigint);
  process.removeListener('SIGTERM', sigterm);
  rmSync(staging, { recursive: true, force: true });
}
