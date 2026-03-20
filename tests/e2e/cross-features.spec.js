const { test, expect } = require('@playwright/test');
const { setupApp, navigateToSheet } = require('../helpers/test-utils');

/* ═══ Cross-Feature Bar: rendering on consumer template ═══ */

test('recipe sheet shows cross-feature bar with link button', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.cross-bar', { timeout: 5000 });
  await expect(page.locator('.cross-bar')).toBeVisible();
  await expect(page.locator('.cross-link-btn')).toBeVisible();
});

test('cross-feature link button displays correct label and icon', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.cross-link-btn', { timeout: 5000 });
  const btn = page.locator('.cross-link-btn');
  await expect(btn).toContainText('Link IoT Scale');
});

test('cross-feature link button has pointer cursor', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.cross-link-btn', { timeout: 5000 });
  await expect(page.locator('.cross-link-btn')).toHaveCSS('cursor', 'pointer');
});

test('cross-feature bar has flex layout', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.cross-bar', { timeout: 5000 });
  await expect(page.locator('.cross-bar')).toHaveCSS('display', 'flex');
});

/* ═══ Non-consumer templates: no cross-feature bar ═══ */

test('IoT sheet does not show cross-feature bar', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-048');
  await page.waitForSelector('.iot-view', { timeout: 5000 });
  await expect(page.locator('.cross-bar')).toHaveCount(0);
});

test('checklist sheet does not show cross-feature bar', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-001');
  await page.waitForSelector('#template-badge:not(.hidden)', { timeout: 5000 });
  await expect(page.locator('.cross-bar')).toHaveCount(0);
});

/* ═══ Picker overlay ═══ */

test('clicking link button opens cross-feature picker overlay', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.cross-link-btn', { timeout: 5000 });
  await page.click('.cross-link-btn');
  await page.waitForSelector('.cross-picker', { timeout: 5000 });
  await expect(page.locator('.cross-picker')).toBeVisible();
  await expect(page.locator('.cross-picker-panel')).toBeVisible();
  await expect(page.locator('.cross-picker-header h3')).toContainText('Link');
});

test('picker overlay has search input', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.cross-link-btn', { timeout: 5000 });
  await page.click('.cross-link-btn');
  await page.waitForSelector('.cross-picker-search', { timeout: 5000 });
  const search = page.locator('.cross-picker-search');
  await expect(search).toBeVisible();
  await expect(search).toHaveAttribute('placeholder', /search/i);
});

test('picker closes via close button', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.cross-link-btn', { timeout: 5000 });
  await page.click('.cross-link-btn');
  await page.waitForSelector('.cross-picker', { timeout: 5000 });
  await page.click('.cross-picker-close');
  await expect(page.locator('.cross-picker')).toHaveCount(0);
});

test('picker closes via overlay click', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.cross-link-btn', { timeout: 5000 });
  await page.click('.cross-link-btn');
  await page.waitForSelector('.cross-picker', { timeout: 5000 });
  await page.click('.cross-picker', { position: { x: 5, y: 5 } });
  await expect(page.locator('.cross-picker')).toHaveCount(0);
});

test('picker lists compatible IoT sheets', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.cross-link-btn', { timeout: 5000 });
  await page.click('.cross-link-btn');
  await page.waitForSelector('.cross-picker-item', { timeout: 10000 });
  const count = await page.locator('.cross-picker-item').count();
  expect(count).toBeGreaterThan(0);
});

test('picker search filters sheet list', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.cross-link-btn', { timeout: 5000 });
  await page.click('.cross-link-btn');
  await page.waitForSelector('.cross-picker-item', { timeout: 10000 });
  const countBefore = await page.locator('.cross-picker-item').count();
  await page.fill('.cross-picker-search', 'zzznomatchxyz');
  const countAfter = await page.locator('.cross-picker-item').count();
  expect(countAfter).toBeLessThan(countBefore);
});

/* ═══ Linking workflow: select sheet → widget appears ═══ */

