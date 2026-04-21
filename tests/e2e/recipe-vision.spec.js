// @ts-check
/**
 * recipe-vision.spec.js — Tests for AI vision-based recipe scanning.
 *
 * Tests the "Scan Recipe from Photo" feature added to the import modal,
 * as well as the scanRecipeFromImage helper in recipe-scraper.js.
 */
const { test, expect } = require('@playwright/test');
const path = require('path');
const { setupApp, navigateToHome } = require('../helpers/test-utils');

/** Absolute path to a minimal JPEG fixture for file-chooser tests. */
const RECIPE_IMAGE_PATH = path.join(__dirname, '../fixtures/images/test-recipe.jpg');

/* ─────────── helpers ─────────── */

/** Open the import modal. */
async function openImportModal(page) {
  await page.locator('#menu-import-btn').click();
  await page.waitForSelector('#import-modal:not(.hidden)', { timeout: 5_000 });
}

/** Seed a Gemini API key into localStorage before navigating. */
async function seedApiKey(page) {
  await page.addInitScript(() => {
    localStorage.setItem('waymark_agent_keys', JSON.stringify([
      { key: 'test-vision-key', nickname: 'Vision Key', addedAt: '2026-01-01',
        requestsToday: 0, lastUsed: null, lastError: null, isBilled: false },
    ]));
  });
}

/** Build a mock Gemini generateContent response for vision. */
function buildVisionResponse(recipeJson) {
  return JSON.stringify({
    candidates: [{
      content: {
        parts: [{ text: JSON.stringify(recipeJson) }],
        role: 'model',
      },
      finishReason: 'STOP',
    }],
  });
}

/** A minimal recipe returned by the vision mock. */
const MOCK_RECIPE = {
  name: 'Chocolate Chip Cookies',
  servings: '24',
  prepTime: '15 min',
  cookTime: '12 min',
  category: 'Dessert',
  difficulty: 'Easy',
  description: 'Classic chewy cookies',
  ingredients: [
    { qty: '2', unit: 'cups', name: 'flour' },
    { qty: '1', unit: 'cup', name: 'butter' },
    { qty: '200', unit: 'g', name: 'chocolate chips' },
  ],
  instructions: [
    'Preheat oven to 375°F.',
    'Mix butter and sugars.',
    'Fold in chocolate chips.',
    'Bake 10-12 min.',
  ],
};

/**
 * Helper: trigger the upload button, intercept file chooser, provide fixture image,
 * and await Gemini route. Returns after the import step advances.
 */
async function triggerVisionScanWithMockRoute(page, geminiBody) {
  await page.route(/generativelanguage.*generateContent/, async route => {
    await route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: typeof geminiBody === 'string' ? geminiBody : buildVisionResponse(geminiBody),
    });
  });

  const [fileChooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 5_000 }),
    page.locator('#recipe-vision-upload-btn').click(),
  ]);
  await fileChooser.setFiles(RECIPE_IMAGE_PATH);
}

/* ─────────── UI visibility ─────────── */

test('import modal shows Scan Recipe from Photo section', async ({ page }) => {
  await setupApp(page);
  await openImportModal(page);

  const visionSection = page.locator('.recipe-import-vision-section');
  await expect(visionSection).toBeVisible();
  await expect(visionSection).toContainText('Scan Recipe from Photo');
});

test('import modal shows Take Photo and Upload Image buttons', async ({ page }) => {
  await setupApp(page);
  await openImportModal(page);

  await expect(page.locator('#recipe-vision-camera-btn')).toBeVisible();
  await expect(page.locator('#recipe-vision-upload-btn')).toBeVisible();
  await expect(page.locator('#recipe-vision-camera-btn')).toContainText('Take Photo');
  await expect(page.locator('#recipe-vision-upload-btn')).toContainText('Upload Image');
});

test('recipe vision status is hidden on modal open', async ({ page }) => {
  await setupApp(page);
  await openImportModal(page);

  await expect(page.locator('#recipe-vision-status')).toBeHidden();
});

