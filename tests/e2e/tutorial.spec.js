// @ts-check
/**
 * tutorial.spec.js — Tests for the onboarding tutorial system.
 *
 * Each test bootstraps the app in full isolation via setupApp().
 * The tutorial auto-starts when tutorialCompleted is false.
 * By default setupApp() sets tutorialCompleted=true to keep
 * other tests unaffected; these tests explicitly set it to false
 * when needed to exercise the tutorial flow.
 */
const { test, expect } = require('@playwright/test');
const { setupApp, navigateToSheet } = require('../helpers/test-utils');

/* ────────────────── Auto-start behaviour ────────────────── */

test('tutorial auto-starts for first-time users', async ({ page }) => {
  await setupApp(page, { tutorialCompleted: false });

  // Tutorial overlay should become visible shortly after boot
  await expect(page.locator('#tutorial-overlay')).toBeVisible({ timeout: 3000 });
  await expect(page.locator('#tutorial-title')).toContainText('Welcome to WayMark');
});

test('tutorial does NOT auto-start when previously completed', async ({ page }) => {
  await setupApp(page, { tutorialCompleted: true });

  // Give it a moment — it should NOT appear
  await page.waitForTimeout(1000);
  await expect(page.locator('#tutorial-overlay')).toBeHidden();
});

/* ────────────────── Manual trigger ────────────────── */

test('clicking help button in top bar starts the tutorial', async ({ page }) => {
  await setupApp(page, { tutorialCompleted: true });

  await expect(page.locator('#tutorial-overlay')).toBeHidden();
  await page.locator('#tutorial-btn').click();
  await expect(page.locator('#tutorial-overlay')).toBeVisible();
  await expect(page.locator('#tutorial-title')).toContainText('Welcome to WayMark');
});

/* ────────────────── Navigation ────────────────── */

test('Next button advances to the second step', async ({ page }) => {
  await setupApp(page, { tutorialCompleted: false });
  await expect(page.locator('#tutorial-overlay')).toBeVisible({ timeout: 3000 });

  const stepText = page.locator('#tutorial-step-text');
  await expect(stepText).toContainText('1 of');

  await page.locator('#tutorial-next').click();
  await expect(stepText).toContainText('2 of');
  await expect(page.locator('#tutorial-title')).not.toContainText('Welcome');
});

test('Back button is hidden on the first step', async ({ page }) => {
  await setupApp(page, { tutorialCompleted: false });
  await expect(page.locator('#tutorial-overlay')).toBeVisible({ timeout: 3000 });

  await expect(page.locator('#tutorial-prev')).toBeHidden();
});

test('Back button appears on the second step and navigates back', async ({ page }) => {
  await setupApp(page, { tutorialCompleted: false });
  await expect(page.locator('#tutorial-overlay')).toBeVisible({ timeout: 3000 });

  await page.locator('#tutorial-next').click();
  await expect(page.locator('#tutorial-prev')).toBeVisible();

  await page.locator('#tutorial-prev').click();
  await expect(page.locator('#tutorial-step-text')).toContainText('1 of');
});

test('can navigate through all steps to the last one', async ({ page }) => {
  await setupApp(page, { tutorialCompleted: false });
  await expect(page.locator('#tutorial-overlay')).toBeVisible({ timeout: 3000 });

  // Extract total number of steps from "1 of N" text
  const stepLabel = await page.locator('#tutorial-step-text').textContent();
  const total = parseInt(stepLabel.split('of')[1].trim(), 10);

  // Click Next until the last step
  for (let i = 1; i < total; i++) {
    await page.locator('#tutorial-next').click();
  }

  await expect(page.locator('#tutorial-step-text')).toContainText(`${total} of ${total}`);
});

test('last step shows Finish button instead of Next', async ({ page }) => {
  await setupApp(page, { tutorialCompleted: false });
  await expect(page.locator('#tutorial-overlay')).toBeVisible({ timeout: 3000 });

  // Navigate to last step
  const stepLabel = await page.locator('#tutorial-step-text').textContent();
  const total = parseInt(stepLabel.split('of')[1].trim(), 10);
  for (let i = 1; i < total; i++) {
    await page.locator('#tutorial-next').click();
  }

  await expect(page.locator('#tutorial-next')).toHaveText('Finish');
});

/* ────────────────── Dismissal ────────────────── */

test('Skip tutorial closes the overlay', async ({ page }) => {
  await setupApp(page, { tutorialCompleted: false });
  await expect(page.locator('#tutorial-overlay')).toBeVisible({ timeout: 3000 });

  await page.locator('#tutorial-skip').click();
  await expect(page.locator('#tutorial-overlay')).toBeHidden();
});

test('Escape key closes the tutorial', async ({ page }) => {
  await setupApp(page, { tutorialCompleted: false });
  await expect(page.locator('#tutorial-overlay')).toBeVisible({ timeout: 3000 });

  await page.keyboard.press('Escape');
  await expect(page.locator('#tutorial-overlay')).toBeHidden();
});

