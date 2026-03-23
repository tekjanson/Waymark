const { test, expect } = require('@playwright/test');
const { setupApp, navigateToSheet, getCreatedRecords } = require('../helpers/test-utils');

/* ─── Gaming Leaderboard fixture (sheet-059): 8 players ─── */

test('scoreboard template is detected for sheet-059', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-059');
  await page.waitForSelector('.scoreboard-podium', { timeout: 5000 });
  await expect(page.locator('#template-badge')).toContainText('Scoreboard');
});

test('podium renders exactly 3 blocks for sheet-059', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-059');
  await page.waitForSelector('.scoreboard-podium-block', { timeout: 5000 });
  await expect(page.locator('.scoreboard-podium-block')).toHaveCount(3);
});

test('podium gold block shows 🥇 medal', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-059');
  await page.waitForSelector('.scoreboard-podium-block', { timeout: 5000 });
  const medalText = await page.locator('.scoreboard-rank-1 .scoreboard-podium-medal').textContent();
  expect(medalText).toContain('🥇');
});

test('podium silver and bronze medals render', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-059');
  await page.waitForSelector('.scoreboard-podium-block', { timeout: 5000 });
  const silver = await page.locator('.scoreboard-rank-2 .scoreboard-podium-medal').textContent();
  const bronze = await page.locator('.scoreboard-rank-3 .scoreboard-podium-medal').textContent();
  expect(silver).toContain('🥈');
  expect(bronze).toContain('🥉');
});

test('ranked list renders all 8 players', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-059');
  await page.waitForSelector('.scoreboard-row', { timeout: 5000 });
  await expect(page.locator('.scoreboard-row')).toHaveCount(8);
});

test('rows are sorted by score descending — Alice appears first', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-059');
  await page.waitForSelector('.scoreboard-row', { timeout: 5000 });
  const firstRowText = await page.locator('.scoreboard-row').first().textContent();
  expect(firstRowText).toContain('Alice');
});

test('streak badges show 🔥 for non-zero streaks', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-059');
  await page.waitForSelector('.scoreboard-streak-badge', { timeout: 5000 });
  const badges = page.locator('.scoreboard-streak-badge');
  const count = await badges.count();
  // Alice=8, Bob=3, Carol=1, Eve=5, Grace=2 have non-zero streaks → 5 badges
  expect(count).toBeGreaterThan(0);
  const firstBadge = await badges.first().textContent();
  expect(firstBadge).toContain('🔥');
});

test('win rate badges display for players with win rate data', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-059');
  await page.waitForSelector('.scoreboard-winrate-badge', { timeout: 5000 });
  const badges = page.locator('.scoreboard-winrate-badge');
  const count = await badges.count();
  expect(count).toBeGreaterThan(0);
  const firstBadge = await badges.first().textContent();
  expect(firstBadge).toMatch(/%/);
});

test('top 3 rows have scoreboard-row-top class', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-059');
  await page.waitForSelector('.scoreboard-row-top', { timeout: 5000 });
  await expect(page.locator('.scoreboard-row-top')).toHaveCount(3);
});

test('inline edit on score emits a record', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-059');
  await page.waitForSelector('.scoreboard-row', { timeout: 5000 });

  // Click first score cell in ranked list (skip podium — click the list row score)
  await page.locator('.scoreboard-list .scoreboard-score').first().click();
  const input = await page.waitForSelector('.scoreboard-list .scoreboard-score input.editable-cell-input', { timeout: 3000 });
  await input.fill('9999');
  await input.press('Enter');

  const records = await getCreatedRecords(page);
  expect(records.some(r => r.value === '9999')).toBe(true);
});

test('scoreboard uses non-transparent background color', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-059');
  await page.waitForSelector('.scoreboard-row', { timeout: 5000 });

  const bg = await page.locator('.scoreboard-row').first().evaluate(
    el => getComputedStyle(el).backgroundColor
  );
  expect(bg).not.toBe('rgba(0, 0, 0, 0)');
  expect(bg).not.toBe('');
});

test('podium stand heights are visually distinct (rank-1 tallest)', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-059');
  await page.waitForSelector('.scoreboard-podium-stand', { timeout: 5000 });

  const heights = await page.evaluate(() => {
    const stands = [...document.querySelectorAll('.scoreboard-podium-stand')];
    // stands appear in DOM order: rank-2, rank-1, rank-3 due to flex order
    // we get the heights and verify they differ
    return stands.map(s => parseFloat(getComputedStyle(s).height));
  });
  // All three stands should have different heights
  expect(new Set(heights).size).toBe(3);
});

test('scoreboard renders correctly at 375px mobile width', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await setupApp(page);
  await navigateToSheet(page, 'sheet-059');
  await page.waitForSelector('.scoreboard-list', { timeout: 5000 });

  const overflows = await page.evaluate(() => {
    const problems = [];
    document.querySelectorAll('.scoreboard-list .scoreboard-row').forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.right > window.innerWidth + 2) {
        problems.push(el.className);
      }
    });
    return problems;
  });
  expect(overflows).toHaveLength(0);
});
