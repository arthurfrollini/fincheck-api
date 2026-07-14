#!/bin/bash
# Runs unit + e2e suites, merges their coverage reports, and prints the
# combined statement/branch/function/line percentages — a line counts as
# covered if either suite exercises it. Neither suite's own report alone
# reflects this: unit only covers application/domain services, e2e only
# covers infra/http (plus what it deliberately mocks out), so the two
# numbers are meaningless in isolation for a combined coverage target.
set -e

npm run test:unit -- --coverage
npx jest --config ./test/jest-e2e.json --coverageReporters=json --coverageReporters=text-summary

rm -rf .nyc_merge
mkdir -p .nyc_merge/.nyc_output
cp coverage/coverage-final.json .nyc_merge/.nyc_output/unit.json
cp coverage-e2e/coverage-final.json .nyc_merge/.nyc_output/e2e.json

echo ""
echo "=== Combined coverage (unit + e2e merged) ==="
npx nyc merge .nyc_merge/.nyc_output .nyc_merge/.nyc_output/merged.json > /dev/null
rm .nyc_merge/.nyc_output/unit.json .nyc_merge/.nyc_output/e2e.json
npx nyc report --temp-dir=.nyc_merge/.nyc_output --report-dir=.nyc_merge/report --reporter=text --reporter=text-summary

rm -rf .nyc_merge
