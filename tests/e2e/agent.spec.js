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
  await expect(page.locator('.agent-header-title')).toContainText('Waymark AI Agent');
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
  await expect(suggestions.first()).toContainText('How do I add a new template?');
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

test('settings modal shows API key input field', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => { window.location.hash = '#/agent'; });
  await page.waitForSelector('.agent-settings-btn', { timeout: 5000 });
  await page.click('.agent-settings-btn');
  await page.waitForSelector('.agent-settings-input', { timeout: 3000 });
  await expect(page.locator('.agent-settings-input')).toBeVisible();
  await expect(page.locator('.agent-settings-input')).toHaveAttribute('type', 'password');
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

test('user configures API key via settings modal save button', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => { window.location.hash = '#/agent'; });
  await page.waitForSelector('.agent-settings-btn', { timeout: 5000 });

  // Open settings
  await page.click('.agent-settings-btn');
  await page.waitForSelector('.agent-settings-input', { timeout: 3000 });

  // Enter API key
  await page.fill('.agent-settings-input', 'test-api-key-abc');

  // Save
  await page.click('.agent-settings-save');

  // Verify modal closed and toast appeared
  await expect(page.locator('#agent-settings-modal')).toHaveCount(0);
  await page.waitForSelector('.toast', { timeout: 3000 });
  await expect(page.locator('.toast')).toContainText('saved');

  // Verify the view now shows empty state (not welcome)
  await page.waitForSelector('.agent-empty', { timeout: 3000 });
  await expect(page.locator('.agent-empty')).toBeVisible();
  await expect(page.locator('.agent-welcome')).toHaveCount(0);
});
