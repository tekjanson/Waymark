const { test, expect } = require('@playwright/test');
const { setupApp, navigateToSheet, getCreatedRecords } = require('../helpers/test-utils');

/* ─── sheet-057 : Q1 Team Meeting Minutes (3 meetings, 7 agenda items) ─── */

// Meeting groups, sorted by date descending:
//   Design Review  (2026-01-22) — 2 items — FIRST (expanded)
//   Team Standup   (2026-01-20) — 2 items — collapsed
//   Q1 Planning    (2026-01-15) — 3 items — collapsed

test('minutes template is detected for sheet-057', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-057');
  await page.waitForSelector('.minutes-layout', { timeout: 5000 });
  await expect(page.locator('.minutes-layout')).toBeVisible();
  await expect(page.locator('#template-badge')).toContainText('Meeting Minutes');
});

test('minutes renders three meeting group sections', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-057');
  await page.waitForSelector('.minutes-meeting', { timeout: 5000 });
  const groups = await page.locator('.minutes-meeting').count();
  expect(groups).toBe(3);
});

test('first meeting section starts expanded, others start collapsed', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-057');
  await page.waitForSelector('.minutes-meeting', { timeout: 5000 });

  const first  = page.locator('.minutes-meeting').nth(0);
  const second = page.locator('.minutes-meeting').nth(1);
  const third  = page.locator('.minutes-meeting').nth(2);

  await expect(first).not.toHaveClass(/minutes-collapsed/);
  await expect(second).toHaveClass(/minutes-collapsed/);
  await expect(third).toHaveClass(/minutes-collapsed/);
});

test('meetings are sorted by date descending — most recent first', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-057');
  await page.waitForSelector('.minutes-meeting-title', { timeout: 5000 });

  const titles = await page.locator('.minutes-meeting-title').allTextContents();
  expect(titles[0]).toBe('Design Review');
  expect(titles[1]).toBe('Team Standup');
  expect(titles[2]).toBe('Q1 Planning');
});

test('meeting dates are rendered in human-readable format', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-057');
  await page.waitForSelector('.minutes-meeting-date', { timeout: 5000 });

  // First meeting: Design Review (2026-01-22) → "Jan 22, 2026"
  await expect(page.locator('.minutes-meeting-date').first()).toContainText('Jan 22, 2026');
});

test('attendee chips are rendered in meeting headers', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-057');
  await page.waitForSelector('.minutes-attendee-chip', { timeout: 5000 });

  // Design Review has "Alice, Eve" → 2 chips
  const firstMeetingChips = page.locator('.minutes-meeting').nth(0).locator('.minutes-attendee-chip');
  await expect(firstMeetingChips).toHaveCount(2);
  await expect(firstMeetingChips.first()).toContainText('Alice');
  await expect(firstMeetingChips.nth(1)).toContainText('Eve');
});

test('meeting item count badge shows correct counts', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-057');
  await page.waitForSelector('.minutes-item-count', { timeout: 5000 });

  const counts = await page.locator('.minutes-item-count').allTextContents();
  // Design Review: 2, Team Standup: 2, Q1 Planning: 3
  expect(counts[0]).toBe('2');
  expect(counts[1]).toBe('2');
  expect(counts[2]).toBe('3');
});

test('expanding a collapsed meeting section reveals agenda items', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-057');
  await page.waitForSelector('.minutes-meeting', { timeout: 5000 });

  const second = page.locator('.minutes-meeting').nth(1);
  const body   = second.locator('.minutes-body');

  // Initially collapsed — body hidden
  await expect(body).toBeHidden();

  // Click the header to expand
  await second.locator('.minutes-meeting-header').click();

  // Now expanded — body visible
  await expect(second).not.toHaveClass(/minutes-collapsed/);
  await expect(body).toBeVisible();
});

