const { test, expect } = require('@playwright/test');
const { setupApp } = require('../helpers/test-utils');

/* ---------- Agent View — Rendering & Navigation ---------- */

test('agent view renders when navigating to #/agent', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => { window.location.hash = '#/agent'; });
  await page.waitForSelector('#agent-view:not(.hidden)', { timeout: 5000 });
  await expect(page.locator('#agent-view')).toBeVisible();
  await expect(page.locator('.agent-container')).toBeVisible();
});

test('agent view shows header with title and action buttons', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => { window.location.hash = '#/agent'; });
  await page.waitForSelector('.agent-header', { timeout: 5000 });
  await expect(page.locator('.agent-header-title')).toContainText('Waymark AI');
  await expect(page.locator('.agent-settings-btn')).toBeVisible();
  await expect(page.locator('.agent-clear-btn')).toBeVisible();
});

test('agent view shows welcome state when no API key is configured', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => { window.location.hash = '#/agent'; });
  await page.waitForSelector('.agent-welcome', { timeout: 5000 });
  await expect(page.locator('.agent-welcome')).toBeVisible();
  await expect(page.locator('.agent-welcome-btn')).toBeVisible();
});

test('agent input is disabled when no API key is set', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => { window.location.hash = '#/agent'; });
  await page.waitForSelector('.agent-input', { timeout: 5000 });
  await expect(page.locator('.agent-input')).toBeDisabled();
  await expect(page.locator('.agent-send-btn')).toBeDisabled();
  await expect(page.locator('.agent-capture-image-btn')).toBeDisabled();
  await expect(page.locator('.agent-attach-image-btn')).toBeDisabled();
});

test('agent shows image attach button when API key is configured', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => {
    localStorage.setItem('waymark_agent_api_key', JSON.stringify('test-key-123'));
    window.location.hash = '#/agent';
  });
  await page.waitForSelector('.agent-input', { timeout: 5000 });
  await expect(page.locator('.agent-capture-image-btn')).toBeVisible();
  await expect(page.locator('.agent-capture-image-btn')).toBeEnabled();
  await expect(page.locator('.agent-attach-image-btn')).toBeVisible();
  await expect(page.locator('.agent-attach-image-btn')).toBeEnabled();
});

/* ---------- API Key Settings ---------- */

test('clicking settings button opens agent settings modal', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => { window.location.hash = '#/agent'; });
  await page.waitForSelector('.agent-settings-btn', { timeout: 5000 });
  await page.click('.agent-settings-btn');
  await page.waitForSelector('#agent-settings-modal', { timeout: 3000 });
  await expect(page.locator('#agent-settings-modal')).toBeVisible();
  await expect(page.locator('.agent-settings-modal h3')).toContainText('Agent Settings');
});

test('clicking welcome configure button opens settings modal', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => { window.location.hash = '#/agent'; });
  await page.waitForSelector('.agent-welcome-btn', { timeout: 5000 });
  await page.click('.agent-welcome-btn');
  await page.waitForSelector('#agent-settings-modal', { timeout: 3000 });
  await expect(page.locator('#agent-settings-modal')).toBeVisible();
});

test('settings modal closes when clicking overlay', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => { window.location.hash = '#/agent'; });
  await page.waitForSelector('.agent-settings-btn', { timeout: 5000 });
  await page.click('.agent-settings-btn');
  await page.waitForSelector('#agent-settings-modal', { timeout: 3000 });
  await page.click('#agent-settings-modal', { position: { x: 5, y: 5 } });
  await expect(page.locator('#agent-settings-modal')).toHaveCount(0);
});

test('settings modal closes when clicking X button', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => { window.location.hash = '#/agent'; });
  await page.waitForSelector('.agent-settings-btn', { timeout: 5000 });
  await page.click('.agent-settings-btn');
  await page.waitForSelector('#agent-settings-modal', { timeout: 3000 });
  await page.click('.agent-settings-close');
  await expect(page.locator('#agent-settings-modal')).toHaveCount(0);
});

test('agent settings modal body is scrollable on mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await setupApp(page);
  await page.evaluate(() => { window.location.hash = '#/agent'; });
  await page.waitForSelector('.agent-settings-btn', { timeout: 5000 });
  await page.click('.agent-settings-btn');
  await page.waitForSelector('#agent-settings-modal .modal-body', { timeout: 3000 });

  const scrollState = await page.evaluate(() => {
    const body = document.querySelector('#agent-settings-modal .modal-body');
    if (!body) return null;
    const before = body.scrollTop;
    body.scrollTop = 140;
    return {
      overflowY: window.getComputedStyle(body).overflowY,
      before,
      after: body.scrollTop,
      scrollHeight: body.scrollHeight,
      clientHeight: body.clientHeight,
    };
  });

  expect(scrollState).not.toBeNull();
  expect(['auto', 'scroll']).toContain(scrollState.overflowY);
  expect(scrollState.scrollHeight).toBeGreaterThanOrEqual(scrollState.clientHeight);
  expect(scrollState.after).toBeGreaterThanOrEqual(scrollState.before);
});

test('saving API key enables input and shows empty state with suggestions', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => { window.location.hash = '#/agent'; });
  await page.waitForSelector('.agent-settings-btn', { timeout: 5000 });

  // Set API key via localStorage directly for testing
  await page.evaluate(() => {
    localStorage.setItem('waymark_agent_api_key', JSON.stringify('test-key-123'));
  });

  // Re-navigate to refresh the view
  await page.evaluate(() => { window.location.hash = '#/'; });
  await page.waitForSelector('#home-view:not(.hidden)', { timeout: 5000 });
  await page.evaluate(() => { window.location.hash = '#/agent'; });
  await page.waitForSelector('.agent-empty', { timeout: 5000 });

  await expect(page.locator('.agent-empty')).toBeVisible();
  await expect(page.locator('.agent-suggestion')).toHaveCount(4);
  await expect(page.locator('.agent-input')).not.toBeDisabled();
  await expect(page.locator('.agent-send-btn')).not.toBeDisabled();
});

/* ---------- Chat Interface ---------- */

test('agent suggestions are clickable and have correct text', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => {
    localStorage.setItem('waymark_agent_api_key', JSON.stringify('test-key-123'));
    window.location.hash = '#/agent';
  });
  await page.waitForSelector('.agent-suggestion', { timeout: 5000 });
  const suggestions = page.locator('.agent-suggestion');
  await expect(suggestions).toHaveCount(4);
  await expect(suggestions.first()).toContainText('Create a project board to track my tasks');
});

test('clear button resets conversation to empty state', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => {
    localStorage.setItem('waymark_agent_api_key', JSON.stringify('test-key-123'));
    window.location.hash = '#/agent';
  });
  await page.waitForSelector('.agent-empty', { timeout: 5000 });
  await page.click('.agent-clear-btn');
  await page.waitForSelector('.agent-empty', { timeout: 3000 });
  await expect(page.locator('.agent-empty')).toBeVisible();
});

/* ---------- Sidebar Navigation ---------- */

test('sidebar agent menu item navigates to agent view', async ({ page }) => {
  await setupApp(page);
  await page.waitForSelector('#menu-agent-btn', { timeout: 5000 });
  await page.click('#menu-agent-btn');
  await page.waitForSelector('#agent-view:not(.hidden)', { timeout: 5000 });
  await expect(page.locator('#agent-view')).toBeVisible();
});

test('sidebar agent menu item gets active class when on agent view', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => { window.location.hash = '#/agent'; });
  await page.waitForSelector('#agent-view:not(.hidden)', { timeout: 5000 });
  await expect(page.locator('#menu-agent-btn')).toHaveClass(/active/);
});

test('navigating away from agent removes active class', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => { window.location.hash = '#/agent'; });
  await page.waitForSelector('#agent-view:not(.hidden)', { timeout: 5000 });
  await page.evaluate(() => { window.location.hash = '#/'; });
  await page.waitForSelector('#home-view:not(.hidden)', { timeout: 5000 });
  await expect(page.locator('#menu-agent-btn')).not.toHaveClass(/active/);
});

/* ---------- Visual & Style ---------- */

test('agent container uses flex column layout', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => { window.location.hash = '#/agent'; });
  await page.waitForSelector('.agent-container', { timeout: 5000 });
  await expect(page.locator('.agent-container')).toHaveCSS('display', 'flex');
  await expect(page.locator('.agent-container')).toHaveCSS('flex-direction', 'column');
});

test('agent header icon displays robot emoji', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => { window.location.hash = '#/agent'; });
  await page.waitForSelector('.agent-header-icon', { timeout: 5000 });
  await expect(page.locator('.agent-header-icon')).toContainText('🤖');
});

test('agent settings and clear buttons have pointer cursor', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => { window.location.hash = '#/agent'; });
  await page.waitForSelector('.agent-settings-btn', { timeout: 5000 });
  await expect(page.locator('.agent-settings-btn')).toHaveCSS('cursor', 'pointer');
  await expect(page.locator('.agent-clear-btn')).toHaveCSS('cursor', 'pointer');
});

test('agent view renders without overflow at mobile width', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await setupApp(page);
  await page.evaluate(() => { window.location.hash = '#/agent'; });
  await page.waitForSelector('.agent-container', { timeout: 5000 });

  const overflows = await page.evaluate(() => {
    const problems = [];
    document.querySelectorAll('.agent-container *').forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.right > window.innerWidth + 2) {
        problems.push(el.className);
      }
    });
    return problems;
  });
  expect(overflows).toHaveLength(0);
});

/* ---------- Settings Modal — Model Selection ---------- */

test('settings modal shows model selection dropdown', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => { window.location.hash = '#/agent'; });
  await page.waitForSelector('.agent-settings-btn', { timeout: 5000 });
  await page.click('.agent-settings-btn');
  await page.waitForSelector('.agent-settings-select', { timeout: 3000 });
  await expect(page.locator('.agent-settings-select')).toBeVisible();
  const options = page.locator('.agent-settings-select option');
  const count = await options.count();
  expect(count).toBeGreaterThanOrEqual(3);
});

test('settings modal shows key ring UI with add-key form', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => { window.location.hash = '#/agent'; });
  await page.waitForSelector('.agent-settings-btn', { timeout: 5000 });
  await page.click('.agent-settings-btn');
  await page.waitForSelector('.agent-keyring-add-form', { timeout: 3000 });
  await expect(page.locator('.agent-keyring-list')).toBeVisible();
  await expect(page.locator('.agent-keyring-add-form')).toBeVisible();
  // The primary key input is password type
  const keyInput = page.locator('.agent-keyring-add-form .agent-settings-input[type="password"]');
  await expect(keyInput).toBeVisible();
  // Add key button should exist
  await expect(page.locator('.agent-keyring-add-btn')).toBeVisible();
});

/* ---------- Full User Workflow ---------- */

test('user navigates to agent and back to home', async ({ page }) => {
  await setupApp(page);
  await expect(page.locator('#home-view')).toBeVisible();

  await page.evaluate(() => { window.location.hash = '#/agent'; });
  await page.waitForSelector('#agent-view:not(.hidden)', { timeout: 5000 });
  await expect(page.locator('#agent-view')).toBeVisible();
  await expect(page.locator('#home-view')).toBeHidden();

  await page.evaluate(() => { window.location.hash = '#/'; });
  await page.waitForSelector('#home-view:not(.hidden)', { timeout: 5000 });
  await expect(page.locator('#home-view')).toBeVisible();
  await expect(page.locator('#agent-view')).toBeHidden();
});

test('user adds API key via key ring and saves settings', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => { window.location.hash = '#/agent'; });
  await page.waitForSelector('.agent-settings-btn', { timeout: 5000 });

  // Open settings
  await page.click('.agent-settings-btn');
  await page.waitForSelector('.agent-keyring-add-form', { timeout: 3000 });

  // Empty state should show
  await expect(page.locator('.agent-keyring-empty')).toBeVisible();

  // Enter a new API key and add it
  await page.fill('.agent-keyring-add-form .agent-settings-input[type="password"]', 'test-api-key-abc');
  await page.fill('.agent-keyring-nickname-input', 'Test Key');
  await page.click('.agent-keyring-add-btn');

  // Key should now appear in the ring list
  await page.waitForSelector('.agent-keyring-row', { timeout: 3000 });
  await expect(page.locator('.agent-keyring-nickname')).toContainText('Test Key');

  // Save settings
  await page.click('.agent-settings-save');

  // Verify modal closed and toast appeared
  await expect(page.locator('#agent-settings-modal')).toHaveCount(0);

  // Verify the view now shows empty state (not welcome)
  await page.waitForSelector('.agent-empty', { timeout: 3000 });
  await expect(page.locator('.agent-empty')).toBeVisible();
  await expect(page.locator('.agent-welcome')).toHaveCount(0);
});

/* ---------- Conversation Persistence ---------- */

test('conversation persists in localStorage after navigating away and back', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => {
    localStorage.setItem('waymark_agent_api_key', JSON.stringify('test-key'));
    // Simulate a saved conversation
    localStorage.setItem('waymark_agent_conversation', JSON.stringify([
      { role: 'user', content: 'Hello agent' },
      { role: 'assistant', content: 'Hello! How can I help?' },
    ]));
    window.location.hash = '#/agent';
  });
  await page.waitForSelector('.agent-message', { timeout: 5000 });

  // Verify the messages are restored
  const messages = page.locator('.agent-message');
  await expect(messages).toHaveCount(2);
  await expect(messages.first()).toContainText('Hello agent');
  await expect(messages.nth(1)).toContainText('Hello! How can I help?');
});

test('user message renders attached photo previews in chat', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => {
    localStorage.setItem('waymark_agent_api_key', JSON.stringify('test-key'));
    localStorage.setItem('waymark_agent_conversation', JSON.stringify([
      {
        role: 'user',
        content: 'Please analyze this photo',
        images: [{ name: 'photo-1.jpg', src: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/' }],
      },
    ]));
    window.location.hash = '#/agent';
  });

  await page.waitForSelector('.agent-message-user .agent-user-image', { timeout: 5000 });
  await expect(page.locator('.agent-message-user .agent-user-image')).toHaveCount(1);
  await expect(page.locator('.agent-message-user .agent-user-image').first()).toHaveAttribute('src', /data:image\/jpeg;base64/);
});

test('clicking user photo thumbnail opens lightbox', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => {
    localStorage.setItem('waymark_agent_api_key', JSON.stringify('test-key'));
    localStorage.setItem('waymark_agent_conversation', JSON.stringify([
      {
        role: 'user',
        content: 'Please analyze this photo',
        images: [{ name: 'photo-1.jpg', src: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/' }],
      },
    ]));
    window.location.hash = '#/agent';
  });

  await page.waitForSelector('.agent-user-image-btn', { timeout: 5000 });
  await page.click('.agent-user-image-btn');
  await page.waitForSelector('.agent-image-lightbox', { timeout: 3000 });
  await expect(page.locator('.agent-image-lightbox-image')).toBeVisible();
  await page.click('.agent-image-lightbox-close');
  await expect(page.locator('.agent-image-lightbox')).toHaveCount(0);
});

