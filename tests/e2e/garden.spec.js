const { test, expect } = require('@playwright/test');
const { setupApp, navigateToSheet, getCreatedRecords } = require('../helpers/test-utils');

/* ─── Backyard Garden fixture (sheet-060): 8 plants across 5 zones ─── */

test('garden template is detected for sheet-060', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-060');
  await page.waitForSelector('.garden-card', { timeout: 5000 });
  await expect(page.locator('#template-badge')).toContainText('Garden Planner');
});

test('garden view renders 8 plant cards', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-060');
  await page.waitForSelector('.garden-card', { timeout: 5000 });
  await expect(page.locator('.garden-card')).toHaveCount(8);
});

test('plant cards show plant names', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-060');
  await page.waitForSelector('.garden-plant-name', { timeout: 5000 });
  const names = await page.locator('.garden-plant-name').allTextContents();
  expect(names).toContain('Tomato');
  expect(names).toContain('Basil');
  expect(names).toContain('Sunflower');
});

test('plants with variety show variety label', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-060');
  await page.waitForSelector('.garden-plant-variety', { timeout: 5000 });
  const varieties = await page.locator('.garden-plant-variety').allTextContents();
  expect(varieties.some(v => v.includes('Cherry Roma') || v.includes('Genovese'))).toBe(true);
});

test('zone groups render separate headings', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-060');
  await page.waitForSelector('.garden-group-heading', { timeout: 5000 });
  const headings = await page.locator('.garden-group-heading').allTextContents();
  // Fixture has zones: Bed A, Bed B, Border, Herb Pot, Raised Bed
  expect(headings.length).toBeGreaterThanOrEqual(3);
  expect(headings.some(h => h.includes('Bed'))).toBe(true);
});

test('water badges render for plants with last-watered dates', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-060');
  await page.waitForSelector('.garden-water-badge', { timeout: 5000 });
  const badges = page.locator('.garden-water-badge');
  const count = await badges.count();
  expect(count).toBeGreaterThan(0);
});

test('harvest badges render for plants with harvest dates', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-060');
  await page.waitForSelector('.garden-harvest-badge', { timeout: 5000 });
  const badges = page.locator('.garden-harvest-badge');
  const count = await badges.count();
  // 4 plants have harvest dates (Tomato, Cucumber, Sunflower, Zucchini, Strawberry)
  expect(count).toBeGreaterThanOrEqual(4);
});

test('planted date chips render for plants with planted dates', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-060');
  await page.waitForSelector('.garden-planted-chip', { timeout: 5000 });
  const chips = page.locator('.garden-planted-chip');
  const count = await chips.count();
  expect(count).toBeGreaterThan(0);
  // Verify date is formatted (shows month abbreviation)
  const firstText = await chips.first().textContent();
  expect(firstText).toMatch(/[A-Z][a-z]+\s+\d+/);
});

test('plant emoji icons render for all cards', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-060');
  await page.waitForSelector('.garden-plant-icon', { timeout: 5000 });
  await expect(page.locator('.garden-plant-icon')).toHaveCount(8);
});

test('plant name inline edit emits a record', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-060');
  await page.waitForSelector('.garden-plant-name', { timeout: 5000 });

  await page.locator('.garden-plant-name').first().click();
  const input = await page.waitForSelector('.garden-plant-name input.editable-cell-input', { timeout: 3000 });
  await input.fill('Updated Plant');
  await input.press('Enter');

  const records = await getCreatedRecords(page);
  expect(records.some(r => r.value === 'Updated Plant')).toBe(true);
});

test('garden cards use non-transparent background', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-060');
  await page.waitForSelector('.garden-card', { timeout: 5000 });

  const bg = await page.locator('.garden-card').first().evaluate(
    el => getComputedStyle(el).backgroundColor
  );
  expect(bg).not.toBe('rgba(0, 0, 0, 0)');
  expect(bg).not.toBe('');
});

test('garden cards have border radius (rounded corners)', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-060');
  await page.waitForSelector('.garden-card', { timeout: 5000 });

  const radius = await page.locator('.garden-card').first().evaluate(
    el => parseFloat(getComputedStyle(el).borderRadius)
  );
  expect(radius).toBeGreaterThan(0);
});

test('garden cards use grid layout', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-060');
  await page.waitForSelector('.garden-cards', { timeout: 5000 });
  await expect(page.locator('.garden-cards').first()).toHaveCSS('display', 'grid');
});

test('garden template renders correctly at 375px mobile width', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await setupApp(page);
  await navigateToSheet(page, 'sheet-060');
  await page.waitForSelector('.garden-card', { timeout: 5000 });

  const overflows = await page.evaluate(() => {
    const problems = [];
    document.querySelectorAll('.garden-card').forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.right > window.innerWidth + 2) {
        problems.push(el.className);
      }
    });
    return problems;
  });
  expect(overflows).toHaveLength(0);
});
