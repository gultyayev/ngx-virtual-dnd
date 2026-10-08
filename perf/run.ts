import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { cpus, freemem, loadavg, platform, release, totalmem } from 'node:os';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { Worker } from 'node:worker_threads';
import { setTimeout as delay } from 'node:timers/promises';
import { extractScenarios } from './fixtures/extract-scenarios.ts';
import {
  compareExperiment,
  EXIT_CODES,
  renderComparisonMarkdown,
} from './fixtures/compare-metrics.ts';
import {
  blockOrder,
  dependencyHash,
  FIXTURE_PATHS,
  HARNESS_PATHS,
  hashPaths,
  LIBRARY_PATHS,
  PRODUCTION_INPUT_PATHS,
} from './fixtures/runner-plan.ts';
import type { Experiment, HealthSnapshot, Variant } from './fixtures/run-types.ts';

function parseRunnerOptions(args: string[]) {
  return parseArgs({
    args,
    options: {
      base: { type: 'string' },
      head: { type: 'string' },
      blocks: { type: 'string', default: '10' },
      output: { type: 'string' },
      calibration: { type: 'boolean', default: false },
      control: { type: 'string', default: 'none' },
      'control-work-ms': { type: 'string', default: '50' },
      'base-port': { type: 'string', default: '4300' },
      'head-port': { type: 'string', default: '4301' },
    },
  }).values;
}

// Locate the requested evidence destination even when strict argument parsing fails.
// The final occurrence matches parseArgs' handling of repeated string options.
function evidenceArgument(args: string[], flag: string): string | undefined {
  for (let index = args.length - 1; index >= 0; index--) {
    if (args[index].startsWith(`${flag}=`)) return args[index].slice(flag.length + 1);
    if (args[index] === flag && args[index + 1] && !args[index + 1].startsWith('--')) {
      return args[index + 1];
    }
  }
  return undefined;
}

const args = process.argv.slice(2);
let values = parseRunnerOptions([]);
const roots = { base: resolve('.'), head: resolve(evidenceArgument(args, '--head') ?? '.') };
let blocks = 10;
let control = 'none';
let controlWorkMs = 50;
const ports = { base: 4300, head: 4301 };
let output = resolve(
  evidenceArgument(args, '--output') ?? resolve(roots.head, 'perf/results/experiment.json'),
);
let runDirectory = '';
const children: ChildProcess[] = [];
let stopping = false;
let experiment: Experiment | undefined;

function gitCommit(root: string): string {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`Cannot identify library revision in ${root}.`);
  return result.stdout.trim();
}

function verifyBuild(root: string): string {
  const data = JSON.parse(readFileSync(resolve(root, 'dist/perf-build.json'), 'utf8')) as Record<
    string,
    unknown
  >;
  if (
    data['formatVersion'] !== 1 ||
    data['fixtureHash'] !== hashPaths(root, FIXTURE_PATHS) ||
    data['libraryHash'] !== hashPaths(root, LIBRARY_PATHS) ||
    data['dependencyHash'] !== dependencyHash(root) ||
    data['outputHash'] !== hashPaths(root, ['dist/dnd/browser'])
  ) {
    throw new Error(
      `Stale or incompatible production build in ${root}. Run npm run perf:build there.`,
    );
  }
  return data['fixtureHash'] as string;
}

function pressure(resource: string, kind: 'some' | 'full'): number | null {
  try {
    const line = readFileSync(`/proc/pressure/${resource}`, 'utf8')
      .split('\n')
      .find((l) => l.startsWith(`${kind} `));
    const value = line?.match(/total=(\d+)/)?.[1];
    return value === undefined ? null : Number(value);
  } catch {
    return null;
  }
}

function health(): HealthSnapshot {
  const processors = cpus();
  return {
    timestamp: new Date().toISOString(),
    loadAverage: loadavg(),
    freeMemoryBytes: freemem(),
    cpuTime: {
      idle: processors.reduce((sum, cpu) => sum + cpu.times.idle, 0),
      total: processors.reduce(
        (sum, cpu) => sum + Object.values(cpu.times).reduce((a, b) => a + b, 0),
        0,
      ),
    },
    pressure: {
      cpuSomeUs: pressure('cpu', 'some'),
      memorySomeUs: pressure('memory', 'some'),
      memoryFullUs: pressure('memory', 'full'),
      ioSomeUs: pressure('io', 'some'),
      ioFullUs: pressure('io', 'full'),
    },
  };
}

function writeExperiment(experiment: Experiment): void {
  // Persist after every run so cancellation/failure retains its completed measurements.
  writeFileSync(output, JSON.stringify(experiment, null, 2) + '\n');
}

