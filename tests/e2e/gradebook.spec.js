// @ts-check
const { test, expect } = require('@playwright/test');
const { setupApp, navigateToSheet, waitForChecklistRows, getChecklistTexts, getCreatedRecords } = require('../helpers/test-utils');

test('gradebook detected as Gradebook template', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-019');
  await page.waitForSelector('.grading-row', { timeout: 5_000 });
  await expect(page.locator('#template-badge')).toContainText('Gradebook');
});

test('gradebook renders student rows with scores', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-019');
  await page.waitForSelector('.grading-student-cell', { timeout: 5_000 });

  // 8 students + 1 header + 1 footer
  const rows = page.locator('.grading-row');
  expect(await rows.count()).toBe(10);

  // Check student name exists
  const students = await page.locator('.grading-student-cell').allTextContents();
  expect(students.some(s => s.includes('Emma Wilson'))).toBe(true);
});

test('gradebook shows grade column', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-019');
  await page.waitForSelector('.grading-grade-cell', { timeout: 5_000 });

  const grades = await page.locator('.grading-grade-cell').allTextContents();
  expect(grades.some(g => g.includes('A'))).toBe(true);
});

test('gradebook shows class average footer', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-019');
  await page.waitForSelector('.grading-footer', { timeout: 5_000 });

  const footer = page.locator('.grading-footer');
  const text = await footer.textContent();
  expect(text).toContain('Class Average');

  // Class avg cell should have a numeric value
  const avgCell = footer.locator('.grading-avg-cell');
  const avg = parseInt(await avgCell.textContent(), 10);
  expect(avg).toBeGreaterThan(0);
});

test('gradebook shows grade distribution chart', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-019');
  await page.waitForSelector('.grading-dist', { timeout: 5_000 });

  const title = await page.locator('.grading-dist-title').textContent();
  expect(title).toContain('Grade Distribution');

  const bars = page.locator('.grading-dist-bar');
  expect(await bars.count()).toBe(5); // A, B, C, D, F

  // Labels should be letter grades
  const labels = await page.locator('.grading-dist-label').allTextContents();
  expect(labels).toEqual(['A', 'B', 'C', 'D', 'F']);
});

test('gradebook distribution counts match student data', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-019');
  await page.waitForSelector('.grading-dist-count', { timeout: 5_000 });

  const counts = await page.locator('.grading-dist-count').allTextContents();
  const total = counts.map(Number).reduce((a, b) => a + b, 0);
  expect(total).toBe(8); // 8 students
});

test('gradebook directoryView shows classroom overview title', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => { window.location.hash = '#/folder/f-grades/Gradebooks'; });
  await page.waitForSelector('.grading-dir-title', { timeout: 8_000 });

  await expect(page.locator('.grading-dir-title')).toContainText('Classroom Overview');
});

test('gradebook directoryView shows per-class cards', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => { window.location.hash = '#/folder/f-grades/Gradebooks'; });
  await page.waitForSelector('.grading-dir-card', { timeout: 8_000 });

  const cards = page.locator('.grading-dir-card');
  expect(await cards.count()).toBe(2);
});

test('gradebook directoryView shows grand totals bar', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => { window.location.hash = '#/folder/f-grades/Gradebooks'; });
  await page.waitForSelector('.grading-dir-totals', { timeout: 8_000 });

  const text = await page.locator('.grading-dir-totals').textContent();
  expect(text).toContain('students');
  expect(text).toContain('classes');
  expect(text).toContain('Avg');
});

test('gradebook directoryView card click navigates to sheet', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => { window.location.hash = '#/folder/f-grades/Gradebooks'; });
  await page.waitForSelector('.grading-dir-card', { timeout: 8_000 });

  await page.locator('.grading-dir-card').first().click();
  await page.waitForSelector('.grading-row', { timeout: 5_000 });
  await expect(page.locator('#template-badge')).toContainText('Gradebook');
});
