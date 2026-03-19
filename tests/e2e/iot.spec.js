const { test, expect } = require('@playwright/test');
const { setupApp, navigateToSheet, getCreatedRecords } = require('../helpers/test-utils');

/* ─── Multi-sensor sheet (sheet-047): 6 different sensors ─── */

test('iot template is detected for multi-sensor sheet-047', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-047');
  await page.waitForSelector('.iot-view', { timeout: 5000 });
  await expect(page.locator('.iot-view')).toBeVisible();
  await expect(page.locator('#template-badge')).toContainText('IoT Sensor Log');
});

test('multi-sensor view renders six sensor cards', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-047');
  await page.waitForSelector('.iot-card', { timeout: 5000 });
  await expect(page.locator('.iot-card')).toHaveCount(6);
});

test('multi-sensor summary bar shows chips with sensor count and attention', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-047');
  await page.waitForSelector('.iot-summary-bar', { timeout: 5000 });

  /* First chip contains the total (6) sensors */
  const chips = page.locator('.iot-summary-chip');
  const firstChipText = await chips.first().textContent();
  expect(firstChipText).toContain('6');

  /* At least one chip indicates need-attention sensors */
  const allText = await page.locator('.iot-summary-bar').textContent();
  expect(allText).toMatch(/need attention|offline/i);
});

test('filter by Needs Attention shows only non-Normal sensors', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-047');
  await page.waitForSelector('.iot-filter-btn', { timeout: 5000 });

  /* Click the second filter button (Needs Attention) */
  await page.locator('.iot-filter-btn').nth(1).click();

  /* Wait for grid to update */
  await page.waitForFunction(
    () => document.querySelectorAll('.iot-card').length < 6,
    { timeout: 3000 }
  );

  const remaining = await page.locator('.iot-card').count();
  expect(remaining).toBeGreaterThan(0);
  expect(remaining).toBeLessThan(6);

  /* Clicking All Sensors restores full count */
  await page.locator('.iot-filter-btn').first().click();
  await expect(page.locator('.iot-card')).toHaveCount(6);
});

test('state button click cycles sensor state and emits a record', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-047');
  await page.waitForSelector('.iot-state-btn', { timeout: 5000 });

  const btn = page.locator('.iot-state-btn').first();
  const initialText = await btn.textContent();
  await btn.click();
  const afterText = await btn.textContent();
  expect(afterText).not.toBe(initialText);

  const records = await getCreatedRecords(page);
  expect(records.length).toBeGreaterThan(0);
});

test('state button and filter button have pointer cursor', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-047');
  await page.waitForSelector('.iot-state-btn', { timeout: 5000 });

  await expect(page.locator('.iot-state-btn').first()).toHaveCSS('cursor', 'pointer');
  await expect(page.locator('.iot-filter-btn').first()).toHaveCSS('cursor', 'pointer');
});

test('sensor cards use Waymark surface and shadow design tokens', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-047');
  await page.waitForSelector('.iot-card', { timeout: 5000 });

  /* Card should have a non-transparent background */
  const bg = await page.locator('.iot-card').first().evaluate(
    el => getComputedStyle(el).backgroundColor
  );
  expect(bg).not.toBe('rgba(0, 0, 0, 0)');
  expect(bg).not.toBe('');

  /* Card border should exist */
  const border = await page.locator('.iot-card').first().evaluate(
    el => getComputedStyle(el).borderTopWidth
  );
  expect(parseFloat(border)).toBeGreaterThan(0);
});

test('multi-sensor view has no horizontal overflow at 375px', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await setupApp(page);
  await navigateToSheet(page, 'sheet-047');
  await page.waitForSelector('.iot-grid', { timeout: 5000 });

  const overflows = await page.evaluate(() => {
    const issues = [];
    document.querySelectorAll('.iot-view *').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.right > window.innerWidth + 3) {
        issues.push((el.className || el.tagName).toString().slice(0, 60));
      }
    });
    return issues;
  });
  expect(overflows).toHaveLength(0);
});

/* ─── Single-sensor sheet (sheet-048): 6 readings, 1 sensor name ─── */

test('iot template is detected for per-sensor sheet-048', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-048');
  await page.waitForSelector('.iot-single-view', { timeout: 5000 });
  await expect(page.locator('.iot-single-view')).toBeVisible();
  await expect(page.locator('#template-badge')).toContainText('IoT Sensor Log');
});

test('single-sensor view renders hero card with sensor name', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-048');
  await page.waitForSelector('.iot-hero', { timeout: 5000 });

  await expect(page.locator('.iot-hero')).toBeVisible();
  await expect(page.locator('.iot-hero-name')).toContainText('Boiler Room Temp');
});

test('hero shows latest reading value (last row = 26.9 C)', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-048');
  await page.waitForSelector('.iot-hero-reading', { timeout: 5000 });

  await expect(page.locator('.iot-hero-reading')).toContainText('26.9');
});

