import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { dependencyHash, FIXTURE_PATHS, hashPaths, LIBRARY_PATHS } from './runner-plan.ts';
import { makeExperiment } from './experiment-fixture.ts';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
function cli(script: string, args: string[], cwd = repository, environment = process.env) {
  const childEnvironment = { ...environment };
  // Node's test child context otherwise sends CLI console output through its
  // binary test reporter instead of ordinary stdout/stderr.
  delete childEnvironment['NODE_TEST_CONTEXT'];
  return spawnSync(
    process.execPath,
    ['--experimental-strip-types', resolve(repository, script), ...args],
    {
      cwd,
      env: childEnvironment,
      encoding: 'utf8',
      timeout: 10_000,
    },
  );
}
function temporary(run: (directory: string) => void): void {
  const directory = mkdtempSync(join(tmpdir(), 'perf-runner-cli-'));
  try {
    run(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
function put(root: string, input: string, contents = '{}'): void {
  const path = join(root, input);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}
function inputs(root: string): void {
  for (const input of new Set([...FIXTURE_PATHS, ...LIBRARY_PATHS])) {
    if (['src', 'public'].includes(input) || input.endsWith('/src')) {
      mkdirSync(join(root, input), { recursive: true });
    } else put(root, input);
  }
  put(root, 'dist/dnd/browser/index.html', '<html>fixture</html>');
}
function fingerprint(root: string): void {
  put(
    root,
    'dist/perf-build.json',
    JSON.stringify({
      formatVersion: 1,
      fixtureHash: hashPaths(root, FIXTURE_PATHS),
      libraryHash: hashPaths(root, LIBRARY_PATHS),
      dependencyHash: dependencyHash(root),
      outputHash: hashPaths(root, ['dist/dnd/browser']),
    }),
  );
}
function oldEvidence(directory: string): string {
  const output = join(directory, 'experiment.json');
  put(directory, 'experiment.json', JSON.stringify(makeExperiment()));
  put(directory, 'comparison.json', JSON.stringify({ verdict: 'pass' }));
  put(directory, 'comparison.md', 'Old passing experiment');
  return output;
}
function expectInvalid(directory: string, output: string, result: ReturnType<typeof cli>): void {
  assert.equal(result.status, 3, result.stderr);
  assert.equal(existsSync(output), false, 'earlier passing experiment must not remain');
  const comparison = JSON.parse(readFileSync(join(directory, 'comparison.json'), 'utf8'));
  assert.equal(comparison.verdict, 'invalid');
  assert.match(
    readFileSync(join(directory, 'comparison.md'), 'utf8'),
    /Invalid benchmark experiment/,
  );
}

test('runner replaces old passing evidence when strict option parsing fails', () => {
  temporary((directory) => {
    const output = oldEvidence(directory);
    expectInvalid(directory, output, cli('perf/run.ts', ['--unknown', '--output', output]));
  });
});

test('runner replaces old passing evidence for invalid numeric options and default head output', () => {
  temporary((directory) => {
    const results = join(directory, 'perf/results');
    const output = oldEvidence(results);
    expectInvalid(results, output, cli('perf/run.ts', ['--head', directory, '--blocks', '0']));
  });
});

test('runner rejects stale library compilation inputs before starting servers or browsers', () => {
  temporary((directory) => {
    inputs(directory);
    fingerprint(directory);
    put(directory, 'projects/ngx-virtual-dnd/tsconfig.lib.prod.json', '{"changed":true}');
    const results = join(directory, 'perf/results');
    const output = oldEvidence(results);
    const result = cli('perf/run.ts', ['--base', directory, '--head', directory, '--blocks', '1']);
    expectInvalid(results, output, result);
    const comparison = JSON.parse(readFileSync(join(results, 'comparison.json'), 'utf8'));
    assert.match(comparison.reasons[0], /Stale or incompatible production build/);
  });
});

test('build refuses to fingerprint inputs changed during compilation and removes the old manifest', () => {
  temporary((directory) => {
    inputs(directory);
    fingerprint(directory);
    const bin = join(directory, 'bin');
    mkdirSync(bin);
    writeFileSync(
      join(bin, 'npm'),
      `#!/usr/bin/env node
const { writeFileSync } = require('node:fs');
if (process.argv[3] === 'build:lib') writeFileSync('projects/ngx-virtual-dnd/tsconfig.lib.prod.json', '{"changed":true}');
`,
      { mode: 0o755 },
    );
    const result = cli('perf/build.ts', [], directory, {
      ...process.env,
      PATH: `${bin}${delimiter}${process.env['PATH'] ?? ''}`,
    });
    assert.notEqual(result.status, 0, result.stderr);
    assert.match(result.stderr, /inputs changed during the production build/);
    assert.equal(existsSync(join(directory, 'dist/perf-build.json')), false);
  });
});

test('cancellation preserves the pending block and an incomplete requested experiment', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'perf-cancel-cli-'));
  let child: ReturnType<typeof spawn> | undefined;
  try {
    inputs(directory);
    for (const input of [
      'perf/fixtures/input.ts',
      'perf/scenarios/input.ts',
      'perf/playwright.perf.config.ts',
      'perf/run.ts',
      'perf/build.ts',
      'perf/prepare.ts',
    ]) {
      put(directory, input, '// fixture');
    }
    put(
      directory,
      'scripts/serve-dist.js',
      'process.stdout.write("serve-dist: serving\\n"); setInterval(() => {}, 1000);',
    );
    put(directory, 'node_modules/@playwright/test/package.json', '{"version":"test-playwright"}');
    put(directory, 'node_modules/@playwright/test/cli.js', 'setInterval(() => {}, 1000);');
    fingerprint(directory);
    const bin = join(directory, 'bin');
    mkdirSync(bin);
    writeFileSync(
      join(bin, 'git'),
      '#!/usr/bin/env node\nprocess.stdout.write("fixture-sha\\n");\n',
      {
        mode: 0o755,
      },
    );
    const environment: NodeJS.ProcessEnv = {
      ...process.env,
      PATH: `${bin}${delimiter}${process.env['PATH'] ?? ''}`,
    };
    delete environment['NODE_TEST_CONTEXT'];
    child = spawn(
      process.execPath,
      [
        '--experimental-strip-types',
        resolve(repository, 'perf/run.ts'),
        '--base',
        directory,
        '--head',
        directory,
        '--blocks',
        '20',
      ],
      {
        cwd: repository,
        env: environment,
        stdio: 'ignore',
      },
    );
    const finished = new Promise<number | null>((fulfill, reject) => {
      child!.once('error', reject);
      child!.once('exit', fulfill);
    });
    const output = join(directory, 'perf/results/experiment.json');
    let pending: ReturnType<typeof makeExperiment> | undefined;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (existsSync(output)) {
        pending = JSON.parse(readFileSync(output, 'utf8'));
        if (pending?.blocks.length === 1) break;
      }
      if (child.exitCode !== null) break;
      await delay(25);
    }
    assert.equal(pending?.blocks.length, 1, 'runner must save its pending block before execution');
    assert.equal(pending?.blocks[0].runs.length, 0);
    child.kill('SIGINT');
    assert.equal(await finished, 130);
    const retained = JSON.parse(readFileSync(output, 'utf8'));
    assert.equal(retained.requestedBlocks, 20);
    assert.equal(retained.completed, false);
    assert.equal(retained.blocks.length, 1);
    const comparison = JSON.parse(
      readFileSync(join(directory, 'perf/results/comparison.json'), 'utf8'),
    );
    assert.equal(comparison.verdict, 'invalid');
    assert.match(comparison.reasons[0], /cancelled by SIGINT/);
  } finally {
    if (child?.exitCode === null) child.kill('SIGTERM');
    rmSync(directory, { recursive: true, force: true });
  }
});

