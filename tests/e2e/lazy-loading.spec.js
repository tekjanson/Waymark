const { test, expect } = require('@playwright/test');
const { setupApp } = require('../helpers/test-utils');

test('loads template modules only when needed', async ({ page }) => {
  const templateRequests = [];

  await page.route('**/js/templates/**', route => {
    templateRequests.push(route.request().url());
    route.continue();
  });

  await setupApp(page, { hash: '#/' });
  await page.waitForSelector('#app-screen:not(.hidden)', { timeout: 10_000 });

  const initialTemplateFiles = templateRequests
    .map(url => new URL(url).pathname.split('/').pop())
    .filter(Boolean);

  expect(initialTemplateFiles).toEqual(expect.arrayContaining(['checklist.js']));
  expect(initialTemplateFiles).not.toContain('budget.js');
  expect(initialTemplateFiles).not.toContain('tracker.js');

  await page.evaluate(() => {
    window.location.hash = '#/sheet/sheet-016';
  });
  await page.waitForSelector('#checklist-view:not(.hidden)', { timeout: 10_000 });

  const budgetLoaded = templateRequests.some(url => /\/js\/templates\/budget\/index\.js$/.test(url));
  expect(budgetLoaded).toBe(true);
});
