/**
 * mock-server.js — Fixture data helpers for Playwright tests.
 *
 * This module does NOT start its own server — Playwright's webServer
 * config handles that. Instead it provides:
 *  - Baseline fixture data as JS objects (for route interception)
 *  - Helper to override fixture routes per-test
 */

const fs   = require('fs');
const path = require('path');

const FIXTURES = path.join(__dirname, '..', 'fixtures');

function loadJSON(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES, relativePath), 'utf-8'));
}

/** Load all baseline fixture data. */
function getFixtures() {
  return {
    users:   loadJSON('users.json'),
    folders: loadJSON('folders.json'),
    sheets: {
      'sheet-001': loadJSON('sheets/groceries.json'),
      'sheet-002': loadJSON('sheets/home-projects.json'),
      'sheet-003': loadJSON('sheets/shared-chores.json'),
    },
  };
}

/**
 * Override a fixture route in the browser.
 * Uses Playwright page.route() to fulfill with custom data.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} fixturePath   e.g. 'folders.json'
 * @param {any} data             JSON-serialisable object
 */
async function overrideFixture(page, fixturePath, data) {
  await page.route(`**/__fixtures/${fixturePath}`, async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(data),
    });
  });
}

/**
 * Simulate an error for a specific API area.
 * Sets window.__WAYMARK_MOCK_ERROR on the page.
 *
 * @param {import('@playwright/test').Page} page
 * @param {'drive'|'sheets'|null} area   null to clear
 */
async function injectError(page, area) {
  await page.evaluate((a) => { window.__WAYMARK_MOCK_ERROR = a; }, area);
}

module.exports = {
  getFixtures,
  overrideFixture,
  injectError,
};