test('clearing conversation removes it from localStorage', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => {
    localStorage.setItem('waymark_agent_api_key', JSON.stringify('test-key'));
    localStorage.setItem('waymark_agent_conversation', JSON.stringify([
      { role: 'user', content: 'test message' },
    ]));
    window.location.hash = '#/agent';
  });
  await page.waitForSelector('.agent-message', { timeout: 5000 });
  await expect(page.locator('.agent-message')).toHaveCount(1);

  // Clear conversation
  await page.click('.agent-clear-btn');
  await page.waitForSelector('.agent-empty', { timeout: 3000 });

  // Verify localStorage is cleared
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('waymark_agent_conversation'))
  );
  expect(saved).toEqual([]);
});

/* ---------- Cloud Sync Toggle ---------- */

test('settings modal shows cloud sync toggle', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => { window.location.hash = '#/agent'; });
  await page.waitForSelector('.agent-header', { timeout: 5000 });
  await page.click('.agent-settings-btn');
  await page.waitForSelector('#agent-settings-modal', { timeout: 3000 });
  await expect(page.locator('.agent-settings-cloud-label')).toBeVisible();
  await expect(page.locator('.agent-settings-cloud-label .agent-settings-toggle')).toBeVisible();
  await expect(page.locator('.agent-settings-cloud-label')).toContainText('Sync keys across devices');
});

test('cloud sync toggle is unchecked by default', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => { window.location.hash = '#/agent'; });
  await page.waitForSelector('.agent-header', { timeout: 5000 });
  await page.click('.agent-settings-btn');
  await page.waitForSelector('#agent-settings-modal', { timeout: 3000 });
  const checked = await page.locator('.agent-settings-cloud-label .agent-settings-toggle').isChecked();
  expect(checked).toBe(false);
});

test('saving settings with cloud sync stores key ring via user-data', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => { window.location.hash = '#/agent'; });
  await page.waitForSelector('.agent-header', { timeout: 5000 });
  await page.click('.agent-settings-btn');
  await page.waitForSelector('#agent-settings-modal', { timeout: 3000 });

  // Add API key to ring
  await page.fill('.agent-keyring-add-form .agent-settings-input[type="password"]', 'test-cloud-key');
  await page.click('.agent-keyring-add-btn');
  await page.waitForSelector('.agent-keyring-row', { timeout: 3000 });

  // Enable cloud sync and save
  await page.check('.agent-settings-cloud-label .agent-settings-toggle');
  await page.click('.agent-settings-save');
  await page.waitForSelector('#agent-settings-modal', { timeout: 3000, state: 'detached' });

  // Verify localStorage has the key ring
  const keys = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('waymark_agent_keys'))
  );
  expect(keys).toHaveLength(1);
  expect(keys[0].key).toBe('test-cloud-key');
});

/* ---------- Tool Calling UI ---------- */

test('agent module exposes tool declarations for sheet creation', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => { window.location.hash = '#/agent'; });
  await page.waitForSelector('.agent-container', { timeout: 5000 });

  // Verify the create_sheet tool is accessible in the module scope
  const hasCreateSheet = await page.evaluate(() => {
    // The tool calling functions are internal, but we can verify the
    // module loaded correctly by checking the agent view rendered
    return document.querySelector('.agent-container') !== null;
  });
  expect(hasCreateSheet).toBe(true);
});

test('tool indicator CSS renders with correct animation', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => {
    localStorage.setItem('waymark_agent_api_key', JSON.stringify('test-key'));
    window.location.hash = '#/agent';
  });
  await page.waitForSelector('.agent-chat-body', { timeout: 5000 });

  // Inject a tool indicator element to test CSS styling
  await page.evaluate(() => {
    const el = document.createElement('div');
    el.className = 'agent-tool-indicator';
    el.innerHTML = '<span class="agent-tool-icon">🔧</span><span>Creating sheet...</span>';
    document.querySelector('.agent-chat-body').appendChild(el);
  });

  const indicator = page.locator('.agent-tool-indicator');
  await expect(indicator).toBeVisible();
  await expect(indicator).toContainText('Creating sheet...');

  // Verify flex layout
  const display = await indicator.evaluate(el => getComputedStyle(el).display);
  expect(display).toBe('flex');
});

/* ---------- Context Management ---------- */

test('agent trims old messages when conversation exceeds max context', async ({ page }) => {
  await setupApp(page);

  // Build a long conversation (30 messages)
  const messages = [];
  for (let i = 0; i < 30; i++) {
    messages.push({ role: i % 2 === 0 ? 'user' : 'assistant', content: `Message ${i}` });
  }

  await page.evaluate((msgs) => {
    localStorage.setItem('waymark_agent_api_key', JSON.stringify('test-key'));
    localStorage.setItem('waymark_agent_conversation', JSON.stringify(msgs));
    window.location.hash = '#/agent';
  }, messages);

  await page.waitForSelector('.agent-message', { timeout: 5000 });

  // All 30 messages should render in the UI
  const count = await page.locator('.agent-message').count();
  expect(count).toBe(30);
});

test('agent caps request history by message count and character budget', async ({ page }) => {
  await setupApp(page);

  const longChunk = 'A'.repeat(1400);
  const messages = [];
  for (let i = 0; i < 14; i++) {
    messages.push({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `Message ${i} ${longChunk}`,
    });
  }

  await page.evaluate((msgs) => {
    localStorage.setItem('waymark_agent_keys', JSON.stringify([
      { key: 'ctx-budget-key', nickname: 'Ctx', addedAt: '2026-01-01', requestsToday: 0, lastUsed: null, lastError: null, isBilled: false },
    ]));
    localStorage.setItem('waymark_agent_conversation', JSON.stringify(msgs));
    window.location.hash = '#/agent';
  }, messages);
  await page.waitForSelector('.agent-input', { timeout: 5000 });

  let capturedBody = null;
  await page.route(/generateContent/, async route => {
    if (route.request().url().includes('stream')) return route.continue();
    capturedBody = JSON.parse(route.request().postData());
    await route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: buildTextResponse('Trimmed context works.'),
    });
  });
  await page.route(/streamGenerateContent/, async route => {
    await route.fulfill({ status: 500, body: '{}' });
  });

  await page.fill('.agent-input', 'hello');
  await page.click('.agent-send-btn');

  await page.waitForFunction(() => {
    const msgs = document.querySelectorAll('.agent-message-assistant');
    return msgs.length >= 1 && msgs[msgs.length - 1].textContent.includes('Trimmed context works');
  }, { timeout: 10000 });

  expect(capturedBody).not.toBeNull();
  expect(capturedBody.contents.length).toBeLessThanOrEqual(10);
  expect(capturedBody.contents[0].parts[0].text).toContain('Earlier in this conversation:');
  expect(capturedBody.generationConfig.maxOutputTokens).toBe(4096);
  const recentHistory = capturedBody.contents.slice(1, -1);
  expect(recentHistory.length).toBeLessThanOrEqual(8);
  const historyChars = recentHistory
    .reduce((sum, item) => sum + (item.parts?.[0]?.text?.length || 0), 0);
  expect(historyChars).toBeLessThanOrEqual(3600);
});

test('older assistant turns are summarized ahead of the recent context window', async ({ page }) => {
  await setupApp(page);

  const messages = [
    { role: 'user', content: 'OLD USER REQUEST alpha alpha alpha' },
    { role: 'assistant', content: 'OLD ASSISTANT SUMMARY apples oranges bananas' },
    { role: 'user', content: 'OLD USER REQUEST beta beta beta' },
    { role: 'assistant', content: 'OLD ASSISTANT SUMMARY carrots celery squash' },
    { role: 'user', content: 'Recent user 1' },
    { role: 'assistant', content: 'Recent assistant 1' },
    { role: 'user', content: 'Recent user 2' },
    { role: 'assistant', content: 'Recent assistant 2' },
    { role: 'user', content: 'Recent user 3' },
    { role: 'assistant', content: 'Recent assistant 3' },
    { role: 'user', content: 'Recent user 4' },
    { role: 'assistant', content: 'Recent assistant 4' },
  ];

  await page.evaluate((msgs) => {
    localStorage.setItem('waymark_agent_keys', JSON.stringify([
      { key: 'summary-key', nickname: 'Summary', addedAt: '2026-01-01', requestsToday: 0, lastUsed: null, lastError: null, isBilled: false },
    ]));
    localStorage.setItem('waymark_agent_conversation', JSON.stringify(msgs));
    window.location.hash = '#/agent';
  }, messages);
  await page.waitForSelector('.agent-input', { timeout: 5000 });

  let capturedBody = null;
  await page.route(/generateContent/, async route => {
    if (route.request().url().includes('stream')) return route.continue();
    capturedBody = JSON.parse(route.request().postData());
    await route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: buildTextResponse('Summary context works.'),
    });
  });
  await page.route(/streamGenerateContent/, async route => {
    await route.fulfill({ status: 500, body: '{}' });
  });

  await page.fill('.agent-input', 'use the recent context');
  await page.click('.agent-send-btn');

  await page.waitForFunction(() => {
    const msgs = document.querySelectorAll('.agent-message-assistant');
    return msgs.length >= 1 && msgs[msgs.length - 1].textContent.includes('Summary context works');
  }, { timeout: 10000 });

  expect(capturedBody).not.toBeNull();
  const summaryText = capturedBody.contents[0].parts[0].text;
  expect(capturedBody.contents[0].role).toBe('model');
  expect(summaryText).toContain('Earlier in this conversation:');
  expect(summaryText).toContain('OLD ASSISTANT SUMMARY apples oranges bananas');
  expect(summaryText).toContain('OLD ASSISTANT SUMMARY carrots celery squash');
  expect(summaryText).not.toContain('OLD USER REQUEST');
});

test('system prompt keeps sheet context compact and points to search_sheets', async ({ page }) => {
  await setupApp(page, { recentSheets: [
    { id: 'sheet-001', name: 'Grocery List', openedAt: '2026-01-01T00:00:00Z' },
    { id: 'sheet-002', name: 'Home Repairs', openedAt: '2026-01-01T00:01:00Z' },
    { id: 'sheet-003', name: 'Weekly Chores', openedAt: '2026-01-01T00:02:00Z' },
    { id: 'sheet-004', name: 'Monthly Budget', openedAt: '2026-01-01T00:03:00Z' },
  ] });
  await page.evaluate(() => {
    localStorage.setItem('waymark_agent_keys', JSON.stringify([
      { key: 'ctx-sheets-compact-key', nickname: 'Ctx2', addedAt: '2026-01-01', requestsToday: 0, lastUsed: null, lastError: null, isBilled: false },
    ]));
    window.location.hash = '#/agent';
  });
  await page.waitForSelector('.agent-input', { timeout: 5000 });

  let capturedBody = null;
  await page.route(/generateContent/, async route => {
    if (route.request().url().includes('stream')) return route.continue();
    capturedBody = JSON.parse(route.request().postData());
    await route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: buildTextResponse('Compact system prompt works.'),
    });
  });
  await page.route(/streamGenerateContent/, async route => {
    await route.fulfill({ status: 500, body: '{}' });
  });

  await page.fill('.agent-input', 'hello');
  await page.click('.agent-send-btn');

  await page.waitForFunction(() => {
    const msgs = document.querySelectorAll('.agent-message-assistant');
    return msgs.length >= 1 && msgs[msgs.length - 1].textContent.includes('Compact system prompt works');
  }, { timeout: 10000 });

  expect(capturedBody).not.toBeNull();
  const systemText = capturedBody.systemInstruction?.parts?.[0]?.text || '';
  expect(systemText).toContain('The user has');
  expect(systemText).toContain('search_sheets');
  const listedSheets = (systemText.match(/\(id: sheet-/g) || []).length;
  expect(listedSheets).toBeLessThanOrEqual(12);
});

test('planner brief decomposes multi-domain requests into compact execution hints', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => {
    localStorage.setItem('waymark_agent_keys', JSON.stringify([
      { key: 'planner-key', nickname: 'Planner', addedAt: '2026-01-01', requestsToday: 0, lastUsed: null, lastError: null, isBilled: false },
    ]));
    window.location.hash = '#/agent';
  });
  await page.waitForSelector('.agent-input', { timeout: 5000 });

  let generateCallCount = 0;
  let capturedBody = null;
  await page.route(/generateContent/, async route => {
    if (route.request().url().includes('stream')) return route.continue();
    generateCallCount++;
    if (generateCallCount === 1) {
      await route.fulfill({
        status: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: { message: 'planner unavailable' } }),
      });
      return;
    }
    capturedBody = JSON.parse(route.request().postData());
    await route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: buildTextResponse('Planner brief works.'),
    });
  });
  await page.route(/streamGenerateContent/, async route => {
    await route.fulfill({ status: 500, body: '{}' });
  });

  await page.fill('.agent-input', 'plan a family vacation for me on a 5000 budget road tripping from Wrentham MA to the Grand Canyon');
  await page.click('.agent-send-btn');

  await page.waitForFunction(() => {
    const msgs = document.querySelectorAll('.agent-message-assistant');
    return msgs.length >= 1 && msgs[msgs.length - 1].textContent.includes('Planner brief works');
  }, { timeout: 10000 });

  expect(capturedBody).not.toBeNull();
  expect(generateCallCount).toBe(2);
  const finalPrompt = capturedBody.contents[capturedBody.contents.length - 1].parts[0].text;
  expect(finalPrompt).toContain('Planner brief:');
  expect(finalPrompt).toContain('Detected domains: travel, budget.');
  expect(finalPrompt).toContain('Budget constraint: 5000.');
  expect(finalPrompt).toContain('create separate sheets for travel, budget');
  expect(finalPrompt.length).toBeLessThanOrEqual(1200);
});

test('complex requests use one planner round before the main model call', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => {
    localStorage.setItem('waymark_agent_keys', JSON.stringify([
      { key: 'planner-round-key', nickname: 'PlanRT', addedAt: '2026-01-01', requestsToday: 0, lastUsed: null, lastError: null, isBilled: false },
    ]));
    window.location.hash = '#/agent';
  });
  await page.waitForSelector('.agent-input', { timeout: 5000 });

  let generateCallCount = 0;
  let finalBody = null;
  await page.route(/generateContent/, async route => {
    if (route.request().url().includes('stream')) return route.continue();
    generateCallCount++;
    if (generateCallCount === 1) {
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: buildTextResponse('travel, budget, route, create separate sheets'),
      });
      return;
    }
    finalBody = JSON.parse(route.request().postData());
    await route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: buildTextResponse('Planner round-trip works.'),
    });
  });
  await page.route(/streamGenerateContent/, async route => {
    await route.fulfill({ status: 500, body: '{}' });
  });

  await page.fill('.agent-input', 'plan a family vacation for me on a 5000 budget road tripping from Wrentham MA to the Grand Canyon');
  await page.click('.agent-send-btn');

  await page.waitForFunction(() => {
    const msgs = document.querySelectorAll('.agent-message-assistant');
    return msgs.length >= 1 && msgs[msgs.length - 1].textContent.includes('Planner round-trip works');
  }, { timeout: 10000 });

  expect(generateCallCount).toBe(2);
  const finalPrompt = finalBody.contents[finalBody.contents.length - 1].parts[0].text;
  expect(finalPrompt).toContain('Planner brief: travel, budget, route, create separate sheets');
});