test('recipe vision status resets when modal is closed and reopened', async ({ page }) => {
  await setupApp(page);
  await openImportModal(page);

  // Manually show status
  await page.evaluate(() => {
    const el = document.getElementById('recipe-vision-status');
    if (el) { el.textContent = 'old status'; el.classList.remove('hidden'); }
  });
  await expect(page.locator('#recipe-vision-status')).toBeVisible();

  // Close and reopen
  await page.locator('#import-modal-close').click();
  await expect(page.locator('#import-modal')).toBeHidden();

  await openImportModal(page);
  await expect(page.locator('#recipe-vision-status')).toBeHidden();
});

/* ─────────── No API key error handling ─────────── */

test('clicking Upload Image without API key shows toast error', async ({ page }) => {
  // No API key seeded — should show a toast error without opening file chooser
  await setupApp(page);
  await openImportModal(page);

  await page.locator('#recipe-vision-upload-btn').click();

  // Toast should appear with an error message about API keys
  await page.waitForSelector('.toast', { timeout: 5_000 });
  const toast = page.locator('.toast').last();
  await expect(toast).toContainText(/gemini|api key|settings/i);
});

/* ─────────── Successful vision scan ─────────── */

test('vision scan advances to configure step on success', async ({ page }) => {
  await seedApiKey(page);
  await setupApp(page);
  await openImportModal(page);

  await triggerVisionScanWithMockRoute(page, MOCK_RECIPE);

  // Should advance to configure step
  await page.waitForSelector('#import-step-analyze:not(.hidden)', { timeout: 10_000 });
  await expect(page.locator('#import-modal-title')).toContainText('Configure Template');
});

test('successful vision scan populates recipe name in preview', async ({ page }) => {
  await seedApiKey(page);
  await setupApp(page);
  await openImportModal(page);

  await triggerVisionScanWithMockRoute(page, MOCK_RECIPE);

  await page.waitForSelector('#import-step-analyze:not(.hidden)', { timeout: 10_000 });

  const previewName = page.locator('#import-preview-name');
  await expect(previewName).toContainText('Chocolate Chip Cookies');
});

test('successful vision scan selects Recipe template', async ({ page }) => {
  await seedApiKey(page);
  await setupApp(page);
  await openImportModal(page);

  await triggerVisionScanWithMockRoute(page, MOCK_RECIPE);

  await page.waitForSelector('#import-step-analyze:not(.hidden)', { timeout: 10_000 });

  const templatePicker = page.locator('#import-template-pick');
  await expect(templatePicker).toHaveValue('recipe');
});

test('vision scan status shows success message with ingredient count', async ({ page }) => {
  await seedApiKey(page);
  await setupApp(page);
  await openImportModal(page);

  await triggerVisionScanWithMockRoute(page, MOCK_RECIPE);

  await page.waitForSelector('#import-step-analyze:not(.hidden)', { timeout: 10_000 });

  const status = page.locator('#recipe-vision-status');
  await expect(status).toContainText('3 ingredients');
});

/* ─────────── API error handling ─────────── */

test('vision scan shows error in status when Gemini returns error', async ({ page }) => {
  await seedApiKey(page);
  await setupApp(page);
  await openImportModal(page);

  await page.route(/generativelanguage.*generateContent/, async route => {
    await route.fulfill({
      status: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: { message: 'API key not valid.' } }),
    });
  });

  const [fileChooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 5_000 }),
    page.locator('#recipe-vision-upload-btn').click(),
  ]);
  await fileChooser.setFiles(RECIPE_IMAGE_PATH);

  await page.waitForSelector('#recipe-vision-status:not(.hidden)', { timeout: 10_000 });
  const status = page.locator('#recipe-vision-status');
  await expect(status).toContainText('❌');
  await expect(status).toContainText('API key not valid');
});

/* ─────────── Unit tests: scanRecipeFromImage ─────────── */

test('helpers: scanRecipeFromImage throws when no image data', async ({ page }) => {
  await setupApp(page);

  const result = await page.evaluate(async () => {
    const { scanRecipeFromImage } = await import('/js/recipe-scraper.js');
    try {
      await scanRecipeFromImage(null, 'test-key');
      return { threw: false };
    } catch (e) {
      return { threw: true, message: e.message };
    }
  });

  expect(result.threw).toBe(true);
  expect(result.message).toMatch(/image data/i);
});

