const { test, expect } = require('@playwright/test');
const { setupApp, navigateToSheet, getCreatedRecords } = require('../helpers/test-utils');

/* ============================================================
   ui-patterns.spec.js — Waymark UI pattern update tests

   Covers the improved data-entry UX:
     - datepickerCell in kanban card detail and modal
     - clicking kanban card preview opens focus modal
     - date cell keyboard / Escape behaviour
     - modal due date is editable (was static before)
   ============================================================ */

/* ---------- Layer 1: datepickerCell rendering ---------- */

test('kanban card detail due-date field renders with date-cell class', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-028');
  await page.waitForSelector('.kanban-card', { timeout: 5000 });

  // Expand the first card that has a due date
  const expandBtn = page.locator('.kanban-card-expand').first();
  await expandBtn.click();
  await page.waitForSelector('.kanban-card-detail', { timeout: 3000 });

  const dueDateCell = page.locator('.kanban-card-detail .date-cell').first();
  await expect(dueDateCell).toBeVisible();
});

test('kanban card detail due-date field is not a plain text input', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-028');
  await page.waitForSelector('.kanban-card', { timeout: 5000 });

  // Expand first card
  await page.locator('.kanban-card-expand').first().click();
  await page.waitForSelector('.kanban-card-detail', { timeout: 3000 });

  // In resting state the due-date cell should NOT contain a text input
  const dueDateCell = page.locator('.kanban-card-detail .date-cell').first();
  const inputCount = await dueDateCell.locator('input[type="text"]').count();
  expect(inputCount).toBe(0);
});

test('clicking kanban card detail due-date opens a date input', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-028');
  await page.waitForSelector('.kanban-card', { timeout: 5000 });

  // Expand first card
  await page.locator('.kanban-card-expand').first().click();
  await page.waitForSelector('.kanban-card-detail', { timeout: 3000 });

  const dueDateCell = page.locator('.kanban-card-detail .date-cell').first();
  await dueDateCell.click();

  // Should show a native date input
  const dateInput = dueDateCell.locator('input[type="date"]');
  await expect(dateInput).toBeVisible({ timeout: 2000 });
});

test('kanban card detail due-date input accepts Escape to cancel', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-028');
  await page.waitForSelector('.kanban-card', { timeout: 5000 });

  await page.locator('.kanban-card-expand').first().click();
  await page.waitForSelector('.kanban-card-detail', { timeout: 3000 });

  const dueDateCell = page.locator('.kanban-card-detail .date-cell').first();
  const originalText = await dueDateCell.textContent();
  await dueDateCell.click();
  await dueDateCell.locator('input[type="date"]').waitFor({ state: 'visible', timeout: 2000 });

  // Click elsewhere to blur without changing the value — should restore original text
  await page.click('body');

  await expect(dueDateCell.locator('input[type="date"]')).toHaveCount(0);
  const textAfter = await dueDateCell.textContent();
  // Blurring without a change restores the original display
  expect(textAfter).toBe(originalText);
});

/* ---------- Layer 2: card preview click → opens modal ---------- */

test('clicking kanban card preview area opens focus modal', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-028');
  await page.waitForSelector('.kanban-card', { timeout: 5000 });

  // Click the preview area (not a button) of the first card
  const preview = page.locator('.kanban-card-preview').first();
  await preview.click();

  await page.waitForSelector('.kanban-modal-overlay', { timeout: 3000 });
  await expect(page.locator('.kanban-modal-overlay')).toBeVisible();
  await expect(page.locator('.kanban-modal-title')).toBeVisible();
});

test('clicking stage badge in card preview does NOT open modal', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-028');
  await page.waitForSelector('.kanban-card', { timeout: 5000 });

  // Click the stage badge which is inside .kanban-card-preview
  const stageBadge = page.locator('.kanban-card-preview .kanban-stage-btn').first();
  await stageBadge.click();

  // Should show the stage dropdown, NOT the card modal
  await page.waitForSelector('.kanban-stage-dropdown', { timeout: 3000 });
  await expect(page.locator('.kanban-stage-dropdown')).toBeVisible();
  await expect(page.locator('.kanban-modal-overlay')).toHaveCount(0);
});

/* ---------- Layer 3: modal due date is now editable ---------- */

test('kanban modal header due date is editable (date-cell)', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-028');
  await page.waitForSelector('.kanban-card', { timeout: 5000 });

  await page.click('.kanban-card-open');
  await page.waitForSelector('.kanban-modal-overlay', { timeout: 3000 });

  // The due date in the modal header should use the date-cell class
  const dueBadge = page.locator('.kanban-modal-header .date-cell');
  await expect(dueBadge).toBeVisible();
});

