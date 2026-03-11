/**
 * Playwright config for the design-audit screenshot capture.
 * Runs ONLY the design-audit.spec.js file (no testIgnore blocking).
 */
const baseConfig = require('./tests/playwright.config.js');
const path = require('path');

module.exports = {
  ...baseConfig,
  testDir: path.resolve(__dirname, 'tests/e2e'),
  testIgnore: [],              // override the ignore so design-audit runs
  testMatch: '**/design-audit.spec.js',
  workers: 1,                  // sequential — screenshot order matters
  reporter: [['list']],        // no HTML report for screenshots
};