test('hero badge reflects latest status (Alert — exceeds max 26)', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-048');
  await page.waitForSelector('.iot-hero-badge', { timeout: 5000 });

  await expect(page.locator('.iot-hero-badge')).toContainText('Alert');
  await expect(page.locator('.iot-hero-badge')).toHaveClass(/iot-badge-alert/);
});

test('hero border left styling indicates alert tone', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-048');
  await page.waitForSelector('.iot-hero-alert', { timeout: 5000 });

  await expect(page.locator('.iot-hero')).toHaveClass(/iot-hero-alert/);
});

test('threshold range bar renders for sensor with min/max', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-048');
  await page.waitForSelector('.iot-thresh-wrap', { timeout: 5000 });

  await expect(page.locator('.iot-thresh-wrap')).toBeVisible();
  await expect(page.locator('.iot-thresh-fill')).toBeVisible();
});

test('reading history table shows all 6 readings', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-048');
  await page.waitForSelector('.iot-history-table', { timeout: 5000 });

  /* 6 data rows → 6 history rows (newest first, header not counted) */
  await expect(page.locator('.iot-history-row')).toHaveCount(6);
});

test('history header shows newest reading first', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-048');
  await page.waitForSelector('.iot-history-row', { timeout: 5000 });

  /* Most recent row (26.9 C Alert) should be first */
  await expect(page.locator('.iot-history-row').first().locator('.iot-history-reading')).toContainText('26.9');
});

test('single view has no horizontal overflow at 375px', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await setupApp(page);
  await navigateToSheet(page, 'sheet-048');
  await page.waitForSelector('.iot-single-view', { timeout: 5000 });

  const overflows = await page.evaluate(() => {
    const issues = [];
    document.querySelectorAll('.iot-view *').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.right > window.innerWidth + 3) {
        issues.push((el.className || el.tagName).toString().slice(0, 60));
      }
    });
    return issues;
  });
  expect(overflows).toHaveLength(0);
});

/* ─── Live Stream panel (common to both views) ─── */

test('live stream panel renders with Connect button', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-047');
  await page.waitForSelector('.iot-stream-panel', { timeout: 5000 });

  await expect(page.locator('.iot-stream-title')).toContainText('Live Stream');
  await expect(page.locator('.iot-stream-select')).toBeVisible();
  await expect(page.locator('.iot-stream-connect')).toContainText('Connect');
  await expect(page.locator('.iot-stream-status')).toContainText('Disconnected');
});

test('stream mode selector includes all four transport options', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-047');
  await page.waitForSelector('.iot-stream-select', { timeout: 5000 });

  const options = await page.locator('.iot-stream-select option').allTextContents();
  expect(options).toContain('WebSocket');
  expect(options.some(t => /mqtt/i.test(t))).toBe(true);
  expect(options.some(t => /poll/i.test(t))).toBe(true);
  expect(options.some(t => /serial/i.test(t))).toBe(true);
});

test('selecting MQTT mode reveals topic input and hides poll interval', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-047');
  await page.waitForSelector('.iot-stream-panel', { timeout: 5000 });

  await page.locator('.iot-stream-select').selectOption('mqtt');
  await expect(page.locator('.iot-stream-topic')).toBeVisible();
  await expect(page.locator('.iot-stream-interval')).toHaveClass(/hidden/);
});

test('selecting serial mode reveals baud rate input', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-047');
  await page.waitForSelector('.iot-stream-panel', { timeout: 5000 });

  await page.locator('.iot-stream-select').selectOption('serial');
  await expect(page.locator('.iot-stream-baud')).toBeVisible();
});

test('selecting poll mode reveals interval input', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-048');
  await page.waitForSelector('.iot-stream-panel', { timeout: 5000 });

  await page.locator('.iot-stream-select').selectOption('poll');
  await expect(page.locator('.iot-stream-interval')).toBeVisible();
  await expect(page.locator('.iot-stream-interval')).not.toHaveClass(/hidden/);
});

test('stream panel has export CSV and Clear Log buttons', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-047');
  await page.waitForSelector('.iot-stream-panel', { timeout: 5000 });

  await expect(page.locator('button', { hasText: 'Export CSV' })).toBeVisible();
  await expect(page.locator('button', { hasText: 'Clear Log' })).toBeVisible();
});

