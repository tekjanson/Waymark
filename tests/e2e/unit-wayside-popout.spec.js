// @ts-check
const { test, expect } = require('@playwright/test');
const { setupApp } = require('../helpers/test-utils');

test.describe('Wayside Chat Pop-out and Bubble Mode', () => {
  test('can pop out Wayside chat session, move anywhere on screen, truncate to bubble, and dock back', async ({ page }) => {
    await setupApp(page);
    await page.waitForSelector('#home-wayside', { timeout: 5_000 });

    // Select Waymark AI to start a chat session
    const aiAvatar = page.locator('#home-wayside .avatar-ai');
    await expect(aiAvatar).toBeVisible();
    await aiAvatar.click();

    // Verify chat session is mounted in embedded mode inside #wayside-chat-container
    const chatContainer = page.locator('#wayside-chat-container');
    const chatPanel = page.locator('.social-chat-panel');
    await expect(chatPanel).toBeVisible();
    await expect(chatContainer.locator('.social-chat-panel')).toHaveCount(1);
    await expect(chatPanel).toHaveClass(/social-chat-embedded/);

    // Verify pop-out and bubble buttons exist
    const popoutBtn = page.locator('#wayside-popout-btn');
    const bubbleBtn = page.locator('#wayside-bubble-btn');
    await expect(popoutBtn).toBeVisible();
    await expect(bubbleBtn).toBeVisible();
    await expect(popoutBtn).toHaveAttribute('title', 'Pop out chat');
    await expect(bubbleBtn).toHaveAttribute('title', 'Truncate to chat bubble');

    // 1. Click Pop Out button
    await popoutBtn.click();

    // Verify chat panel is now popped out and attached to document.body
    await expect(chatPanel).toHaveClass(/social-chat-popped-out/);
    const isAttachedToBody = await page.evaluate(() => {
      const panel = document.querySelector('.social-chat-panel');
      return panel && panel.parentElement === document.body;
    });
    expect(isAttachedToBody).toBe(true);

    // Verify placeholder appears in the Wayside column
    const placeholder = page.locator('.wayside-popped-out-placeholder');
    await expect(placeholder).toBeVisible();
    await expect(placeholder).toContainText('Floating session active');
    const dockBtnInColumn = page.locator('#wayside-dock-btn');
    await expect(dockBtnInColumn).toBeVisible();

    // Verify popout button now acts as a dock button
    await expect(popoutBtn).toHaveAttribute('title', 'Dock chat back to Wayside');
    await expect(popoutBtn).toHaveText('↙');

    // 2. Drag / move the popped out window anywhere on screen
    const header = page.locator('.social-chat-panel .social-chat-header');
    const headerBox = await header.boundingBox();
    expect(headerBox).not.toBeNull();

    // Move using pointer events towards the center/left of the screen
    await page.mouse.move(headerBox.x + 20, headerBox.y + 10);
    await page.mouse.down();
    await page.mouse.move(headerBox.x - 450, headerBox.y + 50, { steps: 5 });
    await page.mouse.up();

    // Verify position changed
    const posAfterDrag = await page.evaluate(() => {
      const panel = /** @type {HTMLElement} */ (document.querySelector('.social-chat-panel'));
      return { left: panel.style.left, top: panel.style.top };
    });
    expect(posAfterDrag.left).toBeTruthy();
    expect(posAfterDrag.top).toBeTruthy();

    // 3. Truncate down to chat bubble
    await bubbleBtn.click();

    // Verify panel is now in bubble mode
    await expect(chatPanel).toHaveClass(/social-chat-bubble-mode/);
    const bubbleFab = page.locator('#wayside-bubble-fab');
    await expect(bubbleFab).toBeVisible();
    await expect(bubbleFab.locator('.social-chat-bubble-icon')).toHaveText('🤖');

    // Verify chat contents (messages, input bar) are hidden in bubble mode
    const messagesVisible = await page.locator('#wayside-chat-log').isVisible();
    expect(messagesVisible).toBe(false);

    // 4. Drag the chat bubble to a new position
    const bubbleBox = await bubbleFab.boundingBox();
    expect(bubbleBox).not.toBeNull();

    await page.mouse.move(bubbleBox.x + 20, bubbleBox.y + 20);
    await page.mouse.down();
    await page.mouse.move(bubbleBox.x - 80, bubbleBox.y - 40, { steps: 5 });
    await page.mouse.up();

    // Still in bubble mode after drag
    await expect(chatPanel).toHaveClass(/social-chat-bubble-mode/);

    // 5. Click the bubble to expand back to floating window
    await bubbleFab.click();

    // Verify bubble mode is exited and full chat window is visible again
    await expect(chatPanel).not.toHaveClass(/social-chat-bubble-mode/);
    await expect(chatPanel).toHaveClass(/social-chat-popped-out/);
    await expect(page.locator('#wayside-chat-log')).toBeVisible();
    await expect(page.locator('#wayside-chat-input')).toBeVisible();

    // 6. Dock the chat back to the Wayside column
    await dockBtnInColumn.click();

    // Verify chat panel is re-mounted into #wayside-chat-container
    await expect(chatPanel).toHaveClass(/social-chat-embedded/);
    await expect(chatPanel).not.toHaveClass(/social-chat-popped-out/);
    const isBackInWayside = await page.evaluate(() => {
      const panel = document.querySelector('.social-chat-panel');
      const container = document.getElementById('wayside-chat-container');
      return panel && panel.parentElement === container;
    });
    expect(isBackInWayside).toBe(true);

    // Verify placeholder is removed
    await expect(page.locator('.wayside-popped-out-placeholder')).toHaveCount(0);
    await expect(popoutBtn).toHaveAttribute('title', 'Pop out chat');
    await expect(popoutBtn).toHaveText('↗');
  });

  test('clicking bubble toggle directly from embedded mode pops out and truncates immediately', async ({ page }) => {
    await setupApp(page);
    await page.waitForSelector('#home-wayside', { timeout: 5_000 });

    // Select Waymark AI
    await page.locator('#home-wayside .avatar-ai').click();

    const chatPanel = page.locator('.social-chat-panel');
    const bubbleBtn = page.locator('#wayside-bubble-btn');

    // Click bubble toggle while still embedded
    await bubbleBtn.click();

    // Should immediately pop out to document.body and enter bubble mode
    await expect(chatPanel).toHaveClass(/social-chat-bubble-mode/);
    await expect(chatPanel).toHaveClass(/social-chat-popped-out/);
    const bubbleFab = page.locator('#wayside-bubble-fab');
    await expect(bubbleFab).toBeVisible();

    // Clicking bubble expands back
    await bubbleFab.click();
    await expect(chatPanel).not.toHaveClass(/social-chat-bubble-mode/);
    await expect(chatPanel).toHaveClass(/social-chat-popped-out/);
  });

  test('placeholder controls and keyboard navigation support truncating to bubble and expanding', async ({ page }) => {
    await setupApp(page);
    await page.waitForSelector('#home-wayside', { timeout: 5_000 });

    await page.locator('#home-wayside .avatar-ai').click();
    const chatPanel = page.locator('.social-chat-panel');
    const popoutBtn = page.locator('#wayside-popout-btn');
    await popoutBtn.click();
    await expect(chatPanel).toHaveClass(/social-chat-popped-out/);

    // Placeholder has action button to toggle bubble mode
    const placeholderBubbleBtn = page.locator('#wayside-toggle-bubble-btn');
    await expect(placeholderBubbleBtn).toBeVisible();
    await expect(placeholderBubbleBtn).toContainText('🫧 Truncate to bubble');

    // Click placeholder button to truncate down to bubble
    await placeholderBubbleBtn.click({ force: true });
    await expect(chatPanel).toHaveClass(/social-chat-bubble-mode/);
    await expect(placeholderBubbleBtn).toContainText('🪟 Expand window');

    // Keyboard support: bubbleFab has role button, tabindex, and Enter/Space expands
    const bubbleFab = page.locator('#wayside-bubble-fab');
    await expect(bubbleFab).toHaveAttribute('role', 'button');
    await expect(bubbleFab).toHaveAttribute('tabindex', '0');
    await bubbleFab.focus();
    await page.keyboard.press('Enter');

    // Expanded via Enter key
    await expect(chatPanel).not.toHaveClass(/social-chat-bubble-mode/);
    await expect(chatPanel).toHaveClass(/social-chat-popped-out/);

    // Keyboard support: Escape key collapses back to bubble
    await page.keyboard.press('Escape');
    await expect(chatPanel).toHaveClass(/social-chat-bubble-mode/);
  });
});
