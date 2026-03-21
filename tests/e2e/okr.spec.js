const { test, expect } = require('@playwright/test');
const { setupApp, navigateToSheet, getCreatedRecords } = require('../helpers/test-utils');

/* ─── Company OKR sheet (sheet-053): 3 objectives, 11 KRs ─── */

test('okr template is detected for company sheet-053', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-053');
  await page.waitForSelector('.okr-group', { timeout: 5000 });
  await expect(page.locator('#template-badge')).toContainText('OKR / Goals');
});

test('okr renders correct number of objective groups', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-053');
  await page.waitForSelector('.okr-group', { timeout: 5000 });
  // 4 distinct objectives in the fixture
  const groups = await page.locator('.okr-group').count();
  expect(groups).toBe(4);
});

test('okr objective headers show the objective name', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-053');
  await page.waitForSelector('.okr-objective-name', { timeout: 5000 });
  const names = await page.locator('.okr-objective-name').allTextContents();
  expect(names.some(n => n.includes('Revenue'))).toBe(true);
  expect(names.some(n => n.includes('Product Quality'))).toBe(true);
  expect(names.some(n => n.includes('World-Class Team'))).toBe(true);
});

test('okr objective header shows KR count badge', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-053');
  await page.waitForSelector('.okr-objective-count', { timeout: 5000 });
  const count = await page.locator('.okr-objective-count').count();
  expect(count).toBe(4);
  // First group "Grow Revenue by 30%" has 3 KRs
  await expect(page.locator('.okr-objective-count').first()).toContainText('3 KRs');
});

test('okr renders KR rows inside each objective group', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-053');
  await page.waitForSelector('.okr-kr-row', { timeout: 5000 });
  const krRows = await page.locator('.okr-kr-row').count();
  // 11 total KRs across all 4 objectives
  expect(krRows).toBe(11);
});

test('okr KR text is shown in each row', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-053');
  await page.waitForSelector('.okr-kr-text', { timeout: 5000 });
  await expect(page.locator('.okr-kr-text').first()).toContainText('$10M ARR');
});

test('okr progress bars are present and non-zero for in-progress KRs', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-053');
  await page.waitForSelector('.okr-kr-bar', { timeout: 5000 });
  const bars = await page.locator('.okr-kr-bar').count();
  expect(bars).toBe(11);
  // Verify first bar (90%) has non-zero width
  const width = await page.locator('.okr-kr-bar').first().evaluate(
    el => getComputedStyle(el).width
  );
  expect(width).not.toBe('0px');
});

test('okr roll-up progress percentage is shown on objective header', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-053');
  await page.waitForSelector('.okr-rollup-pct', { timeout: 5000 });
  const rollups = await page.locator('.okr-rollup-pct').allTextContents();
  expect(rollups.length).toBe(4);
  // All rollup percentages should be numeric
  for (const r of rollups) {
    expect(r).toMatch(/\d+%/);
  }
});

test('okr quarter filter bar is shown when multiple quarters exist', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-053');
  await page.waitForSelector('.okr-filter-bar', { timeout: 5000 });
  await expect(page.locator('.okr-filter-bar')).toBeVisible();
  // Should have Q1 2026, Q2 2026, and All buttons
  const btns = await page.locator('.okr-quarter-btn').count();
  expect(btns).toBeGreaterThanOrEqual(3);
});

test('okr quarter filter hides groups from other quarters', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-053');
  await page.waitForSelector('.okr-quarter-btn', { timeout: 5000 });

  // Click Q1 2026 filter
  const q1Btn = page.locator('.okr-quarter-btn').filter({ hasText: 'Q1 2026' });
  await q1Btn.click();
  await page.waitForSelector('.okr-group', { timeout: 3000 });

  // Q2 2026 objectives should be gone, Q1 2026 objectives remain
  const groups = await page.locator('.okr-group').count();
  expect(groups).toBe(3); // Only the 3 Q1 objectives
});

test('okr quarter filter all button restores all groups', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-053');
  await page.waitForSelector('.okr-quarter-btn', { timeout: 5000 });

  // Click Q1 2026 filter
  await page.locator('.okr-quarter-btn').filter({ hasText: 'Q1 2026' }).click();
  await page.waitForSelector('.okr-group', { timeout: 3000 });

  // Click "All" to restore
  await page.locator('.okr-quarter-btn').filter({ hasText: 'All' }).click();
  await page.waitForSelector('.okr-group', { timeout: 3000 });

  const groups = await page.locator('.okr-group').count();
  expect(groups).toBe(4);
});

