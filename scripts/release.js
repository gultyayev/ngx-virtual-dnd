#!/usr/bin/env node

/**
 * Release script for ngx-virtual-dnd
 *
 * Usage: npm run release [patch|minor|major|<version>]
 *        npm run release:dry-run [patch|minor|major]
 *        npm run release:alpha
 *        npm run release:alpha:dry-run
 *        npm run release -- --pre-release [tag]   (default tag: alpha)
 *
 * Steps:
 * 1. Verify clean git working directory (master-only for stable releases)
 * 2. Run linting
 * 3. Run unit tests
 * 4. Build the library (needed for e2e tests)
 * 5. Run e2e tests
 * 6. Run commit-and-tag-version (bumps version, updates changelog, commits, tags)
 * 7. Rebuild the library (with new version)
 * 8. Push commit and tag to origin
 * 9. npm login, unless `npm whoami` shows a valid session (tokens are short-lived)
 * 10. Publish to npm from dist/ngx-virtual-dnd
 */

import { execSync } from 'node:child_process';
import { copyFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const DIST_PATH = 'dist/ngx-virtual-dnd';

function run(command, options = {}) {
  console.log(`\n> ${command}\n`);
  try {
    execSync(command, { stdio: 'inherit', ...options });
  } catch {
    process.exit(1);
  }
}

function runWithOutput(command) {
  return execSync(command, { encoding: 'utf-8' }).trim();
}

function isLoggedInToNpm() {
  try {
    const user = execSync('npm whoami', {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    console.log(`Logged in to npm as ${user}`);
    return true;
  } catch {
    return false;
  }
}

function validateGitState(preRelease) {
  console.log('\n=== Validating git state ===');

  const branch = runWithOutput('git branch --show-current');
  if (!preRelease && branch !== 'master') {
    console.error(`Error: Must be on master branch. Currently on: ${branch}`);
    process.exit(1);
  }

  const status = runWithOutput('git status --porcelain');
  if (status) {
    console.error('Error: Working directory is not clean. Commit or stash changes first.');
    console.error(status);
    process.exit(1);
  }

  const modeLabel = preRelease ? `pre-release (${preRelease})` : 'stable';
  console.log(`Git state OK: on ${branch}, working directory clean, mode: ${modeLabel}`);
}

function parseArgs() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');

  let preRelease = null;
  const preReleaseIndex = args.indexOf('--pre-release');
  if (preReleaseIndex !== -1) {
    const nextArg = args[preReleaseIndex + 1];
    preRelease = nextArg && !nextArg.startsWith('--') ? nextArg : 'alpha';
  }

  const releaseType = args.find((arg) => !arg.startsWith('--') && arg !== preRelease);

  return { dryRun, releaseType, preRelease };
}

function main() {
  const { dryRun, releaseType, preRelease } = parseArgs();

  if (dryRun) {
    console.log('\n*** DRY RUN MODE - No publish or push will occur ***\n');
  }
  if (preRelease) {
    console.log(`\n*** PRE-RELEASE MODE (${preRelease}) - Will publish to "next" npm tag ***\n`);
  }

  // Step 1: Validate git state
  validateGitState(preRelease);

  // Step 2: Run linting
  console.log('\n=== Running linting ===');
  run('npm run lint');

  // Step 3: Run unit tests
  console.log('\n=== Running unit tests ===');
  run('npm test');

  // Step 4: Build the library (needed for e2e tests)
  console.log('\n=== Building library (for e2e tests) ===');
  run('npm run build:lib');

  // Verify build output exists
  const distPath = resolve(process.cwd(), DIST_PATH);
  if (!existsSync(distPath)) {
    console.error(`Error: Build output not found at ${distPath}`);
    process.exit(1);
  }

  // Step 5: Run e2e tests
  console.log('\n=== Running e2e tests ===');
  run('npm run e2e');

  // Step 6: Bump version and generate changelog
  console.log('\n=== Bumping version and generating changelog ===');
  // Scope changelog + version bump to commits that touched the published
  // library, so demo/e2e/CI/perf changes don't leak into the consumer changelog.
  const scopePath = 'projects/ngx-virtual-dnd';
  let versionCmd = releaseType
    ? `npx commit-and-tag-version --path ${scopePath} --release-as ${releaseType}`
    : `npx commit-and-tag-version --path ${scopePath}`;

  if (preRelease) {
    versionCmd += ` --prerelease ${preRelease}`;
  }

  if (dryRun) {
    versionCmd += ' --dry-run';
  }

  run(versionCmd);

  if (dryRun) {
    console.log('\n*** DRY RUN COMPLETE ***');
    console.log('Skipped: library rebuild, git push, and npm publish');
    console.log('\nTo complete the release, run without --dry-run');
    return;
  }

  // Step 7: Rebuild the library (with new version from commit-and-tag-version)
  console.log('\n=== Rebuilding library (with new version) ===');
  run('npm run build:lib');

  // Copy README and LICENSE to dist
  console.log('\n=== Copying assets to dist ===');
  copyFileSync('README.md', resolve(distPath, 'README.md'));
  copyFileSync('LICENSE', resolve(distPath, 'LICENSE'));
  console.log('Copied README.md and LICENSE to dist');

  // Step 8: Push to origin
  console.log('\n=== Pushing to origin ===');
  const branch = runWithOutput('git branch --show-current');
  run(`git push --follow-tags origin ${branch}`);

  // Step 9: npm login, unless the current session is still valid (tokens are short-lived)
  console.log('\n=== Checking npm auth ===');
  if (isLoggedInToNpm()) {
    console.log('Already logged in to npm, skipping login');
  } else {
    run('npm login');
  }

  // Step 10: Publish to npm
  console.log('\n=== Publishing to npm ===');
  const publishCmd = preRelease
    ? 'npm publish --access public --tag next'
    : 'npm publish --access public';
  run(publishCmd, { cwd: distPath });

  console.log('\n=== Release complete! ===');
}

main();
