const { test, expect } = require('@playwright/test');
const { setupApp, setupPublicApp, navigateToSheet, getCreatedRecords, openOverflowMenu } = require('../helpers/test-utils');

/* ============================================================
   public.spec.js — Public Waymark viewing (no auth required)
   ============================================================ */

test('public route renders sheet without authentication', async ({ page }) => {
  await setupPublicApp(page, 'sheet-001');
  // Sheet title should be visible (groceries fixture)
  await expect(page.locator('#checklist-title')).not.toHaveText('Loading…');
  await expect(page.locator('#checklist-title')).toBeVisible();
  // Checklist items should render
  await page.waitForSelector('#checklist-items *', { timeout: 5000 });
  const items = await page.locator('#checklist-items').innerHTML();
  expect(items.length).toBeGreaterThan(0);
});

test('public view shows the public banner', async ({ page }) => {
  await setupPublicApp(page, 'sheet-001');
  const banner = page.locator('#public-banner');
  await expect(banner).toBeVisible();
  await expect(banner).toContainText('Public View');
  await expect(banner).toContainText('Read Only');
});

test('public view shows sign-in link in banner', async ({ page }) => {
  await setupPublicApp(page, 'sheet-001');
  const loginLink = page.locator('.public-banner-login');
  await expect(loginLink).toBeVisible();
  await expect(loginLink).toContainText('Sign in');
});

test('public view hides sidebar', async ({ page }) => {
  await setupPublicApp(page, 'sheet-001');
  // Sidebar should be hidden via CSS .waymark-public
  const sidebar = page.locator('#sidebar');
  await expect(sidebar).not.toBeVisible();
});

test('public view hides user auth controls', async ({ page }) => {
  await setupPublicApp(page, 'sheet-001');
  // User name, avatar, logout button should be hidden
  await expect(page.locator('#user-name')).not.toBeVisible();
  await expect(page.locator('#logout-btn')).not.toBeVisible();
});

test('public view hides edit-related action buttons', async ({ page }) => {
  await setupPublicApp(page, 'sheet-001');
  // Edit controls should be hidden in public mode
  await expect(page.locator('#open-in-sheets-btn')).not.toBeVisible();
  await expect(page.locator('#sheet-pin-btn')).not.toBeVisible();
  await expect(page.locator('#more-actions-btn')).not.toBeVisible();
});

test('public view applies waymark-public class to body', async ({ page }) => {
  await setupPublicApp(page, 'sheet-001');
  const hasClass = await page.evaluate(() => document.body.classList.contains('waymark-public'));
  expect(hasClass).toBe(true);
});

test('public view renders template badge correctly', async ({ page }) => {
  await setupPublicApp(page, 'sheet-016');
  // Budget template should be detected (sheet-016 is budget-personal)
  await page.waitForSelector('#template-badge:not(.hidden)', { timeout: 5000 });
  await expect(page.locator('#template-badge')).toBeVisible();
});

test('public view renders a kanban board in read-only mode', async ({ page }) => {
  await setupPublicApp(page, 'sheet-017');
  // Kanban template should render lanes
  await page.waitForSelector('.kanban-board', { timeout: 5000 });
  await expect(page.locator('.kanban-board')).toBeVisible();
  const lanes = await page.locator('.kanban-lane').count();
  expect(lanes).toBeGreaterThan(0);
});

test('public view does not produce edit records on interaction', async ({ page }) => {
  await setupPublicApp(page, 'sheet-001');
  await page.waitForSelector('#checklist-items *', { timeout: 5000 });
  // Clear any init records
  await page.evaluate(() => { window.__WAYMARK_RECORDS.length = 0; });
  // Try clicking a checklist row checkbox — should not produce records since edit is locked
  const checkboxes = page.locator('.checklist-checkbox');
  const count = await checkboxes.count();
  if (count > 0) {
    await checkboxes.first().click();
  }
  // Wait briefly for any async record creation
  await page.waitForTimeout(500);
  const records = await getCreatedRecords(page);
  // Filter for cell-update records — should be zero
  const cellUpdates = records.filter(r => r.type === 'cell-update');
  expect(cellUpdates).toHaveLength(0);
});

test('public view can navigate between public sheets', async ({ page }) => {
  await setupPublicApp(page, 'sheet-001');
  await expect(page.locator('#checklist-title')).not.toHaveText('Loading…');
  const firstTitle = await page.locator('#checklist-title').textContent();

  // Navigate to another public sheet
  await page.evaluate(() => { window.location.hash = '#/public/sheet-016'; });
  await page.waitForSelector('#checklist-view:not(.hidden)', { timeout: 5000 });
  // Wait for title to change
  await page.waitForFunction(
    (prev) => document.getElementById('checklist-title')?.textContent !== prev && document.getElementById('checklist-title')?.textContent !== 'Loading…',
    firstTitle,
    { timeout: 5000 }
  );
  const secondTitle = await page.locator('#checklist-title').textContent();
  expect(secondTitle).not.toBe(firstTitle);
  expect(secondTitle).not.toBe('Loading…');
});