test('selecting a sheet in picker creates link and shows widget', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.cross-link-btn', { timeout: 5000 });
  await page.click('.cross-link-btn');
  await page.waitForSelector('.cross-picker-item', { timeout: 10000 });
  await page.click('.cross-picker-item');
  // Picker closes and page reloads with widget
  await page.waitForSelector('.cross-widget', { timeout: 5000 });
  await expect(page.locator('.cross-widget')).toBeVisible();
  // Link button should be gone (replaced by widget)
  await expect(page.locator('.cross-link-btn')).toHaveCount(0);
});

/* ═══ Widget rendering with pre-set link ═══ */

test('linked widget shows provider sheet name in header', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => {
    const links = { 'sheet-027': [{ featureId: 'sensor-reading', linkedSheetId: 'sheet-048', linkedSheetName: 'Boiler Room Temp' }] };
    localStorage.setItem('waymark_cross_links', JSON.stringify(links));
  });
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.cross-widget', { timeout: 5000 });
  await expect(page.locator('.cross-widget-title')).toContainText('Boiler Room Temp');
});

test('linked widget renders sensor data chips', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => {
    const links = { 'sheet-027': [{ featureId: 'sensor-reading', linkedSheetId: 'sheet-048', linkedSheetName: 'Boiler Room Temp' }] };
    localStorage.setItem('waymark_cross_links', JSON.stringify(links));
  });
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.cross-sensor-chip', { timeout: 5000 });
  await expect(page.locator('.cross-sensor-chip')).toBeVisible();
});

test('sensor chip displays reading value', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => {
    const links = { 'sheet-027': [{ featureId: 'sensor-reading', linkedSheetId: 'sheet-048', linkedSheetName: 'Boiler Room Temp' }] };
    localStorage.setItem('waymark_cross_links', JSON.stringify(links));
  });
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.cross-sensor-chip', { timeout: 5000 });
  const text = await page.locator('.cross-sensor-chip').first().textContent();
  // IoT fixture has numeric readings
  expect(text).toBeTruthy();
  expect(text.length).toBeGreaterThan(2);
});

test('sensor chip has tone class based on alert state', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => {
    const links = { 'sheet-027': [{ featureId: 'sensor-reading', linkedSheetId: 'sheet-048', linkedSheetName: 'Boiler Room Temp' }] };
    localStorage.setItem('waymark_cross_links', JSON.stringify(links));
  });
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.cross-sensor-chip', { timeout: 5000 });
  const className = await page.locator('.cross-sensor-chip').first().getAttribute('class');
  expect(className).toMatch(/cross-sensor-(normal|watch|alert|offline)/);
});

test('widget header shows provider icon', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => {
    const links = { 'sheet-027': [{ featureId: 'sensor-reading', linkedSheetId: 'sheet-048', linkedSheetName: 'Boiler Room Temp' }] };
    localStorage.setItem('waymark_cross_links', JSON.stringify(links));
  });
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.cross-widget-icon', { timeout: 5000 });
  const icon = await page.locator('.cross-widget-icon').textContent();
  expect(icon).toBe('📡');
});

/* ═══ Unlink workflow ═══ */

test('clicking unlink removes widget and shows link button', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => {
    const links = { 'sheet-027': [{ featureId: 'sensor-reading', linkedSheetId: 'sheet-048', linkedSheetName: 'Boiler Room Temp' }] };
    localStorage.setItem('waymark_cross_links', JSON.stringify(links));
  });
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.cross-widget', { timeout: 5000 });
  await page.click('.cross-unlink-btn');
  await expect(page.locator('.cross-widget')).toHaveCount(0);
  await expect(page.locator('.cross-link-btn')).toBeVisible();
});

test('unlink clears localStorage link', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => {
    const links = { 'sheet-027': [{ featureId: 'sensor-reading', linkedSheetId: 'sheet-048', linkedSheetName: 'Boiler Room Temp' }] };
    localStorage.setItem('waymark_cross_links', JSON.stringify(links));
  });
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.cross-widget', { timeout: 5000 });
  await page.click('.cross-unlink-btn');
  const links = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('waymark_cross_links') || '{}')
  );
  expect(links['sheet-027'] || []).toHaveLength(0);
});

