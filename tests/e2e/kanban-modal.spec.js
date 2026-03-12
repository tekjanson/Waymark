const { test, expect } = require('@playwright/test');
const { setupApp, navigateToSheet } = require('../helpers/test-utils');

/* ============================================================
   kanban-modal.spec.js — Kanban focus modal lifecycle tests

   Tests the kanban card focus modal: open, close via X,
   backdrop, Escape, and browser back button (history API).
   ============================================================ */

/* ---------- Modal open / close lifecycle ---------- */

test('kanban modal opens when clicking the open button on a card', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-028');
  await page.waitForSelector('.kanban-card', { timeout: 5000 });

  await page.click('.kanban-card-open');
  await page.waitForSelector('.kanban-modal-overlay', { timeout: 3000 });

  await expect(page.locator('.kanban-modal-overlay')).toBeVisible();
  await expect(page.locator('.kanban-modal')).toBeVisible();
  await expect(page.locator('.kanban-modal-title')).toBeVisible();
});

test('kanban modal closes via X button', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-028');
  await page.waitForSelector('.kanban-card', { timeout: 5000 });

  // Open modal
  await page.click('.kanban-card-open');
  await page.waitForSelector('.kanban-modal-overlay', { timeout: 3000 });
  await expect(page.locator('.kanban-modal-overlay')).toBeVisible();

  // Close via X
  await page.click('.kanban-modal-close');
  await expect(page.locator('.kanban-modal-overlay')).toHaveCount(0);
});

test('kanban modal closes via backdrop click', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-028');
  await page.waitForSelector('.kanban-card', { timeout: 5000 });

  // Open modal
  await page.click('.kanban-card-open');
  await page.waitForSelector('.kanban-modal-overlay', { timeout: 3000 });
  await expect(page.locator('.kanban-modal-overlay')).toBeVisible();

  // Close via backdrop click (click the overlay outside the modal)
  await page.locator('.kanban-modal-overlay').click({ position: { x: 5, y: 5 } });
  await expect(page.locator('.kanban-modal-overlay')).toHaveCount(0);
});

test('kanban modal closes via Escape key', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-028');
  await page.waitForSelector('.kanban-card', { timeout: 5000 });

  // Open modal
  await page.click('.kanban-card-open');
  await page.waitForSelector('.kanban-modal-overlay', { timeout: 3000 });
  await expect(page.locator('.kanban-modal-overlay')).toBeVisible();

  // Close via Escape
  await page.keyboard.press('Escape');
  await expect(page.locator('.kanban-modal-overlay')).toHaveCount(0);
});

/* ---------- Browser back button (history API) ---------- */

test('kanban modal closes via browser back button instead of leaving sheet', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-028');
  await page.waitForSelector('.kanban-card', { timeout: 5000 });

  // Open modal
  await page.click('.kanban-card-open');
  await page.waitForSelector('.kanban-modal-overlay', { timeout: 3000 });
  await expect(page.locator('.kanban-modal-overlay')).toBeVisible();

  // Press browser back — should close modal, NOT navigate away
  await page.goBack();
  await expect(page.locator('.kanban-modal-overlay')).toHaveCount(0);

  // Should still be on the kanban sheet (not navigated away)
  await expect(page.locator('#checklist-view')).toBeVisible();
  const url = page.url();
  expect(url).toContain('#/sheet/sheet-028');
});

test('kanban modal back button then second back navigates away from sheet', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-028');
  await page.waitForSelector('.kanban-card', { timeout: 5000 });

  // Open modal
  await page.click('.kanban-card-open');
  await page.waitForSelector('.kanban-modal-overlay', { timeout: 3000 });

  // First back — closes modal
  await page.goBack();
  await expect(page.locator('.kanban-modal-overlay')).toHaveCount(0);

  // Still on the sheet
  expect(page.url()).toContain('#/sheet/sheet-028');

  // Second back — navigates away from the sheet
  await page.goBack();
  await page.waitForSelector('#home-view:not(.hidden)', { timeout: 5000 });
  expect(page.url()).not.toContain('#/sheet/');
});

/* ---------- Modal content & interaction ---------- */

test('kanban modal shows card title and stage badge', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-028');
  await page.waitForSelector('.kanban-card', { timeout: 5000 });

  await page.click('.kanban-card-open');
  await page.waitForSelector('.kanban-modal-overlay', { timeout: 3000 });

  // Modal should contain the title and a stage badge
  await expect(page.locator('.kanban-modal-title')).toBeVisible();
  const titleText = await page.locator('.kanban-modal-title').textContent();
  expect(titleText.trim().length).toBeGreaterThan(0);

  await expect(page.locator('.kanban-modal-header-meta .kanban-stage-btn')).toBeVisible();
});

test('kanban modal close button has pointer cursor', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-028');
  await page.waitForSelector('.kanban-card', { timeout: 5000 });

  await page.click('.kanban-card-open');
  await page.waitForSelector('.kanban-modal-close', { timeout: 3000 });

  await expect(page.locator('.kanban-modal-close')).toHaveCSS('cursor', 'pointer');
});

/* ---------- Re-open after close ---------- */

test('kanban modal can be re-opened after closing via back button', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-028');
  await page.waitForSelector('.kanban-card', { timeout: 5000 });

  // Open modal
  await page.click('.kanban-card-open');
  await page.waitForSelector('.kanban-modal-overlay', { timeout: 3000 });
  await expect(page.locator('.kanban-modal-overlay')).toBeVisible();

  // Close via back button
  await page.goBack();
  await expect(page.locator('.kanban-modal-overlay')).toHaveCount(0);

  // Re-open the modal
  await page.click('.kanban-card-open');
  await page.waitForSelector('.kanban-modal-overlay', { timeout: 3000 });
  await expect(page.locator('.kanban-modal-overlay')).toBeVisible();

  // Close via X to verify it still works normally
  await page.click('.kanban-modal-close');
  await expect(page.locator('.kanban-modal-overlay')).toHaveCount(0);
});

test('kanban modal can be re-opened after closing via Escape', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-028');
  await page.waitForSelector('.kanban-card', { timeout: 5000 });

  // Open → close via Escape
  await page.click('.kanban-card-open');
  await page.waitForSelector('.kanban-modal-overlay', { timeout: 3000 });
  await page.keyboard.press('Escape');
  await expect(page.locator('.kanban-modal-overlay')).toHaveCount(0);

  // Re-open → close via back button
  await page.click('.kanban-card-open');
  await page.waitForSelector('.kanban-modal-overlay', { timeout: 3000 });
  await expect(page.locator('.kanban-modal-overlay')).toBeVisible();

  await page.goBack();
  await expect(page.locator('.kanban-modal-overlay')).toHaveCount(0);

  // Still on the sheet
  expect(page.url()).toContain('#/sheet/sheet-028');
});

/* ---------- Mobile viewport ---------- */

test('kanban modal back button works at mobile viewport width', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await setupApp(page);
  await navigateToSheet(page, 'sheet-028');
  await page.waitForSelector('.kanban-card', { timeout: 5000 });

  // Open modal
  await page.click('.kanban-card-open');
  await page.waitForSelector('.kanban-modal-overlay', { timeout: 3000 });
  await expect(page.locator('.kanban-modal-overlay')).toBeVisible();

  // Back button closes modal, doesn't navigate away
  await page.goBack();
  await expect(page.locator('.kanban-modal-overlay')).toHaveCount(0);

  // Still on the kanban sheet
  await expect(page.locator('#checklist-view')).toBeVisible();
  expect(page.url()).toContain('#/sheet/sheet-028');
});
