import { readFileSync } from 'node:fs';
import { EXPECTED_SCENARIOS, type ScenarioReport } from './run-types.ts';
export type { ScenarioReport } from './run-types.ts';
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** Accept only a complete successful Playwright run, never a failed/retried attachment. */
export function extractScenarios(filePath: string): ScenarioReport[] {
  const data: unknown = JSON.parse(readFileSync(filePath, 'utf-8'));
  return extractScenarioData(data);
}

export function extractScenarioData(data: unknown): ScenarioReport[] {
  const invalid = (reason: string): never => {
    throw new Error(`Invalid benchmark reporter data: ${reason}`);
  };
  if (!object(data) || !Array.isArray(data['suites']) || data['suites'].length === 0)
    return invalid('missing suites.');
  if (!Array.isArray(data['errors']) || data['errors'].length > 0)
    return invalid('missing error state or run-level errors.');
  const stats = data['stats'];
  if (
    !object(stats) ||
    stats['unexpected'] !== 0 ||
    stats['skipped'] !== 0 ||
    stats['flaky'] !== 0 ||
    stats['expected'] !== Object.keys(EXPECTED_SCENARIOS).length
  )
    return invalid('run must pass every expected scenario without skips, retries, or failures.');
  const scenarios: ScenarioReport[] = [];
  const seen = new Set<string>();
  let testCount = 0;
  function traverse(suite: unknown): void {
    if (!object(suite)) return invalid('malformed suite.');
    if (suite['suites'] !== undefined) {
      if (!Array.isArray(suite['suites'])) return invalid('malformed child suites.');
      for (const child of suite['suites']) traverse(child);
    }
    if (suite['specs'] === undefined) return;
    if (!Array.isArray(suite['specs'])) return invalid('malformed specs.');
    for (const spec of suite['specs']) {
      if (
        !object(spec) ||
        spec['ok'] !== true ||
        !Array.isArray(spec['tests']) ||
        spec['tests'].length !== 1
      )
        return invalid('each benchmark spec must contain one successful test.');
      for (const test of spec['tests']) {
        testCount++;
        if (
          !object(test) ||
          test['expectedStatus'] !== 'passed' ||
          test['status'] !== 'expected' ||
          !Array.isArray(test['results']) ||
          test['results'].length !== 1
        )
          return invalid('failed, skipped, retried, or missing test result.');
        const result = test['results'][0];
        if (
          !object(result) ||
          result['status'] !== 'passed' ||
          result['retry'] !== 0 ||
          result['error'] !== undefined ||
          !Array.isArray(result['errors']) ||
          result['errors'].length !== 0 ||
          !Array.isArray(result['attachments'])
        )
          return invalid('result must pass once without errors.');
        let attached = 0;
        for (const attachment of result['attachments']) {
          if (
            !object(attachment) ||
            typeof attachment['name'] !== 'string' ||
            !Object.hasOwn(EXPECTED_SCENARIOS, attachment['name'])
          )
            continue;
          if (
            attachment['contentType'] !== 'application/json' ||
            typeof attachment['body'] !== 'string' ||
            attachment['body'].length === 0
          )
            return invalid('marked scenario attachment lacks inline JSON.');
          const body: unknown = JSON.parse(
            Buffer.from(attachment['body'], 'base64').toString('utf8'),
          );
          if (!object(body) || body['scenario'] !== attachment['name'])
            return invalid('attachment scenario identity does not match its marker.');
          if (seen.has(attachment['name']))
            return invalid(`duplicate scenario ${attachment['name']}.`);
          seen.add(attachment['name']);
          scenarios.push(body as unknown as ScenarioReport);
          attached++;
        }
        if (attached !== 1)
          return invalid(
            'each passing benchmark test must have exactly one marked scenario attachment.',
          );
      }
    }
  }
  for (const suite of data['suites']) traverse(suite);
  if (testCount !== Object.keys(EXPECTED_SCENARIOS).length)
    return invalid('unexpected test topology.');
  for (const name of Object.keys(EXPECTED_SCENARIOS))
    if (!seen.has(name)) return invalid(`missing expected scenario ${name}.`);
  return scenarios;
}
