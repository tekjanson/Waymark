const { test, expect } = require('@playwright/test');
const { setupApp, navigateToSheet, getCreatedRecords } = require('../helpers/test-utils');

/* ── Helper: compute contrast ratio between text color and effective background.
 *  Walks up the DOM to find the nearest opaque background, alpha-blends
 *  semi-transparent backgrounds along the way, then computes WCAG ratio.
 * ──────────────────────────────────────────────────────────────────────────── */
async function getContrastRatio(page, selector) {
  return page.evaluate((sel) => {
    function parseColor(css) {
      const m = css.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
      if (!m) return null;
      return { r: +m[1], g: +m[2], b: +m[3], a: m[4] !== undefined ? +m[4] : 1 };
    }
    function blend(fg, bg) {
      // Alpha-composite fg over bg
      const a = fg.a;
      return {
        r: Math.round(fg.r * a + bg.r * (1 - a)),
        g: Math.round(fg.g * a + bg.g * (1 - a)),
        b: Math.round(fg.b * a + bg.b * (1 - a)),
        a: 1,
      };
    }
    function relativeLuminance({ r, g, b }) {
      return [r, g, b].map(c => {
        const s = c / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      }).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
    }
    function contrastRatio(c1, c2) {
      const l1 = relativeLuminance(c1), l2 = relativeLuminance(c2);
      const lighter = Math.max(l1, l2), darker = Math.min(l1, l2);
      return (lighter + 0.05) / (darker + 0.05);
    }

    // Walk up DOM to find effective opaque background color
    function effectiveBg(el) {
      let composite = { r: 255, g: 255, b: 255, a: 1 }; // assume white root
      const chain = [];
      let cur = el;
      while (cur && cur !== document.body.parentElement) {
        chain.unshift(cur);
        cur = cur.parentElement;
      }
      for (const node of chain) {
        const bg = parseColor(window.getComputedStyle(node).backgroundColor);
        if (bg && bg.a > 0) composite = blend(bg, composite);
      }
      return composite;
    }

    const target = document.querySelector(sel);
    if (!target) return null;
    const style = window.getComputedStyle(target);
    const fg = parseColor(style.color);
    if (!fg) return null;
    const bg = effectiveBg(target);
    return contrastRatio(fg, bg);
  }, selector);
}

test('agents template detects and renders cards', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-057');
  await expect(page.locator('.agents-grid')).toBeVisible();
  await expect(page.locator('.agents-card')).toHaveCount(4);
});

test('agents template renders agent names', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-057');
  await expect(page.locator('.agents-name').first()).toContainText('Alex');
});

test('agents template renders status badges', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-057');
  const badges = page.locator('.agents-status-badge');
  await expect(badges.first()).toContainText('Online');
});

test('agents template renders tuning section', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-057');
  await expect(page.locator('.agents-tuning-section').first()).toBeVisible();
  await expect(page.locator('.agents-tuning-label').first()).toContainText('Tuning');
});

test('agents template renders workboard field', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-057');
  await expect(page.locator('.agents-workboard').first()).toBeVisible();
  await expect(page.locator('.agents-field-label').first()).toContainText('Workboard');
});

test('agents template renders header stats', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-057');
  await expect(page.locator('.agents-header-stats')).toBeVisible();
  await expect(page.locator('.agents-stat').first()).toContainText('4');
});

test('agents template renders avatar initials', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-057');
  // "Alex" → 1 word → 1 initial: "A"
  await expect(page.locator('.agents-avatar').first()).toContainText('A');
});

test('Dev Fleet sidebar button is visible', async ({ page }) => {
  await setupApp(page);
  await expect(page.locator('#menu-fleet-btn')).toBeVisible();
  await expect(page.locator('#menu-fleet-btn')).toContainText('Dev Fleet');
});

test('Set as Fleet Registry button appears on agents sheet', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-057');
  // Open the more-actions overflow menu
  await page.click('#more-actions-btn');
  await expect(page.locator('#set-fleet-btn')).toBeVisible();
  await expect(page.locator('#set-fleet-btn')).toContainText('Set as Fleet Registry');
});

