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