function stopChildren(): void {
  stopping = true;
  for (const child of children) if (child.exitCode === null) child.kill('SIGTERM');
}
function persistInvalid(message: string): void {
  mkdirSync(dirname(output), { recursive: true });
  if (experiment) {
    experiment.completed = false;
    experiment.environment['failureReason'] = message;
    writeExperiment(experiment);
  }
  writeFileSync(
    resolve(dirname(output), 'comparison.json'),
    JSON.stringify(
      {
        verdict: 'invalid',
        reasons: [message],
        rows: [],
        blocks: experiment?.blocks.length ?? 0,
        thresholdPercent: 10,
      },
      null,
      2,
    ) + '\n',
  );
  writeFileSync(
    resolve(dirname(output), 'comparison.md'),
    `## Invalid benchmark experiment\n\n${message}\n`,
  );
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    stopChildren();
    try {
      persistInvalid(`Experiment cancelled by ${signal} before its final verdict was saved.`);
    } catch (error) {
      console.error(`Cannot preserve cancelled experiment: ${String(error)}`);
    }
    process.exit(signal === 'SIGINT' ? 130 : 143);
  });
}

async function startServer(variant: Variant): Promise<void> {
  const child = spawn(process.execPath, [resolve(roots.head, 'scripts/serve-dist.js')], {
    cwd: roots.head,
    env: {
      ...process.env,
      PORT: String(ports[variant]),
      PERF_BUILD_DIR: resolve(roots[variant], 'dist/dnd/browser'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);
  let messages = '';
  child.stdout!.on('data', (chunk: Buffer) => {
    messages += chunk.toString();
  });
  child.stderr!.on('data', (chunk: Buffer) => {
    messages += chunk.toString();
  });
  let spawnError: Error | undefined;
  child.on('error', (error) => {
    spawnError = error;
  });
  for (let attempt = 0; attempt < 100; attempt++) {
    if (spawnError || child.exitCode !== null)
      throw new Error(`Static server failed: ${spawnError?.message ?? messages}`);
    // The server's own ready message avoids silently attaching to someone else's port.
    if (messages.includes('serve-dist: serving')) return;
    await delay(100);
  }
  throw new Error(`Static server did not start for ${variant}.`);
}

async function execute(variant: Variant, sourceFile: string): Promise<void> {
  const workers: Worker[] = [];
  if (control === 'cpu' && variant === 'head') {
    for (let i = 0; i < Math.min(cpus().length, 8); i++) {
      workers.push(new Worker('let n = 1; while (true) n = Math.sqrt(n + 1);', { eval: true }));
    }
  }
  try {
    await new Promise<void>((fulfill, reject) => {
      const child = spawn(
        process.execPath,
        [
          resolve(roots.head, 'node_modules/@playwright/test/cli.js'),
          'test',
          '--config',
          resolve(roots.head, 'perf/playwright.perf.config.ts'),
        ],
        {
          cwd: roots.head,
          stdio: 'inherit',
          env: {
            ...process.env,
            PERF_MANAGED_SERVER: '1',
            PERF_BASE_URL: `http://127.0.0.1:${ports[variant]}`,
            PERF_RESULT_PATH: sourceFile,
            PERF_ITERATIONS: '1',
            PERF_WARMUP_ITERATIONS: '1',
            PERF_CONTROL_WORK_MS:
              control === 'script' && variant === 'head' ? String(controlWorkMs) : '0',
          },
        },
      );
      children.push(child);
      child.once('error', reject);
      child.once('exit', (code, signal) =>
        code === 0 && !stopping
          ? fulfill()
          : reject(
              new Error(
                `Benchmark ${variant} failed (${signal ?? code}); raw output: ${sourceFile}`,
              ),
            ),
      );
    });
  } finally {
    await Promise.all(
      workers.map(async (worker) => {
        await worker.terminate();
      }),
    );
  }
}

try {
  // A failed invocation must never leave an earlier passing experiment as the
  // default report input. Keep historical raw runs, but replace this run's verdict.
  for (const file of [
    output,
    resolve(dirname(output), 'comparison.json'),
    resolve(dirname(output), 'comparison.md'),
  ]) {
    rmSync(file, { force: true });
  }
  values = parseRunnerOptions(args);
  roots.base = resolve(values.base ?? '.');
  roots.head = resolve(values.head ?? '.');
  blocks = Number(values.blocks);
  control = values.control;
  controlWorkMs = Number(values['control-work-ms']);
  ports.base = Number(values['base-port']);
  ports.head = Number(values['head-port']);
  output = resolve(values.output ?? resolve(roots.head, 'perf/results/experiment.json'));
  runDirectory = resolve(dirname(output), `runs-${Date.now()}`);
  if (!Number.isInteger(blocks) || blocks < 1 || blocks > 100)
    throw new Error('--blocks must be an integer from 1 to 100.');
  if (!['none', 'script', 'cpu'].includes(control))
    throw new Error('--control must be none, script or cpu.');
  if (!values.calibration && control !== 'none')
    throw new Error('Controls require --calibration; they are not PR regressions.');
  if (!Number.isFinite(controlWorkMs) || controlWorkMs < 0 || controlWorkMs > 1000)
    throw new Error('--control-work-ms must be between 0 and 1000.');
  if (
    Object.values(ports).some((port) => !Number.isInteger(port) || port < 1024 || port > 65535) ||
    ports.base === ports.head
  )
    throw new Error('Choose distinct valid server ports.');
  const fixtureBase = verifyBuild(roots.base);
  const fixtureHead = verifyBuild(roots.head);
  if (fixtureBase !== fixtureHead)
    throw new Error(
      'Base/head fixtures or dependencies differ. Build both libraries with the same consumer fixture and lockfile.',
    );
  const variants = {
    base: {
      commit: gitCommit(roots.base),
      dependencyHash: dependencyHash(roots.base),
      libraryHash: hashPaths(roots.base, LIBRARY_PATHS),
    },
    head: {
      commit: gitCommit(roots.head),
      dependencyHash: dependencyHash(roots.head),
      libraryHash: hashPaths(roots.head, LIBRARY_PATHS),
    },
  };
  if (
    values.calibration &&
    (variants.base.commit !== variants.head.commit ||
      variants.base.libraryHash !== variants.head.libraryHash)
  )
    throw new Error('A/A calibration requires identical library source on both sides.');
  const frozenHarness = hashPaths(roots.head, HARNESS_PATHS);
  const frozenProduction = {
    base: hashPaths(roots.base, PRODUCTION_INPUT_PATHS),
    head: hashPaths(roots.head, PRODUCTION_INPUT_PATHS),
  };
  function verifyFrozenInputs(): void {
    if (hashPaths(roots.head, HARNESS_PATHS) !== frozenHarness) {
      throw new Error('Common benchmark harness changed while the experiment was running.');
    }
    for (const variant of ['base', 'head'] as const) {
      verifyBuild(roots[variant]);
      if (
        hashPaths(roots[variant], PRODUCTION_INPUT_PATHS) !== frozenProduction[variant] ||
        gitCommit(roots[variant]) !== variants[variant].commit
      ) {
        throw new Error(
          `${variant} checkout or production build changed while the experiment was running.`,
        );
      }
    }
  }
  mkdirSync(runDirectory, { recursive: true });
  experiment = {
    formatVersion: 1,
    mode: values.calibration ? 'calibration' : 'comparison',
    harnessHash: frozenHarness + ':' + fixtureHead,
    variants,
    requestedBlocks: blocks,
    completed: false,
    blocks: [],
    environment: {
      nodeVersion: process.version,
      playwrightVersion: (
        JSON.parse(
          readFileSync(resolve(roots.head, 'node_modules/@playwright/test/package.json'), 'utf8'),
        ) as { version: string }
      ).version,
      browserVersion: '',
      viewport: { width: 1280, height: 720 },
      deviceScaleFactor: 1,
      headless: true,
      cpuThrottle: 4,
      platform: platform(),
      architecture: process.arch,
      cpuModel: cpus()[0]?.model ?? 'unknown',
      cpuCount: cpus().length,
      totalMemoryBytes: totalmem(),
      kernel: release(),
      runnerImage: process.env['ImageOS'] ?? 'local',
      runnerImageVersion: process.env['ImageVersion'] ?? 'unknown',
      runnerEnvironment: process.env['RUNNER_ENVIRONMENT'] ?? 'local',
      control,
      controlWorkMs: control === 'script' ? controlWorkMs : 0,
    },
  };
  writeExperiment(experiment);
  await startServer('base');
  await startServer('head');
  for (let index = 0; index < blocks; index++) {
    const block = {
      index,
      order: blockOrder(index),
      runs: [] as Experiment['blocks'][number]['runs'],
    };
    experiment.blocks.push(block);
    // Save the pending block before spawning work. Cancellation cannot make a
    // shorter prefix of the requested experiment appear complete.
    writeExperiment(experiment);
    for (const [position, variant] of block.order.entries()) {
      verifyFrozenInputs();
      console.log(`\nBalanced block ${index + 1}/${blocks}, ${position + 1}/4: ${variant}`);
      const sourceFile = resolve(runDirectory, `block-${index}-${position}-${variant}.json`);
      const healthBefore = health();
      await execute(variant, sourceFile);
      const healthAfter = health();
      const scenarios = extractScenarios(sourceFile);
      experiment.environment['browserVersion'] ??= scenarios[0]?.raw[0]?.browserVersion;
      if (experiment.environment['browserVersion'] === '')
        experiment.environment['browserVersion'] = scenarios[0]?.raw[0]?.browserVersion;
      block.runs.push({
        variant,
        startedAt: healthBefore.timestamp,
        sourceFile,
        healthBefore,
        healthAfter,
        scenarios,
      });
      writeExperiment(experiment);
    }
  }
  verifyFrozenInputs();
  experiment.completed = true;
  writeExperiment(experiment);
  const comparison = compareExperiment(experiment);
  const markdown = renderComparisonMarkdown(comparison);
  writeFileSync(resolve(dirname(output), 'comparison.md'), markdown);
  writeFileSync(
    resolve(dirname(output), 'comparison.json'),
    JSON.stringify(comparison, null, 2) + '\n',
  );
  console.log(markdown);
  process.exitCode = EXIT_CODES[comparison.verdict];
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Invalid benchmark experiment: ${message}`);
  persistInvalid(message);
  process.exitCode = 3;
} finally {
  stopChildren();
}