test('Dev Fleet button navigates to fleet sheet after pin', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-057');
  // Open overflow and click Set as Fleet Registry
  await page.click('#more-actions-btn');
  await page.click('#set-fleet-btn');
  // Navigate away then use Fleet button
  await page.evaluate(() => { window.location.hash = '#/'; });
  await page.waitForSelector('#home-view:not(.hidden)', { timeout: 5000 });
  await page.click('#menu-fleet-btn');
  await page.waitForSelector('.agents-grid', { timeout: 10000 });
  await expect(page.locator('.agents-grid')).toBeVisible();
});

/* ── Dark mode contrast tests ─────────────────────────────────────────────── */

test('agents dark mode: agent name has readable contrast', async ({ page }) => {
  await setupApp(page, { theme: 'dark' });
  await navigateToSheet(page, 'sheet-057');
  await expect(page.locator('.agents-name').first()).toBeVisible();
  // WCAG AA requires ≥4.5 for normal text
  const ratio = await getContrastRatio(page, '.agents-name');
  expect(ratio).toBeGreaterThanOrEqual(4.5);
});

test('agents dark mode: tuning cell text is readable', async ({ page }) => {
  await setupApp(page, { theme: 'dark' });
  await navigateToSheet(page, 'sheet-057');
  await expect(page.locator('.agents-tuning-cell').first()).toBeVisible();
  const ratio = await getContrastRatio(page, '.agents-tuning-cell');
  expect(ratio).toBeGreaterThanOrEqual(4.5);
});

test('agents dark mode: tuning label is readable', async ({ page }) => {
  await setupApp(page, { theme: 'dark' });
  await navigateToSheet(page, 'sheet-057');
  const ratio = await getContrastRatio(page, '.agents-tuning-label');
  // Large text (bold) only needs ≥3.0 (WCAG AA for large/bold)
  expect(ratio).toBeGreaterThanOrEqual(3.0);
});

test('agents dark mode: workboard cell is readable', async ({ page }) => {
  await setupApp(page, { theme: 'dark' });
  await navigateToSheet(page, 'sheet-057');
  await expect(page.locator('.agents-workboard-cell').first()).toBeVisible();
  const ratio = await getContrastRatio(page, '.agents-workboard-cell');
  expect(ratio).toBeGreaterThanOrEqual(3.0);
});

test('agents dark mode: command cell is readable', async ({ page }) => {
  await setupApp(page, { theme: 'dark' });
  await navigateToSheet(page, 'sheet-057');
  await expect(page.locator('.agents-command-cell').first()).toBeVisible();
  const ratio = await getContrastRatio(page, '.agents-command-cell');
  expect(ratio).toBeGreaterThanOrEqual(3.0);
});

test('agents dark mode: copilot provider badge is readable', async ({ page }) => {
  await setupApp(page, { theme: 'dark' });
  await navigateToSheet(page, 'sheet-057');
  await expect(page.locator('.agents-provider-copilot').first()).toBeVisible();
  const ratio = await getContrastRatio(page, '.agents-provider-copilot');
  expect(ratio).toBeGreaterThanOrEqual(3.0);
});

test('agents dark mode: card background uses surface token not hardcoded white', async ({ page }) => {
  await setupApp(page, { theme: 'dark' });
  await navigateToSheet(page, 'sheet-057');
  // In dark mode, card background must NOT be near-white (#fafbfc = rgb(250,251,252))
  const bgColor = await page.evaluate(() => {
    const card = document.querySelector('.agents-card');
    if (!card) return null;
    return window.getComputedStyle(card).backgroundColor;
  });
  expect(bgColor).not.toBeNull();
  // Near-white detection: all channels > 230
  const m = bgColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (m) {
    const [r, g, b] = [parseInt(m[1]), parseInt(m[2]), parseInt(m[3])];
    const isNearWhite = r > 230 && g > 230 && b > 230;
    expect(isNearWhite).toBe(false);
  }
});

