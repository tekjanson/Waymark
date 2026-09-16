// @ts-check
const { test, expect } = require('@playwright/test');
const { setupApp, navigateToSheet, getCreatedRecords } = require('../helpers/test-utils');

const SHEET = 'sheet-074';

function card(page, key) {
  return page.locator(`.party-card-${key}`);
}

test('party workbook detected as Party Planning Dashboard', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, SHEET);
  await page.waitForSelector('.party-root', { timeout: 5_000 });
  await expect(page.locator('#template-badge')).toContainText('Party');
});

test('hero shows guest of honor, date and theme', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, SHEET);
  await page.waitForSelector('.party-hero', { timeout: 5_000 });
  const hero = page.locator('.party-hero');
  await expect(hero).toContainText('Sophie Martinez');
  await expect(hero).toContainText('2026-07-18');
  await expect(hero).toContainText('Tropical Garden Party');
});

test('overall readiness ring renders a percentage', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, SHEET);
  await page.waitForSelector('.party-ring-num', { timeout: 5_000 });
  // done 13 / total 23 = 57%
  await expect(page.locator('.party-ring-num')).toHaveText('57%');
});

test('all four category cards plus links render', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, SHEET);
  await page.waitForSelector('.party-board', { timeout: 5_000 });
  for (const key of ['guests', 'menu', 'budget', 'decorations', 'links']) {
    await expect(card(page, key)).toHaveCount(1);
  }
});

test('guest category shows the correct percent complete', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, SHEET);
  await page.waitForSelector('.party-card-guests', { timeout: 5_000 });
  // 4 of 5 responded (Yes/No) = 80%
  await expect(card(page, 'guests').locator('.party-card-pct')).toHaveText('80%');
});

test('clicking a card header collapses and expands its body', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, SHEET);
  await page.waitForSelector('.party-card-guests', { timeout: 5_000 });
  const body = card(page, 'guests').locator('.party-card-body');
  await expect(body).toBeVisible();
  await card(page, 'guests').locator('.party-card-head').click();
  await expect(body).toBeHidden();
  await card(page, 'guests').locator('.party-card-head').click();
  await expect(body).toBeVisible();
});

test('cycling an RSVP status persists to the Guests tab', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, SHEET);
  await page.waitForSelector('.party-card-guests .party-badge', { timeout: 5_000 });
  const firstBadge = card(page, 'guests').locator('.party-item .party-badge').first();
  await expect(firstBadge).toHaveText('Yes');
  await firstBadge.click();
  await expect(card(page, 'guests').locator('.party-item .party-badge').first()).toHaveText('No');
  const records = await getCreatedRecords(page);
  expect(records.some(r => r.type === 'tab-write' && r.tabTitle === 'Guests')).toBe(true);
});

test('toggling a decoration yes/no persists to the Decorations tab', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, SHEET);
  await page.waitForSelector('.party-card-decorations .party-toggle', { timeout: 5_000 });
  const toggle = card(page, 'decorations').locator('.party-item').first().locator('.party-toggle').first();
  await toggle.click();
  const records = await getCreatedRecords(page);
  expect(records.some(r => r.type === 'tab-write' && r.tabTitle === 'Decorations')).toBe(true);
});

test('adding a guest through the modal appends a row and persists', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, SHEET);
  await page.waitForSelector('.party-card-guests', { timeout: 5_000 });
  const before = await card(page, 'guests').locator('.party-item').count();
  await card(page, 'guests').locator('.party-add').click();
  await page.waitForSelector('.party-modal', { timeout: 3_000 });
  await page.locator('.party-modal .party-field-input').first().fill('New Friend');
  await page.locator('.party-modal-btn-primary').click();
  await expect(card(page, 'guests').locator('.party-item')).toHaveCount(before + 1);
  await expect(
    card(page, 'guests').locator('.party-item').last().locator('.party-cell-name .party-cell-input'),
  ).toHaveValue('New Friend');
  const records = await getCreatedRecords(page);
  expect(records.some(r => r.type === 'tab-write' && r.tabTitle === 'Guests')).toBe(true);
});

test('external tool links render with working hrefs', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, SHEET);
  await page.waitForSelector('.party-card-links', { timeout: 5_000 });
  const links = card(page, 'links').locator('.party-link-open');
  await expect(links).toHaveCount(3);
  await expect(links.first()).toHaveAttribute('href', /amazon\.com/);
});

test('reordering a section moves it and persists to the Layout tab', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, SHEET);
  await page.waitForSelector('.party-board', { timeout: 5_000 });
  // guests is first by default
  await expect(page.locator('.party-card').first()).toHaveClass(/party-card-guests/);
  await card(page, 'guests').locator('.party-move[aria-label="Move section down"]').click();
  await expect(page.locator('.party-card').first()).toHaveClass(/party-card-menu/);
  const records = await getCreatedRecords(page);
  expect(records.some(r => r.type === 'tab-write' && r.tabTitle === 'Layout')).toBe(true);
});

test('editing party details updates the hero and persists to Details', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, SHEET);
  await page.waitForSelector('.party-hero-edit', { timeout: 5_000 });
  await page.locator('.party-hero-edit').click();
  await page.waitForSelector('.party-modal', { timeout: 3_000 });
  // Theme is the 4th meta field
  const inputs = page.locator('.party-modal .party-field-input');
  await inputs.nth(3).fill('Neon Disco Night');
  await page.locator('.party-modal-btn-primary').click();
  await expect(page.locator('.party-hero')).toContainText('Neon Disco Night');
  const records = await getCreatedRecords(page);
  expect(records.some(r => r.type === 'tab-write' && r.tabTitle === 'Details')).toBe(true);
});
