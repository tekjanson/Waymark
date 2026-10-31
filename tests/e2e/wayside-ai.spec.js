// @ts-check
const { test, expect } = require('@playwright/test');
const { setupApp } = require('../helpers/test-utils');

test.describe('Wayside AI Assistant Integration', () => {

  test('Waymark AI avatar appears in The Wayside and can be selected', async ({ page }) => {
    await setupApp(page);
    await page.waitForSelector('#home-wayside', { timeout: 5_000 });

    const aiAvatar = page.locator('#home-wayside .avatar-ai');
    await expect(aiAvatar).toBeVisible();
    await expect(aiAvatar).toHaveText('🤖');
    await expect(aiAvatar).toHaveAttribute('title', /assistant@waymark\.internal/);

    await aiAvatar.click();
    await expect(page.locator('#wayside-crew-title')).toContainText('Waymark AI');
    await expect(page.locator('#wayside-chat-input')).toBeVisible();

    // Type a chat message
    await page.fill('#wayside-chat-input', 'Can you help me plan a trip?');
    await page.press('#wayside-chat-input', 'Enter');

    const lastMsg = page.locator('#wayside-chat-log .chat-self').last();
    await expect(lastMsg).toContainText('Can you help me plan a trip?');
  });

});
