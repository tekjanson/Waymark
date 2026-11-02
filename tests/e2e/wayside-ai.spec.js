// @ts-check
const { test, expect } = require('@playwright/test');
const { setupApp } = require('../helpers/test-utils');


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

  test('Wayside chat renders markdown sheet and doc links from Waymark AI as clickable anchors', async ({ page }) => {
    await setupApp(page);
    await page.waitForSelector('#home-wayside', { timeout: 5_000 });

    const parsed = await page.evaluate(async () => {
      const { appendLinkified } = await import('/js/wayboard.js');
      const div = document.createElement('div');
      appendLinkified(
        div,
        'Created [Paris Itinerary](#/sheet/sheet-paris-123) and [Packing Doc](https://docs.google.com/document/d/doc-123/edit)!'
      );
      const links = [...div.querySelectorAll('a')].map(a => ({
        text: a.textContent,
        href: a.getAttribute('href'),
        target: a.getAttribute('target'),
      }));
      return links;
    });

    expect(parsed).toEqual([
      { text: 'Paris Itinerary', href: '#/sheet/sheet-paris-123', target: null },
      { text: 'Packing Doc', href: 'https://docs.google.com/document/d/doc-123/edit', target: '_blank' },
    ]);
  });

