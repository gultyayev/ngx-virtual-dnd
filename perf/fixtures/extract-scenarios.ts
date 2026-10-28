import { readFileSync } from 'node:fs';

interface Attachment {
  name: string;
  body?: string;
  contentType: string;
}

interface TestResult {
  attachments?: Attachment[];
}

interface TestCase {
  results?: TestResult[];
}

interface Spec {
  tests?: TestCase[];
}

interface Suite {
  suites?: Suite[];
  specs?: Spec[];
}

interface ResultsFile {
  suites: Suite[];
}

export interface ScenarioReport {
  scenario: string;
  metricsSchemaVersion?: number;
  [metric: string]: unknown;
}

export function extractScenarios(filePath: string): ScenarioReport[] {
  const data: ResultsFile = JSON.parse(readFileSync(filePath, 'utf-8'));
  const scenarios: ScenarioReport[] = [];

  function traverseSuite(suite: Suite): void {
    for (const child of suite.suites ?? []) {
      traverseSuite(child);
    }
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        for (const result of test.results ?? []) {
          for (const attachment of result.attachments ?? []) {
            if (attachment.contentType === 'application/json' && attachment.body) {
              const report = JSON.parse(
                Buffer.from(attachment.body, 'base64').toString('utf-8'),
              ) as ScenarioReport;
              if (report.scenario) {
                scenarios.push(report);
              }
            }
          }
        }
      }
    }
  }

  for (const suite of data.suites ?? []) {
    traverseSuite(suite);
  }

  return scenarios;
}