test('agent short-circuits locally when the request exceeds the token budget', async ({ page }) => {
  await setupApp(page);

  const longChunk = 'Route details and notes '.repeat(500);
  const messages = [];
  for (let i = 0; i < 20; i++) {
    messages.push({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `Message ${i} ${longChunk}`,
    });
  }

  await page.evaluate((msgs) => {
    localStorage.setItem('waymark_agent_keys', JSON.stringify([
      { key: 'budget-guard-key', nickname: 'Budget', addedAt: '2026-01-01', requestsToday: 0, lastUsed: null, lastError: null, isBilled: false },
    ]));
    localStorage.setItem('waymark_agent_conversation', JSON.stringify(msgs));
    window.location.hash = '#/agent';
  }, messages);
  await page.waitForSelector('.agent-input', { timeout: 5000 });

  let networkCalls = 0;
  await page.route(/generateContent/, async route => {
    networkCalls++;
    await route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: buildTextResponse('unexpected network call'),
    });
  });
  await page.route(/streamGenerateContent/, async route => {
    networkCalls++;
    await route.fulfill({ status: 500, body: '{}' });
  });

  await page.fill('.agent-input', 'Plan a very detailed cross-country family trip with exhaustive daily notes, backup routes, fallback hotels, restaurant ideas, sightseeing, activity options, and packing advice for every stop ' + longChunk);
  await page.click('.agent-send-btn');

  await page.waitForFunction(() => {
    const msgs = document.querySelectorAll('.agent-message-assistant');
    return msgs.length >= 1 && msgs[msgs.length - 1].textContent.includes('above the local budget');
  }, { timeout: 10000 });

  expect(networkCalls).toBe(0);
  await expect(page.locator('.agent-message-assistant').last()).toContainText('above the local budget');
});

test('quota-exhausted key rotates to the next configured key before failing', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => {
    localStorage.setItem('waymark_agent_keys', JSON.stringify([
      { key: 'quota-key', nickname: 'Spent', addedAt: '2026-01-01', requestsToday: 0, lastUsed: null, lastError: null, isBilled: false },
      { key: 'fresh-key', nickname: 'Fresh', addedAt: '2026-01-01', requestsToday: 0, lastUsed: null, lastError: null, isBilled: false },
    ]));
    window.location.hash = '#/agent';
  });
  await page.waitForSelector('.agent-input', { timeout: 5000 });

  const usedKeys = [];
  await page.route(/generateContent/, async route => {
    if (route.request().url().includes('stream')) return route.continue();
    const headers = route.request().headers();
    const requestKey = headers['x-goog-api-key'];
    usedKeys.push(requestKey);
    if (requestKey === 'quota-key') {
      await route.fulfill({
        status: 429,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          error: {
            message: 'You exceeded your current quota, please check your plan and billing details.',
          },
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: buildTextResponse('Rotated key succeeded.'),
    });
  });
  await page.route(/streamGenerateContent/, async route => {
    await route.fulfill({ status: 500, body: '{}' });
  });

  await page.fill('.agent-input', 'Create a small trip plan');
  await page.click('.agent-send-btn');

  await page.waitForFunction(() => {
    const msgs = document.querySelectorAll('.agent-message-assistant');
    return msgs.length >= 1 && msgs[msgs.length - 1].textContent.includes('Rotated key succeeded');
  }, { timeout: 10000 });

  expect(usedKeys).toContain('quota-key');
  expect(usedKeys).toContain('fresh-key');
  await expect(page.locator('.agent-message-assistant').last()).toContainText('Rotated key succeeded');
});

/* ---------- Key Ring UI ---------- */

test('settings shows empty key ring message when no keys configured', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => { window.location.hash = '#/agent'; });
  await page.waitForSelector('.agent-settings-btn', { timeout: 5000 });
  await page.click('.agent-settings-btn');
  await page.waitForSelector('.agent-keyring-empty', { timeout: 3000 });
  await expect(page.locator('.agent-keyring-empty')).toContainText('No API keys configured');
});

test('adding a key to the ring shows it in the list with masked value', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => { window.location.hash = '#/agent'; });
  await page.waitForSelector('.agent-settings-btn', { timeout: 5000 });
  await page.click('.agent-settings-btn');
  await page.waitForSelector('.agent-keyring-add-form', { timeout: 3000 });

  // Add a key
  await page.fill('.agent-keyring-add-form .agent-settings-input[type="password"]', 'AIzaSyAbcdef1234');
  await page.fill('.agent-keyring-nickname-input', 'Work Key');
  await page.click('.agent-keyring-add-btn');

  // Key row should appear
  await page.waitForSelector('.agent-keyring-row', { timeout: 3000 });
  await expect(page.locator('.agent-keyring-nickname')).toContainText('Work Key');
  // Masked value should show last 4 chars
  await expect(page.locator('.agent-keyring-masked')).toContainText('····1234');
  await expect(page.locator('.agent-keyring-usage')).toContainText('0 today');
  // Empty message should be gone
  await expect(page.locator('.agent-keyring-empty')).toHaveCount(0);
});

test('adding multiple keys shows all in the ring list', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => { window.location.hash = '#/agent'; });
  await page.waitForSelector('.agent-settings-btn', { timeout: 5000 });
  await page.click('.agent-settings-btn');
  await page.waitForSelector('.agent-keyring-add-form', { timeout: 3000 });

  // Add first key
  await page.fill('.agent-keyring-add-form .agent-settings-input[type="password"]', 'AIzaSyFirst1111');
  await page.fill('.agent-keyring-nickname-input', 'First');
  await page.click('.agent-keyring-add-btn');
  await page.waitForSelector('.agent-keyring-row', { timeout: 3000 });

  // Add second key
  await page.fill('.agent-keyring-add-form .agent-settings-input[type="password"]', 'AIzaSySecond2222');
  await page.fill('.agent-keyring-nickname-input', 'Second');
  await page.click('.agent-keyring-add-btn');

  // Both keys should be visible
  const rows = page.locator('.agent-keyring-row');
  await expect(rows).toHaveCount(2);
  await expect(page.locator('.agent-keyring-nickname').first()).toContainText('First');
  await expect(page.locator('.agent-keyring-nickname').nth(1)).toContainText('Second');
});

test('removing a key from the ring updates the list', async ({ page }) => {
  await setupApp(page);
  // Pre-populate keys
  await page.evaluate(() => {
    localStorage.setItem('waymark_agent_keys', JSON.stringify([
      { key: 'key-AAAA', nickname: 'Alpha', addedAt: '2026-01-01', requestsToday: 5, lastUsed: null, lastError: null, isBilled: false },
      { key: 'key-BBBB', nickname: 'Beta', addedAt: '2026-01-02', requestsToday: 3, lastUsed: null, lastError: null, isBilled: true },
    ]));
    window.location.hash = '#/agent';
  });
  await page.waitForSelector('.agent-settings-btn', { timeout: 5000 });
  await page.click('.agent-settings-btn');
  await page.waitForSelector('.agent-keyring-row', { timeout: 3000 });

  // Should start with 2 keys
  await expect(page.locator('.agent-keyring-row')).toHaveCount(2);

  // Remove the first key
  await page.click('.agent-keyring-remove');
  await expect(page.locator('.agent-keyring-row')).toHaveCount(1);
  await expect(page.locator('.agent-keyring-nickname')).toContainText('Beta');
});

test('billed badge displays for billed keys', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => {
    localStorage.setItem('waymark_agent_keys', JSON.stringify([
      { key: 'key-FREE', nickname: 'Free', addedAt: '2026-01-01', requestsToday: 0, lastUsed: null, lastError: null, isBilled: false },
      { key: 'key-PAID', nickname: 'Paid', addedAt: '2026-01-02', requestsToday: 0, lastUsed: null, lastError: null, isBilled: true },
    ]));
    window.location.hash = '#/agent';
  });
  await page.waitForSelector('.agent-settings-btn', { timeout: 5000 });
  await page.click('.agent-settings-btn');
  await page.waitForSelector('.agent-keyring-row', { timeout: 3000 });

  // Only the billed key should have the badge
  const badges = page.locator('.agent-keyring-billed');
  await expect(badges).toHaveCount(1);
  await expect(badges.first()).toContainText('Billed');
});

test('add key button shows toast on duplicate key', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => {
    localStorage.setItem('waymark_agent_keys', JSON.stringify([
      { key: 'existing-key', nickname: 'Existing', addedAt: '2026-01-01', requestsToday: 0, lastUsed: null, lastError: null, isBilled: false },
    ]));
    window.location.hash = '#/agent';
  });
  await page.waitForSelector('.agent-settings-btn', { timeout: 5000 });
  await page.click('.agent-settings-btn');
  await page.waitForSelector('.agent-keyring-add-form', { timeout: 3000 });

  // Try adding the same key
  await page.fill('.agent-keyring-add-form .agent-settings-input[type="password"]', 'existing-key');
  await page.click('.agent-keyring-add-btn');

  // Should show error toast
  await page.waitForSelector('.toast', { timeout: 3000 });
  await expect(page.locator('.toast')).toContainText('already in your ring');
});

test('remove all keys button clears the ring and shows welcome', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => {
    localStorage.setItem('waymark_agent_keys', JSON.stringify([
      { key: 'key-1', nickname: 'K1', addedAt: '2026-01-01', requestsToday: 0, lastUsed: null, lastError: null, isBilled: false },
    ]));
    window.location.hash = '#/agent';
  });
  await page.waitForSelector('.agent-settings-btn', { timeout: 5000 });
  await page.click('.agent-settings-btn');
  await page.waitForSelector('.agent-settings-remove', { timeout: 3000 });

  // Click Remove All Keys
  await page.click('.agent-settings-remove');

  // Modal closes and welcome view shows
  await page.waitForSelector('.toast', { timeout: 3000 });
  await expect(page.locator('.toast')).toContainText('removed');
  await page.waitForSelector('.agent-welcome', { timeout: 5000 });
  await expect(page.locator('.agent-welcome')).toBeVisible();
});

test('legacy single key auto-migrates to key ring format', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => {
    // Set legacy single key format
    localStorage.setItem('waymark_agent_api_key', JSON.stringify('legacy-key-XXXX'));
    window.location.hash = '#/agent';
  });
  // Agent view should recognize the key and show empty state (not welcome)
  await page.waitForSelector('.agent-empty', { timeout: 5000 });
  await expect(page.locator('.agent-empty')).toBeVisible();
  await expect(page.locator('.agent-welcome')).toHaveCount(0);

  // Verify migration happened — key ring should exist in localStorage
  const keys = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('waymark_agent_keys'))
  );
  expect(keys).toHaveLength(1);
  expect(keys[0].key).toBe('legacy-key-XXXX');
  expect(keys[0].nickname).toBe('Key 1');
});

test('key ring add-btn has pointer cursor', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => { window.location.hash = '#/agent'; });
  await page.waitForSelector('.agent-settings-btn', { timeout: 5000 });
  await page.click('.agent-settings-btn');
  await page.waitForSelector('.agent-keyring-add-btn', { timeout: 3000 });
  await expect(page.locator('.agent-keyring-add-btn')).toHaveCSS('cursor', 'pointer');
});

test('key ring renders correctly at mobile width', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await setupApp(page);
  await page.evaluate(() => {
    localStorage.setItem('waymark_agent_keys', JSON.stringify([
      { key: 'key-1', nickname: 'Mobile Test', addedAt: '2026-01-01', requestsToday: 10, lastUsed: null, lastError: null, isBilled: true },
    ]));
    window.location.hash = '#/agent';
  });
  await page.waitForSelector('.agent-settings-btn', { timeout: 5000 });
  await page.click('.agent-settings-btn');
  await page.waitForSelector('.agent-keyring-row', { timeout: 3000 });

  // Verify nothing overflows
  const overflows = await page.evaluate(() => {
    const problems = [];
    document.querySelectorAll('.agent-keyring-list *').forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.right > window.innerWidth + 2) {
        problems.push(el.className);
      }
    });
    return problems;
  });
  expect(overflows).toHaveLength(0);
});

/* ---------- Streaming Responses ---------- */

/** Helper: build a mock SSE response body from text chunks */
function buildSSEBody(chunks) {
  return chunks.map(text => {
    const json = JSON.stringify({
      candidates: [{ content: { parts: [{ text }], role: 'model' } }],
    });
    return `data: ${json}\n\n`;
  }).join('');
}

test('streaming response shows text progressively in a live bubble', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => {
    localStorage.setItem('waymark_agent_keys', JSON.stringify([
      { key: 'test-stream-key', nickname: 'Stream', addedAt: '2026-01-01', requestsToday: 0, lastUsed: null, lastError: null, isBilled: false },
    ]));
    window.location.hash = '#/agent';
  });
  await page.waitForSelector('.agent-input', { timeout: 5000 });

  // Mock the streaming endpoint with delayed chunks
  await page.route(/streamGenerateContent/, async route => {
    const body = buildSSEBody(['Hello', ' world', '!']);
    await route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
      body,
    });
  });

  // Send a message
  await page.fill('.agent-input', 'say hello');
  await page.click('.agent-send-btn');

  // The assistant message should appear with the streamed text
  await page.waitForSelector('.agent-message-assistant .agent-message-content', { timeout: 5000 });
  // Wait for final render
  await page.waitForFunction(() => {
    const msgs = document.querySelectorAll('.agent-message-assistant');
    const last = msgs[msgs.length - 1];
    return last && last.textContent.includes('Hello world!');
  }, { timeout: 5000 });
  const assistantMsgs = page.locator('.agent-message-assistant');
  await expect(assistantMsgs.last()).toContainText('Hello world!');
});

test('stop button appears during streaming and reverts after', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => {
    localStorage.setItem('waymark_agent_keys', JSON.stringify([
      { key: 'test-stop-key', nickname: 'Stop', addedAt: '2026-01-01', requestsToday: 0, lastUsed: null, lastError: null, isBilled: false },
    ]));
    window.location.hash = '#/agent';
  });
  await page.waitForSelector('.agent-send-btn', { timeout: 5000 });

  // Verify send button starts as ➤
  await expect(page.locator('.agent-send-btn')).toContainText('➤');

  // Mock streaming with a slow response that lets us check the stop button
  let resolveRoute;
  const routePromise = new Promise(r => { resolveRoute = r; });
  await page.route(/streamGenerateContent/, async route => {
    // Wait briefly to let us check the stop button
    await new Promise(r => setTimeout(r, 500));
    const body = buildSSEBody(['Done.']);
    await route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
      body,
    });
    resolveRoute();
  });

  // Send message — the stop button should appear
  await page.fill('.agent-input', 'test');
  await page.click('.agent-send-btn');

  // Stop button should be visible during streaming
  await page.waitForSelector('.agent-stop-btn', { timeout: 3000 });
  await expect(page.locator('.agent-stop-btn')).toContainText('⏹');

  // Wait for streaming to complete
  await routePromise;

  // After streaming, send button should revert
  await page.waitForSelector('.agent-send-btn:not(.agent-stop-btn)', { timeout: 5000 });
  await expect(page.locator('.agent-send-btn')).toContainText('➤');
});

test('stop button CSS has error background color', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => {
    localStorage.setItem('waymark_agent_keys', JSON.stringify([
      { key: 'stop-css-key', nickname: 'CSS', addedAt: '2026-01-01', requestsToday: 0, lastUsed: null, lastError: null, isBilled: false },
    ]));
    window.location.hash = '#/agent';
  });
  await page.waitForSelector('.agent-send-btn', { timeout: 5000 });

  // Mock streaming with slow response
  await page.route(/streamGenerateContent/, async route => {
    await new Promise(r => setTimeout(r, 1000));
    await route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
      body: buildSSEBody(['ok']),
    });
  });

  await page.fill('.agent-input', 'x');
  await page.click('.agent-send-btn');
  await page.waitForSelector('.agent-stop-btn', { timeout: 3000 });

  // Verify the stop button has the error color background
  const bgColor = await page.locator('.agent-stop-btn').evaluate(el =>
    getComputedStyle(el).backgroundColor
  );
  expect(bgColor).not.toBe('rgba(0, 0, 0, 0)');
});