test('agents dark mode: tuning cell background is not near-white', async ({ page }) => {
  await setupApp(page, { theme: 'dark' });
  await navigateToSheet(page, 'sheet-057');
  const effectiveBg = await page.evaluate(() => {
    function parseColor(css) {
      const m = css.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
      if (!m) return null;
      return { r: +m[1], g: +m[2], b: +m[3], a: m[4] !== undefined ? +m[4] : 1 };
    }
    function blend(fg, bg) {
      const a = fg.a;
      return { r: Math.round(fg.r * a + bg.r * (1 - a)), g: Math.round(fg.g * a + bg.g * (1 - a)), b: Math.round(fg.b * a + bg.b * (1 - a)), a: 1 };
    }
    let composite = { r: 255, g: 255, b: 255, a: 1 };
    const cell = document.querySelector('.agents-tuning-cell');
    if (!cell) return null;
    const chain = [];
    let cur = cell;
    while (cur && cur !== document.body.parentElement) { chain.unshift(cur); cur = cur.parentElement; }
    for (const node of chain) {
      const bg = parseColor(window.getComputedStyle(node).backgroundColor);
      if (bg && bg.a > 0) composite = blend(bg, composite);
    }
    return composite;
  });
  expect(effectiveBg).not.toBeNull();
  const isNearWhite = effectiveBg.r > 230 && effectiveBg.g > 230 && effectiveBg.b > 230;
  expect(isNearWhite).toBe(false);
});

test('agents light mode: agent name has readable contrast', async ({ page }) => {
  await setupApp(page, { theme: 'light' });
  await navigateToSheet(page, 'sheet-057');
  const ratio = await getContrastRatio(page, '.agents-name');
  expect(ratio).toBeGreaterThanOrEqual(4.5);
});

test('agents light mode: tuning cell text is readable', async ({ page }) => {
  await setupApp(page, { theme: 'light' });
  await navigateToSheet(page, 'sheet-057');
  const ratio = await getContrastRatio(page, '.agents-tuning-cell');
  expect(ratio).toBeGreaterThanOrEqual(4.5);
});

/* ── Write-back propagation tests ────────────────────────────────────────────
 * These verify that editing a field in the UI fires api.sheets.updateCell(),
 * recorded in window.__WAYMARK_RECORDS as type 'cell-update'.
 * ──────────────────────────────────────────────────────────────────────────── */

test('agents: editing agent name in UI fires a cell-update record', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-057');
  // Click the first agent name (editableCell)
  const nameEl = page.locator('.agents-name').first();
  await nameEl.click();
  const input = nameEl.locator('input.editable-cell-input');
  await expect(input).toBeVisible({ timeout: 3000 });
  await input.fill('Alex-Updated');
  await input.press('Enter');
  // Verify a cell-update record was created
  const records = await getCreatedRecords(page);
  expect(records.some(r => r.type === 'cell-update' && r.value === 'Alex-Updated')).toBe(true);
});

test('agents: editing tuning textarea in UI fires a cell-update record', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-057');
  // Click the first tuning cell (textareaCell)
  const tuningEl = page.locator('.agents-tuning-cell').first();
  await tuningEl.click();
  const ta = tuningEl.locator('textarea.editable-cell-textarea');
  await expect(ta).toBeVisible({ timeout: 3000 });
  await ta.fill('Be extremely concise. Avoid repetition.');
  // Commit via Ctrl+Enter
  await ta.press('Control+Enter');
  const records = await getCreatedRecords(page);
  expect(records.some(r => r.type === 'cell-update' && r.value === 'Be extremely concise. Avoid repetition.')).toBe(true);
});

test('agents: editing workboard cell in UI fires a cell-update record', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-057');
  const workboardEl = page.locator('.agents-workboard-cell').first();
  await workboardEl.click();
  const input = workboardEl.locator('input.editable-cell-input');
  await expect(input).toBeVisible({ timeout: 3000 });
  await input.fill('new-sheet-id-12345');
  await input.press('Enter');
  const records = await getCreatedRecords(page);
  expect(records.some(r => r.type === 'cell-update' && r.value === 'new-sheet-id-12345')).toBe(true);
});

/* ── Add Agent form tests ─────────────────────────────────────────────────────
 * Verify the "Add Agent" form appears and submitting it fires a row-append record.
 * ──────────────────────────────────────────────────────────────────────────── */

test('agents: Add Agent trigger button is visible', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-057');
  // checklist.js renders .add-row-trigger for templates with addRowFields()
  await expect(page.locator('.add-row-trigger')).toBeVisible();
  await expect(page.locator('.add-row-trigger')).toContainText('Add Agent');
});

