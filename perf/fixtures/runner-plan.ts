import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import type { Variant } from './run-types.ts';

export function blockOrder(index: number): Variant[] {
  if (!Number.isInteger(index) || index < 0) throw new Error('Invalid block index.');
  return index % 2 === 0 ? ['base', 'head', 'head', 'base'] : ['head', 'base', 'base', 'head'];
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
  'package.json',
  'package-lock.json',
];
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
  ...FIXTURE_PATHS,
  ...LIBRARY_PATHS,
  'dist/perf-build.json',
  'dist/dnd/browser',
];

export function dependencyHash(root: string): string {
  return hashPaths(root, ['package.json', 'package-lock.json']);
}