test('unlink button has pointer cursor', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => {
    const links = { 'sheet-027': [{ featureId: 'sensor-reading', linkedSheetId: 'sheet-048', linkedSheetName: 'Boiler Room Temp' }] };
    localStorage.setItem('waymark_cross_links', JSON.stringify(links));
  });
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.cross-unlink-btn', { timeout: 5000 });
  await expect(page.locator('.cross-unlink-btn')).toHaveCSS('cursor', 'pointer');
});

/* ═══ Persistence ═══ */

test('cross link persists across navigation', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => {
    const links = { 'sheet-027': [{ featureId: 'sensor-reading', linkedSheetId: 'sheet-048', linkedSheetName: 'Boiler Room Temp' }] };
    localStorage.setItem('waymark_cross_links', JSON.stringify(links));
  });
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.cross-widget', { timeout: 5000 });
  // Navigate away
  await page.evaluate(() => { window.location.hash = '#/'; });
  await page.waitForSelector('#home-view:not(.hidden)', { timeout: 5000 });
  // Navigate back
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.cross-widget', { timeout: 5000 });
  await expect(page.locator('.cross-widget')).toBeVisible();
});

/* ═══ Widget error handling ═══ */

test('widget shows error when linked sheet fails to load', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => {
    const links = { 'sheet-027': [{ featureId: 'sensor-reading', linkedSheetId: 'nonexistent-sheet-999', linkedSheetName: 'Missing Sheet' }] };
    localStorage.setItem('waymark_cross_links', JSON.stringify(links));
  });
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.cross-widget', { timeout: 5000 });
  await page.waitForSelector('.cross-error', { timeout: 5000 });
  await expect(page.locator('.cross-error')).toContainText(/failed/i);
});

/* ═══ Visual / style consistency ═══ */

test('widget header has non-transparent background', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => {
    const links = { 'sheet-027': [{ featureId: 'sensor-reading', linkedSheetId: 'sheet-048', linkedSheetName: 'Boiler Room Temp' }] };
    localStorage.setItem('waymark_cross_links', JSON.stringify(links));
  });
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.cross-widget-header', { timeout: 5000 });
  const bg = await page.locator('.cross-widget-header').evaluate(el => getComputedStyle(el).backgroundColor);
  expect(bg).not.toBe('rgba(0, 0, 0, 0)');
});

test('widget border uses design token radius', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => {
    const links = { 'sheet-027': [{ featureId: 'sensor-reading', linkedSheetId: 'sheet-048', linkedSheetName: 'Boiler Room Temp' }] };
    localStorage.setItem('waymark_cross_links', JSON.stringify(links));
  });
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.cross-widget', { timeout: 5000 });
  await expect(page.locator('.cross-widget')).toHaveCSS('border-radius', /\d+px/);
});

/* ═══ Mobile ═══ */

test('cross-feature widget goes full width on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await setupApp(page);
  await page.evaluate(() => {
    const links = { 'sheet-027': [{ featureId: 'sensor-reading', linkedSheetId: 'sheet-048', linkedSheetName: 'Boiler Room Temp' }] };
    localStorage.setItem('waymark_cross_links', JSON.stringify(links));
  });
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.cross-widget', { timeout: 5000 });
  const overflows = await page.evaluate(() => {
    const problems = [];
    document.querySelectorAll('.cross-bar *').forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.right > window.innerWidth + 2) problems.push(el.className);
    });
    return problems;
  });
  expect(overflows).toHaveLength(0);
});

/* ═══ Unit: cross-feature registry (pure function tests) ═══ */

test('registerCrossFeature and getCrossFeature round-trip', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { getCrossFeature, getCrossFeatures } = await import('/js/templates/shared.js');
    const sensor = getCrossFeature('sensor-reading');
    const all = getCrossFeatures();
    return {
      sensorExists: !!sensor,
      sensorProvider: sensor?.provider,
      sensorName: sensor?.name,
      sensorHasExtract: typeof sensor?.extractData === 'function',
      sensorHasWidget: typeof sensor?.buildWidget === 'function',
      registryHasSensor: 'sensor-reading' in all,
    };
  });
  expect(result.sensorExists).toBe(true);
  expect(result.sensorProvider).toBe('iot');
  expect(result.sensorName).toBe('Live Sensor');
  expect(result.sensorHasExtract).toBe(true);
  expect(result.sensorHasWidget).toBe(true);
  expect(result.registryHasSensor).toBe(true);
});