test('okr objective collapses KR list on header click', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-053');
  await page.waitForSelector('.okr-objective-header', { timeout: 5000 });

  // Initially expanded — KR list is visible
  const firstList = page.locator('.okr-kr-list').first();
  await expect(firstList).not.toHaveClass(/okr-kr-hidden/);

  // Click to collapse
  await page.locator('.okr-objective-header').first().click();
  await expect(firstList).toHaveClass(/okr-kr-hidden/);

  // Click again to expand
  await page.locator('.okr-objective-header').first().click();
  await expect(firstList).not.toHaveClass(/okr-kr-hidden/);
});

test('okr progress cell is editable and emits edit on commit', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-053');
  await page.waitForSelector('.okr-kr-prog-cell', { timeout: 5000 });

  // Click the first progress cell to edit
  const progCell = page.locator('.okr-kr-prog-cell').first();
  await progCell.click();
  const input = await page.waitForSelector('.okr-kr-prog-cell .editable-cell-input, .editable-cell-input', { timeout: 3000 });
  await input.fill('95%');
  await input.press('Enter');

  const records = await getCreatedRecords(page);
  expect(records.some(r => r.value === '95%')).toBe(true);
});

test('okr owner badges are shown on KR rows', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-053');
  await page.waitForSelector('.okr-kr-owner', { timeout: 5000 });
  const owners = await page.locator('.okr-kr-owner').count();
  expect(owners).toBeGreaterThan(0);
  await expect(page.locator('.okr-kr-owner').first()).toContainText('Alice');
});

test('okr quarter badges are shown on KR rows', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-053');
  await page.waitForSelector('.okr-kr-quarter', { timeout: 5000 });
  const quarters = await page.locator('.okr-kr-quarter').count();
  expect(quarters).toBeGreaterThan(0);
});

test('okr objective header is clickable (cursor pointer)', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-053');
  await page.waitForSelector('.okr-objective-header', { timeout: 5000 });
  await expect(page.locator('.okr-objective-header').first()).toHaveCSS('cursor', 'pointer');
});

test('okr group uses design token border color', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-053');
  await page.waitForSelector('.okr-group', { timeout: 5000 });
  const border = await page.locator('.okr-group').first().evaluate(
    el => getComputedStyle(el).borderColor
  );
  expect(border).not.toBe('');
  expect(border).not.toBe('rgba(0, 0, 0, 0)');
});

test('okr rollup bar track is visible on objective header', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-053');
  await page.waitForSelector('.okr-rollup-bar-wrap', { timeout: 5000 });
  await expect(page.locator('.okr-rollup-bar-wrap').first()).toBeVisible();
});

test('okr add row form is present with correct label', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-053');
  await page.waitForSelector('.add-row-trigger', { timeout: 5000 });
  await expect(page.locator('.add-row-trigger').first()).toContainText('Add Key Result');
});

/* ─── Team OKR sheet (sheet-054): 2 objectives, 5 KRs ─── */

test('okr template is detected for team sheet-054', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-054');
  await page.waitForSelector('.okr-group', { timeout: 5000 });
  await expect(page.locator('#template-badge')).toContainText('OKR / Goals');
});

test('okr renders 2 objective groups for team sheet', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-054');
  await page.waitForSelector('.okr-group', { timeout: 5000 });
  await expect(page.locator('.okr-group')).toHaveCount(2);
});

test('okr renders 5 KR rows for team sheet', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-054');
  await page.waitForSelector('.okr-kr-row', { timeout: 5000 });
  await expect(page.locator('.okr-kr-row')).toHaveCount(5);
});

test('okr renders correctly at 375px mobile width', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await setupApp(page);
  await navigateToSheet(page, 'sheet-053');
  await page.waitForSelector('.okr-group', { timeout: 5000 });
  await expect(page.locator('.okr-group').first()).toBeVisible();
  // Verify no overflow
  const overflows = await page.evaluate(() => {
    const problems = [];
    document.querySelectorAll('.okr-group *').forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.right > window.innerWidth + 2) problems.push(el.className);
    });
    return problems;
  });
  expect(overflows).toHaveLength(0);
});
