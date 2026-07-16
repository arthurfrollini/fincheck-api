// Minimal Jest reporter that writes a tiny pass/fail summary to a file
// synchronously in onRunComplete. This runs as part of Jest's reporter
// pipeline (right when the run finishes), BEFORE the BullMQ/Redis teardown
// race can crash the process and preempt Jest's own --json/--outputFile
// serialization. scripts/test-combined.sh reads this file to determine real
// pass/fail from Jest's own results rather than the teardown-polluted exit
// code. See docs/known-issues/bullmq-teardown-race.md.
const fs = require('fs');

class E2eResultsReporter {
  constructor(globalConfig, options) {
    this._outputFile = (options && options.outputFile) || process.env.E2E_RESULTS_FILE;
  }

  onRunComplete(_contexts, results) {
    if (!this._outputFile) {
      return;
    }
    const summary = {
      numFailedTests: results.numFailedTests,
      numFailedTestSuites: results.numFailedTestSuites,
      numPassedTests: results.numPassedTests,
      numTotalTests: results.numTotalTests,
    };
    fs.writeFileSync(this._outputFile, JSON.stringify(summary));
  }
}

module.exports = E2eResultsReporter;
