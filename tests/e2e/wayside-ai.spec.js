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

  test('Waymark AI displays Share Agent button, opens Share Agent modal, grants Drive permission, and generates invite link', async ({ page }) => {
    await setupApp(page);
    await page.waitForSelector('#home-wayside', { timeout: 5_000 });

    const aiAvatar = page.locator('#home-wayside .avatar-ai');
    await aiAvatar.click();

    const shareAgentBtn = page.locator('#wayside-share-agent-btn');
    await expect(shareAgentBtn).toBeVisible();
    await expect(shareAgentBtn).toContainText('Share Agent');

    await shareAgentBtn.click();

    const modal = page.locator('#wayside-share-agent-modal');
    await expect(modal).toBeVisible();
    await expect(modal.locator('h3')).toContainText('Share Waymark AI Agent');

    await page.fill('#wayside-share-agent-email', 'spouse@gmail.com');
    await page.click('#wayside-share-agent-grant-btn');

    const linkVal = await page.inputValue('#wayside-share-agent-link');
    expect(linkVal).toContain('ledger=');
    expect(linkVal).toContain('from=assistant%40waymark.internal');

    const permissionRecords = await page.evaluate(() =>
      (window.__WAYMARK_RECORDS || []).filter(r => r.type === 'drive-permission')
    );
    expect(permissionRecords.some(r => r.email === 'spouse@gmail.com' && r.role === 'writer')).toBe(true);
  });

  test('Waymark AI displays multi-thread controls, stores threads in Google Drive, and switches/clears threads (agent-only)', async ({ page }) => {
    await setupApp(page);
    await page.waitForSelector('#home-wayside', { timeout: 5_000 });

    // Select a human crew/collaborator first (auto-selected on boot) — thread bar must NOT be present on human chats
    const humanThreadBar = page.locator('#wayside-thread-bar');
    await expect(humanThreadBar).toHaveCount(0);

    // Now select Waymark AI — thread bar MUST be visible
    await page.locator('#home-wayside .avatar-ai').click();
    await expect(page.locator('#wayside-thread-bar')).toBeVisible();
    await expect(page.locator('#wayside-thread-select')).toBeVisible();
    await expect(page.locator('#wayside-new-thread-btn')).toBeVisible();
    await expect(page.locator('#wayside-clear-thread-btn')).toBeVisible();

    // Send a message in the default thread
    await page.fill('#wayside-chat-input', 'First thread message about groceries');
    await page.press('#wayside-chat-input', 'Enter');
    await expect(page.locator('#wayside-chat-log .chat-self').last()).toContainText('First thread message about groceries');

    // Click "+ New" to start a second thread
    await page.click('#wayside-new-thread-btn');
    await expect(page.locator('#wayside-chat-log .wayside-thread-empty')).toBeVisible();
    await expect(page.locator('#wayside-chat-log .chat-self')).toHaveCount(0);

    // Send a message in the new thread
    await page.fill('#wayside-chat-input', 'Second thread about Maui vacation');
    await page.press('#wayside-chat-input', 'Enter');
    await expect(page.locator('#wayside-chat-log .chat-self').last()).toContainText('Second thread about Maui vacation');

    // Switch back to the default thread via the dropdown and verify its message is restored from Drive
    await page.selectOption('#wayside-thread-select', 'default');
    await expect(page.locator('#wayside-chat-log .chat-self').last()).toContainText('First thread message about groceries');

    // Click Clear to reset context and start fresh
    await page.click('#wayside-clear-thread-btn');
    await expect(page.locator('#wayside-chat-log .wayside-thread-empty')).toContainText('Context cleared');
  });

  test('Profile / Settings modal is spacious on desktop and responsive without overflow on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await setupApp(page);

    await page.locator('#user-name').click();
    await page.waitForSelector('#settings-modal:not(.hidden)', { timeout: 5_000 });

    const desktopBox = await page.locator('.settings-modal').boundingBox();
    expect(desktopBox).not.toBeNull();
    expect(desktopBox.width).toBeGreaterThanOrEqual(700);
    await expect(page.locator('#settings-user-email')).not.toBeEmpty();

    // Switch to mobile viewport (375x812) and verify no horizontal overflow
    await page.setViewportSize({ width: 375, height: 812 });
    const mobileMetrics = await page.evaluate(() => {
      const modal = document.querySelector('.settings-modal');
      const body = document.querySelector('#settings-modal .settings-body');
      const rect = modal.getBoundingClientRect();
      return {
        modalWidth: rect.width,
        viewportWidth: window.innerWidth,
        bodyScrollWidth: body.scrollWidth,
        bodyClientWidth: body.clientWidth,
      };
    });
    expect(mobileMetrics.modalWidth).toBeLessThanOrEqual(mobileMetrics.viewportWidth);
    expect(mobileMetrics.bodyScrollWidth).toBeLessThanOrEqual(mobileMetrics.bodyClientWidth + 2);
  });

  test('Collaborator can connect a shared agent ledger, switch between Personal and Shared Agent, and push OAuth tokens over P2P tunnel', async ({ page }) => {
    await setupApp(page);
    await page.waitForSelector('#home-wayside', { timeout: 5_000 });

    // Seed a shared agent ledger owned by spouse@gmail.com in mock sheets
    await page.evaluate(async () => {
      const { api } = await import('/js/api-client.js');
      const created = await api.sheets.createSpreadsheet(
        '.waymark-ledger-contact-pair-assistant@waymark.internal--spouse@gmail.com',
        [['Document_ID', 'Document_Title', 'Waymark_Type', 'Shared_With_Email', 'Group', 'Permission_Level', 'Shared_Timestamp', 'Status']],
        null
      );
      window.__TEST_SHARED_AGENT_ID = created.spreadsheetId || created.id;
      await api.sheets.writeTab(window.__TEST_SHARED_AGENT_ID, 'Chat', [
        ['Message_ID', 'Timestamp_UTC', 'Sender_Email', 'Target_Group_Or_Contact', 'Message_Text', 'Attached_Waymark_Link'],
        ['m-shared-1', '2026-11-08T10:00:00Z', 'spouse@gmail.com', 'assistant@waymark.internal', 'Hello from spouse shared agent!', ''],
      ]);
    });

    const sharedSheetId = await page.evaluate(() => window.__TEST_SHARED_AGENT_ID);
    expect(sharedSheetId).toBeTruthy();

    // Open Profile / Settings modal and click Configure / Switch button for Waymark AI Agent
    await page.locator('#user-name').click();
    await page.waitForSelector('#settings-modal:not(.hidden)', { timeout: 5_000 });
    await expect(page.locator('#settings-agent-host-label')).toContainText('Personal Agent');
    await page.locator('#settings-configure-agent-btn').click();

    const modal = page.locator('#wayside-share-agent-modal');
    await expect(modal).toBeVisible();

    // Paste shared invite link and connect to the shared agent
    await page.fill(
      '#wayside-connect-agent-input',
      `https://waymark.example.com/?ledger=${sharedSheetId}&from=assistant%40waymark.internal`
    );
    await page.click('#wayside-connect-agent-btn');

    // Host selector now has the shared agent selected and shows spouse@gmail.com
    await expect(page.locator('#wayside-agent-host-select')).toHaveValue(sharedSheetId);
    await expect(page.locator('#wayside-agent-host-select option:checked')).toContainText('spouse@gmail.com');

    // Test pushing OAuth token via P2P tunnel
    await page.click('#wayside-push-oauth-btn');
    await expect(page.locator('#wayside-oauth-tunnel-status')).toContainText('Pushed OAuth token bundle');

    // Simulate agent acknowledging the OAuth token over P2P
    await page.evaluate(() => {
      document.dispatchEvent(new CustomEvent('waymark:agent-oauth-ack', {
        detail: { ok: true, hasRefreshToken: true },
      }));
    });
    await expect(page.locator('#wayside-oauth-tunnel-status')).toContainText('Agent acknowledged OAuth credentials');

    // Close modal and verify shared agent chat message is loaded in Wayside AI
    await page.locator('.wayside-share-agent-close').click();
    await expect(page.locator('#wayside-chat-log')).toContainText('Hello from spouse shared agent!');

    // Verify Settings modal also reflects the active Shared Agent
    await page.locator('#user-name').click();
    await page.waitForSelector('#settings-modal:not(.hidden)', { timeout: 5_000 });
    await expect(page.locator('#settings-agent-host-label')).toContainText('Shared Agent (spouse@gmail.com)');
  });




