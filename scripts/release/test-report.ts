// Usage: node scripts/release/test-report.ts <vitest.json> <required file>…
// Prints one summary line; exits 1 with the reason when the report is not a clean pass.
import { readFileSync } from 'node:fs';
import { assertNothingSkipped, type VitestReport } from './testReport.ts';

const [file, ...required] = process.argv.slice(2);
if (!file) {
  process.stderr.write('usage: test-report.ts <vitest.json> <required file>…\n');
  process.exit(2);
}

try {
  const report = JSON.parse(readFileSync(file, 'utf8')) as VitestReport;
  const summary = assertNothingSkipped(report, required);
  process.stdout.write(
    `${summary.passed} passed, 0 skipped, content-dependent suites ran: ${summary.requiredFilesSeen}\n`,
  );
} catch (error) {
  process.stderr.write(`test report: ${(error as Error).message}\n`);
  process.exit(1);
}