for (const mutationRun of [1, 4]) {
  test(`runner rejects a harness edited during suite ${mutationRun} and preserves its completed measurements`, () => {
    temporary((directory) => {
      inputs(directory);
      for (const input of [
        'perf/fixtures/input.ts',
        'perf/scenarios/input.ts',
        'perf/playwright.perf.config.ts',
        'perf/run.ts',
        'perf/build.ts',
        'perf/prepare.ts',
      ]) {
        put(directory, input, '// fixture');
      }
      put(
        directory,
        'scripts/serve-dist.js',
        'process.stdout.write("serve-dist: serving\\n"); setInterval(() => {}, 1000);',
      );
      put(directory, 'node_modules/@playwright/test/package.json', '{"version":"test-playwright"}');
      const reports = makeExperiment().blocks[0].runs[0].scenarios;
      put(
        directory,
        'reporter.json',
        JSON.stringify({
          errors: [],
          stats: { expected: reports.length, unexpected: 0, skipped: 0, flaky: 0 },
          suites: [
            {
              specs: reports.map((report) => ({
                ok: true,
                tests: [
                  {
                    expectedStatus: 'passed',
                    status: 'expected',
                    results: [
                      {
                        status: 'passed',
                        retry: 0,
                        errors: [],
                        attachments: [
                          {
                            name: report.scenario,
                            contentType: 'application/json',
                            body: Buffer.from(JSON.stringify(report)).toString('base64'),
                          },
                        ],
                      },
                    ],
                  },
                ],
              })),
            },
          ],
        }),
      );
      put(
        directory,
        'node_modules/@playwright/test/cli.js',
        `
const { existsSync, readFileSync, writeFileSync } = require('node:fs');
const countFile = '.fake-suite-count';
const count = (existsSync(countFile) ? Number(readFileSync(countFile, 'utf8')) : 0) + 1;
writeFileSync(countFile, String(count));
writeFileSync(process.env.PERF_RESULT_PATH, readFileSync('reporter.json'));
if (count === ${mutationRun}) writeFileSync('perf/scenarios/input.ts', '// changed during measurement');
`,
      );
      fingerprint(directory);
      const bin = join(directory, 'bin');
      mkdirSync(bin);
      writeFileSync(
        join(bin, 'git'),
        '#!/usr/bin/env node\nprocess.stdout.write("fixture-sha\\n");\n',
        { mode: 0o755 },
      );
      const result = cli(
        'perf/run.ts',
        ['--base', directory, '--head', directory, '--blocks', '1'],
        repository,
        {
          ...process.env,
          PATH: `${bin}${delimiter}${process.env['PATH'] ?? ''}`,
        },
      );
      assert.equal(result.status, 3, result.stderr);
      const output = join(directory, 'perf/results/experiment.json');
      const retained = JSON.parse(readFileSync(output, 'utf8'));
      assert.equal(retained.completed, false);
      assert.equal(retained.requestedBlocks, 1);
      assert.equal(retained.blocks[0].runs.length, mutationRun);
      const comparison = JSON.parse(
        readFileSync(join(directory, 'perf/results/comparison.json'), 'utf8'),
      );
      assert.equal(comparison.verdict, 'invalid');
      assert.match(comparison.reasons[0], /harness changed while the experiment was running/);
    });
  });
}
