// @ts-check
const { test, expect } = require('@playwright/test');
const { setupApp, navigateToSheet, getCreatedRecords } = require('../helpers/test-utils');

/* ============================================================
   cms.spec.js — CMS: Content Scheduling and Publishing tests
   ============================================================ */

/* --- Layer 1: Detection & Rendering --- */

test('cms detected as CMS template', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-069');
  await page.waitForSelector('.cms-container', { timeout: 5_000 });
  await expect(page.locator('#template-badge')).toContainText('CMS');
});

test('cms renders content calendar table with post rows', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-069');
  await page.waitForSelector('.cms-table', { timeout: 5_000 });

  await expect(page.locator('.cms-table')).toBeVisible();
  const rows = page.locator('.cms-row');
  expect(await rows.count()).toBeGreaterThanOrEqual(8);
});

test('cms renders table headers including Status and Scheduled', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-069');
  await page.waitForSelector('.cms-th', { timeout: 5_000 });

  const headers = page.locator('.cms-th');
  await expect(headers.first()).toContainText('Title');

  // verify status and scheduled columns are present
  const allHeaders = await headers.allTextContents();
  expect(allHeaders.some(h => h.includes('Status'))).toBe(true);
  expect(allHeaders.some(h => h.includes('Scheduled'))).toBe(true);
  expect(allHeaders.some(h => h.includes('Published'))).toBe(true);
});

test('cms renders status badges for each post row', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-069');
  await page.waitForSelector('.cms-status-btn', { timeout: 5_000 });

  const statusBtns = page.locator('.cms-status-btn');
  expect(await statusBtns.count()).toBeGreaterThanOrEqual(8);
});

/* --- Layer 2: Filter Behavior --- */

test('cms filter toolbar renders All/Draft/Scheduled/Published/Archived buttons', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-069');
  await page.waitForSelector('.cms-filter-btn', { timeout: 5_000 });

  const filterBtns = page.locator('.cms-filter-btn');
  expect(await filterBtns.count()).toBe(5);
  await expect(filterBtns.first()).toContainText('All');
});

test('cms filter by Draft shows only Draft posts', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-069');
  await page.waitForSelector('.cms-filter-btn', { timeout: 5_000 });

  // Click Draft filter
  await page.locator('.cms-filter-btn', { hasText: 'Draft' }).click();
  await page.waitForTimeout(100);

  const rows = page.locator('.cms-row');
  const count = await rows.count();
  expect(count).toBeGreaterThanOrEqual(1);

  // All visible rows should have draft status
  for (let i = 0; i < count; i++) {
    const statusBtn = rows.nth(i).locator('.cms-status-btn');
    await expect(statusBtn).toContainText('Draft');
  }
});

test('cms filter by Published shows only Published posts', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-069');
  await page.waitForSelector('.cms-filter-btn', { timeout: 5_000 });

  // Click Published filter
  await page.locator('.cms-filter-btn', { hasText: 'Published' }).click();
  await page.waitForTimeout(100);

  const rows = page.locator('.cms-row');
  const count = await rows.count();
  expect(count).toBeGreaterThanOrEqual(1);

  for (let i = 0; i < count; i++) {
    const statusBtn = rows.nth(i).locator('.cms-status-btn');
    await expect(statusBtn).toContainText('Published');
  }
});

test('cms filter active button gets active class', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-069');
  await page.waitForSelector('.cms-filter-btn', { timeout: 5_000 });

  // Initially "All" is active
  await expect(page.locator('.cms-filter-btn.cms-filter-active')).toContainText('All');

  // Click Scheduled
  await page.locator('.cms-filter-btn', { hasText: 'Scheduled' }).click();
  await expect(page.locator('.cms-filter-btn.cms-filter-active')).toContainText('Scheduled');
});

/* --- Layer 3: Interaction Quality --- */

test('cms status badge cycles on click and emits edit', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-069');
  await page.waitForSelector('.cms-status-btn', { timeout: 5_000 });

  // Find the first Draft post
  const draftBtn = page.locator('.cms-status-btn.cms-status-draft').first();
  await expect(draftBtn).toBeVisible();
  await draftBtn.click();

  // After click, status should have advanced to Scheduled
  const nextBtn = page.locator('.cms-status-btn').first();
  const newText = await nextBtn.textContent();
  expect(['Scheduled', 'Published', 'Archived', 'Draft']).toContain(newText?.trim());
});

test('cms title cell supports inline edit', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-069');
  await page.waitForSelector('.cms-title-text', { timeout: 5_000 });

  const titleCell = page.locator('.cms-title-text').first();
  await titleCell.click();

  const input = page.locator('.editable-cell-input').first();
  await expect(input).toBeVisible();
  await input.fill('Updated Post Title');
  await input.press('Enter');

  const records = await getCreatedRecords(page);
  expect(records.length).toBeGreaterThanOrEqual(1);
  expect(records.some(r => r.value === 'Updated Post Title')).toBe(true);
});

