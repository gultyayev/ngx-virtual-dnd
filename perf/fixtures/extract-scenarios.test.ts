import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractScenarioData } from './extract-scenarios.ts';
import { makeExperiment } from './experiment-fixture.ts';
function reporter() {
  const scenarios = makeExperiment().blocks[0].runs[0].scenarios;
  return {
    errors: [],
    stats: { expected: 6, unexpected: 0, skipped: 0, flaky: 0 },
    suites: [
      {
        specs: scenarios.map((scenario) => ({
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
                      name: scenario.scenario,
                      contentType: 'application/json',
                      body: Buffer.from(JSON.stringify(scenario)).toString('base64'),
                    },
                  ],
                },
              ],
            },
          ],
        })),
      },
    ],
  };
}
test('extracts each marked scenario once from a fully successful reporter', () => {
  assert.equal(extractScenarioData(reporter()).length, 6);
});
test('does not accept unrelated JSON attachments as benchmark evidence', () => {
  const data = reporter();
  const result = data.suites[0].specs[0].tests[0].results[0];
  result.attachments[0].name = 'unrelated-json';
  assert.throws(() => extractScenarioData(data), /marked scenario/);
});
test('duplicate scenario names fail before a map can overwrite the evidence', () => {
  const data = reporter();
  data.suites[0].specs[1].tests[0].results[0].attachments =
    data.suites[0].specs[0].tests[0].results[0].attachments;
  assert.throws(() => extractScenarioData(data), /duplicate scenario/);
});
test('failed first attempt plus a successful retry cannot become passing benchmark data', () => {
  const data = reporter();
  data.suites[0].specs[0].tests[0].results.unshift({
    ...data.suites[0].specs[0].tests[0].results[0],
    status: 'failed',
  });
  assert.throws(() => extractScenarioData(data), /retried/);
});
for (const field of ['unexpected', 'skipped', 'flaky'] as const)
  test(`rejects reporter ${field}`, () => {
    const data = reporter();
    data.stats[field] = 1;
    assert.throws(() => extractScenarioData(data));
  });
test('empty, missing, and malformed reporters fail closed', () => {
  for (const data of [
    { suites: [] },
    {},
    null,
    { suites: [{}], stats: { expected: 6, unexpected: 0, skipped: 0, flaky: 0 }, errors: [] },
  ])
    assert.throws(() => extractScenarioData(data));
});
test('run errors and incorrectly marked body identities fail closed', () => {
  const errors = reporter() as unknown as Record<string, unknown>;
  errors['errors'] = [{ message: 'server crashed' }];
  assert.throws(() => extractScenarioData(errors), /run-level errors/);
  const data = reporter();
  data.suites[0].specs[0].tests[0].results[0].attachments[0].body = Buffer.from(
    JSON.stringify({ scenario: 'wrong' }),
  ).toString('base64');
  assert.throws(() => extractScenarioData(data), /identity/);
});
