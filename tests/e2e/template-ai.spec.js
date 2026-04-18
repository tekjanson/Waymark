const { test, expect } = require('@playwright/test');
const { setupApp, navigateToSheet } = require('../helpers/test-utils');

/* ---------- Visibility & presence of the Ask AI button ---------- */

test('Ask AI button is visible in the checklist header when a sheet is open', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-050');
  await page.waitForSelector('#checklist-view:not(.hidden)', { timeout: 5000 });
  await expect(page.locator('#template-ai-btn')).toBeVisible();
});

test('Ask AI button shows sparkle icon and label', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-050');
  await page.waitForSelector('#template-ai-btn', { timeout: 5000 });
  const btn = page.locator('#template-ai-btn');
  await expect(btn).toContainText('Ask AI');
});

test('Ask AI button has pointer cursor', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-050');
  await page.waitForSelector('#template-ai-btn', { timeout: 5000 });
  await expect(page.locator('#template-ai-btn')).toHaveCSS('cursor', 'pointer');
});

/* ---------- Panel opens and closes ---------- */

test('clicking Ask AI opens the AI overlay panel', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-050');
  await page.waitForSelector('#template-ai-btn', { timeout: 5000 });
  await page.click('#template-ai-btn');
  await page.waitForSelector('.template-ai-panel', { timeout: 3000 });
  await expect(page.locator('.template-ai-panel')).toBeVisible();
  await expect(page.locator('.template-ai-backdrop')).toBeVisible();
});

test('overlay panel shows sheet title in the header', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-050');
  await page.waitForSelector('#template-ai-btn', { timeout: 5000 });
  await page.click('#template-ai-btn');
  await page.waitForSelector('.template-ai-header', { timeout: 3000 });
  await expect(page.locator('.template-ai-sheet-name')).toContainText('My Task List');
});

test('clicking the close button (✕) closes the panel', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-050');
  await page.waitForSelector('#template-ai-btn', { timeout: 5000 });
  await page.click('#template-ai-btn');
  await page.waitForSelector('.template-ai-panel', { timeout: 3000 });
  await page.click('.template-ai-close');
  await page.waitForSelector('.template-ai-panel', { state: 'detached', timeout: 2000 });
  await expect(page.locator('.template-ai-panel')).toHaveCount(0);
  await expect(page.locator('.template-ai-backdrop')).toHaveCount(0);
});

test('pressing Escape closes the overlay panel', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-050');
  await page.waitForSelector('#template-ai-btn', { timeout: 5000 });
  await page.click('#template-ai-btn');
  await page.waitForSelector('.template-ai-panel', { timeout: 3000 });
  await page.keyboard.press('Escape');
  await page.waitForSelector('.template-ai-panel', { state: 'detached', timeout: 2000 });
  await expect(page.locator('.template-ai-panel')).toHaveCount(0);
});

test('clicking the backdrop closes the overlay panel', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-050');
  await page.waitForSelector('#template-ai-btn', { timeout: 5000 });
  await page.click('#template-ai-btn');
  await page.waitForSelector('.template-ai-backdrop', { timeout: 3000 });
  await page.click('.template-ai-backdrop', { position: { x: 5, y: 5 } });
  await page.waitForSelector('.template-ai-panel', { state: 'detached', timeout: 2000 });
  await expect(page.locator('.template-ai-panel')).toHaveCount(0);
});

/* ---------- No-keys state ---------- */

test('overlay shows no-keys state when no API key is configured', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-050');
  await page.waitForSelector('#template-ai-btn', { timeout: 5000 });
  await page.click('#template-ai-btn');
  await page.waitForSelector('.template-ai-no-keys', { timeout: 3000 });
  await expect(page.locator('.template-ai-no-keys')).toBeVisible();
  await expect(page.locator('.template-ai-no-keys-icon')).toContainText('🤖');
});

test('no-keys state shows link to AI agent settings', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-050');
  await page.waitForSelector('#template-ai-btn', { timeout: 5000 });
  await page.click('#template-ai-btn');
  await page.waitForSelector('.template-ai-no-keys', { timeout: 3000 });
  const link = page.locator('.template-ai-no-keys-hint a');
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute('href', '#/agent');
});

test('text input is disabled in no-keys state', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-050');
  await page.waitForSelector('#template-ai-btn', { timeout: 5000 });
  await page.click('#template-ai-btn');
  await page.waitForSelector('.template-ai-input', { timeout: 3000 });
  await expect(page.locator('.template-ai-input')).toBeDisabled();
  await expect(page.locator('.template-ai-capture-btn')).toBeDisabled();
  await expect(page.locator('.template-ai-attach-btn')).toBeDisabled();
});

/* ---------- Ready state with API key ---------- */

test('overlay shows empty state with suggestions when API key is configured', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-050');
  await page.waitForSelector('#checklist-view:not(.hidden)', { timeout: 5000 });
  await page.evaluate(() => {
    localStorage.setItem('waymark_agent_keys', JSON.stringify([{ key: 'test-key-abc', requestsToday: 0 }]));
  });
  await page.click('#template-ai-btn');
  await page.waitForSelector('.template-ai-empty', { timeout: 3000 });
  await expect(page.locator('.template-ai-empty')).toBeVisible();
  await expect(page.locator('.template-ai-empty-prompt')).toBeVisible();
});

test('overlay shows suggestion chips when API key is configured', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-050');
  await page.waitForSelector('#checklist-view:not(.hidden)', { timeout: 5000 });
  await page.evaluate(() => {
    localStorage.setItem('waymark_agent_keys', JSON.stringify([{ key: 'test-key-abc', requestsToday: 0 }]));
  });
  await page.click('#template-ai-btn');
  await page.waitForSelector('.template-ai-suggestion', { timeout: 3000 });
  const chips = page.locator('.template-ai-suggestion');
  expect(await chips.count()).toBeGreaterThanOrEqual(2);
});