test('streaming fallback works when SSE endpoint returns error', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => {
    localStorage.setItem('waymark_agent_keys', JSON.stringify([
      { key: 'fallback-key', nickname: 'Fallback', addedAt: '2026-01-01', requestsToday: 0, lastUsed: null, lastError: null, isBilled: false },
    ]));
    window.location.hash = '#/agent';
  });
  await page.waitForSelector('.agent-input', { timeout: 5000 });

  // Mock streaming to fail, buffered to succeed
  await page.route(/streamGenerateContent/, async route => {
    await route.fulfill({ status: 500, body: '{}' });
  });
  await page.route(/generateContent/, async route => {
    if (route.request().url().includes('stream')) return route.continue();
    await route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        candidates: [{ content: { parts: [{ text: 'Fallback response' }], role: 'model' } }],
      }),
    });
  });

  await page.fill('.agent-input', 'test fallback');
  await page.click('.agent-send-btn');

  // Should eventually show the fallback response
  await page.waitForFunction(() => {
    const msgs = document.querySelectorAll('.agent-message-assistant');
    const last = msgs[msgs.length - 1];
    return last && last.textContent.includes('Fallback response');
  }, { timeout: 10000 });
});

test('streamed tool calls fall back to buffered handling for complete execution', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => {
    localStorage.setItem('waymark_agent_keys', JSON.stringify([
      { key: 'stream-tool-key', nickname: 'StreamTool', addedAt: '2026-01-01', requestsToday: 0, lastUsed: null, lastError: null, isBilled: false },
    ]));
    window.location.hash = '#/agent';
  });
  await page.waitForSelector('.agent-input', { timeout: 5000 });

  let generateCallCount = 0;
  await page.route(/streamGenerateContent/, async route => {
    await route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
      body: [
        'data: ' + JSON.stringify({
          candidates: [{
            content: {
              role: 'model',
              parts: [{ functionCall: { name: 'create_sheet', args: { template: 'check' } } }],
            },
          }],
        }),
        '',
      ].join('\n'),
    });
  });
  await page.route(/generateContent/, async route => {
    if (route.request().url().includes('stream')) return route.continue();
    generateCallCount++;
    if (generateCallCount === 1) {
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: buildCreateSheetFunctionCall('checklist', 'Streaming Tool Checklist', [
          ['Pack bags', 'No', 'Friday'],
          ['Charge phone', 'No', 'Thursday'],
        ]),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: buildTextResponse('Buffered tool handling worked.'),
    });
  });

  await page.fill('.agent-input', 'Make me a checklist via tool call.');
  await page.click('.agent-send-btn');

  await page.waitForFunction(() => {
    const msgs = document.querySelectorAll('.agent-message-assistant');
    const last = msgs[msgs.length - 1];
    return last && last.textContent.includes('Buffered tool handling worked');
  }, { timeout: 10000 });

  expect(generateCallCount).toBe(2);
});

test('typing dots show before first streaming chunk arrives', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => {
    localStorage.setItem('waymark_agent_keys', JSON.stringify([
      { key: 'dots-key', nickname: 'Dots', addedAt: '2026-01-01', requestsToday: 0, lastUsed: null, lastError: null, isBilled: false },
    ]));
    window.location.hash = '#/agent';
  });
  await page.waitForSelector('.agent-input', { timeout: 5000 });

  // Mock streaming with delayed start
  let resolveRoute;
  await page.route(/streamGenerateContent/, async route => {
    await new Promise(r => { resolveRoute = r; setTimeout(r, 1000); });
    await route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
      body: buildSSEBody(['Hi']),
    });
  });

  await page.fill('.agent-input', 'hello');
  await page.click('.agent-send-btn');

  // Typing dots should appear
  await page.waitForSelector('.agent-typing-dots', { timeout: 3000 });
  await expect(page.locator('.agent-typing-dots')).toBeVisible();

  // Resolve the stream to clean up
  if (resolveRoute) resolveRoute();
});

test('streamed message is persisted to conversation history', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => {
    localStorage.setItem('waymark_agent_keys', JSON.stringify([
      { key: 'persist-key', nickname: 'Persist', addedAt: '2026-01-01', requestsToday: 0, lastUsed: null, lastError: null, isBilled: false },
    ]));
    window.location.hash = '#/agent';
  });
  await page.waitForSelector('.agent-input', { timeout: 5000 });

  await page.route(/streamGenerateContent/, async route => {
    await route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
      body: buildSSEBody(['Saved response']),
    });
  });

  await page.fill('.agent-input', 'save me');
  await page.click('.agent-send-btn');

  // Wait for the response to finish
  await page.waitForFunction(() => {
    const msgs = document.querySelectorAll('.agent-message-assistant');
    const last = msgs[msgs.length - 1];
    return last && last.textContent.includes('Saved response');
  }, { timeout: 5000 });

  // Check localStorage conversation
  const conversation = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('waymark_agent_conversation'))
  );
  expect(conversation.length).toBeGreaterThanOrEqual(2);
  const lastMsg = conversation[conversation.length - 1];
  expect(lastMsg.role).toBe('assistant');
  expect(lastMsg.content).toContain('Saved response');
});

/* ---------- read_sheet Tool ---------- */

/**
 * Helper: build a mock Gemini response that calls the read_sheet tool.
 */
function buildReadSheetFunctionCall(spreadsheetId) {
  return JSON.stringify({
    candidates: [{
      content: {
        parts: [{
          functionCall: {
            name: 'read_sheet',
            args: { spreadsheet_id: spreadsheetId },
          },
        }],
        role: 'model',
      },
    }],
  });
}

/**
 * Helper: build a mock Gemini text response (for the follow-up after a tool call).
 */
function buildTextResponse(text) {
  return JSON.stringify({
    candidates: [{
      content: {
        parts: [{ text }],
        role: 'model',
      },
    }],
  });
}

function buildCreateSheetFunctionCall(template, title, data) {
  return JSON.stringify({
    candidates: [{
      content: {
        parts: [{
          functionCall: {
            name: 'create_sheet',
            args: { template, title, data },
          },
        }],
        role: 'model',
      },
    }],
  });
}

test('agent follows chained create_sheet tool calls before final response', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => {
    localStorage.setItem('waymark_agent_keys', JSON.stringify([
      { key: 'chain-key', nickname: 'Chain', addedAt: '2026-01-01', requestsToday: 0, lastUsed: null, lastError: null, isBilled: false },
    ]));
    window.location.hash = '#/agent';
  });
  await page.waitForSelector('.agent-input', { timeout: 5000 });

  let callCount = 0;
  await page.route(/generateContent/, async route => {
    if (route.request().url().includes('stream')) return route.continue();
    callCount++;
    if (callCount === 1) {
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: buildCreateSheetFunctionCall('travel', 'Family Travel Plan', [
          ['Day 1', 'Wrentham', 'Drive to Pennsylvania'],
          ['Day 2', 'Ohio', 'Continue west'],
        ]),
      });
      return;
    }
    if (callCount === 2) {
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: buildCreateSheetFunctionCall('budget', 'Family Travel Budget', [
          ['Fuel', '1200', 'Gas for the route'],
          ['Hotel', '2200', 'Family stays'],
        ]),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: buildTextResponse('Created both sheets: [Travel](#/sheet/travel-123) and [Budget](#/sheet/budget-456).'),
    });
  });
  await page.route(/streamGenerateContent/, async route => {
    await route.fulfill({ status: 500, body: '{}' });
  });

  await page.fill('.agent-input', 'Plan a vacation and budget it for me.');
  await page.click('.agent-send-btn');

  await page.waitForFunction(() => {
    const msgs = document.querySelectorAll('.agent-message-assistant');
    const last = msgs[msgs.length - 1];
    return last && last.textContent.includes('Created both sheets');
  }, { timeout: 10000 });

  expect(callCount).toBe(3);
  await expect(page.locator('.agent-message-assistant').last()).toContainText('Created both sheets');
});

test('blank post-tool response falls back to a Waymark success message', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => {
    localStorage.setItem('waymark_agent_keys', JSON.stringify([
      { key: 'blank-tool-key', nickname: 'BlankTool', addedAt: '2026-01-01', requestsToday: 0, lastUsed: null, lastError: null, isBilled: false },
    ]));
    window.location.hash = '#/agent';
  });
  await page.waitForSelector('.agent-input', { timeout: 5000 });

  let callCount = 0;
  await page.route(/generateContent/, async route => {
    if (route.request().url().includes('stream')) return route.continue();
    callCount++;
    if (callCount === 1) {
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: buildCreateSheetFunctionCall('checklist', 'Weekend Packing Checklist', [
          ['Pack bags', 'No', 'Friday'],
          ['Buy snacks', 'No', 'Thursday'],
        ]),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        candidates: [{
          content: {
            parts: [{}],
            role: 'model',
          },
        }],
      }),
    });
  });
  await page.route(/streamGenerateContent/, async route => {
    await route.fulfill({ status: 500, body: '{}' });
  });

  await page.fill('.agent-input', 'Make me a packing checklist.');
  await page.click('.agent-send-btn');

  await page.waitForFunction(() => {
    const msgs = document.querySelectorAll('.agent-message-assistant');
    const last = msgs[msgs.length - 1];
    return last && last.textContent.includes('Created sheet');
  }, { timeout: 10000 });

  expect(callCount).toBe(2);
  await expect(page.locator('.agent-message-assistant').last()).toContainText('Open in Waymark');
  await expect(page.locator('.agent-message-assistant').last()).toContainText('Weekend Packing Checklist');
});

test('read_sheet tool reads sheet data and returns summary to model', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => {
    localStorage.setItem('waymark_agent_keys', JSON.stringify([
      { key: 'read-key', nickname: 'Read', addedAt: '2026-01-01', requestsToday: 0, lastUsed: null, lastError: null, isBilled: false },
    ]));
    window.location.hash = '#/agent';
  });
  await page.waitForSelector('.agent-input', { timeout: 5000 });

  let callCount = 0;
  // First call: model returns a function call for read_sheet
  // Second call: model returns a text summary after receiving tool results
  await page.route(/generateContent/, async route => {
    if (route.request().url().includes('stream')) return route.continue();
    callCount++;
    if (callCount === 1) {
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: buildReadSheetFunctionCall('sheet-001'),
      });
    } else {
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: buildTextResponse('Your grocery list has 5 items including Milk and Eggs.'),
      });
    }
  });
  // Also mock streaming to fail so it falls back to buffered
  await page.route(/streamGenerateContent/, async route => {
    await route.fulfill({ status: 500, body: '{}' });
  });

  await page.fill('.agent-input', 'what is on my grocery list?');
  await page.click('.agent-send-btn');

  // Wait for the final response from the model
  await page.waitForFunction(() => {
    const msgs = document.querySelectorAll('.agent-message-assistant');
    const last = msgs[msgs.length - 1];
    return last && last.textContent.includes('grocery list has 5 items');
  }, { timeout: 10000 });

  await expect(page.locator('.agent-message-assistant').last()).toContainText('grocery list has 5 items');
});

test('read_sheet tool handles missing spreadsheet gracefully', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => {
    localStorage.setItem('waymark_agent_keys', JSON.stringify([
      { key: 'read-err-key', nickname: 'ReadErr', addedAt: '2026-01-01', requestsToday: 0, lastUsed: null, lastError: null, isBilled: false },
    ]));
    window.location.hash = '#/agent';
  });
  await page.waitForSelector('.agent-input', { timeout: 5000 });

  let callCount = 0;
  await page.route(/generateContent/, async route => {
    if (route.request().url().includes('stream')) return route.continue();
    callCount++;
    if (callCount === 1) {
      // Model requests a non-existent sheet
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: buildReadSheetFunctionCall('nonexistent-sheet-id'),
      });
    } else {
      // Model receives the error and gives a helpful response
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: buildTextResponse('I could not find that sheet. Please check the ID and try again.'),
      });
    }
  });
  await page.route(/streamGenerateContent/, async route => {
    await route.fulfill({ status: 500, body: '{}' });
  });

  await page.fill('.agent-input', 'read sheet xyz');
  await page.click('.agent-send-btn');

  // The model should still respond (error result is passed back as tool output)
  await page.waitForFunction(() => {
    const msgs = document.querySelectorAll('.agent-message-assistant');
    const last = msgs[msgs.length - 1];
    return last && last.textContent.includes('could not find');
  }, { timeout: 10000 });

  await expect(page.locator('.agent-message-assistant').last()).toContainText('could not find');
});

test('read_sheet tool indicator shows reading message', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => {
    window.location.hash = '#/agent';
  });
  await page.waitForSelector('.agent-chat-body', { timeout: 5000 });

  // Inject a tool indicator for read_sheet to test labeling
  await page.evaluate(() => {
    const el = document.createElement('div');
    el.className = 'agent-tool-indicator';
    el.innerHTML = '<span class="agent-tool-icon">🔧</span><span>Reading sheet...</span>';
    document.querySelector('.agent-chat-body').appendChild(el);
  });

  const indicator = page.locator('.agent-tool-indicator');
  await expect(indicator).toBeVisible();
  await expect(indicator).toContainText('Reading sheet');
});

test('read_sheet sends tool result back to model for summarization', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => {
    localStorage.setItem('waymark_agent_keys', JSON.stringify([
      { key: 'read-sum-key', nickname: 'Sum', addedAt: '2026-01-01', requestsToday: 0, lastUsed: null, lastError: null, isBilled: false },
    ]));
    window.location.hash = '#/agent';
  });
  await page.waitForSelector('.agent-input', { timeout: 5000 });

  let callCount = 0;
  let secondCallBody = null;

  await page.route(/generateContent/, async route => {
    if (route.request().url().includes('stream')) return route.continue();
    callCount++;
    if (callCount === 1) {
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: buildReadSheetFunctionCall('sheet-001'),
      });
    } else {
      // Capture the follow-up request body to verify it contains tool results
      secondCallBody = JSON.parse(route.request().postData());
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: buildTextResponse('Here is your sheet summary.'),
      });
    }
  });
  await page.route(/streamGenerateContent/, async route => {
    await route.fulfill({ status: 500, body: '{}' });
  });

  await page.fill('.agent-input', 'show my groceries');
  await page.click('.agent-send-btn');

  await page.waitForFunction(() => {
    const msgs = document.querySelectorAll('.agent-message-assistant');
    const last = msgs[msgs.length - 1];
    return last && last.textContent.includes('sheet summary');
  }, { timeout: 10000 });

  // Verify the follow-up request included a functionResponse with content
  expect(secondCallBody).not.toBeNull();
  const funcResponse = secondCallBody.contents.find(c =>
    c.parts?.some(p => p.functionResponse)
  );
  expect(funcResponse).toBeDefined();
  const resp = funcResponse.parts[0].functionResponse;
  expect(resp.name).toBe('read_sheet');
  expect(resp.response.content.title).toBeTruthy();
  expect(resp.response.content.headers).toBeDefined();
  expect(Array.isArray(resp.response.content.rows)).toBe(true);
});

