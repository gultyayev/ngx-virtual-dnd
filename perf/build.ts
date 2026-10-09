import { spawnSync } from 'node:child_process';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import {
  dependencyHash,
  DEPENDENCY_PATHS,
  FIXTURE_PATHS,
  hashPaths,
  installedDependencyHash,
  LIBRARY_PATHS,
} from './fixtures/runner-plan.ts';

/** Build a consumer fixture independently of each checkout's current demo and newly added APIs. */
export function stageFixture(
  root: string,
  fixtureRoot: string,
  stagingDirectory: string,
): { project: string; outputDirectory: string } {
  mkdirSync(stagingDirectory, { recursive: true });
  for (const name of FIXTURE_PATHS)
    cpSync(resolve(fixtureRoot, name), resolve(stagingDirectory, name), { recursive: true });
  for (const name of DEPENDENCY_PATHS) cpSync(resolve(root, name), resolve(stagingDirectory, name));
  symlinkSync(resolve(root, 'node_modules'), resolve(stagingDirectory, 'node_modules'), 'dir');
  mkdirSync(resolve(stagingDirectory, 'dist'), { recursive: true });
  symlinkSync(
    resolve(root, 'dist/ngx-virtual-dnd'),
    resolve(stagingDirectory, 'dist/ngx-virtual-dnd'),
    'dir',
  );
  writeFileSync(
    resolve(stagingDirectory, 'tsconfig.perf.json'),
    JSON.stringify(
      {
        extends: './tsconfig.app.json',
        compilerOptions: { paths: { 'ngx-virtual-dnd': ['./dist/ngx-virtual-dnd'] } },
      },
      null,
      2,
    ) + '\n',
  );
  const angular = JSON.parse(readFileSync(resolve(stagingDirectory, 'angular.json'), 'utf8'));
  const applications = Object.entries(angular.projects ?? {}).filter(
    ([, project]) => (project as { projectType?: string }).projectType === 'application',
  );
  if (applications.length !== 1)
    throw new Error('The common fixture must define exactly one Angular application.');
  const [project, application] = applications[0] as [
    string,
    { architect?: { build?: { options?: Record<string, unknown> } } },
  ];
  if (!application.architect?.build)
    throw new Error('Common fixture is missing its application build target.');
  application.architect.build.options = {
    ...application.architect.build.options,
    tsConfig: 'tsconfig.perf.json',
  };
  angular.projects = { [project]: application };
  writeFileSync(resolve(stagingDirectory, 'angular.json'), JSON.stringify(angular, null, 2) + '\n');
  return { project, outputDirectory: resolve(stagingDirectory, 'dist/dnd/browser') };
}

export function main(args = process.argv.slice(2)): void {
  const root = realpathSync(process.cwd());
  const manifest = resolve(root, 'dist/perf-build.json');
  rmSync(manifest, { force: true });
  const { values } = parseArgs({ args, options: { fixture: { type: 'string' } } });
  const fixtureRoot = realpathSync(resolve(values.fixture ?? root));
  const inputIdentity = () => ({
    fixtureHash: hashPaths(fixtureRoot, FIXTURE_PATHS),
    libraryHash: hashPaths(root, LIBRARY_PATHS),
    libraryBuildConfigHash: hashPaths(root, ['angular.json', 'tsconfig.json']),
    dependencyHash: dependencyHash(root),
    installedDependencyHash: installedDependencyHash(root),
  });
  const before = inputIdentity();
  const buildLibrary = spawnSync('npm', ['run', 'build:lib'], { cwd: root, stdio: 'inherit' });
  if (buildLibrary.error) throw buildLibrary.error;
  if (buildLibrary.status !== 0)
    throw new Error(`Library build failed (${buildLibrary.status ?? buildLibrary.signal}).`);
  if (JSON.stringify(before) !== JSON.stringify(inputIdentity()))
    throw new Error(
      'Benchmark inputs changed during the production build. Rebuild from stable source.',
    );
  const stagingDirectory = mkdtempSync(resolve(tmpdir(), 'perf-fixture-'));
  try {
    const fixture = stageFixture(root, fixtureRoot, stagingDirectory);
    const buildApplication = spawnSync(
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
      { cwd: stagingDirectory, stdio: 'inherit' },
    );
    if (buildApplication.error) throw buildApplication.error;
    if (buildApplication.status !== 0)
      throw new Error(
        `Common fixture build failed (${buildApplication.status ?? buildApplication.signal}).`,
      );
    if (JSON.stringify(before) !== JSON.stringify(inputIdentity()))
      throw new Error(
        'Benchmark inputs changed during the production build. Rebuild from stable source.',
      );
    rmSync(resolve(root, 'dist/dnd/browser'), { recursive: true, force: true });
    cpSync(fixture.outputDirectory, resolve(root, 'dist/dnd/browser'), { recursive: true });
    mkdirSync(resolve(root, 'dist'), { recursive: true });
    writeFileSync(
      manifest,
      JSON.stringify(
        {
          formatVersion: 2,
          fixtureRoot,
          ...before,
          outputHash: hashPaths(root, ['dist/dnd/browser']),
        },
        null,
        2,
      ) + '\n',
    );
  } finally {
    rmSync(stagingDirectory, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