test('clicking a suggestion chip fills the text input', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-050');
  await page.waitForSelector('#checklist-view:not(.hidden)', { timeout: 5000 });
  await page.evaluate(() => {
    localStorage.setItem('waymark_agent_keys', JSON.stringify([{ key: 'test-key-abc', requestsToday: 0 }]));
  });
  await page.click('#template-ai-btn');
  await page.waitForSelector('.template-ai-suggestion', { timeout: 3000 });
  const firstChip = page.locator('.template-ai-suggestion').first();
  const chipText = await firstChip.textContent();
  await firstChip.click();
  const input = page.locator('.template-ai-input');
  await expect(input).toHaveValue(chipText.trim());
});

test('text input is enabled when API key is configured', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-050');
  await page.waitForSelector('#checklist-view:not(.hidden)', { timeout: 5000 });
  await page.evaluate(() => {
    localStorage.setItem('waymark_agent_keys', JSON.stringify([{ key: 'test-key-abc', requestsToday: 0 }]));
  });
  await page.click('#template-ai-btn');
  await page.waitForSelector('.template-ai-input', { timeout: 3000 });
  await expect(page.locator('.template-ai-input')).toBeEnabled();
  await expect(page.locator('.template-ai-capture-btn')).toBeEnabled();
  await expect(page.locator('.template-ai-attach-btn')).toBeEnabled();
});

test('text input accepts typed text', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-050');
  await page.waitForSelector('#checklist-view:not(.hidden)', { timeout: 5000 });
  await page.evaluate(() => {
    localStorage.setItem('waymark_agent_keys', JSON.stringify([{ key: 'test-key-abc', requestsToday: 0 }]));
  });
  await page.click('#template-ai-btn');
  await page.waitForSelector('.template-ai-input', { timeout: 3000 });
  await page.fill('.template-ai-input', 'Mark all tasks as done');
  await expect(page.locator('.template-ai-input')).toHaveValue('Mark all tasks as done');
});

/* ---------- Visual style consistency ---------- */

test('overlay panel slides in from the right with visible background', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-050');
  await page.waitForSelector('#template-ai-btn', { timeout: 5000 });
  await page.click('#template-ai-btn');
  await page.waitForSelector('.template-ai-panel-open', { timeout: 3000 });
  await expect(page.locator('.template-ai-panel')).toHaveClass(/template-ai-panel-open/);
  await expect(page.locator('.template-ai-panel')).toHaveCSS('position', 'fixed');
});

test('panel close button has pointer cursor', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-050');
  await page.waitForSelector('#template-ai-btn', { timeout: 5000 });
  await page.click('#template-ai-btn');
  await page.waitForSelector('.template-ai-close', { timeout: 3000 });
  await expect(page.locator('.template-ai-close')).toHaveCSS('cursor', 'pointer');
});

test('overlay panel fits within viewport (no overflow)', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-050');
  await page.waitForSelector('#template-ai-btn', { timeout: 5000 });
  await page.click('#template-ai-btn');
  await page.waitForSelector('.template-ai-panel-open', { timeout: 3000 });
  // Wait for CSS transition to complete (220ms) before measuring
  await page.waitForFunction(() => {
    const panel = document.querySelector('.template-ai-panel');
    if (!panel) return false;
    return panel.getBoundingClientRect().right <= window.innerWidth + 2;
  }, { timeout: 3000 });
  const overflow = await page.evaluate(() => {
    const panel = document.querySelector('.template-ai-panel');
    if (!panel) return false;
    const rect = panel.getBoundingClientRect();
    return rect.right > window.innerWidth + 2;
  });
  expect(overflow).toBe(false);
});

/* ---------- Panel re-open lifecycle ---------- */

test('panel can be opened and closed multiple times', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-050');
  await page.waitForSelector('#template-ai-btn', { timeout: 5000 });

  // First open/close
  await page.click('#template-ai-btn');
  await page.waitForSelector('.template-ai-panel', { timeout: 3000 });
  await page.click('.template-ai-close');
  await page.waitForSelector('.template-ai-panel', { state: 'detached', timeout: 2000 });

  // Second open/close
  await page.click('#template-ai-btn');
  await page.waitForSelector('.template-ai-panel', { timeout: 3000 });
  await expect(page.locator('.template-ai-panel')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.waitForSelector('.template-ai-panel', { state: 'detached', timeout: 2000 });
  await expect(page.locator('.template-ai-panel')).toHaveCount(0);
});

/* ---------- Mobile / race-condition fixes ---------- */

test('Ask AI button has min-height of 44px for mobile tap target', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-050');
  await page.waitForSelector('#template-ai-btn', { timeout: 5000 });
  const height = await page.evaluate(() => {
    const btn = document.getElementById('template-ai-btn');
    return btn ? btn.getBoundingClientRect().height : 0;
  });
  expect(height).toBeGreaterThanOrEqual(44);
});

test('Ask AI button opens panel even if clicked before sheet data finishes loading', async ({ page }) => {
  await setupApp(page);
  // Navigate but click BEFORE waiting for the checklist view content
  await page.evaluate((id) => { window.location.hash = `#/sheet/${id}`; }, 'sheet-050');
  await page.waitForSelector('#checklist-view:not(.hidden)', { timeout: 5000 });
  // Immediately click the button (data may or may not be loaded)
  await page.click('#template-ai-btn');
  await page.waitForSelector('.template-ai-panel', { timeout: 3000 });
  await expect(page.locator('.template-ai-panel')).toBeVisible();
});