test('agents: clicking Add Agent button expands the form', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-057');
  await page.click('.add-row-trigger');
  await expect(page.locator('.add-row-form')).toBeVisible({ timeout: 3000 });
  // Form must have at minimum a Name field
  await expect(page.locator('.add-row-field-input').first()).toBeVisible();
});

test('agents: submitting Add Agent form fires a row-append record', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-057');
  await page.click('.add-row-trigger');
  // Fill in agent name
  const nameInput = page.locator('.add-row-field-input').first();
  await expect(nameInput).toBeVisible({ timeout: 3000 });
  await nameInput.fill('River');
  // Submit
  await page.click('.add-row-submit');
  const records = await getCreatedRecords(page);
  const appendRec = records.find(r => r.type === 'row-append');
  expect(appendRec).toBeTruthy();
  // The row data must include the agent name
  const rowData = appendRec.rows?.[0] ?? [];
  expect(rowData.some(v => v === 'River')).toBe(true);
});

/* ── Fleet webhook / Sync Fleet button tests ────────────────────────────────
 * These inject window.__WAYMARK_FLEET_WEBHOOK via addInitScript so the
 * button renders, then use page.route() to intercept the fetch without
 * needing a real webhook server running.
 * ──────────────────────────────────────────────────────────────────────────── */

test('agents: Sync Fleet button is hidden without webhook URL', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-057');
  // No webhook URL configured → button renders but is display:none (still in DOM)
  // The configure button (⚙️) is always visible
  const syncBtn = page.locator('.agents-sync-btn');
  await expect(syncBtn).toHaveCount(1);
  const isVisible = await syncBtn.isVisible();
  expect(isVisible).toBe(false);
  await expect(page.locator('.agents-cfg-btn')).toBeVisible();
});

test('agents: Sync Fleet button appears when webhook URL is configured', async ({ page }) => {
  await page.addInitScript(() => {
    window.__WAYMARK_FLEET_WEBHOOK = 'http://localhost:3002';
  });
  await setupApp(page);
  await navigateToSheet(page, 'sheet-057');
  await expect(page.locator('.agents-sync-btn')).toBeVisible();
  await expect(page.locator('.agents-sync-btn')).toContainText('Sync Fleet');
});

test('agents: clicking Sync Fleet POSTs to the webhook /fleet-sync route', async ({ page }) => {
  let capturedRequest = null;
  await page.addInitScript(() => {
    window.__WAYMARK_FLEET_WEBHOOK = 'http://localhost:3002';
  });
  // Intercept the fetch before it hits the network
  await page.route('http://localhost:3002/fleet-sync', async (route) => {
    capturedRequest = route.request();
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, output: 'started: dev-worker-river' }) });
  });
  await setupApp(page);
  await navigateToSheet(page, 'sheet-057');
  await page.click('.agents-sync-btn');
  // Wait for request to fire
  await page.waitForTimeout(500);
  expect(capturedRequest).not.toBeNull();
  expect(capturedRequest.method()).toBe('POST');
  expect(capturedRequest.url()).toBe('http://localhost:3002/fleet-sync');
});

test('agents: Sync Fleet shows success toast on 200 response', async ({ page }) => {
  await page.addInitScript(() => {
    window.__WAYMARK_FLEET_WEBHOOK = 'http://localhost:3002';
  });
  await page.route('http://localhost:3002/fleet-sync', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, output: 'done' }) })
  );
  await setupApp(page);
  await navigateToSheet(page, 'sheet-057');
  await page.click('.agents-sync-btn');
  await expect(page.locator('.toast')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('.toast')).toContainText('Fleet synced');
});

test('agents: Sync Fleet shows error toast on failure response', async ({ page }) => {
  await page.addInitScript(() => {
    window.__WAYMARK_FLEET_WEBHOOK = 'http://localhost:3002';
  });
  await page.route('http://localhost:3002/fleet-sync', route =>
    route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'make fleet-sync failed' }) })
  );
  await setupApp(page);
  await navigateToSheet(page, 'sheet-057');
  await page.click('.agents-sync-btn');
  await expect(page.locator('.toast')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('.toast')).toContainText('failed');
});