test('public banner has correct design token colors', async ({ page }) => {
  await setupPublicApp(page, 'sheet-001');
  const banner = page.locator('#public-banner');
  await expect(banner).toBeVisible();

  // Should have a non-transparent background (design token)
  const bgColor = await banner.evaluate(el => getComputedStyle(el).backgroundColor);
  expect(bgColor).not.toBe('rgba(0, 0, 0, 0)');

  // Should have border-radius matching design tokens
  await expect(banner).toHaveCSS('border-radius', /\d+px/);
});

test('public view renders correctly at mobile width', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await setupPublicApp(page, 'sheet-001');
  await page.waitForSelector('#checklist-items *', { timeout: 5000 });

  // Banner should still be visible at mobile width
  await expect(page.locator('#public-banner')).toBeVisible();

  // Nothing should overflow viewport
  const overflows = await page.evaluate(() => {
    const problems = [];
    document.querySelectorAll('#checklist-view *').forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.right > window.innerWidth + 2 && r.width > 0) {
        problems.push(el.className || el.tagName);
      }
    });
    return problems;
  });
  expect(overflows).toHaveLength(0);
});

test('share modal includes public link section', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-001');
  await page.waitForSelector('#checklist-items *', { timeout: 5000 });

  // Open overflow menu then click share
  await openOverflowMenu(page);
  await page.click('#share-btn');
  await page.waitForSelector('#share-modal', { timeout: 3000 });

  // Should have a public link input
  const publicLink = page.locator('.share-public-link');
  await expect(publicLink).toBeVisible();
  const value = await publicLink.inputValue();
  expect(value).toContain('#/public/sheet-001');
});

test('share modal public link has copy button', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-001');
  await page.waitForSelector('#checklist-items *', { timeout: 5000 });

  // Open overflow menu then click share
  await openOverflowMenu(page);
  await page.click('#share-btn');
  await page.waitForSelector('#share-modal', { timeout: 3000 });

  // Should have 3 copy buttons (Waymark link, Public link, Google Sheets link)
  const copyBtns = page.locator('.share-copy-btn');
  await expect(copyBtns).toHaveCount(3);
});

test('public view hides the add-row form', async ({ page }) => {
  await setupPublicApp(page, 'sheet-001');
  await page.waitForSelector('#checklist-items *', { timeout: 5000 });
  // The add-row-root should exist in DOM but be hidden via CSS
  const addRowRoots = page.locator('.add-row-root');
  const count = await addRowRoots.count();
  if (count > 0) {
    for (let i = 0; i < count; i++) {
      await expect(addRowRoots.nth(i)).not.toBeVisible();
    }
  }
});

test('public kanban view hides the add-row form in lanes', async ({ page }) => {
  await setupPublicApp(page, 'sheet-017');
  await page.waitForSelector('.kanban-board', { timeout: 5000 });
  const addRowRoots = page.locator('.add-row-root');
  const count = await addRowRoots.count();
  if (count > 0) {
    for (let i = 0; i < count; i++) {
      await expect(addRowRoots.nth(i)).not.toBeVisible();
    }
  }
});

test('public kanban view blocks stage button clicks', async ({ page }) => {
  await setupPublicApp(page, 'sheet-017');
  await page.waitForSelector('.kanban-board', { timeout: 5000 });
  // Clear any records from initial render
  await page.evaluate(() => { window.__WAYMARK_RECORDS.length = 0; });
  // Try clicking a stage button on a kanban card
  const stageBtns = page.locator('.kanban-stage-btn');
  const count = await stageBtns.count();
  expect(count).toBeGreaterThan(0);
  await stageBtns.first().click();
  // The stage dropdown should NOT appear (edit is locked)
  await page.waitForTimeout(300);
  const dropdowns = await page.locator('.kanban-stage-dropdown').count();
  expect(dropdowns).toBe(0);
  // No edit records should have been created
  const records = await getCreatedRecords(page);
  const cellUpdates = records.filter(r => r.type === 'cell-update');
  expect(cellUpdates).toHaveLength(0);
});

test('public view hides the notification bell', async ({ page }) => {
  await setupPublicApp(page, 'sheet-001');
  await page.waitForSelector('#checklist-items *', { timeout: 5000 });
  // The notification bell should not be visible in public mode
  const bell = page.locator('.notif-bell');
  const count = await bell.count();
  if (count > 0) {
    await expect(bell.first()).not.toBeVisible();
  }
});