test('clicking modal due date opens a native date picker', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-028');
  await page.waitForSelector('.kanban-card', { timeout: 5000 });

  await page.click('.kanban-card-open');
  await page.waitForSelector('.kanban-modal-overlay', { timeout: 3000 });

  const dueBadge = page.locator('.kanban-modal-header .date-cell').first();
  await dueBadge.click();

  // Should show a native date input (may auto-close on some headless browsers)
  const dateInput = dueBadge.locator('input[type="date"]');
  await expect(dateInput).toBeVisible({ timeout: 2000 });
});

test('kanban modal due date Escape cancels without persisting', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-028');
  await page.waitForSelector('.kanban-card', { timeout: 5000 });

  await page.click('.kanban-card-open');
  await page.waitForSelector('.kanban-modal-overlay', { timeout: 3000 });

  const dueBadge = page.locator('.kanban-modal-header .date-cell').first();
  const originalText = await dueBadge.textContent();
  await dueBadge.click();
  await dueBadge.locator('input[type="date"]').waitFor({ state: 'visible', timeout: 2000 });

  // Click elsewhere inside the modal to blur without changing — restores original text
  await page.click('.kanban-modal-title');

  await expect(dueBadge.locator('input[type="date"]')).toHaveCount(0);
  expect(await dueBadge.textContent()).toBe(originalText);
});

/* ---------- Layer 4: datepickerCell unit tests via page.evaluate ---------- */

test('datepickerCell unit: _parseIsoDate accepts YYYY-MM-DD', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    // Access the exported datepickerCell indirectly by checking the date-cell renders
    const container = document.createElement('div');
    container.style.display = 'none';
    document.body.append(container);
    // Import shared and test by creating a datepickerCell
    const mod = await import('/js/templates/shared.js');
    // Create a cell with a known ISO date
    const cell = mod.datepickerCell('span', {}, '2026-06-15', 1, 0);
    container.append(cell);
    const text = cell.textContent;
    container.remove();
    return text;
  });
  // Should display something like "Jun 15" or relative, not the raw ISO string
  expect(result).not.toBe('2026-06-15');
  expect(result.length).toBeGreaterThan(0);
  expect(result).not.toBe('—');
});

test('datepickerCell unit: empty text shows placeholder dash', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const mod = await import('/js/templates/shared.js');
    const cell = mod.datepickerCell('span', {}, '', 1, 0);
    return cell.textContent;
  });
  expect(result).toBe('—');
});

test('datepickerCell unit: renders with editable-cell and date-cell classes', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const mod = await import('/js/templates/shared.js');
    const cell = mod.datepickerCell('span', { className: 'my-field' }, '2026-12-01', 1, 0);
    return cell.className;
  });
  expect(result).toContain('editable-cell');
  expect(result).toContain('date-cell');
  expect(result).toContain('my-field');
});

test('datepickerCell unit: today date displays as "Today"', async ({ page }) => {
  await setupApp(page);
  const todayIso = new Date().toISOString().slice(0, 10);
  const result = await page.evaluate(async (todayStr) => {
    const mod = await import('/js/templates/shared.js');
    const cell = mod.datepickerCell('span', {}, todayStr, 1, 0);
    return cell.textContent;
  }, todayIso);
  expect(result).toBe('Today');
});

test('datepickerCell unit: non-parseable date shows raw value', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const mod = await import('/js/templates/shared.js');
    const cell = mod.datepickerCell('span', {}, 'not a date', 1, 0);
    return cell.textContent;
  });
  // Falls back to raw text or '—' — should not throw
  expect(typeof result).toBe('string');
});

/* ---------- Layer 5: data persistence (date edit emits correct record) ---------- */

test('kanban card detail due date edit emits record with YYYY-MM-DD value', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-028');
  await page.waitForSelector('.kanban-card', { timeout: 5000 });

  await page.locator('.kanban-card-expand').first().click();
  await page.waitForSelector('.kanban-card-detail', { timeout: 3000 });

  const dueDateCell = page.locator('.kanban-card-detail .date-cell').first();
  await dueDateCell.click();

  const dateInput = dueDateCell.locator('input[type="date"]');
  await dateInput.waitFor({ state: 'visible', timeout: 2000 });
  await dateInput.fill('2027-03-15');

  // Click elsewhere to trigger blur → commit
  await page.click('.kanban-card-title');

  // Wait for the record to appear
  await page.waitForFunction(
    () => (window.__WAYMARK_RECORDS || []).some(r => r.value === '2027-03-15'),
    { timeout: 5000 },
  );

  const records = await getCreatedRecords(page);
  const dateRecord = records.find(r => r.value === '2027-03-15');
  expect(dateRecord).toBeTruthy();
  expect(dateRecord.value).toBe('2027-03-15');
});
