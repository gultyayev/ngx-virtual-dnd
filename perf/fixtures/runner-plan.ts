import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import type { Variant } from './run-types.ts';

export function blockOrder(index: number): Variant[] {
  if (!Number.isInteger(index) || index < 0) throw new Error('Invalid block index.');
  return index % 2 === 0 ? ['base', 'head', 'head', 'base'] : ['head', 'base', 'base', 'head'];
}

export function runnerProfile(value: string): {
  profile: 'counts' | 'timing';
  blocks: number;
  warmupIterations: number;
} {
  if (value === 'counts') return { profile: value, blocks: 3, warmupIterations: 0 };
  if (value === 'timing') return { profile: value, blocks: 20, warmupIterations: 1 };
  throw new Error('--profile must be counts or timing.');
}

/** Names and contents are hashed, so renaming/deleting a workload changes its identity. */
export function hashPaths(root: string, paths: string[]): string {
  const hash = createHash('sha256');
  const visit = (relative: string) => {
    const path = resolve(root, relative);
    if (!existsSync(path)) throw new Error(`Missing benchmark input: ${relative}`);
    const entries = readdirSync(path, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const name = join(relative, entry.name);
      if (entry.isDirectory()) visit(name);
      else if (entry.isFile()) {
        hash.update(name.replaceAll('\\', '/'));
        hash.update('\0');
        hash.update(readFileSync(resolve(root, name)));
        hash.update('\0');
      } else throw new Error(`Unsupported benchmark input: ${name}`);
    }
  };
  for (const name of [...paths].sort()) {
    const path = resolve(root, name);
    if (!existsSync(path)) throw new Error(`Missing benchmark input: ${name}`);
    // File inputs are distinguished from directories without depending on their mtime.
    try {
      const bytes = readFileSync(path);
      hash.update(name);
      hash.update('\0');
      hash.update(bytes);
      hash.update('\0');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EISDIR') throw error;
      visit(name);
    }
  }
  return hash.digest('hex');
}

export const FIXTURE_PATHS = [
  'src',
  'public',
  'angular.json',
  'tsconfig.json',
  'tsconfig.app.json',
];
export const DEPENDENCY_PATHS = ['package.json', 'package-lock.json'];
export const LIBRARY_PATHS = [
  'projects/ngx-virtual-dnd/src',
  'projects/ngx-virtual-dnd/package.json',
  'projects/ngx-virtual-dnd/ng-package.json',
  'projects/ngx-virtual-dnd/tsconfig.lib.json',
  'projects/ngx-virtual-dnd/tsconfig.lib.prod.json',
];
export const HARNESS_PATHS = [
  'perf/fixtures',
  'perf/scenarios',
  'perf/playwright.perf.config.ts',
  'perf/run.ts',
  'perf/build.ts',
  'perf/prepare.ts',
  'scripts/serve-dist.js',
];
export const PRODUCTION_INPUT_PATHS = [
  ...DEPENDENCY_PATHS,
  ...LIBRARY_PATHS,
  'angular.json',
  'tsconfig.json',
  'dist/perf-build.json',
  'dist/dnd/browser',
];

export function dependencyHash(root: string): string {
  return hashPaths(root, DEPENDENCY_PATHS);
}

/** Fingerprint the packages actually installed, after checking them against the declared lock. */
export function installedDependencyHash(root: string): string {
  const read = (name: string) =>
    JSON.parse(readFileSync(resolve(root, name), 'utf8')) as Record<string, unknown>;
  const record = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value);
  const declared = read('package-lock.json');
  const installed = read('node_modules/.package-lock.json');
  const manifest = read('package.json');
  if (
    !record(declared['packages']) ||
    !record(installed['packages']) ||
    !record(declared['packages'][''])
  ) {
    throw new Error('Missing dependency lock metadata. Run npm ci before building or measuring.');
  }
  const packages = declared['packages'];
  const rootPackage = packages[''] as Record<string, unknown>;
  const actual = installed['packages'];
  const canonical = (value: unknown) =>
    JSON.stringify(
      record(value)
        ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))
        : (value ?? {}),
    );
  for (const field of [
    'dependencies',
    'devDependencies',
    'optionalDependencies',
    'peerDependencies',
  ]) {
    if (canonical(manifest[field]) !== canonical(rootPackage[field])) {
      throw new Error(
        'Dependency manifest and declared lock differ. Run npm ci with a current lockfile.',
      );
    }
  }
  const entries: unknown[] = [];
  for (const name of Object.keys(actual).sort()) {
    if (name === '') continue;
    if (
      !name.startsWith('node_modules/') ||
      name.includes('..') ||
      !record(actual[name]) ||
      !record(packages[name])
    ) {
      throw new Error(`Installed dependency ${name} is absent from the declared lock. Run npm ci.`);
    }
    const installedPackage = actual[name];
    const lockedPackage = packages[name];
    for (const field of ['version', 'resolved', 'integrity']) {
      if (installedPackage[field] !== lockedPackage[field]) {
        throw new Error(
          `Installed dependency ${name} differs from the declared lock (${field}). Run npm ci.`,
        );
      }
    }
    const packageFile = read(`${name}/package.json`);
    if (
      typeof installedPackage['version'] !== 'string' ||
      packageFile['version'] !== installedPackage['version']
    ) {
      throw new Error(`Installed package files for ${name} are stale or incomplete. Run npm ci.`);
    }
    entries.push({
      path: name,
      name: packageFile['name'],
      version: packageFile['version'],
      resolved: installedPackage['resolved'],
      integrity: installedPackage['integrity'],
    });
  }
  for (const [name, lockedPackage] of Object.entries(packages)) {
    if (
      name !== '' &&
      record(lockedPackage) &&
      lockedPackage['optional'] !== true &&
      !(name in actual)
    ) {
      throw new Error(`Required dependency ${name} is not installed. Run npm ci.`);
    }
  }
  return createHash('sha256').update(JSON.stringify(entries)).digest('hex');
}