test('helpers: scanRecipeFromImage throws when no API key', async ({ page }) => {
  await setupApp(page);

  const result = await page.evaluate(async () => {
    const { scanRecipeFromImage } = await import('/js/recipe-scraper.js');
    try {
      await scanRecipeFromImage({ data: 'base64abc', mimeType: 'image/jpeg' }, '');
      return { threw: false };
    } catch (e) {
      return { threw: true, message: e.message };
    }
  });

  expect(result.threw).toBe(true);
  expect(result.message).toMatch(/api key/i);
});

test('helpers: scanRecipeFromImage normalises vision response correctly', async ({ page }) => {
  await setupApp(page);

  // Intercept the Gemini API call from within the page context
  await page.route(/generativelanguage.*generateContent/, async route => {
    await route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        candidates: [{
          content: {
            parts: [{ text: JSON.stringify({
              name: 'Banana Bread',
              servings: '8',
              prepTime: '10 min',
              cookTime: '60 min',
              category: 'Baking',
              difficulty: 'Easy',
              description: 'Moist banana bread',
              ingredients: [
                { qty: '3', unit: '', name: 'ripe bananas' },
                { qty: '1.5', unit: 'cups', name: 'flour' },
              ],
              instructions: ['Mash bananas.', 'Mix all ingredients.', 'Bake at 350°F.'],
            }) }],
            role: 'model',
          },
        }],
      }),
    });
  });

  const result = await page.evaluate(async () => {
    const { scanRecipeFromImage } = await import('/js/recipe-scraper.js');
    return scanRecipeFromImage({ data: 'base64abc', mimeType: 'image/jpeg' }, 'test-key');
  });

  expect(result.name).toBe('Banana Bread');
  expect(result.servings).toBe('8');
  expect(result.method).toBe('vision');
  expect(result.ingredients).toHaveLength(2);
  expect(result.ingredients[0].name).toBe('ripe bananas');
  expect(result.instructions).toHaveLength(3);
  expect(result.ingredients[0].qty).toBe('3');
});

test('helpers: scanRecipeFromImage strips markdown code fences from response', async ({ page }) => {
  await setupApp(page);

  await page.route(/generativelanguage.*generateContent/, async route => {
    // Response wrapped in ```json ... ``` markdown
    const wrappedJson = '```json\n' + JSON.stringify({
      name: 'Pancakes',
      servings: '4',
      prepTime: '5 min',
      cookTime: '15 min',
      category: '',
      difficulty: '',
      description: '',
      ingredients: [{ qty: '1', unit: 'cup', name: 'flour' }],
      instructions: ['Mix.', 'Cook.'],
    }) + '\n```';

    await route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        candidates: [{ content: { parts: [{ text: wrappedJson }], role: 'model' } }],
      }),
    });
  });

  const result = await page.evaluate(async () => {
    const { scanRecipeFromImage } = await import('/js/recipe-scraper.js');
    return scanRecipeFromImage({ data: 'base64abc', mimeType: 'image/jpeg' }, 'test-key');
  });

  expect(result.name).toBe('Pancakes');
  expect(result.method).toBe('vision');
});

test('helpers: scanRecipeFromImage throws on empty ingredient and instruction arrays', async ({ page }) => {
  await setupApp(page);

  await page.route(/generativelanguage.*generateContent/, async route => {
    await route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        candidates: [{
          content: {
            parts: [{ text: JSON.stringify({
              name: 'Not a recipe',
              servings: '',
              prepTime: '',
              cookTime: '',
              category: '',
              difficulty: '',
              description: '',
              ingredients: [],
              instructions: [],
            }) }],
            role: 'model',
          },
        }],
      }),
    });
  });

  const result = await page.evaluate(async () => {
    const { scanRecipeFromImage } = await import('/js/recipe-scraper.js');
    try {
      await scanRecipeFromImage({ data: 'base64abc', mimeType: 'image/jpeg' }, 'test-key');
      return { threw: false };
    } catch (e) {
      return { threw: true, message: e.message };
    }
  });

  expect(result.threw).toBe(true);
  expect(result.message).toMatch(/could not find a recipe/i);
});