/* ── Workboard link tests ────────────────────────────────────────────────────
 * The Workboard cell renders as a clickable "↗ Open" link when the cell has
 * a value, linking to #/sheet/{id} in the Waymark viewer.
 * ──────────────────────────────────────────────────────────────────────────── */

test('agents: workboard field shows Open link when value is set', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-057');
  // First agent (Alex) has a workboard Sheet ID in the fixture
  const openLink = page.locator('.agents-workboard-open').first();
  await expect(openLink).toBeVisible();
  await expect(openLink).toContainText('↗ Open');
});

test('agents: workboard Open link href points to #/sheet/{id}', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-057');
  const openLink = page.locator('.agents-workboard-open').first();
  await expect(openLink).toBeVisible();
  const href = await openLink.getAttribute('href');
  expect(href).toMatch(/^#\/sheet\/.+/);
  // Must contain the actual Sheet ID from the fixture
  expect(href).toContain('1Jl-fmWVEGatzOORp4wPQwPpg78binoBlCWATP9xb_q4');
});

test('agents: workboard Open link navigates to the sheet', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-057');
  const openLink = page.locator('.agents-workboard-open').first();
  await expect(openLink).toBeVisible();
  await openLink.click();
  // Hash should now reference the workboard sheet ID
  await page.waitForFunction(() => location.hash.includes('/sheet/'), { timeout: 3000 });
  expect(page.url()).toContain('/sheet/1Jl-fmWVEGatzOORp4wPQwPpg78binoBlCWATP9xb_q4');
});

test('agents: workboard cell is still editable after Open link added', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-057');
  const workboardCell = page.locator('.agents-workboard-cell').first();
  await workboardCell.click();
  const input = workboardCell.locator('input.editable-cell-input');
  await expect(input).toBeVisible({ timeout: 3000 });
  await input.fill('new-workboard-id-99');
  await input.press('Enter');
  const records = await getCreatedRecords(page);
  expect(records.some(r => r.type === 'cell-update' && r.value === 'new-workboard-id-99')).toBe(true);
});

/* ── Webhook configure button (⚙️) tests ────────────────────────────────────
 * The ⚙️ button lets users on any deployment (e.g. swiftirons.com) configure
 * their local webhook URL. It saves to localStorage and shows the Sync button.
 * ──────────────────────────────────────────────────────────────────────────── */

test('agents: configure button (⚙️) is always visible', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-057');
  await expect(page.locator('.agents-cfg-btn')).toBeVisible();
});

test('agents: configure button toggles the webhook URL input', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-057');
  const cfgInput = page.locator('.agents-cfg-input');
  // Initially hidden
  await expect(cfgInput).toBeHidden();
  // Click ⚙️ → input appears
  await page.click('.agents-cfg-btn');
  await expect(cfgInput).toBeVisible({ timeout: 2000 });
  // Click again → input hides
  await page.click('.agents-cfg-btn');
  await expect(cfgInput).toBeHidden();
});

test('agents: saving webhook URL via configure makes Sync Fleet visible', async ({ page }) => {
  // No server-injected URL — Sync Fleet starts hidden
  await setupApp(page);
  await navigateToSheet(page, 'sheet-057');
  await expect(page.locator('.agents-sync-btn')).toBeHidden();

  // Open cfg input and type a URL, then press Enter
  await page.route('http://localhost:3002/fleet-sync', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, output: 'done' }) })
  );
  await page.click('.agents-cfg-btn');
  await page.fill('.agents-cfg-input', 'http://localhost:3002');
  await page.keyboard.press('Enter');

  // Toast should confirm save
  await expect(page.locator('.toast')).toBeVisible({ timeout: 3000 });
  await expect(page.locator('.toast')).toContainText('saved');

  // Sync Fleet button should now be visible
  await expect(page.locator('.agents-sync-btn')).toBeVisible({ timeout: 2000 });
});

test('agents: configured webhook URL persists in localStorage', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-057');
  await page.click('.agents-cfg-btn');
  await page.fill('.agents-cfg-input', 'http://localhost:3002');
  await page.keyboard.press('Enter');
  await expect(page.locator('.toast')).toBeVisible({ timeout: 3000 });

  // Verify localStorage was written
  const stored = await page.evaluate(() => localStorage.getItem('waymark_fleet_webhook_url'));
  expect(stored).toBe('http://localhost:3002');
});

