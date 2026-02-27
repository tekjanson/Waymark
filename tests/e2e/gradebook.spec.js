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

  // 8 students + 1 header
  const rows = page.locator('.grading-row');
  expect(await rows.count()).toBe(9);

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