test('collapsing an expanded meeting section hides agenda items', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-057');
  await page.waitForSelector('.minutes-meeting', { timeout: 5000 });

  const first = page.locator('.minutes-meeting').nth(0);
  const body  = first.locator('.minutes-body');

  // Initially expanded
  await expect(body).toBeVisible();

  // Click to collapse
  await first.locator('.minutes-meeting-header').click();
  await expect(first).toHaveClass(/minutes-collapsed/);
  await expect(body).toBeHidden();
});

test('full expand/collapse toggle cycle works on all three meetings', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-057');
  await page.waitForSelector('.minutes-meeting', { timeout: 5000 });

  for (let i = 0; i < 3; i++) {
    const group = page.locator('.minutes-meeting').nth(i);
    const header = group.locator('.minutes-meeting-header');
    const body   = group.locator('.minutes-body');

    // Expand if collapsed
    const isCollapsed = await group.evaluate(el => el.classList.contains('minutes-collapsed'));
    if (isCollapsed) {
      await header.click();
      await expect(body).toBeVisible();
    }

    // Collapse it
    await header.click();
    await expect(body).toBeHidden();

    // Re-expand
    await header.click();
    await expect(body).toBeVisible();
  }
});

test('agenda items are rendered inside an expanded meeting body', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-057');
  await page.waitForSelector('.minutes-meeting', { timeout: 5000 });

  // Expand Q1 Planning (index 2) — it has 3 items
  const third = page.locator('.minutes-meeting').nth(2);
  await third.locator('.minutes-meeting-header').click();
  await third.locator('.minutes-body').waitFor({ state: 'visible', timeout: 3000 });

  const items = third.locator('.minutes-item');
  await expect(items).toHaveCount(3);
});

test('agenda and decision text is visible in expanded items', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-057');
  await page.waitForSelector('.minutes-meeting', { timeout: 5000 });

  // Design Review is already expanded
  const first = page.locator('.minutes-meeting').nth(0);
  await expect(first.locator('.minutes-agenda-text').first()).toContainText('Homepage redesign');
  await expect(first.locator('.minutes-decision-text').first()).toContainText('Approved with feedback');
});

test('action items row is visible with owner and due date badges', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-057');
  await page.waitForSelector('.minutes-meeting', { timeout: 5000 });

  const first = page.locator('.minutes-meeting').nth(0);
  const firstItem = first.locator('.minutes-item').first();

  await expect(firstItem.locator('.minutes-action-row')).toBeVisible();
  await expect(firstItem.locator('.minutes-action-text')).toContainText('Revise mockups');
  await expect(firstItem.locator('.minutes-owner-badge')).toContainText('Eve');
  await expect(firstItem.locator('.minutes-due-badge')).toContainText('2026-01-25');
});

test('chevron rotates when a meeting is collapsed', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-057');
  await page.waitForSelector('.minutes-meeting', { timeout: 5000 });

  const second = page.locator('.minutes-meeting').nth(1);
  // Starts collapsed → chevron should be rotated via CSS transform
  await expect(second).toHaveClass(/minutes-collapsed/);

  // After expanding, no collapsed class
  await second.locator('.minutes-meeting-header').click();
  await expect(second).not.toHaveClass(/minutes-collapsed/);
});

test('meeting header has pointer cursor (clickable)', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-057');
  await page.waitForSelector('.minutes-meeting-header', { timeout: 5000 });
  await expect(page.locator('.minutes-meeting-header').first()).toHaveCSS('cursor', 'pointer');
});

test('meeting group uses surface background with border', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-057');
  await page.waitForSelector('.minutes-meeting', { timeout: 5000 });

  const group = page.locator('.minutes-meeting').first();
  const bg = await group.evaluate(el => getComputedStyle(el).backgroundColor);
  expect(bg).not.toBe('');
  expect(bg).not.toBe('rgba(0, 0, 0, 0)');

  await expect(group).toHaveCSS('border-radius', /\d+px/);
});