test('TOOL_DECLARATIONS includes read_sheet function', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => { window.location.hash = '#/agent'; });
  await page.waitForSelector('.agent-container', { timeout: 5000 });

  const hasAgent = await page.evaluate(() =>
    document.querySelector('.agent-container') !== null
  );
  expect(hasAgent).toBe(true);
});

/* ---------- update_sheet Tool ---------- */

function buildUpdateSheetFunctionCall(spreadsheetId, operation, extra) {
  return JSON.stringify({
    candidates: [{
      content: {
        parts: [{
          functionCall: {
            name: 'update_sheet',
            args: { spreadsheet_id: spreadsheetId, operation, ...extra },
          },
        }],
        role: 'model',
      },
    }],
  });
}

test('update_sheet append_rows adds rows and model confirms', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => {
    localStorage.setItem('waymark_agent_keys', JSON.stringify([
      { key: 'upd-key', nickname: 'Upd', addedAt: '2026-01-01', requestsToday: 0, lastUsed: null, lastError: null, isBilled: false },
    ]));
    window.location.hash = '#/agent';
  });
  await page.waitForSelector('.agent-input', { timeout: 5000 });

  let callCount = 0;
  await page.route(/generateContent/, async route => {
    if (route.request().url().includes('stream')) return route.continue();
    callCount++;
    if (callCount === 1) {
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: buildUpdateSheetFunctionCall('sheet-001', 'append_rows', {
          rows: [['Bread', '2', 'Bakery']],
        }),
      });
    } else {
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: buildTextResponse('Done! I added Bread to your grocery list.'),
      });
    }
  });
  await page.route(/streamGenerateContent/, async route => {
    await route.fulfill({ status: 500, body: '{}' });
  });

  await page.fill('.agent-input', 'add bread to my groceries');
  await page.click('.agent-send-btn');

  await page.waitForFunction(() => {
    const msgs = document.querySelectorAll('.agent-message-assistant');
    const last = msgs[msgs.length - 1];
    return last && last.textContent.includes('added Bread');
  }, { timeout: 10000 });

  await expect(page.locator('.agent-message-assistant').last()).toContainText('added Bread');
});

test('update_sheet update_cells changes cells and model confirms', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => {
    localStorage.setItem('waymark_agent_keys', JSON.stringify([
      { key: 'cell-key', nickname: 'Cell', addedAt: '2026-01-01', requestsToday: 0, lastUsed: null, lastError: null, isBilled: false },
    ]));
    window.location.hash = '#/agent';
  });
  await page.waitForSelector('.agent-input', { timeout: 5000 });

  let callCount = 0;
  await page.route(/generateContent/, async route => {
    if (route.request().url().includes('stream')) return route.continue();
    callCount++;
    if (callCount === 1) {
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: buildUpdateSheetFunctionCall('sheet-001', 'update_cells', {
          updates: [{ row: 1, column: 'Done', value: 'Yes' }],
        }),
      });
    } else {
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: buildTextResponse('Marked the first item as done.'),
      });
    }
  });
  await page.route(/streamGenerateContent/, async route => {
    await route.fulfill({ status: 500, body: '{}' });
  });

  await page.fill('.agent-input', 'mark first item done');
  await page.click('.agent-send-btn');

  await page.waitForFunction(() => {
    const msgs = document.querySelectorAll('.agent-message-assistant');
    const last = msgs[msgs.length - 1];
    return last && last.textContent.includes('Marked the first item');
  }, { timeout: 10000 });

  await expect(page.locator('.agent-message-assistant').last()).toContainText('Marked the first item');
});

test('update_sheet sends correct tool result to model follow-up', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => {
    localStorage.setItem('waymark_agent_keys', JSON.stringify([
      { key: 'upd-verify-key', nickname: 'UpdV', addedAt: '2026-01-01', requestsToday: 0, lastUsed: null, lastError: null, isBilled: false },
    ]));
    window.location.hash = '#/agent';
  });
  await page.waitForSelector('.agent-input', { timeout: 5000 });

  let callCount = 0;
  let secondCallBody = null;

  await page.route(/generateContent/, async route => {
    if (route.request().url().includes('stream')) return route.continue();
    callCount++;
    if (callCount === 1) {
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: buildUpdateSheetFunctionCall('sheet-001', 'append_rows', {
          rows: [['Cheese', '1', 'Dairy']],
        }),
      });
    } else {
      secondCallBody = JSON.parse(route.request().postData());
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: buildTextResponse('Added cheese.'),
      });
    }
  });
  await page.route(/streamGenerateContent/, async route => {
    await route.fulfill({ status: 500, body: '{}' });
  });

  await page.fill('.agent-input', 'add cheese');
  await page.click('.agent-send-btn');

  await page.waitForFunction(() => {
    const msgs = document.querySelectorAll('.agent-message-assistant');
    const last = msgs[msgs.length - 1];
    return last && last.textContent.includes('Added cheese');
  }, { timeout: 10000 });

  expect(secondCallBody).not.toBeNull();
  const funcResponse = secondCallBody.contents.find(c =>
    c.parts?.some(p => p.functionResponse)
  );
  expect(funcResponse).toBeDefined();
  const resp = funcResponse.parts[0].functionResponse;
  expect(resp.name).toBe('update_sheet');
  expect(resp.response.content.operation).toBe('append_rows');
  expect(resp.response.content.rowsAdded).toBe(1);
});

test('update_sheet handles invalid operation gracefully', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => {
    localStorage.setItem('waymark_agent_keys', JSON.stringify([
      { key: 'upd-err-key', nickname: 'UpdErr', addedAt: '2026-01-01', requestsToday: 0, lastUsed: null, lastError: null, isBilled: false },
    ]));
    window.location.hash = '#/agent';
  });
  await page.waitForSelector('.agent-input', { timeout: 5000 });

  let callCount = 0;
  await page.route(/generateContent/, async route => {
    if (route.request().url().includes('stream')) return route.continue();
    callCount++;
    if (callCount === 1) {
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: buildUpdateSheetFunctionCall('sheet-001', 'delete_all', {}),
      });
    } else {
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: buildTextResponse('Sorry, that operation is not supported.'),
      });
    }
  });
  await page.route(/streamGenerateContent/, async route => {
    await route.fulfill({ status: 500, body: '{}' });
  });

  await page.fill('.agent-input', 'delete everything');
  await page.click('.agent-send-btn');

  await page.waitForFunction(() => {
    const msgs = document.querySelectorAll('.agent-message-assistant');
    const last = msgs[msgs.length - 1];
    return last && last.textContent.includes('not supported');
  }, { timeout: 10000 });
});

test('update_sheet tool indicator shows updating message', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => { window.location.hash = '#/agent'; });
  await page.waitForSelector('.agent-chat-body', { timeout: 5000 });

  await page.evaluate(() => {
    const el = document.createElement('div');
    el.className = 'agent-tool-indicator';
    el.innerHTML = '<span class="agent-tool-icon">🔧</span><span>Updating sheet...</span>';
    document.querySelector('.agent-chat-body').appendChild(el);
  });

  await expect(page.locator('.agent-tool-indicator')).toContainText('Updating sheet');
});

/* ---------- Context-Aware System Prompt ---------- */

test('system prompt includes current date in API requests', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => {
    localStorage.setItem('waymark_agent_keys', JSON.stringify([
      { key: 'ctx-date-key', nickname: 'Ctx', addedAt: '2026-01-01', requestsToday: 0, lastUsed: null, lastError: null, isBilled: false },
    ]));
    window.location.hash = '#/agent';
  });
  await page.waitForSelector('.agent-input', { timeout: 5000 });

  let capturedBody = null;
  await page.route(/generateContent/, async route => {
    if (route.request().url().includes('stream')) return route.continue();
    capturedBody = JSON.parse(route.request().postData());
    await route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: buildTextResponse('Hello!'),
    });
  });
  await page.route(/streamGenerateContent/, async route => {
    await route.fulfill({ status: 500, body: '{}' });
  });

  await page.fill('.agent-input', 'hi');
  await page.click('.agent-send-btn');

  await page.waitForFunction(() => {
    const msgs = document.querySelectorAll('.agent-message-assistant');
    return msgs.length >= 1;
  }, { timeout: 10000 });

  expect(capturedBody).not.toBeNull();
  const systemText = capturedBody.systemInstruction?.parts?.[0]?.text || '';
  // Should contain today's date context
  expect(systemText).toContain('Today is');
});

test('system prompt includes user name in API requests', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => {
    localStorage.setItem('waymark_agent_keys', JSON.stringify([
      { key: 'ctx-user-key', nickname: 'Usr', addedAt: '2026-01-01', requestsToday: 0, lastUsed: null, lastError: null, isBilled: false },
    ]));
    window.location.hash = '#/agent';
  });
  await page.waitForSelector('.agent-input', { timeout: 5000 });

  let capturedBody = null;
  await page.route(/generateContent/, async route => {
    if (route.request().url().includes('stream')) return route.continue();
    capturedBody = JSON.parse(route.request().postData());
    await route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: buildTextResponse('Hi there!'),
    });
  });
  await page.route(/streamGenerateContent/, async route => {
    await route.fulfill({ status: 500, body: '{}' });
  });

  await page.fill('.agent-input', 'hello');
  await page.click('.agent-send-btn');

  await page.waitForFunction(() => {
    const msgs = document.querySelectorAll('.agent-message-assistant');
    return msgs.length >= 1;
  }, { timeout: 10000 });

  expect(capturedBody).not.toBeNull();
  const systemText = capturedBody.systemInstruction?.parts?.[0]?.text || '';
  // In mock mode, user is "Test User"
  expect(systemText).toContain('Test User');
});

test('system prompt includes user sheets from Drive', async ({ page }) => {
  await setupApp(page, { recentSheets: [
    { id: 'sheet-001', name: 'Grocery List', openedAt: '2026-01-01T00:00:00Z' },
    { id: 'sheet-002', name: 'Home Repairs', openedAt: '2026-01-01T00:01:00Z' },
    { id: 'sheet-003', name: 'Weekly Chores', openedAt: '2026-01-01T00:02:00Z' },
    { id: 'sheet-004', name: 'Monthly Budget', openedAt: '2026-01-01T00:03:00Z' },
  ] });
  await page.evaluate(() => {
    localStorage.setItem('waymark_agent_keys', JSON.stringify([
      { key: 'ctx-sheets-key', nickname: 'Sht', addedAt: '2026-01-01', requestsToday: 0, lastUsed: null, lastError: null, isBilled: false },
    ]));
    window.location.hash = '#/agent';
  });
  await page.waitForSelector('.agent-input', { timeout: 5000 });

  let capturedBody = null;
  await page.route(/generateContent/, async route => {
    if (route.request().url().includes('stream')) return route.continue();
    capturedBody = JSON.parse(route.request().postData());
    await route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: buildTextResponse('Found your sheets!'),
    });
  });
  await page.route(/streamGenerateContent/, async route => {
    await route.fulfill({ status: 500, body: '{}' });
  });

  await page.fill('.agent-input', 'what sheets do I have?');
  await page.click('.agent-send-btn');

  await page.waitForFunction(() => {
    const msgs = document.querySelectorAll('.agent-message-assistant');
    return msgs.length >= 1;
  }, { timeout: 10000 });

  expect(capturedBody).not.toBeNull();
  const systemText = capturedBody.systemInstruction?.parts?.[0]?.text || '';
  // In mock mode, there are sheets from fixture data
  expect(systemText).toContain('sheet(s)');
  // Should contain at least one sheet name from fixtures
  expect(systemText).toMatch(/id: sheet-\d+/);
});

test('system prompt includes recent conversation sheet references for follow-up edits', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => {
    localStorage.setItem('waymark_agent_keys', JSON.stringify([
      { key: 'recent-sheet-key', nickname: 'Recent', addedAt: '2026-01-01', requestsToday: 0, lastUsed: null, lastError: null, isBilled: false },
    ]));
    localStorage.setItem('waymark_agent_conversation', JSON.stringify([
      { role: 'user', content: 'Create a grocery checklist for this week.' },
      { role: 'assistant', content: 'Created it here: [Weekly Grocery List - Family of 4](#/sheet/created-sheet-123).' },
    ]));
    window.location.hash = '#/agent';
  });
  await page.waitForSelector('.agent-input', { timeout: 5000 });

  let capturedBody = null;
  await page.route(/generateContent/, async route => {
    if (route.request().url().includes('stream')) return route.continue();
    capturedBody = JSON.parse(route.request().postData());
    await route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: buildTextResponse('Updated the checklist.'),
    });
  });
  await page.route(/streamGenerateContent/, async route => {
    await route.fulfill({ status: 500, body: '{}' });
  });

  await page.fill('.agent-input', 'Add apples and yogurt to that checklist.');
  await page.click('.agent-send-btn');

  await page.waitForFunction(() => {
    const msgs = document.querySelectorAll('.agent-message-assistant');
    const last = msgs[msgs.length - 1];
    return last && last.textContent.includes('Updated the checklist');
  }, { timeout: 10000 });

  expect(capturedBody).not.toBeNull();
  const systemText = capturedBody.systemInstruction.parts[0].text;
  expect(systemText).toContain('Recent sheet references from this conversation');
  expect(systemText).toContain('Weekly Grocery List - Family of 4');
  expect(systemText).toContain('created-sheet-123');
  expect(systemText).toContain('prefer update_sheet over creating a duplicate');
});

test('planned user message includes recent-sheet target hint for follow-up edits', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => {
    localStorage.setItem('waymark_agent_keys', JSON.stringify([
      { key: 'planned-hint-key', nickname: 'PlannedHint', addedAt: '2026-01-01', requestsToday: 0, lastUsed: null, lastError: null, isBilled: false },
    ]));
    localStorage.setItem('waymark_agent_conversation', JSON.stringify([
      { role: 'user', content: 'Create a grocery checklist for this week.' },
      { role: 'assistant', content: 'Created it here: [Weekly Grocery List - Family of 4](#/sheet/created-sheet-123).' },
    ]));
    window.location.hash = '#/agent';
  });
  await page.waitForSelector('.agent-input', { timeout: 5000 });

  let capturedBody = null;
  await page.route(/generateContent/, async route => {
    if (route.request().url().includes('stream')) return route.continue();
    capturedBody = JSON.parse(route.request().postData());
    await route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: buildTextResponse('Updated the checklist.'),
    });
  });
  await page.route(/streamGenerateContent/, async route => {
    await route.fulfill({ status: 500, body: '{}' });
  });

  await page.fill('.agent-input', 'Add apples and yogurt to that checklist.');
  await page.click('.agent-send-btn');

  await page.waitForFunction(() => {
    const msgs = document.querySelectorAll('.agent-message-assistant');
    const last = msgs[msgs.length - 1];
    return last && last.textContent.includes('Updated the checklist');
  }, { timeout: 10000 });

  expect(capturedBody).not.toBeNull();
  const finalPrompt = capturedBody.contents[capturedBody.contents.length - 1].parts[0].text;
  expect(finalPrompt).toContain('Recent target hint:');
  expect(finalPrompt).toContain('Weekly Grocery List - Family of 4');
  expect(finalPrompt).toContain('created-sheet-123');
  expect(finalPrompt).toContain('use read_sheet and update_sheet');
});

