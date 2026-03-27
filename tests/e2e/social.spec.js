// @ts-check
const { test, expect } = require('@playwright/test');
const { setupApp, navigateToSheet } = require('../helpers/test-utils');

test('social wall detected as Social Feed template', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-030');
  await page.waitForSelector('.social-feed', { timeout: 5_000 });

  await expect(page.locator('#template-badge')).toContainText('Social');
});

test('social feed renders posts with author avatars', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-030');
  await page.waitForSelector('.social-post', { timeout: 5_000 });

  const posts = page.locator('.social-post');
  expect(await posts.count()).toBeGreaterThan(0);

  // Each post should have an avatar
  const avatars = page.locator('.social-avatar');
  expect(await avatars.count()).toBeGreaterThan(0);
});

test('social feed shows comment threads', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-030');
  await page.waitForSelector('.social-post', { timeout: 5_000 });

  // Should have comment containers from sub-rows
  const comments = page.locator('.social-comment');
  expect(await comments.count()).toBeGreaterThan(0);
});

test('social feed shows category badges', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-030');
  await page.waitForSelector('.social-post', { timeout: 5_000 });

  const badges = page.locator('.social-post-category');
  expect(await badges.count()).toBeGreaterThan(0);
});

test('social profile header shows dominant author', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-030');
  await page.waitForSelector('.social-profile-header', { timeout: 5_000 });

  // Profile header should exist with author name
  await expect(page.locator('.social-profile-name')).not.toBeEmpty();
});

/* ---------- Directory view ---------- */

test('social directoryView shows Sync button', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => { window.location.hash = '#/folder/f-social/Social%20Walls'; });
  await page.waitForSelector('.dir-sync-btn', { timeout: 8_000 });
  await expect(page.locator('.dir-sync-btn')).toBeVisible();
  await expect(page.locator('.dir-sync-btn')).toContainText('Sync');
});

test('social directoryView shows folder refresh button in header', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => { window.location.hash = '#/folder/f-social/Social%20Walls'; });
  await page.waitForSelector('.social-directory', { timeout: 8_000 });
  await expect(page.locator('#folder-refresh-btn')).toBeVisible();
});

/* ---------- Live Chat (P2P) ---------- */

test('social wall shows Connect button in profile header', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-030');
  await page.waitForSelector('.social-profile-header', { timeout: 5_000 });
  await expect(page.locator('.social-connect-btn')).toBeVisible();
  await expect(page.locator('.social-connect-btn')).toContainText('Connect');
});

test('clicking Connect opens live chat panel', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-030');
  await page.waitForSelector('.social-connect-btn', { timeout: 5_000 });
  await page.click('.social-connect-btn');
  await page.waitForSelector('.social-chat-panel', { timeout: 3_000 });
  await expect(page.locator('.social-chat-panel')).toBeVisible();
  await expect(page.locator('.social-chat-title')).toContainText('Live Chat');
  await expect(page.locator('.social-chat-input')).toBeVisible();
});

test('chat panel can be minimized and closed', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-030');
  await page.click('.social-connect-btn');
  await page.waitForSelector('.social-chat-panel', { timeout: 3_000 });

  // Minimize
  await page.click('.social-chat-minimize');
  await expect(page.locator('.social-chat-panel')).toHaveClass(/social-chat-minimized/);

  // Expand
  await page.click('.social-chat-minimize');
  await expect(page.locator('.social-chat-panel')).not.toHaveClass(/social-chat-minimized/);

  // Close
  await page.click('.social-chat-close');
  await expect(page.locator('.social-chat-panel')).toHaveCount(0);
});

test('closing chat saves history to data sheet', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-030');
  await page.click('.social-connect-btn');
  await page.waitForSelector('.social-chat-panel', { timeout: 3_000 });

  // Send a message
  await page.fill('.social-chat-input', 'Test message for history');
  await page.click('.social-chat-send');
  await page.waitForSelector('.social-chat-bubble-text', { timeout: 3_000 });

  // Clear records so we only see what the close produces
  await page.evaluate(() => { window.__WAYMARK_RECORDS.length = 0; });

  // Close the chat panel — should trigger saveChatHistory
  await page.click('.social-chat-close');
  await expect(page.locator('.social-chat-panel')).toHaveCount(0);

  // Wait for the async save to complete
  await page.waitForFunction(
    () => window.__WAYMARK_RECORDS.some(r => r.type === 'row-append'),
    { timeout: 5_000 },
  );

  const records = await page.evaluate(() => window.__WAYMARK_RECORDS);
  const chatSave = records.find(r => r.type === 'row-append');
  expect(chatSave).toBeTruthy();
  expect(chatSave.spreadsheetId).toBe('sheet-030');
  // Should contain the message text in one of the row cells
  const hasMessage = chatSave.rows.some(row => row.includes('Test message for history'));
  expect(hasMessage).toBe(true);
  // Chat rows should use 'chat' category to integrate with the feed
  const hasChatCategory = chatSave.rows.some(row => row.includes('chat'));
  expect(hasChatCategory).toBe(true);
});