test('HTTP polling stream append updates single-sensor hero and appends history row', async ({ page }) => {
  await page.route('**/iot-sensor-stream', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        sensor: 'Boiler Room Temp',
        reading: 27.5,
        unit: 'C',
        timestamp: '2026-03-19T07:00:00Z',
        alert: 'Alert',
      }),
    });
  });

  await setupApp(page);
  await navigateToSheet(page, 'sheet-048');
  await page.waitForSelector('.iot-stream-panel', { timeout: 5000 });

  await page.locator('.iot-stream-select').selectOption('poll');
  await page.locator('.iot-stream-input').first().fill('/iot-sensor-stream');
  await page.locator('.iot-stream-interval').fill('1');
  await page.locator('.iot-stream-connect').click();

  /* Hero reading should update to 27.5 C */
  await expect(page.locator('.iot-hero-reading')).toContainText('27.5', { timeout: 5000 });
  /* History should now have 7 rows (6 original + 1 streamed) */
  await expect(page.locator('.iot-history-row')).toHaveCount(7, { timeout: 5000 });
});

test('HTTP polling stream updates matching sensor card in multi-sensor view', async ({ page }) => {
  await page.route('**/iot-live', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        sensor: 'Boiler Room Temp',
        reading: 24.9,
        unit: 'C',
        timestamp: '2026-03-19T11:00:00Z',
        alert: 'Normal',
      }),
    });
  });

  await setupApp(page);
  await navigateToSheet(page, 'sheet-047');
  await page.waitForSelector('.iot-stream-panel', { timeout: 5000 });

  await page.locator('.iot-stream-select').selectOption('poll');
  await page.locator('.iot-stream-input').first().fill('/iot-live');
  await page.locator('.iot-stream-interval').fill('1');
  await page.locator('.iot-stream-connect').click();

  /* The Boiler Room Temp card reading should update */
  await expect(page.locator('.iot-card').first().locator('.iot-card-reading')).toContainText('24.9 C', { timeout: 5000 });
  /* Status shows last ingested reading or polling confirmation */
  const statusText = await page.locator('.iot-stream-status').textContent();
  expect(statusText.length).toBeGreaterThan(0);
});

/* ─── Directory / Fleet Dashboard (folder f-iot-fleet) ─── */

test('iot fleet directoryView renders fleet dashboard title', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => {
    window.location.hash = '#/folder/f-iot-fleet/Building Sensors';
  });
  await page.waitForSelector('.iot-dir-title', { timeout: 8000 });

  await expect(page.locator('.iot-dir-title')).toContainText('Fleet Dashboard');
});

test('iot fleet directoryView shows sensor cards for each sheet', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => {
    window.location.hash = '#/folder/f-iot-fleet/Building Sensors';
  });
  await page.waitForSelector('.iot-dir-card', { timeout: 8000 });

  /* Folder has 2 sheets → 2 fleet cards */
  await expect(page.locator('.iot-dir-card')).toHaveCount(2);
});

test('fleet dashboard cards show sensor name and latest reading', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => {
    window.location.hash = '#/folder/f-iot-fleet/Building Sensors';
  });
  await page.waitForSelector('.iot-dir-card', { timeout: 8000 });

  /* sheet-048 (Boiler Room Temp, latest 26.9 C Alert) should appear */
  const texts = await page.locator('.iot-dir-card').allTextContents();
  const hasBoiler = texts.some(t => /Boiler Room/i.test(t));
  expect(hasBoiler).toBe(true);

  /* At least one card shows a reading with numeric value */
  const readings = await page.locator('.iot-dir-reading').allTextContents();
  const hasNumeric = readings.some(t => /\d/.test(t));
  expect(hasNumeric).toBe(true);
});

test('fleet dashboard totals bar shows sensor count', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => {
    window.location.hash = '#/folder/f-iot-fleet/Building Sensors';
  });
  await page.waitForSelector('.iot-dir-totals', { timeout: 8000 });

  const totalsText = await page.locator('.iot-dir-totals').textContent();
  expect(totalsText).toMatch(/2 sensor/);
});

test('fleet dashboard card click navigates to sensor sheet', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => {
    window.location.hash = '#/folder/f-iot-fleet/Building Sensors';
  });
  await page.waitForSelector('.iot-dir-card', { timeout: 8000 });

  await page.locator('.iot-dir-card').first().click();
  await page.waitForSelector('.iot-view:not(.hidden)', { timeout: 5000 });

  await expect(page.locator('#template-badge')).toContainText('IoT Sensor Log');
});

test('fleet dashboard cards have pointer cursor for navigation', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => {
    window.location.hash = '#/folder/f-iot-fleet/Building Sensors';
  });
  await page.waitForSelector('.iot-dir-card', { timeout: 8000 });

  await expect(page.locator('.iot-dir-card').first()).toHaveCSS('cursor', 'pointer');
});

test('fleet dashboard uses grid layout', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => {
    window.location.hash = '#/folder/f-iot-fleet/Building Sensors';
  });
  await page.waitForSelector('.iot-dir-grid', { timeout: 8000 });

  await expect(page.locator('.iot-dir-grid')).toHaveCSS('display', /grid/);
});

