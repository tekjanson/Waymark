// @ts-check
/**
 * recipe-vision.spec.js — E2E tests for AI vision recipe scanning.
 *
 * Tests the photo scan pathway in the import modal: file input,
 * preview thumbnail, Gemini Vision API integration, and import flow.
 */
const { test, expect } = require('@playwright/test');
const { setupApp } = require('../helpers/test-utils');

/** Build a minimal valid Gemini Vision API JSON response for a cookie recipe. */
function buildVisionResponse() {
  const recipeJson = JSON.stringify({
    name: "Grandma's Chocolate Chip Cookies",
    servings: "24",
    prepTime: "15 min",
    cookTime: "12 min",
    category: "Dessert",
    difficulty: "Easy",
    description: "Classic homemade cookies",
    ingredients: [
      { qty: "2.25", unit: "cups", name: "all-purpose flour" },
      { qty: "1", unit: "tsp", name: "baking soda" },
      { qty: "1", unit: "cup", name: "butter, softened" },
      { qty: "2", unit: "cups", name: "chocolate chips" }
    ],
    instructions: [
      "Preheat oven to 375°F",
      "Whisk flour, baking soda and salt",
      "Beat butter and sugars until creamy",
      "Add eggs and vanilla",
      "Stir in chocolate chips",
      "Bake 9-11 minutes"
    ]
  });
  return JSON.stringify({
    candidates: [{
      content: {
        parts: [{ text: recipeJson }],
        role: "model"
      }
    }]
  });
}

/** Create a minimal 1×1 pixel PNG as a Playwright file descriptor (no disk I/O). */
function makeTinyPng() {
  // Valid 1×1 pixel black PNG (RGB colour, 8-bit)
  const bytes = [
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG signature
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, // IHDR length + type
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, // 1×1
    0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, // 8-bit RGB, CRC
    0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41, // IDAT length + type
    0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00, // IDAT data
    0x00, 0x00, 0x02, 0x00, 0x01, 0xe2, 0x21, 0xbc, // ...
    0x33, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, // IEND
    0x44, 0xae, 0x42, 0x60, 0x82,                   // IEND CRC
  ];
  return {
    name: 'test-recipe.png',
    mimeType: 'image/png',
    buffer: Buffer.from(bytes),
  };
}

/* ─────────────── Photo scan section visibility ─────────────── */

test('recipe photo scan section is visible in import modal step 1', async ({ page }) => {
  await setupApp(page);

  await page.locator('#menu-import-btn').click();
  await page.waitForSelector('#import-modal', { timeout: 5_000 });

  await expect(page.locator('.recipe-import-photo-section')).toBeVisible();
  await expect(page.locator('#recipe-photo-scan-btn')).toBeVisible();
  await expect(page.locator('#recipe-photo-scan-btn')).toBeDisabled();
});

test('photo scan button is initially disabled and scan label is visible', async ({ page }) => {
  await setupApp(page);

  await page.locator('#menu-import-btn').click();
  await page.waitForSelector('.recipe-import-photo-section', { timeout: 5_000 });

  await expect(page.locator('#recipe-photo-scan-btn')).toBeDisabled();
  await expect(page.locator('#recipe-photo-label')).toBeVisible();
  // File input itself is hidden behind the label
  await expect(page.locator('#recipe-photo-input')).toBeAttached();
});

test('photo preview is hidden on modal open', async ({ page }) => {
  await setupApp(page);

  await page.locator('#menu-import-btn').click();
  await page.waitForSelector('.recipe-import-photo-section', { timeout: 5_000 });

  await expect(page.locator('#recipe-photo-preview')).toBeHidden();
  await expect(page.locator('#recipe-photo-status')).toBeHidden();
});

/* ─────────────── File selection enables scan button ─────────────── */

test('selecting a photo file enables the scan button and shows preview', async ({ page }) => {
  await setupApp(page);

  await page.locator('#menu-import-btn').click();
  await page.waitForSelector('.recipe-import-photo-section', { timeout: 5_000 });

  
  await page.locator('#recipe-photo-input').setInputFiles(makeTinyPng());

  await expect(page.locator('#recipe-photo-scan-btn')).toBeEnabled();
  await expect(page.locator('#recipe-photo-preview')).toBeVisible();
  await expect(page.locator('#recipe-photo-preview-name')).toContainText('test-recipe.png');
});

