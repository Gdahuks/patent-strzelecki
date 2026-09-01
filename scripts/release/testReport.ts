/**
 * Reads the JSON report vitest writes with `--reporter=json --outputFile=…` and refuses anything
 * short of "every test ran and passed".
 *
 * Why this exists: three test files in `src/content/` skip themselves when the content bundle is
 * absent (`describe.skipIf(!PRESENT)`), which is the right thing in CI and on a fresh clone. The
 * release build is the one place where the bundle *is* present — so there, a skipped test means
 * the copy did not land where the tests look, and a report with skips must fail the release.
 */

export interface AssertionResult {
  status: string;
}

export interface FileResult {
  name: string;
  status: string;
  assertionResults: AssertionResult[];
}

export interface VitestReport {
  numTotalTests: number;
  numPassedTests: number;
  numFailedTests: number;
  numPendingTests: number;
  testResults: FileResult[];
}

export interface Summary {
  total: number;
  passed: number;
  requiredFilesSeen: number;
}

/**
 * @param requiredFiles paths relative to the repository root that must have run at least one
 *   test with none skipped — the content-dependent suites.
 */
export function assertNothingSkipped(report: VitestReport, requiredFiles: string[]): Summary {
  if (report.numTotalTests === 0) throw new Error('no tests ran');
  if (report.numFailedTests > 0) throw new Error(`${report.numFailedTests} test(s) failed`);
  if (report.numPendingTests > 0) {
    throw new Error(`${report.numPendingTests} test(s) were skipped — is the content bundle in place?`);
  }

  let seen = 0;
  for (const file of requiredFiles) {
    const result = report.testResults.find((entry) => entry.name.endsWith(`/${file}`));
    if (!result) throw new Error(`${file} is missing from the report`);
    if (result.assertionResults.length === 0) throw new Error(`${file} ran no tests`);
    if (result.assertionResults.some((test) => test.status !== 'passed')) {
      throw new Error(`${file} has skipped tests`);
    }
    seen += 1;
  }

  return { total: report.numTotalTests, passed: report.numPassedTests, requiredFilesSeen: seen };
}
