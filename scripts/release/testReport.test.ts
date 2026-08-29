import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { assertNothingSkipped, type VitestReport } from './testReport.ts';

function report(overrides: Partial<VitestReport> = {}): VitestReport {
  return {
    numTotalTests: 3,
    numPassedTests: 3,
    numFailedTests: 0,
    numPendingTests: 0,
    testResults: [
      { name: '/repo/src/content/acts.package.test.ts', status: 'passed', assertionResults: [{ status: 'passed' }, { status: 'passed' }] },
      { name: '/repo/src/engine/exam.test.ts', status: 'passed', assertionResults: [{ status: 'passed' }] },
    ],
    ...overrides,
  };
}

const REQUIRED = ['src/content/acts.package.test.ts'];

describe('assertNothingSkipped', () => {
  it('accepts a report with everything passed and the required files present', () => {
    const summary = assertNothingSkipped(report(), REQUIRED);
    assert.deepEqual(summary, { total: 3, passed: 3, requiredFilesSeen: 1 });
  });

  it('rejects skipped tests — with the content bundle present nothing may skip', () => {
    assert.throws(
      () => assertNothingSkipped(report({ numPendingTests: 2 }), REQUIRED),
      /2 test\(s\) were skipped/,
    );
  });

  it('rejects failures', () => {
    assert.throws(
      () => assertNothingSkipped(report({ numFailedTests: 1 }), REQUIRED),
      /1 test\(s\) failed/,
    );
  });

  it('rejects an empty run — zero tests is not a pass', () => {
    assert.throws(
      () =>
        assertNothingSkipped(report({ numTotalTests: 0, numPassedTests: 0, testResults: [] }), []),
      /no tests ran/,
    );
  });

  it('rejects a required file that did not run any test', () => {
    const r = report();
    r.testResults[0] = { ...r.testResults[0], assertionResults: [] };
    assert.throws(() => assertNothingSkipped(r, REQUIRED), /acts\.package\.test\.ts ran no tests/);
  });

  it('rejects a required file that is absent from the report', () => {
    assert.throws(
      () => assertNothingSkipped(report(), ['src/content/versions.package.test.ts']),
      /versions\.package\.test\.ts is missing from the report/,
    );
  });

  it('rejects a required file whose tests were skipped even when the totals look fine', () => {
    const r = report();
    r.testResults[0] = { ...r.testResults[0], assertionResults: [{ status: 'skipped' }] };
    assert.throws(
      () => assertNothingSkipped(r, REQUIRED),
      /acts\.package\.test\.ts has skipped tests/,
    );
  });
});