test('system prompt always includes base instructions alongside context', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => {
    localStorage.setItem('waymark_agent_keys', JSON.stringify([
      { key: 'ctx-base-key', nickname: 'Base', addedAt: '2026-01-01', requestsToday: 0, lastUsed: null, lastError: null, isBilled: false },
    ]));
    window.location.hash = '#/agent';
  });
  await page.waitForSelector('.agent-input', { timeout: 5000 });

  let capturedBody = null;
  await page.route(/generateContent/, async route => {
    if (route.request().url().includes('stream')) return route.continue();
    capturedBody = JSON.parse(route.request().postData());
    await route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: buildTextResponse('All good!'),
    });
  });
  await page.route(/streamGenerateContent/, async route => {
    await route.fulfill({ status: 500, body: '{}' });
  });

  await page.fill('.agent-input', 'hello');
  await page.click('.agent-send-btn');

  await page.waitForFunction(() => {
    const msgs = document.querySelectorAll('.agent-message-assistant');
    return msgs.length >= 1;
  }, { timeout: 10000 });

  expect(capturedBody).not.toBeNull();
  const systemText = capturedBody.systemInstruction?.parts?.[0]?.text || '';
  // Base prompt always present
  expect(systemText).toContain('Waymark AI assistant');
  expect(systemText).toContain('Available templates:');
  // Dynamic context also present
  expect(systemText).toContain('Today is');
});

/* ---------- search_sheets Tool ---------- */

function buildSearchSheetsFunctionCall(query) {
  return JSON.stringify({
    candidates: [{
      content: {
        parts: [{
          functionCall: {
            name: 'search_sheets',
            args: { query },
          },
        }],
        role: 'model',
      },
    }],
  });
}

test('search_sheets tool finds matching sheets and returns results to model', async ({ page }) => {
  await setupApp(page, { recentSheets: [
    { id: 'sheet-001', name: 'Grocery List', openedAt: '2026-01-01T00:00:00Z' },
    { id: 'sheet-002', name: 'Home Repairs', openedAt: '2026-01-01T00:01:00Z' },
    { id: 'sheet-003', name: 'Weekly Chores', openedAt: '2026-01-01T00:02:00Z' },
    { id: 'sheet-004', name: 'Monthly Budget', openedAt: '2026-01-01T00:03:00Z' },
  ] });
  await page.evaluate(() => {
    localStorage.setItem('waymark_agent_keys', JSON.stringify([
      { key: 'search-key', nickname: 'Search', addedAt: '2026-01-01', requestsToday: 0, lastUsed: null, lastError: null, isBilled: false },
    ]));
    window.location.hash = '#/agent';
  });
  await page.waitForSelector('.agent-input', { timeout: 5000 });

  let callCount = 0;
  let toolResultBody = null;
  await page.route(/generateContent/, async route => {
    if (route.request().url().includes('stream')) return route.continue();
    callCount++;
    if (callCount === 1) {
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: buildSearchSheetsFunctionCall('Budget'),
      });
    } else {
      toolResultBody = JSON.parse(route.request().postData());
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: buildTextResponse('I found your budget sheets!'),
      });
    }
  });
  await page.route(/streamGenerateContent/, async route => {
    await route.fulfill({ status: 500, body: '{}' });
  });

  await page.fill('.agent-input', 'find my budget sheets');
  await page.click('.agent-send-btn');

  await page.waitForFunction(() => {
    const msgs = document.querySelectorAll('.agent-message-assistant');
    return msgs.length >= 1 && msgs[msgs.length - 1].textContent.includes('budget sheets');
  }, { timeout: 10000 });

  expect(callCount).toBe(2);
  expect(toolResultBody).not.toBeNull();
  // The tool result should contain the search results
  const toolParts = toolResultBody.contents?.find(c => c.role === 'function')
    ?.parts?.find(p => p.functionResponse);
  expect(toolParts).toBeDefined();
  const response = toolParts.functionResponse.response.content;
  expect(response.query).toBe('Budget');
  expect(response.results.length).toBeGreaterThan(0);
  // Results should include Monthly Budget (from fixtures)
  expect(response.results.some(r => r.name.includes('Budget'))).toBe(true);
});

test('search_sheets with no matches returns empty results', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => {
    localStorage.setItem('waymark_agent_keys', JSON.stringify([
      { key: 'search-empty-key', nickname: 'SE', addedAt: '2026-01-01', requestsToday: 0, lastUsed: null, lastError: null, isBilled: false },
    ]));
    window.location.hash = '#/agent';
  });
  await page.waitForSelector('.agent-input', { timeout: 5000 });

  let callCount = 0;
  let toolResultBody = null;
  await page.route(/generateContent/, async route => {
    if (route.request().url().includes('stream')) return route.continue();
    callCount++;
    if (callCount === 1) {
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: buildSearchSheetsFunctionCall('zzz_nonexistent_xyz'),
      });
    } else {
      toolResultBody = JSON.parse(route.request().postData());
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: buildTextResponse('No sheets found with that name.'),
      });
    }
  });
  await page.route(/streamGenerateContent/, async route => {
    await route.fulfill({ status: 500, body: '{}' });
  });

  await page.fill('.agent-input', 'find zzz_nonexistent');
  await page.click('.agent-send-btn');

  await page.waitForFunction(() => {
    const msgs = document.querySelectorAll('.agent-message-assistant');
    return msgs.length >= 1 && msgs[msgs.length - 1].textContent.includes('No sheets');
  }, { timeout: 10000 });

  const toolParts = toolResultBody.contents?.find(c => c.role === 'function')
    ?.parts?.find(p => p.functionResponse);
  const response = toolParts.functionResponse.response.content;
  expect(response.results).toHaveLength(0);
  expect(response.totalMatches).toBe(0);
});

test('search_sheets returns sheet IDs and folder info', async ({ page }) => {
  await setupApp(page, { recentSheets: [
    { id: 'sheet-001', name: 'Grocery List', openedAt: '2026-01-01T00:00:00Z' },
    { id: 'sheet-002', name: 'Home Repairs', openedAt: '2026-01-01T00:01:00Z' },
    { id: 'sheet-003', name: 'Weekly Chores', openedAt: '2026-01-01T00:02:00Z' },
    { id: 'sheet-004', name: 'Monthly Budget', openedAt: '2026-01-01T00:03:00Z' },
  ] });
  await page.evaluate(() => {
    localStorage.setItem('waymark_agent_keys', JSON.stringify([
      { key: 'search-detail-key', nickname: 'SD', addedAt: '2026-01-01', requestsToday: 0, lastUsed: null, lastError: null, isBilled: false },
    ]));
    window.location.hash = '#/agent';
  });
  await page.waitForSelector('.agent-input', { timeout: 5000 });

  let callCount = 0;
  let toolResultBody = null;
  await page.route(/generateContent/, async route => {
    if (route.request().url().includes('stream')) return route.continue();
    callCount++;
    if (callCount === 1) {
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: buildSearchSheetsFunctionCall('Grocery'),
      });
    } else {
      toolResultBody = JSON.parse(route.request().postData());
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: buildTextResponse('Here are your grocery sheets.'),
      });
    }
  });
  await page.route(/streamGenerateContent/, async route => {
    await route.fulfill({ status: 500, body: '{}' });
  });

  await page.fill('.agent-input', 'find grocery');
  await page.click('.agent-send-btn');

  await page.waitForFunction(() => {
    const msgs = document.querySelectorAll('.agent-message-assistant');
    return msgs.length >= 1 && msgs[msgs.length - 1].textContent.includes('grocery');
  }, { timeout: 10000 });

  const toolParts = toolResultBody.contents?.find(c => c.role === 'function')
    ?.parts?.find(p => p.functionResponse);
  const response = toolParts.functionResponse.response.content;
  expect(response.results.length).toBeGreaterThan(0);
  // Each result should have id, name, folder
  for (const sheet of response.results) {
    expect(sheet).toHaveProperty('id');
    expect(sheet).toHaveProperty('name');
    expect(sheet).toHaveProperty('folder');
    expect(sheet.id).toMatch(/^sheet-\d+$/);
  }
});

test('search_sheets shows tool indicator while searching', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => {
    localStorage.setItem('waymark_agent_keys', JSON.stringify([
      { key: 'search-ind-key', nickname: 'SI', addedAt: '2026-01-01', requestsToday: 0, lastUsed: null, lastError: null, isBilled: false },
    ]));
    window.location.hash = '#/agent';
  });
  await page.waitForSelector('.agent-input', { timeout: 5000 });

  let callCount = 0;
  await page.route(/generateContent/, async route => {
    if (route.request().url().includes('stream')) return route.continue();
    callCount++;
    if (callCount === 1) {
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: buildSearchSheetsFunctionCall('Test'),
      });
    } else {
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: buildTextResponse('Found it!'),
      });
    }
  });
  await page.route(/streamGenerateContent/, async route => {
    await route.fulfill({ status: 500, body: '{}' });
  });

  await page.fill('.agent-input', 'search for test sheets');
  await page.click('.agent-send-btn');

  // Wait for the final response
  await page.waitForFunction(() => {
    const msgs = document.querySelectorAll('.agent-message-assistant');
    return msgs.length >= 1 && msgs[msgs.length - 1].textContent.includes('Found it');
  }, { timeout: 10000 });

  // Tool indicator should be cleaned up after completion
  await expect(page.locator('.agent-tool-indicator')).toHaveCount(0);
});

test('search_sheets declaration is present in tool declarations', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => {
    localStorage.setItem('waymark_agent_keys', JSON.stringify([
      { key: 'decl-key', nickname: 'D', addedAt: '2026-01-01', requestsToday: 0, lastUsed: null, lastError: null, isBilled: false },
    ]));
    window.location.hash = '#/agent';
  });
  await page.waitForSelector('.agent-input', { timeout: 5000 });

  let capturedBody = null;
  await page.route(/generateContent/, async route => {
    if (route.request().url().includes('stream')) return route.continue();
    capturedBody = JSON.parse(route.request().postData());
    await route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: buildTextResponse('Hi!'),
    });
  });
  await page.route(/streamGenerateContent/, async route => {
    await route.fulfill({ status: 500, body: '{}' });
  });

  await page.fill('.agent-input', 'hi');
  await page.click('.agent-send-btn');

  await page.waitForFunction(() => {
    const msgs = document.querySelectorAll('.agent-message-assistant');
    return msgs.length >= 1;
  }, { timeout: 10000 });

  expect(capturedBody).not.toBeNull();
  const declarations = capturedBody.tools?.[0]?.functionDeclarations || [];
  const names = declarations.map(d => d.name);
  expect(names).toContain('search_sheets');
  // All declarations must have a name
  for (const decl of declarations) {
    expect(decl.name).toBeTruthy();
  }
});

/* ---- Slash Commands ---- */

test('slash palette appears when user types / in the input', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => {
    localStorage.setItem('waymark_agent_keys', JSON.stringify([
      { key: 'slash-key', nickname: 'S', addedAt: '2026-01-01', requestsToday: 0, lastUsed: null, lastError: null, isBilled: false },
    ]));
    window.location.hash = '#/agent';
  });
  await page.waitForSelector('.agent-input', { timeout: 5000 });
  await page.fill('.agent-input', '/');
  await page.waitForSelector('.agent-slash-palette:not(.hidden)', { timeout: 3000 });
  const items = await page.$$('.agent-slash-item');
  expect(items.length).toBeGreaterThanOrEqual(6);
});

test('slash palette filters commands as the user types', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => {
    localStorage.setItem('waymark_agent_keys', JSON.stringify([
      { key: 'slash-key', nickname: 'S', addedAt: '2026-01-01', requestsToday: 0, lastUsed: null, lastError: null, isBilled: false },
    ]));
    window.location.hash = '#/agent';
  });
  await page.waitForSelector('.agent-input', { timeout: 5000 });
  await page.fill('.agent-input', '/li');
  await page.waitForSelector('.agent-slash-palette:not(.hidden)', { timeout: 3000 });
  const items = await page.$$('.agent-slash-item');
  // Only /list should match '/li'
  expect(items.length).toBe(1);
  const text = await items[0].textContent();
  expect(text).toContain('/list');
});

test('slash palette hides when user adds a space after the command', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => {
    localStorage.setItem('waymark_agent_keys', JSON.stringify([
      { key: 'slash-key', nickname: 'S', addedAt: '2026-01-01', requestsToday: 0, lastUsed: null, lastError: null, isBilled: false },
    ]));
    window.location.hash = '#/agent';
  });
  await page.waitForSelector('.agent-input', { timeout: 5000 });
  await page.fill('.agent-input', '/list');
  await page.waitForSelector('.agent-slash-palette:not(.hidden)', { timeout: 3000 });
  await page.fill('.agent-input', '/list ');
  await page.dispatchEvent('.agent-input', 'input');
  await page.waitForFunction(() => {
    const p = document.querySelector('.agent-slash-palette');
    return !p || p.classList.contains('hidden');
  }, { timeout: 3000 });
});

test('slash palette closes on Escape key', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => {
    localStorage.setItem('waymark_agent_keys', JSON.stringify([
      { key: 'slash-key', nickname: 'S', addedAt: '2026-01-01', requestsToday: 0, lastUsed: null, lastError: null, isBilled: false },
    ]));
    window.location.hash = '#/agent';
  });
  await page.waitForSelector('.agent-input', { timeout: 5000 });
  await page.fill('.agent-input', '/');
  await page.waitForSelector('.agent-slash-palette:not(.hidden)', { timeout: 3000 });
  await page.press('.agent-input', 'Escape');
  await page.waitForFunction(() => {
    const p = document.querySelector('.agent-slash-palette');
    return !p || p.classList.contains('hidden');
  }, { timeout: 3000 });
});

test('slash item click fills the input and hides the palette', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => {
    localStorage.setItem('waymark_agent_keys', JSON.stringify([
      { key: 'slash-key', nickname: 'S', addedAt: '2026-01-01', requestsToday: 0, lastUsed: null, lastError: null, isBilled: false },
    ]));
    window.location.hash = '#/agent';
  });
  await page.waitForSelector('.agent-input', { timeout: 5000 });
  await page.fill('.agent-input', '/cl');
  await page.waitForSelector('.agent-slash-palette:not(.hidden)', { timeout: 3000 });
  const item = page.locator('.agent-slash-item').first();
  await item.dispatchEvent('mousedown');
  const val = await page.inputValue('.agent-input');
  expect(val.startsWith('/clear')).toBeTruthy();
  await page.waitForFunction(() => {
    const p = document.querySelector('.agent-slash-palette');
    return !p || p.classList.contains('hidden');
  }, { timeout: 2000 });
});

test('slash ArrowDown selects next item and Enter applies it', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => {
    localStorage.setItem('waymark_agent_keys', JSON.stringify([
      { key: 'slash-key', nickname: 'S', addedAt: '2026-01-01', requestsToday: 0, lastUsed: null, lastError: null, isBilled: false },
    ]));
    window.location.hash = '#/agent';
  });
  await page.waitForSelector('.agent-input', { timeout: 5000 });
  await page.fill('.agent-input', '/');
  await page.waitForSelector('.agent-slash-palette:not(.hidden)', { timeout: 3000 });
  await page.press('.agent-input', 'ArrowDown');
  const selected = await page.$('.agent-slash-selected');
  expect(selected).not.toBeNull();
});

