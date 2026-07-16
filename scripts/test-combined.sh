#!/bin/bash
# Runs unit + e2e suites, merges their coverage reports, and prints only the
# combined statement/branch/function/line percentages — a line counts as
# covered if either suite exercises it. Neither suite's own report alone
# reflects this: unit only covers application/domain services, e2e only
# covers infra/http (plus what it deliberately mocks out), so the two
# numbers are meaningless in isolation for a combined coverage target.
#
# Each suite's own test/coverage output is suppressed unless it fails, to
# keep the only thing printed the final merged report.
set -uo pipefail

echo "Running unit tests..."
unit_output=$(npm run test:unit -- --coverage 2>&1)
unit_status=$?
if [ $unit_status -ne 0 ]; then
  echo "$unit_output"
  echo ""
  echo "Unit tests failed."
  exit $unit_status
fi

echo "Running e2e tests (real DB, ~45-50s)..."
# Determine real pass/fail from Jest's own results, not the raw exit code:
# a known, tracked BullMQ/Redis teardown race (see docs/known-issues/bullmq-teardown-race.md) can crash
# the process with a non-zero exit AFTER all tests complete. That same crash
# preempts Jest's built-in --json/--outputFile serialization (written at the
# very end), so we use a tiny custom reporter that writes the pass/fail summary
# synchronously in onRunComplete — before the crash can occur.
e2e_results_file=$(mktemp)
e2e_output=$(E2E_RESULTS_FILE="$e2e_results_file" npx jest --config ./test/jest-e2e.json --coverageReporters=json --coverageReporters=text-summary --reporters="<rootDir>/test/e2e-results-reporter.js" --reporters=default 2>&1)
e2e_status=$?

if [ -s "$e2e_results_file" ]; then
  # Parse via fs.readFileSync + JSON.parse (not require): the mktemp file has
  # no .json extension, so require() would parse it as a JS module and throw.
  e2e_failed_tests=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$e2e_results_file', 'utf8')).numFailedTests)")
  e2e_failed_suites=$(node -e "console.log(JSON.parse(require('fs').readFileSync('$e2e_results_file', 'utf8')).numFailedTestSuites)")
else
  e2e_failed_tests=1
  e2e_failed_suites=1
fi
rm -f "$e2e_results_file"

if [ "$e2e_failed_tests" != "0" ] || [ "$e2e_failed_suites" != "0" ]; then
  echo "$e2e_output"
  echo ""
  echo "E2E tests failed."
  exit 1
fi

if [ $e2e_status -ne 0 ]; then
  echo "E2E tests: all assertions passed. Non-zero exit code is a known, tracked BullMQ/Redis teardown race (see docs/known-issues/bullmq-teardown-race.md) — occurs after all tests complete, not a real failure."
fi

rm -rf .nyc_merge
mkdir -p .nyc_merge/.nyc_output
cp coverage/coverage-final.json .nyc_merge/.nyc_output/unit.json
cp coverage-e2e/coverage-final.json .nyc_merge/.nyc_output/e2e.json
npx nyc merge .nyc_merge/.nyc_output .nyc_merge/.nyc_output/merged.json > /dev/null
rm .nyc_merge/.nyc_output/unit.json .nyc_merge/.nyc_output/e2e.json

echo "Unit: passed. E2E: passed."
echo ""
echo "=== Combined coverage (unit + e2e merged) ==="
npx nyc report --temp-dir=.nyc_merge/.nyc_output --report-dir=.nyc_merge/report --reporter=text --reporter=text-summary

rm -rf .nyc_merge