test('navigating away from sheet saves chat history', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-030');
  await page.click('.social-connect-btn');
  await page.waitForSelector('.social-chat-panel', { timeout: 3_000 });

  // Send a message
  await page.fill('.social-chat-input', 'History before navigate');
  await page.click('.social-chat-send');
  await page.waitForSelector('.social-chat-bubble-text', { timeout: 3_000 });

  // Clear records
  await page.evaluate(() => { window.__WAYMARK_RECORDS.length = 0; });

  // Navigate to a different sheet — triggers waymark:sheet-hidden → destroyChat
  await navigateToSheet(page, 'sheet-001');

  // Wait for the async save to complete
  await page.waitForFunction(
    () => window.__WAYMARK_RECORDS.some(r => r.type === 'row-append'),
    { timeout: 5_000 },
  );

  const records = await page.evaluate(() => window.__WAYMARK_RECORDS);
  const chatSave = records.find(r => r.type === 'row-append');
  expect(chatSave).toBeTruthy();
  expect(chatSave.spreadsheetId).toBe('sheet-030');
  const hasMessage = chatSave.rows.some(row => row.includes('History before navigate'));
  expect(hasMessage).toBe(true);
});

test('two tabs can exchange messages via BroadcastChannel', async ({ context }) => {
  // Use two pages in the same context so BroadcastChannel works between them
  const page1 = await context.newPage();
  const page2 = await context.newPage();

  await setupApp(page1);
  await setupApp(page2);

  // Both navigate to the same social sheet
  await navigateToSheet(page1, 'sheet-030');
  await navigateToSheet(page2, 'sheet-030');

  // Both connect
  await page1.click('.social-connect-btn');
  await page1.waitForSelector('.social-chat-panel', { timeout: 3_000 });

  await page2.click('.social-connect-btn');
  await page2.waitForSelector('.social-chat-panel', { timeout: 3_000 });

  // Wait for peer discovery (BroadcastChannel announce/welcome)
  await page1.waitForFunction(
    () => document.querySelector('.social-chat-peer-count')?.textContent?.includes('1 peer'),
    { timeout: 5_000 },
  );

  // Page 1 sends a message
  await page1.fill('.social-chat-input', 'Hello from tab 1!');
  await page1.click('.social-chat-send');

  // Page 2 should receive it
  await page2.waitForSelector('.social-chat-bubble-text', { timeout: 5_000 });
  await expect(page2.locator('.social-chat-bubble-text').first()).toContainText('Hello from tab 1!');

  // Page 2 replies
  await page2.fill('.social-chat-input', 'Hello back from tab 2!');
  await page2.click('.social-chat-send');

  // Page 1 should receive the reply
  await page1.waitForFunction(
    () => document.querySelectorAll('.social-chat-bubble').length >= 2,
    { timeout: 5_000 },
  );
  const bubbles1 = page1.locator('.social-chat-bubble-text');
  await expect(bubbles1.nth(1)).toContainText('Hello back from tab 2!');
});

/* ---------- Call UI ---------- */

test('chat panel shows call buttons after connecting', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-030');
  await page.click('.social-connect-btn');
  await page.waitForSelector('.social-chat-panel', { timeout: 3_000 });

  await expect(page.locator('.social-call-btn').first()).toBeVisible();
  await expect(page.locator('.social-call-btn').first()).toContainText('Call');
  await expect(page.locator('.social-call-btn-video')).toBeVisible();
  await expect(page.locator('.social-call-btn-video')).toContainText('Video');
  // Hang up should be hidden initially
  await expect(page.locator('.social-call-btn-hangup')).toBeHidden();
});

test('minimized chat hides call bar and media', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-030');
  await page.click('.social-connect-btn');
  await page.waitForSelector('.social-chat-panel', { timeout: 3_000 });

  await page.click('.social-chat-minimize');
  await expect(page.locator('.social-call-bar')).not.toBeVisible();

  // Expand again
  await page.click('.social-chat-minimize');
  await expect(page.locator('.social-call-bar')).toBeVisible();
});

/* ---------- Reconnection ---------- */

test('closing and reopening Connect creates a new chat panel', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-030');

  // First connect
  await page.click('.social-connect-btn');
  await page.waitForSelector('.social-chat-panel', { timeout: 3_000 });

  // Close
  await page.click('.social-chat-close');
  await expect(page.locator('.social-chat-panel')).toHaveCount(0);

  // Re-connect
  await page.click('.social-connect-btn');
  await page.waitForSelector('.social-chat-panel', { timeout: 3_000 });
  await expect(page.locator('.social-chat-panel')).toBeVisible();
  await expect(page.locator('.social-chat-title')).toContainText('Live Chat');
});