test('agents: Sync Fleet uses localStorage webhook URL when no server flag', async ({ page }) => {
  let capturedUrl = null;
  await page.addInitScript(() => {
    localStorage.setItem('waymark_fleet_webhook_url', 'http://localhost:3002');
  });
  await page.route('http://localhost:3002/fleet-sync', async (route) => {
    capturedUrl = route.request().url();
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, output: 'done' }) });
  });
  await setupApp(page);
  await navigateToSheet(page, 'sheet-057');
  // Button should be visible (URL came from localStorage, no server flag)
  await expect(page.locator('.agents-sync-btn')).toBeVisible({ timeout: 2000 });
  await page.click('.agents-sync-btn');
  await expect(page.locator('.toast')).toBeVisible({ timeout: 5000 });
  expect(capturedUrl).toBe('http://localhost:3002/fleet-sync');
});

test('agents template renders delete button on hover', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-057');
  const firstCard = page.locator('.agents-card').first();
  const deleteBtn = firstCard.locator('.agents-delete-btn');
  
  // Button should be hidden initially
  await expect(deleteBtn).toHaveCSS('opacity', '0');
  
  // Button should show on hover
  await firstCard.hover();
  await expect(deleteBtn).toHaveCSS('opacity', '1');
});

test('agents template delete button opens confirmation modal', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-057');
  const firstCard = page.locator('.agents-card').first();
  const deleteBtn = firstCard.locator('.agents-delete-btn');
  
  // Hover to reveal delete button
  await firstCard.hover();
  
  // Click delete button
  await deleteBtn.click();
  
  // Modal should be visible
  await expect(page.locator('.agents-delete-modal')).not.toHaveClass(/hidden/);
  await expect(page.locator('.agents-delete-modal')).toBeVisible();
});

test('agents template delete modal shows agent name', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-057');
  const deleteBtn = page.locator('.agents-card').first().locator('.agents-delete-btn');
  
  // Hover and click delete
  await page.locator('.agents-card').first().hover();
  await deleteBtn.click();
  
  // Agent name should be in modal
  await expect(page.locator('.agents-delete-agent-name')).toContainText('Alex');
});

test('agents template delete modal cancel button', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-057');
  const deleteBtn = page.locator('.agents-card').first().locator('.agents-delete-btn');
  
  await page.locator('.agents-card').first().hover();
  await deleteBtn.click();
  
  // Click cancel
  await page.locator('.agents-delete-modal-cancel').click();
  
  // Modal should be hidden
  await expect(page.locator('.agents-delete-modal')).toHaveClass(/hidden/);
});

test('agents template delete button sends edit', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-057');
  const deleteBtn = page.locator('.agents-card').first().locator('.agents-delete-btn');
  
  await page.locator('.agents-card').first().hover();
  await deleteBtn.click();
  
  // Click confirm delete
  await page.locator('.agents-confirm-delete-btn').click();
  
  // Check that an edit record was created (agent name cleared)
  const records = await page.evaluate(() => window.__WAYMARK_RECORDS || []);
  const deleteRecord = records.find(r => r.colIndex === 0 && r.value === '');
  expect(deleteRecord).toBeTruthy();
});

test('agents template renders folder field when present', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-057');
  
  // Check that folder field is rendered
  await expect(page.locator('.agents-folder')).toHaveCount(1);
  await expect(page.locator('.agents-folder').first()).toContainText('📁 Folder');
});

test('agents template folder field displays agent folder', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-057');
  
  // First agent should have "Engineering" folder
  const firstCard = page.locator('.agents-card').first();
  const folderField = firstCard.locator('.agents-folder');
  await expect(folderField).toContainText('Engineering');
});

test('agents template folder field is editable', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-057');
  
  // Click on folder cell to edit
  const folderCell = page.locator('.agents-folder-cell').first();
  await folderCell.click();
  
  // Should be in edit mode with input
  await expect(folderCell.locator('input.editable-cell-input')).toBeVisible();
});
