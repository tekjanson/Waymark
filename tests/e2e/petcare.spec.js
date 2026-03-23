// @ts-check
const { test, expect } = require('@playwright/test');
const { setupApp, navigateToSheet, getCreatedRecords } = require('../helpers/test-utils');

test('pet care tracker is detected from Pet + Vet headers', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-058');
  await page.waitForSelector('.petcare-card', { timeout: 5_000 });

  await expect(page.locator('#template-badge')).toContainText('Pet Care');
});

test('pet care tracker renders one card per pet row', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-058');
  await page.waitForSelector('.petcare-card', { timeout: 5_000 });

  const cards = page.locator('.petcare-card');
  expect(await cards.count()).toBe(4); // fixture has 4 pets
});

test('pet name and type badge are visible on each card', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-058');
  await page.waitForSelector('.petcare-name', { timeout: 5_000 });

  const names = await page.locator('.petcare-name').allTextContents();
  expect(names).toContain('Buddy');
  expect(names).toContain('Whiskers');

  const badges = page.locator('.petcare-type-badge');
  expect(await badges.count()).toBeGreaterThan(0);
  const firstBadge = await badges.first().textContent();
  expect(firstBadge).toBeTruthy();
});

test('pet icon renders emoji based on pet type', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-058');
  await page.waitForSelector('.petcare-icon', { timeout: 5_000 });

  const icons = await page.locator('.petcare-icon').allTextContents();
  expect(icons.some(ic => ic.includes('🐕'))).toBe(true); // Buddy = Dog
  expect(icons.some(ic => ic.includes('🐈'))).toBe(true); // Whiskers = Cat
});

test('appointment badge with past date gets overdue class', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-058');
  await page.waitForSelector('.petcare-appt-badge', { timeout: 5_000 });

  // Buddy has appointment 2020-03-01 — always in the past → overdue
  const overdueBadges = page.locator('.petcare-due-overdue');
  expect(await overdueBadges.count()).toBeGreaterThan(0);
});

test('appointment badge with very far future date gets later class', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-058');
  await page.waitForSelector('.petcare-appt-badge', { timeout: 5_000 });

  // Whiskers has appointment 2099-05-10 — always in the far future → later
  const laterBadges = page.locator('.petcare-due-later');
  expect(await laterBadges.count()).toBeGreaterThan(0);
});

test('stats section shows vet date and vaccination date', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-058');
  await page.waitForSelector('.petcare-stats', { timeout: 5_000 });

  const statLabels = await page.locator('.petcare-stat-label').allTextContents();
  const labelsText = statLabels.join(' ');
  expect(labelsText).toMatch(/last vet/i);
  expect(labelsText).toMatch(/vaccinated/i);
});

test('stats section shows formatted date values', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-058');
  await page.waitForSelector('.petcare-stat-value', { timeout: 5_000 });

  // Buddy's vet visit is 2026-01-15 → should render as 'Jan 15, 2026'
  const statValues = await page.locator('.petcare-stat-value').allTextContents();
  expect(statValues.some(v => v.includes('Jan'))).toBe(true);
});

test('medication pill renders for pets with medication', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-058');
  await page.waitForSelector('.petcare-card', { timeout: 5_000 });

  // Buddy has 'Heartworm monthly'
  const pills = page.locator('.petcare-med-pill');
  expect(await pills.count()).toBeGreaterThan(0);
  const pillText = await pills.first().textContent();
  expect(pillText).toMatch(/heartworm/i);
});

test('notes paragraph renders for pets with notes', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-058');
  await page.waitForSelector('.petcare-notes', { timeout: 5_000 });

  const notes = page.locator('.petcare-notes');
  expect(await notes.count()).toBeGreaterThan(0);
  const firstNote = await notes.first().textContent();
  expect(firstNote).toBeTruthy();
});

test('inline edit: editing pet name emits a record', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-058');
  await page.waitForSelector('.petcare-name', { timeout: 5_000 });

  const firstCard = page.locator('.petcare-card').first();
  const nameEl = firstCard.locator('.petcare-name');
  await nameEl.click();

  const input = await page.waitForSelector('.petcare-card:first-child .editable-cell-input', { timeout: 3_000 });
  await input.fill('Max');
  await input.press('Enter');

  const records = await getCreatedRecords(page);
  expect(records.some(r => r.value === 'Max')).toBe(true);
});

test('inline edit: pressing Escape cancels and emits no record', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-058');
  await page.waitForSelector('.petcare-name', { timeout: 5_000 });

  const firstCard = page.locator('.petcare-card').first();
  const nameEl = firstCard.locator('.petcare-name');
  const originalText = await nameEl.textContent();

  await nameEl.click();
  const input = await page.waitForSelector('.petcare-card:first-child .editable-cell-input', { timeout: 3_000 });
  await input.fill('ShouldNotSave');
  await input.press('Escape');

  // Text must be restored
  await expect(nameEl).toContainText(originalText || '');

  const records = await getCreatedRecords(page);
  expect(records.some(r => r.value === 'ShouldNotSave')).toBe(false);
});

test('petcare cards have pointer cursor on name and editable cells', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-058');
  await page.waitForSelector('.petcare-name', { timeout: 5_000 });

  await expect(page.locator('.petcare-name').first()).toHaveCSS('cursor', 'pointer');
});

test('pet care card uses surface background with border and border-radius', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-058');
  await page.waitForSelector('.petcare-card', { timeout: 5_000 });

  const card = page.locator('.petcare-card').first();
  await expect(card).toHaveCSS('border-radius', /\d+px/);
  const border = await card.evaluate(el => getComputedStyle(el).border);
  expect(border).not.toBe('');
});

test('pet care template renders correctly at mobile width', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await setupApp(page);
  await navigateToSheet(page, 'sheet-058');
  await page.waitForSelector('.petcare-card', { timeout: 5_000 });

  // Verify no horizontal overflow
  const overflows = await page.evaluate(() => {
    const problems = [];
    document.querySelectorAll('.petcare-card, .petcare-header, .petcare-stats').forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.right > window.innerWidth + 2) {
        problems.push(el.className);
      }
    });
    return problems;
  });
  expect(overflows).toHaveLength(0);

  const cards = page.locator('.petcare-card');
  expect(await cards.count()).toBe(4);
});

test('set-appointment placeholder shows for pets without upcoming appointment', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-058');
  await page.waitForSelector('.petcare-card', { timeout: 5_000 });

  // Thumper and Goldie have no appointment → should show "Set appointment"
  const allBadges = await page.locator('.petcare-appt-badge').allTextContents();
  expect(allBadges.some(t => t.includes('Set appointment'))).toBe(true);
});