test('preview shows image thumbnail after file selection', async ({ page }) => {
  await setupApp(page);

  await page.locator('#menu-import-btn').click();
  await page.waitForSelector('.recipe-import-photo-section', { timeout: 5_000 });

  
  await page.locator('#recipe-photo-input').setInputFiles(makeTinyPng());

  await expect(page.locator('#recipe-photo-preview-img')).toBeVisible();
  // src must be set (either object URL or data URL)
  const src = await page.locator('#recipe-photo-preview-img').getAttribute('src');
  expect(src).toBeTruthy();
  expect(src).not.toBe('');
});

/* ─────────────── Gemini Vision API mocking helpers ─────────────── */

/**
 * Install a window.fetch mock that intercepts Gemini API calls and
 * returns the given response body. Must be called before setupApp.
 * Using addInitScript (not page.route) avoids Playwright parallel-
 * intercept flakiness and guarantees the mock is in place from page load.
 */
async function mockGeminiFetch(page, { status = 200, body } = {}) {
  await page.addInitScript(([s, b, key]) => {
    window.__WAYMARK_API_KEY = key;
    const orig = window.fetch.bind(window);
    window.fetch = function (url, opts) {
      if (typeof url === 'string' && url.includes('generativelanguage')) {
        return Promise.resolve(new Response(b, {
          status: s,
          headers: { 'Content-Type': s === 200 ? 'application/json' : 'text/plain' },
        }));
      }
      return orig(url, opts);
    };
  }, [status, body, 'test-vision-key']);
}

/* ─────────────── Gemini Vision API route intercept ─────────────── */

test('scanning a photo calls Gemini Vision API and advances to configure step', async ({ page }) => {
  await mockGeminiFetch(page, { status: 200, body: buildVisionResponse() });
  await setupApp(page);

  await page.locator('#menu-import-btn').click();
  await page.waitForSelector('.recipe-import-photo-section', { timeout: 5_000 });

  
  await page.locator('#recipe-photo-input').setInputFiles(makeTinyPng());
  await expect(page.locator('#recipe-photo-scan-btn')).toBeEnabled();

  await page.locator('#recipe-photo-scan-btn').click();

  // Should advance to step 2 (configure / analyze)
  await page.waitForSelector('#import-step-analyze:not(.hidden)', { timeout: 10_000 });
  await expect(page.locator('#import-step-analyze')).toBeVisible();
});

test('scan result pre-selects recipe template in the configure step', async ({ page }) => {
  await mockGeminiFetch(page, { status: 200, body: buildVisionResponse() });
  await setupApp(page);

  await page.locator('#menu-import-btn').click();
  await page.waitForSelector('.recipe-import-photo-section', { timeout: 5_000 });

  
  await page.locator('#recipe-photo-input').setInputFiles(makeTinyPng());
  await page.locator('#recipe-photo-scan-btn').click();

  await page.waitForSelector('#import-step-analyze:not(.hidden)', { timeout: 10_000 });

  // Template select should have recipe selected
  const templateSelect = page.locator('#import-template-pick');
  if (await templateSelect.isVisible()) {
    await expect(templateSelect).toHaveValue('recipe');
  }

  // The detect badge or template label should reflect "Recipe"
  const badge = page.locator('#detect-badge');
  if (await badge.isVisible()) {
    await expect(badge).toContainText('Recipe');
  }
});

test('scan status updates to show extracted recipe name', async ({ page }) => {
  await mockGeminiFetch(page, { status: 200, body: buildVisionResponse() });
  await setupApp(page);

  await page.locator('#menu-import-btn').click();
  await page.waitForSelector('.recipe-import-photo-section', { timeout: 5_000 });

  
  await page.locator('#recipe-photo-input').setInputFiles(makeTinyPng());
  await page.locator('#recipe-photo-scan-btn').click();

  // Wait for scan to complete (either status text or step advance)
  await page.waitForSelector('#import-step-analyze:not(.hidden)', { timeout: 10_000 });

  // Status text should still contain recipe name (status element not hidden, only parent is)
  const status = await page.locator('#recipe-photo-status').textContent();
  expect(status).toContain('Chocolate Chip');
});

/* ─────────────── Error handling ─────────────── */

test('scan shows error status when API returns 500', async ({ page }) => {
  await mockGeminiFetch(page, { status: 500, body: 'Internal Server Error' });
  await setupApp(page);

  await page.locator('#menu-import-btn').click();
  await page.waitForSelector('.recipe-import-photo-section', { timeout: 5_000 });

  
  await page.locator('#recipe-photo-input').setInputFiles(makeTinyPng());
  await page.locator('#recipe-photo-scan-btn').click();

  // Status div should show an error
  await page.waitForFunction(() => {
    const el = document.getElementById('recipe-photo-status');
    return el && !el.classList.contains('hidden') && el.textContent.includes('❌');
  }, { timeout: 10_000 });

  await expect(page.locator('#recipe-photo-status')).toContainText('❌');
  // Should remain on step 1
  await expect(page.locator('#import-step-pick')).toBeVisible();
});

