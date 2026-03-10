// @ts-check
const { test, expect } = require('@playwright/test');
const { setupApp, navigateToSheet, waitForChecklistRows, getChecklistTexts, getCreatedRecords } = require('../helpers/test-utils');

test('crm detected as CRM template', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-023');
  await page.waitForSelector('.crm-card', { timeout: 5_000 });
  await expect(page.locator('#template-badge')).toContainText('CRM');
});

test('crm renders pipeline summary and deal cards', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-023');
  await page.waitForSelector('.crm-summary', { timeout: 5_000 });

  await expect(page.locator('.crm-summary-total')).toBeVisible();

  const cards = page.locator('.crm-card');
  expect(await cards.count()).toBe(8);
});

test('crm stage badge cycles on click', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-023');
  await page.waitForSelector('.crm-stage-btn', { timeout: 5_000 });

  const firstBtn = page.locator('.crm-stage-btn').first();
  const initialText = await firstBtn.textContent();
  await firstBtn.click();

  const newText = await firstBtn.textContent();
  expect(newText).not.toBe(initialText);

  const records = await getCreatedRecords(page);
  const updates = records.filter(r => r.type === 'cell-update');
  expect(updates.length).toBeGreaterThanOrEqual(1);
});

/* ---------- Funnel view ---------- */

test('crm funnel view toggle button visible', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-023');
  await page.waitForSelector('.crm-view-toggle', { timeout: 5_000 });
  await expect(page.locator('.crm-view-toggle')).toContainText('Funnel View');
});

test('crm funnel view shows 6 stage lanes', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-023');
  await page.waitForSelector('.crm-view-toggle', { timeout: 5_000 });

  await page.locator('.crm-view-toggle').click();

  await page.waitForSelector('.crm-funnel-lane', { timeout: 3_000 });
  const lanes = await page.locator('.crm-funnel-lane').count();
  expect(lanes).toBe(6);
});

test('crm funnel view shows conversion arrows between lanes', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-023');
  await page.waitForSelector('.crm-view-toggle', { timeout: 5_000 });

  await page.locator('.crm-view-toggle').click();

  const arrows = await page.locator('.crm-funnel-arrow').count();
  expect(arrows).toBe(5);
  // Each arrow has a percentage label
  const pcts = await page.locator('.crm-funnel-arrow-pct').count();
  expect(pcts).toBe(5);
});

test('crm funnel lanes show deal counts matching fixture data', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-023');
  await page.waitForSelector('.crm-view-toggle', { timeout: 5_000 });

  await page.locator('.crm-view-toggle').click();
  await page.waitForSelector('.crm-funnel-lane', { timeout: 3_000 });

  // Fixture: 1 Lead, 1 Contacted, 2 Qualified, 2 Proposal, 1 Won, 1 Lost
  const totalDeals = await page.locator('.crm-funnel-deal').count();
  expect(totalDeals).toBe(8);
});

test('crm funnel lanes display stage subtotal values', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-023');
  await page.waitForSelector('.crm-view-toggle', { timeout: 5_000 });

  await page.locator('.crm-view-toggle').click();
  await page.waitForSelector('.crm-funnel-lane-value', { timeout: 3_000 });

  const values = await page.locator('.crm-funnel-lane-value').allTextContents();
  // Every lane value should start with $
  for (const v of values) {
    expect(v.startsWith('$')).toBe(true);
  }
});

test('crm toggle switches between card and funnel views', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-023');
  await page.waitForSelector('.crm-view-toggle', { timeout: 5_000 });

  // Initially cards visible, funnel hidden
  await expect(page.locator('.crm-card-list')).toBeVisible();
  await expect(page.locator('.crm-funnel')).toBeHidden();

  // Click to funnel
  await page.locator('.crm-view-toggle').click();
  await expect(page.locator('.crm-card-list')).toBeHidden();
  await expect(page.locator('.crm-funnel')).toBeVisible();
  await expect(page.locator('.crm-view-toggle')).toContainText('Card View');

  // Click back to cards
  await page.locator('.crm-view-toggle').click();
  await expect(page.locator('.crm-card-list')).toBeVisible();
  await expect(page.locator('.crm-funnel')).toBeHidden();
  await expect(page.locator('.crm-view-toggle')).toContainText('Funnel View');
});

test('crm stale deals are highlighted', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-023');
  await page.waitForSelector('.crm-card', { timeout: 5_000 });

  const staleCards = page.locator('.crm-card-stale');
  expect(await staleCards.count()).toBeGreaterThanOrEqual(1);
});

test('crm summary shows stale count', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-023');
  await page.waitForSelector('.crm-summary', { timeout: 5_000 });

  const staleLabel = page.locator('.crm-summary-stale');
  await expect(staleLabel).toBeVisible();
  await expect(staleLabel).toContainText('stale');
});

test('crm timeline button opens timeline modal', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-023');
  await page.waitForSelector('.crm-card', { timeout: 5_000 });

  await page.locator('.crm-card-timeline-btn').first().click();

  const modal = page.locator('.crm-timeline-modal:not(.hidden)');
  await expect(modal).toBeVisible({ timeout: 3000 });
  await expect(modal.locator('.crm-timeline-title')).not.toBeEmpty();
});

test('crm timeline shows activity entries', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-023');
  await page.waitForSelector('.crm-card', { timeout: 5_000 });

  await page.locator('.crm-card-timeline-btn').first().click();
  await page.waitForSelector('.crm-timeline-modal:not(.hidden)', { timeout: 3000 });

  const entries = page.locator('.crm-timeline-entry');
  expect(await entries.count()).toBeGreaterThanOrEqual(2);
});

test('crm timeline close button works', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-023');
  await page.waitForSelector('.crm-card', { timeout: 5_000 });

  await page.locator('.crm-card-timeline-btn').first().click();
  await page.waitForSelector('.crm-timeline-modal:not(.hidden)', { timeout: 3000 });

  await page.locator('.crm-timeline-close').click();
  await expect(page.locator('.crm-timeline-modal.hidden')).toHaveCount(1);
});

test('crm cards show last activity date', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-023');
  await page.waitForSelector('.crm-card', { timeout: 5_000 });

  const lastAct = page.locator('.crm-card-last-activity');
  expect(await lastAct.count()).toBeGreaterThan(0);
  await expect(lastAct.first()).toContainText('Last:');
});
