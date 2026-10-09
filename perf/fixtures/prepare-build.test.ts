import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  dependencyHash,
  FIXTURE_PATHS,
  hashPaths,
  installedDependencyHash,
  LIBRARY_PATHS,
} from './runner-plan.ts';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const sourceInputs = [
  'src',
  'public',
  'angular.json',
  'tsconfig.json',
  'tsconfig.app.json',
  'tsconfig.spec.json',
  'tsconfig.e2e.json',
  ...LIBRARY_PATHS,
];

function temporary(run: (directory: string) => void): void {
  const directory = mkdtempSync(join(tmpdir(), 'perf-prepare-build-'));
  try {
    run(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function put(root: string, input: string, contents: string): void {
  const path = join(root, input);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

function checkout(root: string, variant: string): void {
  put(root, 'src/main.ts', `import { ${variant}Api } from 'ngx-virtual-dnd';\n${variant}Api();\n`);
  put(root, 'public/fixture.txt', variant);
  put(
    root,
    'angular.json',
    JSON.stringify({
      version: 1,
      fixture: variant,
      projects: {
        dnd: {
          projectType: 'application',
          root: '',
          sourceRoot: 'src',
          architect: {
            build: {
              builder: '@angular/build:application',
              options: { browser: 'src/main.ts', tsConfig: 'tsconfig.app.json' },
            },
          },
        },
        'ngx-virtual-dnd': {
          projectType: 'library',
          architect: { build: { builder: '@angular/build:ng-packagr' } },
        },
      },
    }),
  );
  put(
    root,
    'tsconfig.json',
    JSON.stringify({
      fixture: variant,
      compilerOptions: {
        strict: true,
        skipLibCheck: true,
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'bundler',
        types: [],
        paths: { 'ngx-virtual-dnd': ['./projects/ngx-virtual-dnd/src/public-api.ts'] },
      },
    }),
  );
  put(
    root,
    'tsconfig.app.json',
    JSON.stringify({
      extends: './tsconfig.json',
      include: ['src/**/*.ts'],
    }),
  );
  for (const config of ['tsconfig.spec.json', 'tsconfig.e2e.json']) {
    put(root, config, JSON.stringify({ fixture: variant }));
  }
  for (const input of LIBRARY_PATHS) {
    if (input.endsWith('/src'))
      put(root, `${input}/public-api.ts`, `export const ${variant}Api = () => '${variant}';\n`);
    else put(root, input, JSON.stringify({ library: variant }));
  }
  put(root, 'package.json', JSON.stringify({ name: `${variant}-dependencies` }));
  put(root, 'package-lock.json', JSON.stringify({ name: `${variant}-lockfile` }));
  put(root, `perf/${variant}.ts`, `// ${variant} harness\n`);
  put(root, `scripts/${variant}.js`, `// ${variant} scripts\n`);
}

function cli(script: string, args: string[], cwd = repository, environment = process.env) {
  const childEnvironment = { ...environment };
  delete childEnvironment['NODE_TEST_CONTEXT'];
  return spawnSync(
    process.execPath,
    ['--experimental-strip-types', resolve(repository, script), ...args],
    { cwd, env: childEnvironment, encoding: 'utf8', timeout: 10_000 },
  );
}

function cleanGit(root: string): void {
  for (const args of [
    ['init', '--quiet'],
    ['add', '.'],
    [
      '-c',
      'user.name=Benchmark Test',
      '-c',
      'user.email=benchmark@example.invalid',
      'commit',
      '--quiet',
      '-m',
      'fixture',
    ],
  ]) {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', timeout: 10_000 });
    assert.equal(result.status, 0, result.stderr);
  }
}

function stage(root: string, fixtureRoot: string, stagingDirectory: string) {
  const environment = { ...process.env };
  delete environment['NODE_TEST_CONTEXT'];
  const buildModule = pathToFileURL(resolve(repository, 'perf/build.ts')).href;
  const result = spawnSync(
    process.execPath,
    [
      '--experimental-strip-types',
      '--input-type=module',
      '--eval',
      `import { stageFixture } from ${JSON.stringify(buildModule)};
process.stdout.write(JSON.stringify(stageFixture(${JSON.stringify(root)}, ${JSON.stringify(fixtureRoot)}, ${JSON.stringify(stagingDirectory)})));`,
    ],
    { cwd: root, env: environment, encoding: 'utf8', timeout: 10_000 },
  );
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout) as { project: string; outputDirectory: string };
}

function fakeBuild(root: string, fixtureRoot: string, mutateFixture = false): NodeJS.ProcessEnv {
  const devDependencies = { '@angular/cli': '1.0.0' };
  const cliPackage = {
    version: '1.0.0',
    resolved: 'https://example.invalid/angular-cli.tgz',
    integrity: 'fixture-integrity',
  };
  put(root, 'package.json', JSON.stringify({ name: 'variant', devDependencies }));
  put(
    root,
    'package-lock.json',
    JSON.stringify({
      lockfileVersion: 3,
      packages: { '': { devDependencies }, 'node_modules/@angular/cli': cliPackage },
    }),
  );
  put(
    root,
    'node_modules/.package-lock.json',
    JSON.stringify({
      lockfileVersion: 3,
      packages: { 'node_modules/@angular/cli': cliPackage },
    }),
  );
  put(
    root,
    'node_modules/@angular/cli/package.json',
    JSON.stringify({ name: '@angular/cli', version: '1.0.0' }),
  );
  const bin = join(root, 'bin');
  const npm = join(bin, 'npm');
  put(
    root,
    'bin/npm',
    `#!/usr/bin/env node
const { appendFileSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
appendFileSync(join(process.cwd(), 'build-calls.ndjson'), JSON.stringify({ operation: 'library', cwd: process.cwd(), args: process.argv.slice(2) }) + '\\n');
if (process.argv[2] !== 'run' || process.argv[3] !== 'build:lib') process.exit(42);
mkdirSync('dist/ngx-virtual-dnd', { recursive: true });
writeFileSync('dist/ngx-virtual-dnd/library.js', readFileSync('projects/ngx-virtual-dnd/src/public-api.ts'));
`,
  );
  chmodSync(npm, 0o755);
  put(
    root,
    'node_modules/@angular/cli/bin/ng.js',
    `
const { appendFileSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
appendFileSync(join(process.env.PERF_TEST_VARIANT_ROOT, 'build-calls.ndjson'), JSON.stringify({ operation: 'application', cwd: process.cwd(), args: process.argv.slice(2) }) + '\\n');
const output = {
  application: readFileSync('src/main.ts', 'utf8'),
  library: readFileSync('dist/ngx-virtual-dnd/library.js', 'utf8'),
  angular: JSON.parse(readFileSync('angular.json', 'utf8')),
};
mkdirSync('dist/dnd/browser', { recursive: true });
writeFileSync('dist/dnd/browser/index.html', JSON.stringify(output));
if (process.env.PERF_TEST_MUTATE_FIXTURE === '1') writeFileSync(join(process.env.PERF_TEST_FIXTURE_ROOT, 'src/main.ts'), '// fixture changed during compilation');
`,
  );
  return {
    ...process.env,
    PATH: `${bin}${delimiter}${process.env['PATH'] ?? ''}`,
    PERF_TEST_VARIANT_ROOT: root,
    PERF_TEST_FIXTURE_ROOT: fixtureRoot,
    PERF_TEST_MUTATE_FIXTURE: mutateFixture ? '1' : '0',
  };
}

test('preparation preserves the baseline application and library when head introduces a new API', () => {
  temporary((directory) => {
    const base = join(directory, 'base');
    const head = join(directory, 'head');
    checkout(base, 'base');
    checkout(head, 'head');
    cleanGit(base);
    const before = hashPaths(base, sourceInputs);
    const result = cli('perf/prepare.ts', ['--base', base, '--head', head]);

    assert.equal(result.status, 0, result.stderr);
    assert.equal(
      hashPaths(base, sourceInputs),
      before,
      'preparation must preserve every baseline source and configuration',
    );
    for (const input of ['package.json', 'package-lock.json', 'perf/head.ts', 'scripts/head.js']) {
      assert.equal(
        readFileSync(join(base, input), 'utf8'),
        readFileSync(join(head, input), 'utf8'),
        input,
      );
    }
    assert.equal(existsSync(join(base, 'perf/base.ts')), false);
    assert.equal(existsSync(join(base, 'scripts/base.js')), false);
  });
});

test('staging resolves the baseline consumer through each variant compiled library', () => {
  temporary((directory) => {
    const base = join(directory, 'base');
    const head = join(directory, 'head');
    checkout(base, 'base');
    checkout(head, 'head');
    for (const root of [base, head]) {
      put(root, 'node_modules/fixture-dependency/package.json', JSON.stringify({ variant: root }));
      put(
        root,
        'dist/ngx-virtual-dnd/package.json',
        JSON.stringify({ name: 'ngx-virtual-dnd', types: 'index.d.ts' }),
      );
      put(
        root,
        'dist/ngx-virtual-dnd/index.d.ts',
        `export declare function baseApi(): string;\n${root === head ? 'export declare function headApi(): string;\n' : ''}`,
      );
    }
    const originalBase = hashPaths(base, sourceInputs);
    const originalHead = hashPaths(head, sourceInputs);
    for (const [variant, root] of [
      ['base', base],
      ['head', head],
    ]) {
      const stagingDirectory = join(directory, `${variant}-stage`);
      const staged = stage(root, base, stagingDirectory);
      assert.equal(staged.project, 'dnd');
      assert.equal(staged.outputDirectory, join(stagingDirectory, 'dist/dnd/browser'));
      for (const input of [
        'src/main.ts',
        'public/fixture.txt',
        'tsconfig.json',
        'tsconfig.app.json',
      ]) {
        assert.equal(
          readFileSync(join(stagingDirectory, input), 'utf8'),
          readFileSync(join(base, input), 'utf8'),
          input,
        );
      }
      for (const input of ['package.json', 'package-lock.json']) {
        assert.equal(
          readFileSync(join(stagingDirectory, input), 'utf8'),
          readFileSync(join(root, input), 'utf8'),
          input,
        );
      }
      assert.equal(
        realpathSync(join(stagingDirectory, 'node_modules')),
        realpathSync(join(root, 'node_modules')),
      );
      assert.equal(
        realpathSync(join(stagingDirectory, 'dist/ngx-virtual-dnd')),
        realpathSync(join(root, 'dist/ngx-virtual-dnd')),
      );
      const angular = JSON.parse(readFileSync(join(stagingDirectory, 'angular.json'), 'utf8'));
      assert.deepEqual(
        Object.keys(angular.projects),
        ['dnd'],
        'the staged app must not build the variant library again',
      );
      assert.equal(angular.projects.dnd.architect.build.options.tsConfig, 'tsconfig.perf.json');
      const config = JSON.parse(readFileSync(join(stagingDirectory, 'tsconfig.perf.json'), 'utf8'));
      assert.equal(config.extends, './tsconfig.app.json');
      assert.deepEqual(config.compilerOptions.paths, {
        'ngx-virtual-dnd': ['./dist/ngx-virtual-dnd'],
      });
      const stagedConsumer = readFileSync(join(stagingDirectory, 'src/main.ts'), 'utf8');
      assert.match(stagedConsumer, /import \{ baseApi \} from 'ngx-virtual-dnd'/);
      assert.doesNotMatch(stagedConsumer, /headApi/);
      const compiledTypes = readFileSync(
        join(stagingDirectory, config.compilerOptions.paths['ngx-virtual-dnd'][0], 'index.d.ts'),
        'utf8',
      );
      assert.equal(
        compiledTypes,
        readFileSync(join(root, 'dist/ngx-virtual-dnd/index.d.ts'), 'utf8'),
      );
      assert.match(compiledTypes, /export declare function baseApi\(\)/);
      assert.equal(compiledTypes.includes('headApi'), root === head);
    }
    assert.equal(
      hashPaths(base, sourceInputs),
      originalBase,
      'staging must preserve baseline source',
    );
    assert.equal(hashPaths(head, sourceInputs), originalHead, 'staging must preserve head source');
  });
});

test('build CLI fingerprints and serves an external baseline fixture with the variant library and installed dependencies', () => {
  temporary((directory) => {
    const base = join(directory, 'base');
    const head = join(directory, 'head');
    checkout(base, 'base');
    checkout(head, 'head');
    const environment = fakeBuild(head, base);
    const baseBefore = hashPaths(base, sourceInputs);
    const headBefore = hashPaths(head, sourceInputs);
    const result = cli('perf/build.ts', ['--fixture', '../base'], head, environment);

    assert.equal(result.status, 0, result.stdout + result.stderr);
    const output = JSON.parse(readFileSync(join(head, 'dist/dnd/browser/index.html'), 'utf8'));
    assert.equal(output.application, readFileSync(join(base, 'src/main.ts'), 'utf8'));
    assert.equal(
      output.library,
      readFileSync(join(head, 'projects/ngx-virtual-dnd/src/public-api.ts'), 'utf8'),
    );
    assert.deepEqual(Object.keys(output.angular.projects), ['dnd']);
    const manifest = JSON.parse(readFileSync(join(head, 'dist/perf-build.json'), 'utf8'));
    assert.equal(manifest.formatVersion, 2);
    assert.equal(manifest.fixtureRoot, realpathSync(base));
    assert.equal(manifest.fixtureHash, hashPaths(base, FIXTURE_PATHS));
    assert.equal(manifest.libraryHash, hashPaths(head, LIBRARY_PATHS));
    assert.equal(
      manifest.libraryBuildConfigHash,
      hashPaths(head, ['angular.json', 'tsconfig.json']),
    );
    assert.equal(manifest.dependencyHash, dependencyHash(head));
    assert.equal(manifest.installedDependencyHash, installedDependencyHash(head));
    assert.equal(manifest.outputHash, hashPaths(head, ['dist/dnd/browser']));
    const calls = readFileSync(join(head, 'build-calls.ndjson'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    assert.deepEqual(
      calls.map((call) => call.operation),
      ['library', 'application'],
    );
    assert.equal(calls[0].cwd, head);
    assert.deepEqual(calls[0].args, ['run', 'build:lib']);
    assert.notEqual(calls[1].cwd, head, 'application builds in a disposable workspace');
    assert.deepEqual(calls[1].args, [
      'build',
      'dnd',
      '--configuration',
      'production',
      '--output-path',
      'dist/dnd',
    ]);
    assert.equal(existsSync(calls[1].cwd), false, 'disposable build workspace must be removed');
    assert.equal(hashPaths(base, sourceInputs), baseBefore);
    assert.equal(hashPaths(head, sourceInputs), headBefore);
  });
});

for (const args of [['--fixture', 'missing-fixture'], ['--unknown']]) {
  test(`build removes old passing evidence when preflight rejects ${args[0]}`, () => {
    temporary((directory) => {
      put(
        directory,
        'dist/perf-build.json',
        JSON.stringify({ formatVersion: 2, earlier: 'passing build' }),
      );
      const result = cli('perf/build.ts', args, directory);

      assert.notEqual(result.status, 0);
      assert.equal(existsSync(join(directory, 'dist/perf-build.json')), false, result.stderr);
    });
  });
}

test('build rejects an external fixture changed during compilation and removes old passing evidence', () => {
  temporary((directory) => {
    const base = join(directory, 'base');
    const head = join(directory, 'head');
    checkout(base, 'base');
    checkout(head, 'head');
    const environment = fakeBuild(head, base, true);
    put(
      head,
      'dist/perf-build.json',
      JSON.stringify({ formatVersion: 2, earlier: 'passing build' }),
    );
    const result = cli('perf/build.ts', ['--fixture', base], head, environment);

    assert.notEqual(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stderr, /inputs changed during the production build/);
    assert.equal(existsSync(join(head, 'dist/perf-build.json')), false);
    const calls = readFileSync(join(head, 'build-calls.ndjson'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    assert.equal(
      existsSync(calls[1].cwd),
      false,
      'failed build must remove its disposable workspace',
    );
  });
});