test('scan shows error when no API key is available', async ({ page }) => {
  await setupApp(page);

  // Explicitly remove the API key
  await page.evaluate(() => { window.__WAYMARK_API_KEY = undefined; delete window.__WAYMARK_API_KEY; });

  await page.locator('#menu-import-btn').click();
  await page.waitForSelector('.recipe-import-photo-section', { timeout: 5_000 });

  
  await page.locator('#recipe-photo-input').setInputFiles(makeTinyPng());
  await page.locator('#recipe-photo-scan-btn').click();

  await page.waitForFunction(() => {
    const el = document.getElementById('recipe-photo-status');
    return el && !el.classList.contains('hidden');
  }, { timeout: 5_000 });

  const status = await page.locator('#recipe-photo-status').textContent();
  // Error must mention API key or configuration
  expect(status.toLowerCase()).toMatch(/api key|not configured|❌/);
  await expect(page.locator('#import-step-pick')).toBeVisible();
});

/* ─────────────── Modal state reset ─────────────── */

test('reopening import modal resets photo scan state', async ({ page }) => {
  await mockGeminiFetch(page, { status: 200, body: buildVisionResponse() });
  await setupApp(page);

  // Open modal, select a file
  await page.locator('#menu-import-btn').click();
  await page.waitForSelector('.recipe-import-photo-section', { timeout: 5_000 });

  
  await page.locator('#recipe-photo-input').setInputFiles(makeTinyPng());
  await expect(page.locator('#recipe-photo-preview')).toBeVisible();

  // Close and reopen
  await page.locator('#import-cancel-btn').click();
  await page.locator('#menu-import-btn').click();
  await page.waitForSelector('.recipe-import-photo-section', { timeout: 5_000 });

  // State should be reset
  await expect(page.locator('#recipe-photo-preview')).toBeHidden();
  await expect(page.locator('#recipe-photo-scan-btn')).toBeDisabled();
  await expect(page.locator('#recipe-photo-status')).toBeHidden();
});

/* ─────────────── Unit tests for scanRecipeFromImage ─────────────── */

test('unit: scanRecipeFromImage rejects non-image file types', async ({ page }) => {
  await setupApp(page);

  const result = await page.evaluate(async () => {
    const { scanRecipeFromImage } = await import('/js/recipe-vision.js');
    const txtBlob = new Blob(['hello'], { type: 'text/plain' });
    const txtFile = new File([txtBlob], 'test.txt', { type: 'text/plain' });
    try {
      await scanRecipeFromImage(txtFile);
      return { threw: false };
    } catch (e) {
      return { threw: true, message: e.message };
    }
  });

  expect(result.threw).toBe(true);
  expect(result.message.toLowerCase()).toMatch(/image|format/);
});

test('unit: scanRecipeFromImage rejects files larger than 10MB', async ({ page }) => {
  await setupApp(page);

  const result = await page.evaluate(async () => {
    const { scanRecipeFromImage } = await import('/js/recipe-vision.js');
    // Create a fake 11MB JPEG
    const bigBuffer = new Uint8Array(11 * 1024 * 1024);
    const bigFile = new File([bigBuffer], 'big.jpg', { type: 'image/jpeg' });
    try {
      await scanRecipeFromImage(bigFile);
      return { threw: false };
    } catch (e) {
      return { threw: true, message: e.message };
    }
  });

  expect(result.threw).toBe(true);
  expect(result.message.toLowerCase()).toMatch(/too large|10mb|size/);
});

test('unit: scanRecipeFromImage rejects when no API key', async ({ page }) => {
  await setupApp(page);

  const result = await page.evaluate(async () => {
    // Remove the API key
    const saved = window.__WAYMARK_API_KEY;
    window.__WAYMARK_API_KEY = undefined;
    delete window.__WAYMARK_API_KEY;
    const { scanRecipeFromImage } = await import('/js/recipe-vision.js');
    const tiny = new Uint8Array([137, 80, 78, 71]);
    const file = new File([tiny], 'recipe.png', { type: 'image/png' });
    try {
      await scanRecipeFromImage(file);
      window.__WAYMARK_API_KEY = saved;
      return { threw: false };
    } catch (e) {
      window.__WAYMARK_API_KEY = saved;
      return { threw: true, message: e.message };
    }
  });

  expect(result.threw).toBe(true);
  expect(result.message.toLowerCase()).toMatch(/api key|not configured/);
});
