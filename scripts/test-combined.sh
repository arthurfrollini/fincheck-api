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
e2e_output=$(npx jest --config ./test/jest-e2e.json --coverageReporters=json --coverageReporters=text-summary 2>&1)
e2e_status=$?
if [ $e2e_status -ne 0 ]; then
  echo "$e2e_output"
  echo ""
  echo "E2E tests failed."
  exit $e2e_status
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