/* ---------- Audio Settings ---------- */

test('settings panel shows audio processing checkboxes', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-030');
  await page.click('.social-connect-btn');
  await page.waitForSelector('.social-chat-panel', { timeout: 3_000 });

  // Open settings
  await page.click('.social-chat-settings-btn');
  await expect(page.locator('.social-chat-settings-panel')).toBeVisible();

  // Audio processing and Advanced sections should be visible
  const titles = page.locator('.social-settings-title');
  const count = await titles.count();
  const texts = [];
  for (let i = 0; i < count; i++) texts.push(await titles.nth(i).textContent());
  expect(texts).toContain('Audio Processing');
  expect(texts).toContain('Advanced');

  // All three audio checkboxes should be present and checked by default
  const rows = page.locator('.social-settings-row');
  const rowCount = await rows.count();
  const labels = [];
  for (let i = 0; i < rowCount; i++) labels.push(await rows.nth(i).textContent());
  expect(labels.some(l => l.includes('Echo cancellation'))).toBe(true);
  expect(labels.some(l => l.includes('Noise suppression'))).toBe(true);
  expect(labels.some(l => l.includes('Auto gain control'))).toBe(true);
  expect(labels.some(l => l.includes('Noise gate'))).toBe(true);
  expect(labels.some(l => l.includes('High-pass filter'))).toBe(true);
});

test('audio settings default to enabled', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-030');
  await page.click('.social-connect-btn');
  await page.waitForSelector('.social-chat-panel', { timeout: 3_000 });
  await page.click('.social-chat-settings-btn');

  // All audio checkboxes should be checked by default
  const checkboxes = page.locator('.social-chat-settings-panel input[type="checkbox"]');
  const count = await checkboxes.count();
  // There are 5 checkboxes total: save history, sound, echo, noise, gain
  expect(count).toBe(5);
  // The last three (echo, noise, gain) should all be checked
  for (let i = 2; i < 5; i++) {
    await expect(checkboxes.nth(i)).toBeChecked();
  }
});

test('unchecking audio settings persists to localStorage', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-030');
  await page.click('.social-connect-btn');
  await page.waitForSelector('.social-chat-panel', { timeout: 3_000 });
  await page.click('.social-chat-settings-btn');

  // Uncheck echo cancellation (3rd checkbox, index 2)
  const checkboxes = page.locator('.social-chat-settings-panel input[type="checkbox"]');
  await checkboxes.nth(2).uncheck();

  // Verify localStorage was updated
  const echoVal = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('waymark_audio_echo_cancellation')),
  );
  expect(echoVal).toBe(false);

  // Other settings should still be true
  const noiseVal = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('waymark_audio_noise_suppression')),
  );
  const gainVal = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('waymark_audio_auto_gain')),
  );
  // null means not yet set (defaults to true), or explicitly true
  expect(noiseVal === null || noiseVal === true).toBe(true);
  expect(gainVal === null || gainVal === true).toBe(true);
});

test('audio settings hint text is shown', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-030');
  await page.click('.social-connect-btn');
  await page.waitForSelector('.social-chat-panel', { timeout: 3_000 });
  await page.click('.social-chat-settings-btn');

  await expect(page.locator('.social-settings-hint')).toBeVisible();
  await expect(page.locator('.social-settings-hint')).toContainText('next call');
});

test('noise gate slider defaults to -50 dB and persists changes', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-030');
  await page.click('.social-connect-btn');
  await page.waitForSelector('.social-chat-panel', { timeout: 3_000 });
  await page.click('.social-chat-settings-btn');

  // Noise gate slider should exist with default value
  const sliders = page.locator('.social-settings-range');
  expect(await sliders.count()).toBe(2);
  const gateSlider = sliders.first();
  await expect(gateSlider).toHaveValue('-50');

  // Change it
  await gateSlider.fill('-35');
  await gateSlider.dispatchEvent('input');

  const val = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('waymark_audio_gate_threshold')),
  );
  expect(val).toBe(-35);

  // Label should update
  const gateLabel = page.locator('.social-settings-range-value').first();
  await expect(gateLabel).toContainText('-35 dB');
});

test('high-pass slider defaults to 80 Hz and persists changes', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-030');
  await page.click('.social-connect-btn');
  await page.waitForSelector('.social-chat-panel', { timeout: 3_000 });
  await page.click('.social-chat-settings-btn');

  const sliders = page.locator('.social-settings-range');
  const hpSlider = sliders.nth(1);
  await expect(hpSlider).toHaveValue('80');

  await hpSlider.fill('120');
  await hpSlider.dispatchEvent('input');

  const val = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('waymark_audio_highpass_freq')),
  );
  expect(val).toBe(120);

  const hpLabel = page.locator('.social-settings-range-value').nth(1);
  await expect(hpLabel).toContainText('120 Hz');
});
