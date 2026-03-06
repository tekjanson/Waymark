/* Root-level redirect so `npx playwright test` works from the project root
   without needing --config tests/playwright.config.js every time. */
const config = require('./tests/playwright.config.js');
const path = require('path');

module.exports = {
  ...config,
  testDir: path.resolve(__dirname, 'tests/e2e'),
};