test('clicking Finish on last step closes the tutorial', async ({ page }) => {
  await setupApp(page, { tutorialCompleted: false });
  await expect(page.locator('#tutorial-overlay')).toBeVisible({ timeout: 3000 });

  // Navigate to last step
  const stepLabel = await page.locator('#tutorial-step-text').textContent();
  const total = parseInt(stepLabel.split('of')[1].trim(), 10);
  for (let i = 1; i < total; i++) {
    await page.locator('#tutorial-next').click();
  }

  await page.locator('#tutorial-next').click(); // "Finish"
  await expect(page.locator('#tutorial-overlay')).toBeHidden();
});

/* ────────────────── Persistence ────────────────── */

test('completing tutorial sets tutorialCompleted in localStorage', async ({ page }) => {
  await setupApp(page, { tutorialCompleted: false });
  await expect(page.locator('#tutorial-overlay')).toBeVisible({ timeout: 3000 });

  await page.locator('#tutorial-skip').click();
  await expect(page.locator('#tutorial-overlay')).toBeHidden();

  // Verify localStorage
  const completed = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('waymark_tutorial_completed')),
  );
  expect(completed).toBe(true);
});

test('skipping tutorial sets persistence flag preventing future auto-start', async ({ page }) => {
  await setupApp(page, { tutorialCompleted: false });
  await expect(page.locator('#tutorial-overlay')).toBeVisible({ timeout: 3000 });

  await page.locator('#tutorial-skip').click();
  await expect(page.locator('#tutorial-overlay')).toBeHidden();

  // Verify localStorage persistence flag was set
  const completed = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('waymark_tutorial_completed')),
  );
  expect(completed).toBe(true);

  // Verify the tutorial is no longer visible and doesn't reappear
  await page.waitForTimeout(1000);
  await expect(page.locator('#tutorial-overlay')).toBeHidden();
});

/* ────────────────── Content ────────────────── */

test('tutorial steps contain meaningful titles and descriptions', async ({ page }) => {
  await setupApp(page, { tutorialCompleted: false });
  await expect(page.locator('#tutorial-overlay')).toBeVisible({ timeout: 3000 });

  // Check first step has content
  const title = await page.locator('#tutorial-title').textContent();
  const body = await page.locator('#tutorial-body').textContent();
  expect(title.length).toBeGreaterThan(0);
  expect(body.length).toBeGreaterThan(10);

  // Advance and verify second step also has content
  await page.locator('#tutorial-next').click();
  const title2 = await page.locator('#tutorial-title').textContent();
  const body2 = await page.locator('#tutorial-body').textContent();
  expect(title2.length).toBeGreaterThan(0);
  expect(body2.length).toBeGreaterThan(10);
  expect(title2).not.toBe(title); // different content each step
});

/* ────────────────── Spotlight ────────────────── */

test('spotlight element is visible when step has a target', async ({ page }) => {
  await setupApp(page, { tutorialCompleted: false });
  await expect(page.locator('#tutorial-overlay')).toBeVisible({ timeout: 3000 });

  // Step 1 (Welcome) has no target — spotlight hidden
  const spotlight = page.locator('#tutorial-spotlight');
  await expect(spotlight).toHaveCSS('display', 'none');

  // Step 2 (Drive Explorer) has target #sidebar — spotlight visible
  await page.locator('#tutorial-next').click();
  await expect(spotlight).not.toHaveCSS('display', 'none');
});

/* ────────────────── Template Tutorial ────────────────── */

test('template tutorial auto-starts on first sheet visit', async ({ page }) => {
  await setupApp(page, { templateTutorials: true });
  await navigateToSheet(page, 'sheet-017'); // kanban
  await page.waitForSelector('.kanban-board', { timeout: 3000 });

  // Template tutorial should auto-start (no prior localStorage flag)
  await expect(page.locator('#tutorial-overlay')).toBeVisible({ timeout: 3000 });
  await expect(page.locator('#tutorial-title')).not.toContainText('Welcome');
});

test('template help button opens template tutorial', async ({ page }) => {
  await setupApp(page, { templateTutorials: true });
  await navigateToSheet(page, 'sheet-017'); // kanban
  await page.waitForSelector('.kanban-board', { timeout: 3000 });

  // Dismiss the auto-started tutorial first
  await expect(page.locator('#tutorial-overlay')).toBeVisible({ timeout: 3000 });
  await page.locator('#tutorial-skip').click();
  await expect(page.locator('#tutorial-overlay')).toBeHidden();

  // Click the help button to reopen
  await page.locator('#template-help-btn').click();
  await expect(page.locator('#tutorial-overlay')).toBeVisible({ timeout: 2000 });
});