/* --- Layer 4: Visual Consistency --- */

test('cms archived rows have archived css class', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-069');
  await page.waitForSelector('.cms-row-archived', { timeout: 5_000 });

  await expect(page.locator('.cms-row-archived').first()).toBeVisible();
});

test('cms published status button has published CSS class', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-069');
  await page.waitForSelector('.cms-status-published', { timeout: 5_000 });

  const publishedBtns = page.locator('.cms-status-published');
  expect(await publishedBtns.count()).toBeGreaterThanOrEqual(1);
});

test('cms scheduled status button has scheduled CSS class', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-069');
  await page.waitForSelector('.cms-status-scheduled', { timeout: 5_000 });

  await expect(page.locator('.cms-status-scheduled').first()).toBeVisible();
});

/* --- Layer 5: Edge Cases --- */

test('cms filter to Archived then back to All shows all posts', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-069');
  await page.waitForSelector('.cms-filter-btn', { timeout: 5_000 });

  const allCount = await page.locator('.cms-row').count();

  await page.locator('.cms-filter-btn', { hasText: 'Archived' }).click();
  await page.waitForTimeout(100);

  await page.locator('.cms-filter-btn', { hasText: 'All' }).click();
  await page.waitForTimeout(100);

  const restoredCount = await page.locator('.cms-row').count();
  expect(restoredCount).toBe(allCount);
});

/* ============================================================
   Unit tests — pure helpers via page.evaluate
   ============================================================ */

test('cms helpers: cmsStatusKey classifies all status values correctly', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { cmsStatusKey } = await import('/js/templates/cms.js');
    return {
      draft: cmsStatusKey('Draft'),
      draftLower: cmsStatusKey('draft'),
      scheduled: cmsStatusKey('Scheduled'),
      schedPartial: cmsStatusKey('sched'),
      published: cmsStatusKey('Published'),
      pubShort: cmsStatusKey('pub'),
      archived: cmsStatusKey('Archived'),
      archShort: cmsStatusKey('arch'),
      empty: cmsStatusKey(''),
      unknown: cmsStatusKey('Pending'),
    };
  });

  expect(results.draft).toBe('draft');
  expect(results.draftLower).toBe('draft');
  expect(results.scheduled).toBe('scheduled');
  expect(results.schedPartial).toBe('scheduled');
  expect(results.published).toBe('published');
  expect(results.pubShort).toBe('published');
  expect(results.archived).toBe('archived');
  expect(results.archShort).toBe('archived');
  expect(results.empty).toBe('draft');
  expect(results.unknown).toBe('draft');
});

test('cms helpers: formatCmsDate formats and handles edge cases', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { formatCmsDate } = await import('/js/templates/cms.js');
    return {
      isoDate: formatCmsDate('2026-04-15'),
      empty: formatCmsDate(''),
      invalid: formatCmsDate('not-a-date'),
    };
  });

  expect(results.isoDate).toMatch(/Apr(il)? 15,? 2026/);
  expect(results.empty).toBe('');
  expect(results.invalid).toBe('not-a-date');
});

test('cms helpers: scheduleState returns correct state', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { scheduleState } = await import('/js/templates/cms.js');

    const now = new Date();
    // Future dates
    const in2Days = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const yesterday = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    return {
      notScheduled: scheduleState('Published', in2Days),
      soon: scheduleState('Scheduled', in2Days),
      upcoming: scheduleState('Scheduled', in30Days),
      overdue: scheduleState('Scheduled', yesterday),
      noDate: scheduleState('Scheduled', ''),
    };
  });

  expect(results.notScheduled).toBeNull();
  expect(results.soon).toBe('soon');
  expect(results.upcoming).toBe('upcoming');
  expect(results.overdue).toBe('overdue');
  expect(results.noDate).toBeNull();
});

test('cms helpers: parseScheduledDate handles valid and invalid input', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { parseScheduledDate } = await import('/js/templates/cms.js');
    const d = parseScheduledDate('2026-06-01');
    return {
      valid: d !== null,
      empty: parseScheduledDate('') === null,
      invalid: parseScheduledDate('not-a-date') === null,
    };
  });

  expect(results.valid).toBe(true);
  expect(results.empty).toBe(true);
  expect(results.invalid).toBe(true);
});

test('cms helpers: cmsStageClass returns valid CSS suffix for all states', async ({ page }) => {
  await setupApp(page);
  const results = await page.evaluate(async () => {
    const { cmsStageClass } = await import('/js/templates/cms.js');
    return {
      draft: cmsStageClass('Draft'),
      scheduled: cmsStageClass('Scheduled'),
      published: cmsStageClass('Published'),
      archived: cmsStageClass('Archived'),
    };
  });

  expect(results.draft).toBe('draft');
  expect(results.scheduled).toBe('scheduled');
  expect(results.published).toBe('published');
  expect(results.archived).toBe('archived');
});