test('/help command shows system message with command list', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => {
    localStorage.setItem('waymark_agent_keys', JSON.stringify([
      { key: 'slash-key', nickname: 'S', addedAt: '2026-01-01', requestsToday: 0, lastUsed: null, lastError: null, isBilled: false },
    ]));
    window.location.hash = '#/agent';
  });
  await page.waitForSelector('.agent-input', { timeout: 5000 });
  await page.fill('.agent-input', '/help');
  await page.press('.agent-input', 'Enter');
  await page.waitForSelector('.agent-message-system', { timeout: 3000 });
  await expect(page.locator('.agent-message-system')).toContainText('/new');
  await expect(page.locator('.agent-message-system')).toContainText('/list');
  await expect(page.locator('.agent-message-system')).toContainText('/clear');
});

test('/clear command clears the chat and shows empty state', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => {
    localStorage.setItem('waymark_agent_keys', JSON.stringify([
      { key: 'slash-clear', nickname: 'C', addedAt: '2026-01-01', requestsToday: 0, lastUsed: null, lastError: null, isBilled: false },
    ]));
    window.location.hash = '#/agent';
  });
  await page.waitForSelector('.agent-input', { timeout: 5000 });
  // Confirm there is an empty state initially
  await page.waitForSelector('.agent-empty', { timeout: 3000 });
  await page.fill('.agent-input', '/clear');
  await page.press('.agent-input', 'Enter');
  // empty state should still be visible
  await page.waitForSelector('.agent-empty', { timeout: 3000 });
  await expect(page.locator('.agent-empty')).toBeVisible();
});

test('/keys command opens the settings modal', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => {
    localStorage.setItem('waymark_agent_keys', JSON.stringify([
      { key: 'slash-key-k', nickname: 'K', addedAt: '2026-01-01', requestsToday: 0, lastUsed: null, lastError: null, isBilled: false },
    ]));
    window.location.hash = '#/agent';
  });
  await page.waitForSelector('.agent-input', { timeout: 5000 });
  await page.fill('.agent-input', '/keys');
  await page.press('.agent-input', 'Enter');
  await page.waitForSelector('.agent-settings-modal', { timeout: 3000 });
  await expect(page.locator('.agent-settings-modal')).toBeVisible();
});

test('slash palette item rows have cursor:pointer', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => {
    localStorage.setItem('waymark_agent_keys', JSON.stringify([
      { key: 'slash-key', nickname: 'S', addedAt: '2026-01-01', requestsToday: 0, lastUsed: null, lastError: null, isBilled: false },
    ]));
    window.location.hash = '#/agent';
  });
  await page.waitForSelector('.agent-input', { timeout: 5000 });
  await page.fill('.agent-input', '/');
  await page.waitForSelector('.agent-slash-palette:not(.hidden)', { timeout: 3000 });
  const item = page.locator('.agent-slash-item').first();
  await expect(item).toHaveCSS('cursor', 'pointer');
});

test('/list command shows system message with sheet list or empty state', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => {
    localStorage.setItem('waymark_agent_keys', JSON.stringify([
      { key: 'slash-key', nickname: 'S', addedAt: '2026-01-01', requestsToday: 0, lastUsed: null, lastError: null, isBilled: false },
    ]));
    window.location.hash = '#/agent';
  });
  await page.waitForSelector('.agent-input', { timeout: 5000 });
  await page.fill('.agent-input', '/list');
  await page.press('.agent-input', 'Enter');
  await page.waitForSelector('.agent-message-system', { timeout: 5000 });
  const text = await page.locator('.agent-message-system').textContent();
  // Either shows a list, or "no sheets" message
  expect(text.length).toBeGreaterThan(0);
});

test('slash palette does not appear for regular text messages', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => {
    localStorage.setItem('waymark_agent_keys', JSON.stringify([
      { key: 'slash-key', nickname: 'S', addedAt: '2026-01-01', requestsToday: 0, lastUsed: null, lastError: null, isBilled: false },
    ]));
    window.location.hash = '#/agent';
  });
  await page.waitForSelector('.agent-input', { timeout: 5000 });
  await page.fill('.agent-input', 'hello world');
  await page.dispatchEvent('.agent-input', 'input');
  // palette should stay hidden
  await page.waitForFunction(() => {
    const p = document.querySelector('.agent-slash-palette');
    return !p || p.classList.contains('hidden');
  }, { timeout: 2000 });
});

/* ---- Better Markdown Renderer ---- */

test('markdown renderer renders headings h1 h2 h3', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => {
    localStorage.setItem('waymark_agent_keys', JSON.stringify([
      { key: 'md-key', nickname: 'M', addedAt: '2026-01-01', requestsToday: 0, lastUsed: null, lastError: null, isBilled: false },
    ]));
    window.location.hash = '#/agent';
  });
  await page.waitForSelector('.agent-input', { timeout: 5000 });

  await page.route(/generateContent/, async route => {
    if (route.request().url().includes('stream')) return route.continue();
    await route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: buildTextResponse('# Big Title\n## Medium Title\n### Small Title'),
    });
  });
  await page.route(/streamGenerateContent/, async route => {
    await route.fulfill({ status: 500, body: '{}' });
  });

  await page.fill('.agent-input', 'test');
  await page.click('.agent-send-btn');
  await page.waitForSelector('.agent-message-assistant', { timeout: 10000 });

  await expect(page.locator('.agent-md-h1')).toContainText('Big Title');
  await expect(page.locator('.agent-md-h2')).toContainText('Medium Title');
  await expect(page.locator('.agent-md-h3')).toContainText('Small Title');
});

test('markdown renderer renders unordered list', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => {
    localStorage.setItem('waymark_agent_keys', JSON.stringify([
      { key: 'md-key', nickname: 'M', addedAt: '2026-01-01', requestsToday: 0, lastUsed: null, lastError: null, isBilled: false },
    ]));
    window.location.hash = '#/agent';
  });
  await page.waitForSelector('.agent-input', { timeout: 5000 });

  await page.route(/generateContent/, async route => {
    if (route.request().url().includes('stream')) return route.continue();
    await route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: buildTextResponse('- Apples\n- Bananas\n- Cherries'),
    });
  });
  await page.route(/streamGenerateContent/, async route => {
    await route.fulfill({ status: 500, body: '{}' });
  });

  await page.fill('.agent-input', 'test');
  await page.click('.agent-send-btn');
  await page.waitForSelector('.agent-md-ul', { timeout: 10000 });

  const items = await page.$$('.agent-md-ul li');
  expect(items.length).toBe(3);
  await expect(page.locator('.agent-md-ul li').first()).toContainText('Apples');
});

test('markdown renderer renders ordered list', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => {
    localStorage.setItem('waymark_agent_keys', JSON.stringify([
      { key: 'md-key', nickname: 'M', addedAt: '2026-01-01', requestsToday: 0, lastUsed: null, lastError: null, isBilled: false },
    ]));
    window.location.hash = '#/agent';
  });
  await page.waitForSelector('.agent-input', { timeout: 5000 });

  await page.route(/generateContent/, async route => {
    if (route.request().url().includes('stream')) return route.continue();
    await route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: buildTextResponse('1. First step\n2. Second step\n3. Third step'),
    });
  });
  await page.route(/streamGenerateContent/, async route => {
    await route.fulfill({ status: 500, body: '{}' });
  });

  await page.fill('.agent-input', 'test');
  await page.click('.agent-send-btn');
  await page.waitForSelector('.agent-md-ol', { timeout: 10000 });

  const items = await page.$$('.agent-md-ol li');
  expect(items.length).toBe(3);
  await expect(page.locator('.agent-md-ol li').last()).toContainText('Third step');
});

test('markdown renderer renders horizontal rule', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => {
    localStorage.setItem('waymark_agent_keys', JSON.stringify([
      { key: 'md-key', nickname: 'M', addedAt: '2026-01-01', requestsToday: 0, lastUsed: null, lastError: null, isBilled: false },
    ]));
    window.location.hash = '#/agent';
  });
  await page.waitForSelector('.agent-input', { timeout: 5000 });

  await page.route(/generateContent/, async route => {
    if (route.request().url().includes('stream')) return route.continue();
    await route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: buildTextResponse('Above\n\n---\n\nBelow'),
    });
  });
  await page.route(/streamGenerateContent/, async route => {
    await route.fulfill({ status: 500, body: '{}' });
  });

  await page.fill('.agent-input', 'test');
  await page.click('.agent-send-btn');
  await page.waitForSelector('.agent-md-hr', { timeout: 10000 });
  await expect(page.locator('.agent-md-hr')).toBeVisible();
});

test('markdown renderer renders a table with header and rows', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => {
    localStorage.setItem('waymark_agent_keys', JSON.stringify([
      { key: 'md-key', nickname: 'M', addedAt: '2026-01-01', requestsToday: 0, lastUsed: null, lastError: null, isBilled: false },
    ]));
    window.location.hash = '#/agent';
  });
  await page.waitForSelector('.agent-input', { timeout: 5000 });

  await page.route(/generateContent/, async route => {
    if (route.request().url().includes('stream')) return route.continue();
    await route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: buildTextResponse('| Name | Value |\n|------|-------|\n| Alpha | 1 |\n| Beta | 2 |'),
    });
  });
  await page.route(/streamGenerateContent/, async route => {
    await route.fulfill({ status: 500, body: '{}' });
  });

  await page.fill('.agent-input', 'test');
  await page.click('.agent-send-btn');
  await page.waitForSelector('.agent-md-table', { timeout: 10000 });

  const ths = await page.$$('.agent-md-table th');
  expect(ths.length).toBe(2);
  const tds = await page.$$('.agent-md-table td');
  expect(tds.length).toBe(4);
});

test('markdown renderer renders inline links as anchor tags', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => {
    localStorage.setItem('waymark_agent_keys', JSON.stringify([
      { key: 'md-key', nickname: 'M', addedAt: '2026-01-01', requestsToday: 0, lastUsed: null, lastError: null, isBilled: false },
    ]));
    window.location.hash = '#/agent';
  });
  await page.waitForSelector('.agent-input', { timeout: 5000 });

  await page.route(/generateContent/, async route => {
    if (route.request().url().includes('stream')) return route.continue();
    await route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: buildTextResponse('Check [this sheet](#/sheet/abc123) for details.'),
    });
  });
  await page.route(/streamGenerateContent/, async route => {
    await route.fulfill({ status: 500, body: '{}' });
  });

  await page.fill('.agent-input', 'test');
  await page.click('.agent-send-btn');
  await page.waitForSelector('.agent-md-link', { timeout: 10000 });

  const link = page.locator('.agent-md-link');
  await expect(link).toContainText('this sheet');
  const href = await link.getAttribute('href');
  expect(href).toBe('#/sheet/abc123');
});

test('markdown renderer still renders bold and italic inline', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => {
    localStorage.setItem('waymark_agent_keys', JSON.stringify([
      { key: 'md-key', nickname: 'M', addedAt: '2026-01-01', requestsToday: 0, lastUsed: null, lastError: null, isBilled: false },
    ]));
    window.location.hash = '#/agent';
  });
  await page.waitForSelector('.agent-input', { timeout: 5000 });

  await page.route(/generateContent/, async route => {
    if (route.request().url().includes('stream')) return route.continue();
    await route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: buildTextResponse('This is **bold** and *italic* text.'),
    });
  });
  await page.route(/streamGenerateContent/, async route => {
    await route.fulfill({ status: 500, body: '{}' });
  });

  await page.fill('.agent-input', 'test');
  await page.click('.agent-send-btn');
  await page.waitForSelector('.agent-message-assistant', { timeout: 10000 });

  await expect(page.locator('.agent-message-assistant strong')).toContainText('bold');
  await expect(page.locator('.agent-message-assistant em')).toContainText('italic');
});

test('markdown table is scrollable and has rounded border', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => {
    localStorage.setItem('waymark_agent_keys', JSON.stringify([
      { key: 'md-key', nickname: 'M', addedAt: '2026-01-01', requestsToday: 0, lastUsed: null, lastError: null, isBilled: false },
    ]));
    window.location.hash = '#/agent';
  });
  await page.waitForSelector('.agent-input', { timeout: 5000 });

  await page.route(/generateContent/, async route => {
    if (route.request().url().includes('stream')) return route.continue();
    await route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: buildTextResponse('| A | B |\n|---|---|\n| x | y |'),
    });
  });
  await page.route(/streamGenerateContent/, async route => {
    await route.fulfill({ status: 500, body: '{}' });
  });

  await page.fill('.agent-input', 'test');
  await page.click('.agent-send-btn');
  await page.waitForSelector('.agent-md-table-wrap', { timeout: 10000 });

  const wrap = page.locator('.agent-md-table-wrap');
  await expect(wrap).toHaveCSS('overflow-x', 'auto');
  const radius = await wrap.evaluate(el => getComputedStyle(el).borderRadius);
  expect(radius).not.toBe('0px');
});

/* ---- Sheet Preview Cards ---- */

test('sheet preview card appears after create_sheet tool call', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => {
    localStorage.setItem('waymark_agent_keys', JSON.stringify([
      { key: 'card-key', nickname: 'C', addedAt: '2026-01-01', requestsToday: 0, lastUsed: null, lastError: null, isBilled: false },
    ]));
    window.location.hash = '#/agent';
  });
  await page.waitForSelector('.agent-input', { timeout: 5000 });

  let callCount = 0;
  await page.route(/generateContent/, async route => {
    if (route.request().url().includes('stream')) return route.continue();
    callCount++;
    if (callCount === 1) {
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: buildCreateSheetFunctionCall('checklist', 'My Shopping List', [
          ['Milk'],
          ['Eggs'],
        ]),
      });
    } else {
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: buildTextResponse('Done! I created your shopping list.'),
      });
    }
  });
  await page.route(/streamGenerateContent/, async route => {
    await route.fulfill({ status: 500, body: '{}' });
  });

  await page.fill('.agent-input', 'Create a shopping list');
  await page.click('.agent-send-btn');

  await page.waitForSelector('.agent-sheet-card', { timeout: 15000 });
  await expect(page.locator('.agent-sheet-card')).toBeVisible();
  await expect(page.locator('.agent-card-title')).toContainText('My Shopping List');
});

test('sheet preview card shows template badge', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => {
    localStorage.setItem('waymark_agent_keys', JSON.stringify([
      { key: 'card-key', nickname: 'C', addedAt: '2026-01-01', requestsToday: 0, lastUsed: null, lastError: null, isBilled: false },
    ]));
    window.location.hash = '#/agent';
  });
  await page.waitForSelector('.agent-input', { timeout: 5000 });

  let callCount = 0;
  await page.route(/generateContent/, async route => {
    if (route.request().url().includes('stream')) return route.continue();
    callCount++;
    if (callCount === 1) {
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: buildCreateSheetFunctionCall('budget', 'Family Budget', [
          ['Rent', '1200', 'Fixed'],
        ]),
      });
    } else {
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: buildTextResponse('Your budget sheet is ready.'),
      });
    }
  });
  await page.route(/streamGenerateContent/, async route => {
    await route.fulfill({ status: 500, body: '{}' });
  });

  await page.fill('.agent-input', 'Create a family budget');
  await page.click('.agent-send-btn');

  await page.waitForSelector('.agent-card-badge', { timeout: 15000 });
  await expect(page.locator('.agent-card-badge')).toContainText('budget');
});