test('template tutorial does not auto-start on second visit', async ({ page }) => {
  await setupApp(page, { templateTutorials: true });
  await navigateToSheet(page, 'sheet-017'); // kanban
  await page.waitForSelector('.kanban-board', { timeout: 3000 });

  // Dismiss the auto-started tutorial
  await expect(page.locator('#tutorial-overlay')).toBeVisible({ timeout: 3000 });
  await page.locator('#tutorial-skip').click();
  await expect(page.locator('#tutorial-overlay')).toBeHidden();

  // Navigate away and back
  await page.evaluate(() => { window.location.hash = '#/'; });
  await page.waitForSelector('#home-view:not(.hidden)', { timeout: 3000 });
  await navigateToSheet(page, 'sheet-017');
  await page.waitForSelector('.kanban-board', { timeout: 3000 });

  // Tutorial should NOT auto-start this time
  await page.waitForSelector('#template-help-btn:not(.hidden)', { timeout: 3000 });
  await expect(page.locator('#tutorial-overlay')).toBeHidden();
});

test('template help button is visible on sheet view', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-017'); // kanban
  await page.waitForSelector('.kanban-board', { timeout: 3000 });

  await expect(page.locator('#template-help-btn')).toBeVisible();
});

/* ────────────────── Directory View Tutorial ────────────────── */

test('directory tutorial auto-starts on first folder visit with budget directory view', async ({ page }) => {
  await setupApp(page, { templateTutorials: true });
  await page.evaluate(() => { window.location.hash = '#/folder/f-budgets/Budgets'; });
  await page.waitForSelector('.budget-dir-card', { timeout: 8000 });

  // Directory tutorial should auto-start
  await expect(page.locator('#tutorial-overlay')).toBeVisible({ timeout: 3000 });
  await expect(page.locator('#tutorial-title')).toContainText('Financial Overview');
});

test('directory tutorial auto-starts for grading directory view', async ({ page }) => {
  await setupApp(page, { templateTutorials: true });
  await page.evaluate(() => { window.location.hash = '#/folder/f-grades/Gradebooks'; });
  await page.waitForSelector('.grading-dir-card', { timeout: 8000 });

  await expect(page.locator('#tutorial-overlay')).toBeVisible({ timeout: 3000 });
  await expect(page.locator('#tutorial-title')).toContainText('Classroom Overview');
});

test('directory tutorial auto-starts for meal directory view', async ({ page }) => {
  await setupApp(page, { templateTutorials: true });
  await page.evaluate(() => { window.location.hash = '#/folder/f-meals/Meal%20Plans'; });
  await page.waitForSelector('.meal-dir-card', { timeout: 8000 });

  await expect(page.locator('#tutorial-overlay')).toBeVisible({ timeout: 3000 });
  await expect(page.locator('#tutorial-title')).toContainText('Meal Plans Overview');
});

test('directory help button is visible when directory view is active', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => { window.location.hash = '#/folder/f-budgets/Budgets'; });
  await page.waitForSelector('.budget-dir-card', { timeout: 8000 });

  await expect(page.locator('#dir-help-btn')).toBeVisible();
});

test('directory help button opens directory tutorial', async ({ page }) => {
  await setupApp(page, { templateTutorials: true });
  await page.evaluate(() => { window.location.hash = '#/folder/f-budgets/Budgets'; });
  await page.waitForSelector('.budget-dir-card', { timeout: 8000 });

  // Dismiss the auto-started tutorial first
  await expect(page.locator('#tutorial-overlay')).toBeVisible({ timeout: 3000 });
  await page.locator('#tutorial-skip').click();
  await expect(page.locator('#tutorial-overlay')).toBeHidden();

  // Click the help button to reopen
  await page.locator('#dir-help-btn').click();
  await expect(page.locator('#tutorial-overlay')).toBeVisible({ timeout: 2000 });
  await expect(page.locator('#tutorial-title')).toContainText('Financial Overview');
});

test('directory tutorial does not auto-start on second visit', async ({ page }) => {
  await setupApp(page, { templateTutorials: true });
  await page.evaluate(() => { window.location.hash = '#/folder/f-budgets/Budgets'; });
  await page.waitForSelector('.budget-dir-card', { timeout: 8000 });

  // Dismiss the auto-started tutorial
  await expect(page.locator('#tutorial-overlay')).toBeVisible({ timeout: 3000 });
  await page.locator('#tutorial-skip').click();
  await expect(page.locator('#tutorial-overlay')).toBeHidden();

  // Navigate away and back
  await page.evaluate(() => { window.location.hash = '#/'; });
  await page.waitForSelector('#home-view:not(.hidden)', { timeout: 3000 });
  await page.evaluate(() => { window.location.hash = '#/folder/f-budgets/Budgets'; });
  await page.waitForSelector('.budget-dir-card', { timeout: 8000 });

  // Tutorial should NOT auto-start this time
  await page.waitForSelector('#dir-help-btn:not(.hidden)', { timeout: 3000 });
  await expect(page.locator('#tutorial-overlay')).toBeHidden();
});

test('directory help button is hidden when folder has no directory view', async ({ page }) => {
  await setupApp(page);

  // Navigate to home view first, then a folder that won't trigger directory view
  // The dir-help-btn should remain hidden
  await expect(page.locator('#dir-help-btn')).toBeHidden();
});