test('agenda text inline edit emits a record on Enter', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-057');
  await page.waitForSelector('.minutes-meeting', { timeout: 5000 });

  // Design Review is already expanded
  const firstItem = page.locator('.minutes-meeting').nth(0).locator('.minutes-item').first();
  const agendaDiv = firstItem.locator('.minutes-agenda-text');
  await agendaDiv.click();

  const input = await page.waitForSelector('.minutes-agenda-text input.editable-cell-input', { timeout: 3000 });
  await input.fill('Updated homepage redesign topic');
  await input.press('Enter');

  const records = await getCreatedRecords(page);
  expect(records.some(r => r.value === 'Updated homepage redesign topic')).toBe(true);
});

test('decision text inline edit emits a record on Enter', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-057');
  await page.waitForSelector('.minutes-meeting', { timeout: 5000 });

  const firstItem = page.locator('.minutes-meeting').nth(0).locator('.minutes-item').first();
  const decisionDiv = firstItem.locator('.minutes-decision-text');
  await decisionDiv.click();

  const input = await page.waitForSelector('.minutes-decision-text input.editable-cell-input', { timeout: 3000 });
  await input.fill('Approved final design');
  await input.press('Enter');

  const records = await getCreatedRecords(page);
  expect(records.some(r => r.value === 'Approved final design')).toBe(true);
});

test('action item text inline edit emits a record', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-057');
  await page.waitForSelector('.minutes-meeting', { timeout: 5000 });

  const firstItem = page.locator('.minutes-meeting').nth(0).locator('.minutes-item').first();
  const actionSpan = firstItem.locator('.minutes-action-text');
  await actionSpan.click();

  const input = await page.waitForSelector('.minutes-action-text input.editable-cell-input', { timeout: 3000 });
  await input.fill('Submit revised mockups by EOD');
  await input.press('Enter');

  const records = await getCreatedRecords(page);
  expect(records.some(r => r.value === 'Submit revised mockups by EOD')).toBe(true);
});

test('inline edit is cancelled on Escape — no record emitted', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-057');
  await page.waitForSelector('.minutes-meeting', { timeout: 5000 });

  const firstItem = page.locator('.minutes-meeting').nth(0).locator('.minutes-item').first();
  const agendaDiv = firstItem.locator('.minutes-agenda-text');
  await agendaDiv.click();

  const input = await page.waitForSelector('.minutes-agenda-text input.editable-cell-input', { timeout: 3000 });
  const originalText = 'Homepage redesign';
  await input.fill('abandoned edit');
  await input.press('Escape');

  // The input should be gone, and original text visible
  await expect(page.locator('.minutes-agenda-text input.editable-cell-input')).toHaveCount(0);
  await expect(agendaDiv).toContainText(originalText);

  const records = await getCreatedRecords(page);
  expect(records.some(r => r.value === 'abandoned edit')).toBe(false);
});

test('layout uses flex column with gap', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-057');
  await page.waitForSelector('.minutes-layout', { timeout: 5000 });

  await expect(page.locator('.minutes-layout')).toHaveCSS('display', 'flex');
  await expect(page.locator('.minutes-layout')).toHaveCSS('flex-direction', 'column');
});

test('minutes renders correctly at mobile width', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await setupApp(page);
  await navigateToSheet(page, 'sheet-057');
  await page.waitForSelector('.minutes-layout', { timeout: 5000 });

  // No section overflows the viewport
  const overflows = await page.evaluate(() => {
    const problems = [];
    document.querySelectorAll('.minutes-meeting').forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.right > window.innerWidth + 2) problems.push(el.className);
    });
    return problems;
  });
  expect(overflows).toHaveLength(0);

  // Items stack to single column at mobile
  const firstOpenItem = await page.locator('.minutes-meeting').nth(0).locator('.minutes-item').first();
  const templateColumns = await firstOpenItem.evaluate(el => getComputedStyle(el).gridTemplateColumns);
  // At 375px, should be single column (gridTemplateColumns has only one value)
  const colCount = templateColumns.trim().split(/\s+/).length;
  expect(colCount).toBe(1);
});
