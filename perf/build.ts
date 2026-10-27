import { spawn, type ChildProcess } from 'node:child_process';
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

export async function main(args = process.argv.slice(2)): Promise<void> {
  const root = realpathSync(process.cwd());
  const manifest = resolve(root, 'dist/perf-build.json');
  rmSync(manifest, { force: true });
  const failure = resolve(root, 'dist/perf-build-failure.json');
  const failureReport = resolve(root, 'perf/results/build-failure.md');
  rmSync(failure, { force: true });
  rmSync(failureReport, { force: true });
  let stage = 'preflight';
  let stagingDirectory: string | undefined;
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
  const run = async (command: string, commandArgs: string[], cwd: string) => {
    let output = '';
    try {
      await new Promise<void>((resolveBuild, reject) => {
        child = spawn(command, commandArgs, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
        for (const [stream, destination] of [
          [child.stdout, process.stdout],
          [child.stderr, process.stderr],
        ] as const) {
          stream!.on('data', (data: Buffer) => {
            output += data.toString();
            destination.write(data);
          });
        }
        child.once('error', reject);
        child.once('close', (code, signal) =>
          code === 0 && !interrupted
            ? resolveBuild()
            : reject(
                new Error(
                  `${stage === 'consumer' ? 'Common fixture' : 'Library'} build failed (${signal ?? code}).\n${output.slice(-12_000)}`,
                ),
              ),
        );
      });
    } finally {
      mkdirSync(resolve(root, 'perf/results'), { recursive: true });
      writeFileSync(resolve(root, `perf/results/build-${stage}.log`), output);
      child = undefined;
    }
  };
  try {
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
    stage = 'library';
    await run('npm', ['run', 'build:lib'], root);
    if (JSON.stringify(before) !== JSON.stringify(inputIdentity()))
      throw new Error(
        'Benchmark inputs changed during the production build. Rebuild from stable source.',
      );
    stagingDirectory = mkdtempSync(resolve(tmpdir(), 'perf-fixture-'));
    stage = 'consumer';
    const fixture = stageFixture(root, fixtureRoot, stagingDirectory);
    await run(
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
      stagingDirectory,
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
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const diagnosis =
      stage === 'consumer'
        ? 'The library could not compile the selected consumer. A breaking API change may be source-incompatible with the base demo; no comparable evidence was collected.'
        : `Benchmark ${stage} failed; no comparable evidence was collected.`;
    mkdirSync(resolve(root, 'dist'), { recursive: true });
    mkdirSync(resolve(root, 'perf/results'), { recursive: true });
    writeFileSync(
      failure,
      JSON.stringify({ stage, message, diagnosis, interrupted }, null, 2) + '\n',
    );
    writeFileSync(
      failureReport,
      `**Benchmark build failed (${stage})**\n\n${diagnosis}\n\n\`\`\`text\n${message.replaceAll('```', "'''")}\n\`\`\`\n`,
    );
    throw error;
  } finally {
    process.removeListener('SIGINT', sigint);
    process.removeListener('SIGTERM', sigterm);
    if (stagingDirectory) rmSync(stagingDirectory, { recursive: true, force: true });
    if (interrupted) process.exitCode = interrupted === 'SIGINT' ? 130 : 143;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode ||= 1;
  });
}