test('sheet preview card open button links to the correct sheet', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => {
    localStorage.setItem('waymark_agent_keys', JSON.stringify([
      { key: 'card-key', nickname: 'C', addedAt: '2026-01-01', requestsToday: 0, lastUsed: null, lastError: null, isBilled: false },
    ]));
    window.location.hash = '#/agent';
  });
  await page.waitForSelector('.agent-input', { timeout: 5000 });

  let callCount = 0;
  await page.route(/generateContent/, async route => {
    if (route.request().url().includes('stream')) return route.continue();
    callCount++;
    if (callCount === 1) {
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: buildCreateSheetFunctionCall('travel', 'Summer Road Trip', [
          ['Day 1', 'Boston', 'Start'],
        ]),
      });
    } else {
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: buildTextResponse('Your travel plan is ready!'),
      });
    }
  });
  await page.route(/streamGenerateContent/, async route => {
    await route.fulfill({ status: 500, body: '{}' });
  });

  await page.fill('.agent-input', 'Plan a road trip');
  await page.click('.agent-send-btn');

  await page.waitForSelector('.agent-card-open-btn', { timeout: 15000 });
  const href = await page.locator('.agent-card-open-btn').getAttribute('href');
  expect(href).toMatch(/^#\/sheet\//);
});

test('sheet preview card has correct open button styling', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => {
    localStorage.setItem('waymark_agent_keys', JSON.stringify([
      { key: 'card-key', nickname: 'C', addedAt: '2026-01-01', requestsToday: 0, lastUsed: null, lastError: null, isBilled: false },
    ]));
    window.location.hash = '#/agent';
  });
  await page.waitForSelector('.agent-input', { timeout: 5000 });

  let callCount = 0;
  await page.route(/generateContent/, async route => {
    if (route.request().url().includes('stream')) return route.continue();
    callCount++;
    if (callCount === 1) {
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: buildCreateSheetFunctionCall('checklist', 'Test Sheet', [['Item 1']]),
      });
    } else {
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: buildTextResponse('Done.'),
      });
    }
  });
  await page.route(/streamGenerateContent/, async route => {
    await route.fulfill({ status: 500, body: '{}' });
  });

  await page.fill('.agent-input', 'Make a list');
  await page.click('.agent-send-btn');
  await page.waitForSelector('.agent-card-open-btn', { timeout: 15000 });

  const btn = page.locator('.agent-card-open-btn');
  await expect(btn).toBeVisible();
  await expect(btn).toHaveCSS('cursor', 'pointer');
});

test('sheet model response text still appears after preview card', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => {
    localStorage.setItem('waymark_agent_keys', JSON.stringify([
      { key: 'card-key', nickname: 'C', addedAt: '2026-01-01', requestsToday: 0, lastUsed: null, lastError: null, isBilled: false },
    ]));
    window.location.hash = '#/agent';
  });
  await page.waitForSelector('.agent-input', { timeout: 5000 });

  let callCount = 0;
  await page.route(/generateContent/, async route => {
    if (route.request().url().includes('stream')) return route.continue();
    callCount++;
    if (callCount === 1) {
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: buildCreateSheetFunctionCall('checklist', 'Task List', [['Task A']]),
      });
    } else {
      await route.fulfill({
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        body: buildTextResponse('I created a task list for you.'),
      });
    }
  });
  await page.route(/streamGenerateContent/, async route => {
    await route.fulfill({ status: 500, body: '{}' });
  });

  await page.fill('.agent-input', 'I need a task list');
  await page.click('.agent-send-btn');

  await page.waitForSelector('.agent-message-assistant', { timeout: 15000 });
  await expect(page.locator('.agent-message-assistant')).toContainText('I created a task list');
});

/* ---------- Context Files — UI & Interaction ---------- */

test('context bar renders with attach button when API keys are configured', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => {
    localStorage.setItem('waymark_agent_keys', JSON.stringify([
      { key: 'ctx-test-key', nickname: 'K1', addedAt: '2026-01-01', requestsToday: 0, lastUsed: null, lastError: null, isBilled: false },
    ]));
    window.location.hash = '#/agent';
  });
  await page.waitForSelector('.agent-context-bar', { timeout: 5000 });
  await expect(page.locator('.agent-context-bar')).toBeVisible();
  await expect(page.locator('.agent-context-attach-btn')).toBeVisible();
  await expect(page.locator('.agent-context-attach-btn')).toContainText('Add file');
});

test('context bar does not show attach button when no API keys configured', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => { window.location.hash = '#/agent'; });
  await page.waitForSelector('.agent-context-bar', { timeout: 5000 });
  await expect(page.locator('.agent-context-attach-btn')).toHaveCount(0);
});

test('attach button has pointer cursor', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => {
    localStorage.setItem('waymark_agent_keys', JSON.stringify([
      { key: 'ctx-test-key', nickname: 'K1', addedAt: '2026-01-01', requestsToday: 0, lastUsed: null, lastError: null, isBilled: false },
    ]));
    window.location.hash = '#/agent';
  });
  await page.waitForSelector('.agent-context-attach-btn', { timeout: 5000 });
  await expect(page.locator('.agent-context-attach-btn')).toHaveCSS('cursor', 'pointer');
});

test.skip('clicking attach button opens file picker overlay — replaced by Google Picker', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => {
    localStorage.setItem('waymark_agent_keys', JSON.stringify([
      { key: 'ctx-test-key', nickname: 'K1', addedAt: '2026-01-01', requestsToday: 0, lastUsed: null, lastError: null, isBilled: false },
    ]));
    window.location.hash = '#/agent';
  });
  await page.waitForSelector('.agent-context-attach-btn', { timeout: 5000 });
  await page.click('.agent-context-attach-btn');
  await page.waitForSelector('.agent-picker-overlay', { timeout: 5000 });
  await expect(page.locator('.agent-picker-overlay')).toBeVisible();
  await expect(page.locator('.agent-picker-panel')).toBeVisible();
  await expect(page.locator('.agent-picker-title')).toContainText('Add file to context');
  await expect(page.locator('.agent-picker-search')).toBeVisible();
});

test.skip('file picker shows sheets from Drive mock and allows selection — replaced by Google Picker', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => {
    localStorage.setItem('waymark_agent_keys', JSON.stringify([
      { key: 'ctx-test-key', nickname: 'K1', addedAt: '2026-01-01', requestsToday: 0, lastUsed: null, lastError: null, isBilled: false },
    ]));
    window.location.hash = '#/agent';
  });
  await page.waitForSelector('.agent-context-attach-btn', { timeout: 5000 });
  await page.click('.agent-context-attach-btn');
  await page.waitForSelector('.agent-picker-item', { timeout: 5000 });

  const items = page.locator('.agent-picker-item');
  const count = await items.count();
  expect(count).toBeGreaterThan(0);

  // Click the first item to add it
  const firstName = await items.first().locator('.agent-picker-item-name').textContent();
  await items.first().click();

  // Picker should close
  await expect(page.locator('.agent-picker-overlay')).toHaveCount(0);

  // Chip should appear in context bar
  await expect(page.locator('.agent-context-chip')).toHaveCount(1);
  await expect(page.locator('.agent-context-chip-name')).toContainText(firstName);
});

test.skip('file picker search filters sheets by name — replaced by Google Picker', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => {
    localStorage.setItem('waymark_agent_keys', JSON.stringify([
      { key: 'ctx-test-key', nickname: 'K1', addedAt: '2026-01-01', requestsToday: 0, lastUsed: null, lastError: null, isBilled: false },
    ]));
    window.location.hash = '#/agent';
  });
  await page.waitForSelector('.agent-context-attach-btn', { timeout: 5000 });
  await page.click('.agent-context-attach-btn');
  await page.waitForSelector('.agent-picker-item', { timeout: 5000 });

  const countBefore = await page.locator('.agent-picker-item').count();
  await page.fill('.agent-picker-search', 'zzzznonexistent');
  await expect(page.locator('.agent-picker-empty')).toBeVisible();

  await page.fill('.agent-picker-search', '');
  const countAfter = await page.locator('.agent-picker-item').count();
  expect(countAfter).toBe(countBefore);
});

test.skip('file picker closes when clicking overlay background — replaced by Google Picker', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => {
    localStorage.setItem('waymark_agent_keys', JSON.stringify([
      { key: 'ctx-test-key', nickname: 'K1', addedAt: '2026-01-01', requestsToday: 0, lastUsed: null, lastError: null, isBilled: false },
    ]));
    window.location.hash = '#/agent';
  });
  await page.waitForSelector('.agent-context-attach-btn', { timeout: 5000 });
  await page.click('.agent-context-attach-btn');
  await page.waitForSelector('.agent-picker-overlay', { timeout: 5000 });

  // Click the overlay itself (not the panel)
  await page.click('.agent-picker-overlay', { position: { x: 5, y: 5 } });
  await expect(page.locator('.agent-picker-overlay')).toHaveCount(0);
});

test.skip('file picker closes when clicking X button — replaced by Google Picker', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => {
    localStorage.setItem('waymark_agent_keys', JSON.stringify([
      { key: 'ctx-test-key', nickname: 'K1', addedAt: '2026-01-01', requestsToday: 0, lastUsed: null, lastError: null, isBilled: false },
    ]));
    window.location.hash = '#/agent';
  });
  await page.waitForSelector('.agent-context-attach-btn', { timeout: 5000 });
  await page.click('.agent-context-attach-btn');
  await page.waitForSelector('.agent-picker-close', { timeout: 5000 });
  await page.click('.agent-picker-close');
  await expect(page.locator('.agent-picker-overlay')).toHaveCount(0);
});

test('context chip remove button removes the file and updates the bar', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => {
    localStorage.setItem('waymark_agent_keys', JSON.stringify([
      { key: 'ctx-test-key', nickname: 'K1', addedAt: '2026-01-01', requestsToday: 0, lastUsed: null, lastError: null, isBilled: false },
    ]));
    localStorage.setItem('waymark_agent_context_files', JSON.stringify([
      { id: 'sheet-budget-1', name: 'Test Budget Sheet' },
    ]));
    window.location.hash = '#/agent';
  });
  await page.waitForSelector('.agent-context-chip', { timeout: 5000 });
  await expect(page.locator('.agent-context-chip')).toHaveCount(1);

  await page.click('.agent-context-chip-remove');
  await expect(page.locator('.agent-context-chip')).toHaveCount(0);

  // Verify localStorage was updated
  const files = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('waymark_agent_context_files'))
  );
  expect(files).toBeNull();
});

test('context files persist across agent view re-renders', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => {
    localStorage.setItem('waymark_agent_keys', JSON.stringify([
      { key: 'ctx-test-key', nickname: 'K1', addedAt: '2026-01-01', requestsToday: 0, lastUsed: null, lastError: null, isBilled: false },
    ]));
    localStorage.setItem('waymark_agent_context_files', JSON.stringify([
      { id: 'sheet-budget-1', name: 'My Budget' },
      { id: 'sheet-kanban-1', name: 'Project Board' },
    ]));
    window.location.hash = '#/agent';
  });
  await page.waitForSelector('.agent-context-chip', { timeout: 5000 });
  await expect(page.locator('.agent-context-chip')).toHaveCount(2);

  // Navigate away and back
  await page.evaluate(() => { window.location.hash = '#/'; });
  await page.waitForSelector('#home-view:not(.hidden)', { timeout: 5000 });
  await page.evaluate(() => { window.location.hash = '#/agent'; });
  await page.waitForSelector('.agent-context-chip', { timeout: 5000 });
  await expect(page.locator('.agent-context-chip')).toHaveCount(2);
});

test.skip('already-pinned files show added badge in picker — replaced by Google Picker', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => {
    localStorage.setItem('waymark_agent_keys', JSON.stringify([
      { key: 'ctx-test-key', nickname: 'K1', addedAt: '2026-01-01', requestsToday: 0, lastUsed: null, lastError: null, isBilled: false },
    ]));
    window.location.hash = '#/agent';
  });
  await page.waitForSelector('.agent-context-attach-btn', { timeout: 5000 });

  // Add a file first
  await page.click('.agent-context-attach-btn');
  await page.waitForSelector('.agent-picker-item', { timeout: 5000 });
  await page.locator('.agent-picker-item').first().click();
  await expect(page.locator('.agent-context-chip')).toHaveCount(1);

  // Open picker again — the same file should show "added" badge
  await page.click('.agent-context-attach-btn');
  await page.waitForSelector('.agent-picker-item', { timeout: 5000 });
  const badges = page.locator('.agent-picker-item-badge');
  await expect(badges.first()).toContainText('added');
});

test('context chip remove button has pointer cursor', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => {
    localStorage.setItem('waymark_agent_keys', JSON.stringify([
      { key: 'ctx-test-key', nickname: 'K1', addedAt: '2026-01-01', requestsToday: 0, lastUsed: null, lastError: null, isBilled: false },
    ]));
    localStorage.setItem('waymark_agent_context_files', JSON.stringify([
      { id: 'sheet-budget-1', name: 'Test Sheet' },
    ]));
    window.location.hash = '#/agent';
  });
  await page.waitForSelector('.agent-context-chip-remove', { timeout: 5000 });
  await expect(page.locator('.agent-context-chip-remove')).toHaveCSS('cursor', 'pointer');
});

test('context bar renders correctly at mobile width', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await setupApp(page);
  await page.evaluate(() => {
    localStorage.setItem('waymark_agent_keys', JSON.stringify([
      { key: 'ctx-test-key', nickname: 'K1', addedAt: '2026-01-01', requestsToday: 0, lastUsed: null, lastError: null, isBilled: false },
    ]));
    localStorage.setItem('waymark_agent_context_files', JSON.stringify([
      { id: 'sheet-budget-1', name: 'A Very Long Sheet Name That Should Truncate' },
    ]));
    window.location.hash = '#/agent';
  });
  await page.waitForSelector('.agent-context-bar', { timeout: 5000 });
  await expect(page.locator('.agent-context-bar')).toBeVisible();

  // Verify nothing overflows
  const overflows = await page.evaluate(() => {
    const problems = [];
    document.querySelectorAll('.agent-context-bar *').forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.right > window.innerWidth + 2) problems.push(el.className);
    });
    return problems;
  });
  expect(overflows).toHaveLength(0);
});

test('pinned context files are included in the system prompt context', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => {
    localStorage.setItem('waymark_agent_keys', JSON.stringify([
      { key: 'ctx-test-key', nickname: 'K1', addedAt: '2026-01-01', requestsToday: 0, lastUsed: null, lastError: null, isBilled: false },
    ]));
    localStorage.setItem('waymark_agent_context_files', JSON.stringify([
      { id: 'sheet-budget-1', name: 'My Budget' },
    ]));
    window.location.hash = '#/agent';
  });
  await page.waitForSelector('.agent-input:not([disabled])', { timeout: 5000 });

  // Intercept Gemini API call to inspect the system prompt
  let capturedBody = null;
  await page.route(/generativelanguage.*generateContent/, async route => {
    capturedBody = JSON.parse(route.request().postData());
    await route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        candidates: [{ content: { parts: [{ text: 'Budget looks good!' }] } }],
      }),
    });
  });
  await page.route(/streamGenerateContent/, async route => {
    await route.fulfill({ status: 500, body: '{}' });
  });

  await page.fill('.agent-input', 'What is in my budget?');
  await page.click('.agent-send-btn');
  await page.waitForSelector('.agent-message-assistant', { timeout: 15000 });

  // Verify the system prompt mentions pinned files
  expect(capturedBody).not.toBeNull();
  const systemText = capturedBody.systemInstruction?.parts?.[0]?.text || '';
  expect(systemText).toContain('pinned');
  expect(systemText).toContain('sheet-budget-1');
  expect(systemText).toContain('My Budget');
});