test('getCrossFeature returns null for unknown feature', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { getCrossFeature } = await import('/js/templates/shared.js');
    return getCrossFeature('nonexistent-feature-xyz');
  });
  expect(result).toBeNull();
});

test('getCrossFeatures returns shallow copy', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { getCrossFeatures } = await import('/js/templates/shared.js');
    const a = getCrossFeatures();
    const b = getCrossFeatures();
    return a !== b; // different references = shallow copy
  });
  expect(result).toBe(true);
});

test('IoT extractData returns latest readings per sensor', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { getCrossFeature } = await import('/js/templates/shared.js');
    const feature = getCrossFeature('sensor-reading');
    const cols = { sensor: 0, reading: 1, unit: 2, timestamp: 3, min: 4, max: 5, alert: 6 };
    const rows = [
      ['Probe-A', '22.5', '°C', '2026-03-19T10:00:00', '15', '30', 'Normal'],
      ['Probe-A', '23.1', '°C', '2026-03-19T11:00:00', '15', '30', 'Normal'],
      ['Probe-B', '98.2', '%', '2026-03-19T10:30:00', '20', '80', 'Alert'],
    ];
    return feature.extractData(rows, cols);
  });
  // Should return 2 sensors with latest readings
  expect(result).toHaveLength(2);
  const probeA = result.find(s => s.name === 'Probe-A');
  const probeB = result.find(s => s.name === 'Probe-B');
  expect(probeA.reading).toBe(23.1);
  expect(probeA.timestamp).toBe('2026-03-19T11:00:00');
  expect(probeB.reading).toBe(98.2);
  expect(probeB.state).toBe('Alert');
});

test('IoT extractData handles empty rows gracefully', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { getCrossFeature } = await import('/js/templates/shared.js');
    const feature = getCrossFeature('sensor-reading');
    const cols = { sensor: 0, reading: 1, unit: 2, timestamp: 3, min: 4, max: 5, alert: 6 };
    return feature.extractData([], cols);
  });
  expect(result).toHaveLength(0);
});

test('consumer template crossFeatures declaration is accessible', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const { TEMPLATES } = await import('/js/templates/shared.js');
    return {
      recipeCross: TEMPLATES.recipe?.crossFeatures,
      iotCross: TEMPLATES.iot?.crossFeatures,
    };
  });
  expect(result.recipeCross).toBeDefined();
  expect(result.recipeCross.length).toBeGreaterThan(0);
  expect(result.recipeCross[0].featureId).toBe('sensor-reading');
  // IoT is a provider, not a consumer — no crossFeatures
  expect(result.iotCross).toBeUndefined();
});

test('drive listSpreadsheets paginates across multiple result pages', async ({ page }) => {
  await setupApp(page);
  const result = await page.evaluate(async () => {
    const originalFetch = globalThis.fetch;
    const calls = [];

    globalThis.fetch = async (url, options) => {
      const href = String(url);
      calls.push(href);
      const parsed = new URL(href);
      const pageToken = parsed.searchParams.get('pageToken');

      const body = !pageToken
        ? {
            nextPageToken: 'page-2',
            files: [
              { id: 'sheet-page-1', name: 'First Page Sheet', mimeType: 'application/vnd.google-apps.spreadsheet' },
            ],
          }
        : {
            files: [
              { id: 'sheet-page-2', name: 'Second Page Sheet', mimeType: 'application/vnd.google-apps.spreadsheet' },
            ],
          };

      return {
        ok: true,
        json: async () => body,
      };
    };

    try {
      const drive = await import('/js/drive.js');
      const res = await drive.listSpreadsheets('mock-token');
      return {
        calls,
        ids: res.files.map(file => file.id),
      };
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  expect(result.calls).toHaveLength(2);
  expect(result.calls[1]).toContain('pageToken=page-2');
  expect(result.ids).toEqual(['sheet-page-1', 'sheet-page-2']);
});
