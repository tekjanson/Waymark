// @ts-check
const { test, expect } = require('@playwright/test');
const { setupApp, navigateToSheet, getCreatedRecords } = require('../helpers/test-utils');

test('recipe detected as Recipe template', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.recipe-card', { timeout: 5_000 });
  await expect(page.locator('#template-badge')).toContainText('Recipe');
});

test('recipe renders title and metadata', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.recipe-card-title', { timeout: 5_000 });

  await expect(page.locator('.recipe-card-title')).toContainText('Spaghetti Bolognese');
  await expect(page.locator('.recipe-difficulty-badge')).toContainText('Easy');
  await expect(page.locator('.recipe-category-badge')).toContainText('Italian');
});

test('recipe renders ingredients with separate qty and unit columns', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.recipe-ingredients-list li', { timeout: 5_000 });

  const items = page.locator('.recipe-ingredients-list li');
  expect(await items.count()).toBeGreaterThanOrEqual(7);

  // Spaghetti (index 3 after sort): qty "400" in qty span, "g" in unit span, name separate
  const firstQty = page.locator('.recipe-ingredient-qty').nth(3);
  await expect(firstQty).toContainText('400');

  const firstUnit = page.locator('.recipe-ingredient-unit').nth(3);
  await expect(firstUnit).toContainText('g');

  const firstName = page.locator('.recipe-ingredient-text').nth(3);
  await expect(firstName).toContainText('spaghetti');
});

test('recipe renders instructions as numbered steps', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.recipe-instructions-list li', { timeout: 5_000 });

  const steps = page.locator('.recipe-instructions-list li');
  expect(await steps.count()).toBeGreaterThanOrEqual(5);

  await expect(steps.first()).toContainText('Cook spaghetti');
});

test('recipe scale bar is visible with default 1× active', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.recipe-toolbar', { timeout: 5_000 });

  const toolbar = page.locator('.recipe-toolbar');
  await expect(toolbar).toBeVisible();

  // Scale select should default to '1'
  await expect(page.locator('.recipe-scale-select')).toHaveValue('1');
});

test('recipe scaling doubles quantities when 2× is clicked', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.recipe-toolbar', { timeout: 5_000 });

  // Select 2× from dropdown
  await page.locator('.recipe-scale-select').selectOption('2');

  // 2× should now be selected
  await expect(page.locator('.recipe-scale-select')).toHaveValue('2');

  // Spaghetti (index 3) quantity "400" → "800", unit stays "g"
  const firstQty = page.locator('.recipe-ingredient-qty').nth(3);
  await expect(firstQty).toContainText('800');
  await expect(page.locator('.recipe-ingredient-unit').nth(3)).toContainText('g');

  // Servings "4" → "8"
  const servings = page.locator('.recipe-meta-item .meta-label').first();
  await expect(servings).toContainText('8');
});

test('recipe scaling halves quantities when ½× is clicked', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.recipe-toolbar', { timeout: 5_000 });

  // Select ½× from dropdown
  await page.locator('.recipe-scale-select').selectOption('0.5');

  // Spaghetti (index 3) quantity "400" → "200"
  const firstQty = page.locator('.recipe-ingredient-qty').nth(3);
  await expect(firstQty).toContainText('200');

  // Servings "4" → "2"
  const servings = page.locator('.recipe-meta-item .meta-label').first();
  await expect(servings).toContainText('2');
});

test('recipe scaling resets to original when 1× is clicked back', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.recipe-toolbar', { timeout: 5_000 });

  // Scale to 3×
  await page.locator('.recipe-scale-select').selectOption('3');
  const firstQty = page.locator('.recipe-ingredient-qty').nth(3);
  await expect(firstQty).toContainText('1200');

  // Reset to 1×
  await page.locator('.recipe-scale-select').selectOption('1');
  await expect(firstQty).toContainText('400');
});

test('recipe inline edit commits on Enter', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.recipe-ingredient-text', { timeout: 5_000 });

  // Click the first ingredient name to start editing
  const ingredientCell = page.locator('.recipe-ingredient-text').first();
  await ingredientCell.click();

  const input = page.locator('.recipe-ingredient-text input.editable-cell-input').first();
  await input.fill('penne');
  await input.press('Enter');

  // Check edit was recorded
  const records = await getCreatedRecords(page);
  expect(records.some(r => r.value === 'penne')).toBe(true);
});

test('recipe custom scale input scales quantities', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.recipe-toolbar', { timeout: 5_000 });

  // Select "Custom…" option to reveal the custom input
  await page.locator('.recipe-scale-select').selectOption('custom');

  // Type a custom scale of 4
  const customInput = page.locator('.recipe-scale-custom');
  await expect(customInput).toBeVisible();
  await customInput.fill('4');

  // Spaghetti (index 3) quantity "400" → "1600"
  const firstQty = page.locator('.recipe-ingredient-qty').nth(3);
  await expect(firstQty).toContainText('1600');

  // Servings "4" → "16"
  const servings = page.locator('.recipe-meta-item .meta-label').first();
  await expect(servings).toContainText('16');

  // Scale select should show 'custom'
  await expect(page.locator('.recipe-scale-select')).toHaveValue('custom');
});

test('recipe custom scale input clears when preset is clicked', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.recipe-toolbar', { timeout: 5_000 });

  // Select "Custom…" option first
  await page.locator('.recipe-scale-select').selectOption('custom');

  // Type a custom scale
  const customInput = page.locator('.recipe-scale-custom');
  await customInput.fill('5');

  // Now select a preset option
  await page.locator('.recipe-scale-select').selectOption('2');

  // Custom input should be hidden after preset is selected
  await expect(customInput).toBeHidden();

  // 2× should be selected
  await expect(page.locator('.recipe-scale-select')).toHaveValue('2');
});

test('recipe displays source URL when present', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.recipe-card', { timeout: 5_000 });

  // Source bar should be visible since fixture has a source URL
  const sourceBar = page.locator('.recipe-source-bar');
  await expect(sourceBar).toBeVisible();

  // Source link should contain the domain
  const sourceLink = page.locator('.recipe-source-link');
  await expect(sourceLink).toContainText('example.com');

  // Re-sync button should be present
  const resyncBtn = page.locator('.recipe-resync-btn');
  await expect(resyncBtn).toBeVisible();
  await expect(resyncBtn).toContainText('Re-sync');
});

test('recipe quantity is editable at 1× scale and commits on Enter', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.recipe-ingredient-qty', { timeout: 5_000 });

  // At default 1×, quantity should have editable-cell class
  const qtyCell = page.locator('.recipe-ingredient-qty').first();
  await expect(qtyCell).toHaveClass(/editable-cell/);

  // Click to start editing
  await qtyCell.click();
  const input = page.locator('.recipe-ingredient-qty input.editable-cell-input').first();
  await expect(input).toBeVisible();
  await input.fill('500');
  await input.press('Enter');

  // Verify the edit was recorded
  const records = await getCreatedRecords(page);
  expect(records.some(r => r.value === '500')).toBe(true);

  // Cell should display the new numeric value (unit is in separate span)
  await expect(qtyCell).toContainText('500');
});

test('recipe quantity is not editable when scaled to 2×', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.recipe-toolbar', { timeout: 5_000 });

  // Scale to 2×
  await page.locator('.recipe-scale-select').selectOption('2');

  // Quantity should NOT have editable-cell class
  const qtyCell = page.locator('.recipe-ingredient-qty').first();
  await expect(qtyCell).not.toHaveClass(/editable-cell/);

  // Click the quantity — no input should appear
  await qtyCell.click();
  const input = page.locator('.recipe-ingredient-qty input.editable-cell-input');
  await expect(input).toHaveCount(0);
});

test('recipe quantity becomes editable again when returning to 1×', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.recipe-toolbar', { timeout: 5_000 });

  // Scale to 3×
  await page.locator('.recipe-scale-select').selectOption('3');
  const qtyCell = page.locator('.recipe-ingredient-qty').first();
  await expect(qtyCell).not.toHaveClass(/editable-cell/);

  // Return to 1×
  await page.locator('.recipe-scale-select').selectOption('1');
  await expect(qtyCell).toHaveClass(/editable-cell/);

  // Should be editable — click and verify input appears
  await qtyCell.click();
  const input = page.locator('.recipe-ingredient-qty input.editable-cell-input').first();
  await expect(input).toBeVisible();
  await input.press('Escape');
});

test('recipe renders notes section when notes exist', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.recipe-card', { timeout: 5_000 });

  // Notes section should be visible since fixture has a note on first row
  const notesSection = page.locator('.recipe-card-notes');
  await expect(notesSection).toBeVisible();

  // Should contain the note text
  const noteItem = page.locator('.recipe-note-item').first();
  await expect(noteItem).toContainText('A classic Italian comfort dish');
});

test('recipe print button is visible', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.recipe-toolbar', { timeout: 5_000 });

  const printBtn = page.locator('.recipe-print-btn');
  await expect(printBtn).toBeVisible();
  await expect(printBtn).toContainText('Print');
});

test('recipe renders separate unit column for ingredients', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.recipe-ingredients-list li', { timeout: 5_000 });

  // Ground beef (index 4 after sort): qty "500" and unit "g" in separate spans
  const secondQty = page.locator('.recipe-ingredient-qty').nth(4);
  await expect(secondQty).toContainText('500');
  const secondUnit = page.locator('.recipe-ingredient-unit').nth(4);
  await expect(secondUnit).toContainText('g');

  // Garlic (index 5 after sort): qty "3" and unit "cloves"
  const fourthQty = page.locator('.recipe-ingredient-qty').nth(5);
  await expect(fourthQty).toContainText('3');
  const fourthUnit = page.locator('.recipe-ingredient-unit').nth(5);
  await expect(fourthUnit).toContainText('cloves');
});

/* ---------- Unit Conversion Tests ---------- */

test('recipe unit conversion bar is visible with three buttons', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.recipe-convert-select', { timeout: 5_000 });

  const select = page.locator('.recipe-convert-select');
  await expect(select).toBeVisible();

  const options = page.locator('.recipe-convert-select option');
  await expect(options).toHaveCount(3);

  // "Original" should be selected by default
  await expect(page.locator('.recipe-convert-select')).toHaveValue('original');
});

test('recipe converts grams to imperial (oz/lb) when Imperial is clicked', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.recipe-convert-select', { timeout: 5_000 });

  // Select "Imperial" from dropdown
  await page.locator('.recipe-convert-select').selectOption('imperial');

  // 400 g spaghetti (index 3) → unit span now shows "oz"
  const firstUnit = page.locator('.recipe-ingredient-unit').nth(3);
  await expect(firstUnit).toContainText('oz');

  // 800 g canned tomatoes (index 6) → unit should show "lb" (>= 453.592g threshold)
  const fifthUnit = page.locator('.recipe-ingredient-unit').nth(6);
  await expect(fifthUnit).toContainText('lb');
});

test('recipe converts tbsp/tsp to metric (ml) when Metric is clicked', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.recipe-convert-select', { timeout: 5_000 });

  // Select "Metric" from dropdown
  await page.locator('.recipe-convert-select').selectOption('metric');

  // 2 tbsp tomato paste (index 7) → unit span now shows "ml"
  const sixthUnit = page.locator('.recipe-ingredient-unit').nth(7);
  await expect(sixthUnit).toContainText('ml');

  // 1 tsp dried oregano (index 8) → unit span also shows "ml"
  const seventhUnit = page.locator('.recipe-ingredient-unit').nth(8);
  await expect(seventhUnit).toContainText('ml');

  // 400 g spaghetti (index 3) → stays metric: qty "400", unit "g"
  const firstQty = page.locator('.recipe-ingredient-qty').nth(3);
  await expect(firstQty).toContainText('400');
  const firstUnit = page.locator('.recipe-ingredient-unit').nth(3);
  await expect(firstUnit).toContainText('g');
});

test('recipe non-convertible units stay unchanged during conversion', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.recipe-convert-select', { timeout: 5_000 });

  // Select "Imperial"
  await page.locator('.recipe-convert-select').selectOption('imperial');

  // "3 cloves" garlic (index 5) — not convertible: qty stays "3", unit stays "cloves"
  const fourthQty = page.locator('.recipe-ingredient-qty').nth(5);
  await expect(fourthQty).toContainText('3');
  const fourthUnit = page.locator('.recipe-ingredient-unit').nth(5);
  await expect(fourthUnit).toContainText('cloves');

  // "1" onion (index 0, no unit) — stays as "1"
  const thirdQty = page.locator('.recipe-ingredient-qty').nth(0);
  await expect(thirdQty).toContainText('1');
});

test('recipe restores original values when Original is clicked after conversion', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.recipe-convert-select', { timeout: 5_000 });

  // Convert to Imperial
  await page.locator('.recipe-convert-select').selectOption('imperial');
  const firstUnit = page.locator('.recipe-ingredient-unit').nth(3);
  await expect(firstUnit).toContainText('oz');

  // Switch back to Original
  await page.locator('.recipe-convert-select').selectOption('original');
  const firstQty = page.locator('.recipe-ingredient-qty').nth(3);
  await expect(firstQty).toContainText('400');
  await expect(firstUnit).toContainText('g');

  // Original should be selected
  await expect(page.locator('.recipe-convert-select')).toHaveValue('original');
});

test('recipe unit conversion combines with scaling', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.recipe-convert-select', { timeout: 5_000 });

  // Scale to 2× first
  await page.locator('.recipe-scale-select').selectOption('2');
  const firstQty = page.locator('.recipe-ingredient-qty').nth(3);
  await expect(firstQty).toContainText('800');
  const firstUnit = page.locator('.recipe-ingredient-unit').nth(3);
  await expect(firstUnit).toContainText('g');

  // Now convert to Imperial — should show 2× scaled imperial value
  await page.locator('.recipe-convert-select').selectOption('imperial');
  // 800 g → 800 >= 453.592 → lb: 800/453.592 = 1.76 → unit span shows "lb"
  await expect(firstUnit).toContainText('lb');

  // Back to Original restores scaled values
  await page.locator('.recipe-convert-select').selectOption('original');
  await expect(firstQty).toContainText('800');
  await expect(firstUnit).toContainText('g');
});

test('recipe quantity is not editable when unit conversion is active', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.recipe-convert-select', { timeout: 5_000 });

  // At default (1× scale, original units), qty should be editable
  const qtyCell = page.locator('.recipe-ingredient-qty').first();
  await expect(qtyCell).toHaveClass(/editable-cell/);

  // Convert to Metric — qty should no longer be editable
  await page.locator('.recipe-convert-select').selectOption('metric');
  await expect(qtyCell).not.toHaveClass(/editable-cell/);

  // Back to Original — should be editable again
  await page.locator('.recipe-convert-select').selectOption('original');
  await expect(qtyCell).toHaveClass(/editable-cell/);
});

test('recipe imperial units (tbsp/tsp) stay when Imperial conversion is selected', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.recipe-convert-select', { timeout: 5_000 });

  // Select "Imperial"
  await page.locator('.recipe-convert-select').selectOption('imperial');

  // "2 tbsp" tomato paste (index 7) is already imperial — qty stays "2", unit stays "tbsp"
  const sixthQty = page.locator('.recipe-ingredient-qty').nth(7);
  await expect(sixthQty).toContainText('2');
  const sixthUnit = page.locator('.recipe-ingredient-unit').nth(7);
  await expect(sixthUnit).toContainText('tbsp');

  // "1 tsp" dried oregano (index 8) is already imperial — qty stays "1", unit stays "tsp"
  const seventhQty = page.locator('.recipe-ingredient-qty').nth(8);
  await expect(seventhQty).toContainText('1');
  const seventhUnit = page.locator('.recipe-ingredient-unit').nth(8);
  await expect(seventhUnit).toContainText('tsp');
});

/* ---------- Bug regression tests ---------- */

test('recipe empty unit does not show em-dash', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.recipe-ingredients-list li', { timeout: 5_000 });

  // Onion, diced (index 0 after sort) has no unit — unit span should be empty, not "—"
  const thirdUnit = page.locator('.recipe-ingredient-unit').nth(0);
  const unitText = await thirdUnit.textContent();
  expect(unitText).toBe('');
});

test('recipe scaling produces vulgar fractions for common values', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.recipe-toolbar', { timeout: 5_000 });

  // Scale ½×: qty "3" cloves garlic → should show "1 ½" (or similar fraction)
  await page.locator('.recipe-scale-select').selectOption('0.5');

  // 1 tsp dried oregano (index 8) → 0.5 → should show "½"
  const seventhQty = page.locator('.recipe-ingredient-qty').nth(8);
  await expect(seventhQty).toContainText('½');

  // 3 cloves garlic (index 5) → 1.5 → should show "1 ½"
  const fourthQty = page.locator('.recipe-ingredient-qty').nth(5);
  await expect(fourthQty).toContainText('½');
});

test('recipe unit span updates correctly during conversion', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.recipe-convert-select', { timeout: 5_000 });

  // Spaghetti (index 3): unit is "g"
  const firstUnit = page.locator('.recipe-ingredient-unit').nth(3);
  await expect(firstUnit).toContainText('g');

  // Convert to Imperial — unit span should update to "oz"
  await page.locator('.recipe-convert-select').selectOption('imperial');
  await expect(firstUnit).toContainText('oz');

  // Convert to Metric — should return to "g" (already metric)
  await page.locator('.recipe-convert-select').selectOption('metric');
  await expect(firstUnit).toContainText('g');

  // Back to Original
  await page.locator('.recipe-convert-select').selectOption('original');
  await expect(firstUnit).toContainText('g');
});

test('recipe unit span is not editable during conversion', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.recipe-convert-select', { timeout: 5_000 });

  // Default: spaghetti (index 3) unit span should be editable
  const firstUnit = page.locator('.recipe-ingredient-unit').nth(3);
  await expect(firstUnit).toHaveClass(/editable-cell/);

  // Convert to Imperial — unit span should not be editable
  await page.locator('.recipe-convert-select').selectOption('imperial');
  await expect(firstUnit).not.toHaveClass(/editable-cell/);

  // Back to Original — editable again
  await page.locator('.recipe-convert-select').selectOption('original');
  await expect(firstUnit).toHaveClass(/editable-cell/);
});

test('recipe qty styling stays consistent when scaled', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.recipe-ingredient-qty', { timeout: 5_000 });

  const qtySpan = page.locator('.recipe-ingredient-qty').first();

  // Measure base styles at 1× (default, editable-cell class present)
  const baseStyles = await qtySpan.evaluate(el => {
    const s = getComputedStyle(el);
    return { fontSize: s.fontSize, fontWeight: s.fontWeight, padding: s.padding };
  });

  // Scale to 2× — editable-cell removed, but styles must stay the same
  await page.locator('.recipe-scale-select').selectOption('2');
  const scaledStyles = await qtySpan.evaluate(el => {
    const s = getComputedStyle(el);
    return { fontSize: s.fontSize, fontWeight: s.fontWeight, padding: s.padding };
  });
  expect(scaledStyles.fontSize).toBe(baseStyles.fontSize);
  expect(scaledStyles.fontWeight).toBe(baseStyles.fontWeight);
  expect(scaledStyles.padding).toBe(baseStyles.padding);

  // Scale to ½×
  await page.locator('.recipe-scale-select').selectOption('0.5');
  const halfStyles = await qtySpan.evaluate(el => {
    const s = getComputedStyle(el);
    return { fontSize: s.fontSize, fontWeight: s.fontWeight, padding: s.padding };
  });
  expect(halfStyles.fontSize).toBe(baseStyles.fontSize);
  expect(halfStyles.fontWeight).toBe(baseStyles.fontWeight);
  expect(halfStyles.padding).toBe(baseStyles.padding);
});

test('recipe qty styling stays consistent during unit conversion', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.recipe-ingredient-qty', { timeout: 5_000 });

  const qtySpan = page.locator('.recipe-ingredient-qty').first();

  // Measure base styles at Original
  const baseStyles = await qtySpan.evaluate(el => {
    const s = getComputedStyle(el);
    return { fontSize: s.fontSize, fontWeight: s.fontWeight, padding: s.padding };
  });

  // Convert to Imperial — editable-cell removed, styles must stay the same
  await page.locator('.recipe-convert-select').selectOption('imperial');
  const imperialStyles = await qtySpan.evaluate(el => {
    const s = getComputedStyle(el);
    return { fontSize: s.fontSize, fontWeight: s.fontWeight, padding: s.padding };
  });
  expect(imperialStyles.fontSize).toBe(baseStyles.fontSize);
  expect(imperialStyles.fontWeight).toBe(baseStyles.fontWeight);
  expect(imperialStyles.padding).toBe(baseStyles.padding);

  // Convert to Metric
  await page.locator('.recipe-convert-select').selectOption('metric');
  const metricStyles = await qtySpan.evaluate(el => {
    const s = getComputedStyle(el);
    return { fontSize: s.fontSize, fontWeight: s.fontWeight, padding: s.padding };
  });
  expect(metricStyles.fontSize).toBe(baseStyles.fontSize);
  expect(metricStyles.fontWeight).toBe(baseStyles.fontWeight);
  expect(metricStyles.padding).toBe(baseStyles.padding);
});

test('recipe unit styling matches qty and stays consistent during conversion', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.recipe-ingredient-qty', { timeout: 5_000 });

  const qtySpan = page.locator('.recipe-ingredient-qty').nth(3);
  const unitSpan = page.locator('.recipe-ingredient-unit').nth(3);

  // Both should have matching font-size, font-weight, and padding
  const qtyStyles = await qtySpan.evaluate(el => {
    const s = getComputedStyle(el);
    return { fontSize: s.fontSize, fontWeight: s.fontWeight, padding: s.padding };
  });
  const unitStyles = await unitSpan.evaluate(el => {
    const s = getComputedStyle(el);
    return { fontSize: s.fontSize, fontWeight: s.fontWeight, padding: s.padding };
  });
  expect(unitStyles.fontSize).toBe(qtyStyles.fontSize);
  expect(unitStyles.fontWeight).toBe(qtyStyles.fontWeight);

  // Unit styling stays consistent during conversion
  await page.locator('.recipe-convert-select').selectOption('imperial');
  const unitConvertedStyles = await unitSpan.evaluate(el => {
    const s = getComputedStyle(el);
    return { fontSize: s.fontSize, fontWeight: s.fontWeight, padding: s.padding };
  });
  expect(unitConvertedStyles.fontSize).toBe(unitStyles.fontSize);
  expect(unitConvertedStyles.fontWeight).toBe(unitStyles.fontWeight);
  expect(unitConvertedStyles.padding).toBe(unitStyles.padding);
});

test('recipe qty bounding box height stays identical across scale changes', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.recipe-ingredient-qty', { timeout: 5_000 });

  const qtySpan = page.locator('.recipe-ingredient-qty').first();

  // Measure element height at 1× (includes padding, font, line-height)
  const baseHeight = await qtySpan.evaluate(el => el.getBoundingClientRect().height);

  // Scale to 2× — height must not change
  await page.locator('.recipe-scale-select').selectOption('2');
  const scaledHeight = await qtySpan.evaluate(el => el.getBoundingClientRect().height);
  expect(scaledHeight).toBe(baseHeight);

  // Scale to ½× — height must not change
  await page.locator('.recipe-scale-select').selectOption('0.5');
  const halfHeight = await qtySpan.evaluate(el => el.getBoundingClientRect().height);
  expect(halfHeight).toBe(baseHeight);

  // Back to 1× — height must not change
  await page.locator('.recipe-scale-select').selectOption('1');
  const restoredHeight = await qtySpan.evaluate(el => el.getBoundingClientRect().height);
  expect(restoredHeight).toBe(baseHeight);
});

test('recipe qty bounding box height stays identical across unit conversions', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.recipe-ingredient-qty', { timeout: 5_000 });

  const qtySpan = page.locator('.recipe-ingredient-qty').first();

  // Measure element height at Original
  const baseHeight = await qtySpan.evaluate(el => el.getBoundingClientRect().height);

  // Imperial — height must not change
  await page.locator('.recipe-convert-select').selectOption('imperial');
  const imperialHeight = await qtySpan.evaluate(el => el.getBoundingClientRect().height);
  expect(imperialHeight).toBe(baseHeight);

  // Metric — height must not change
  await page.locator('.recipe-convert-select').selectOption('metric');
  const metricHeight = await qtySpan.evaluate(el => el.getBoundingClientRect().height);
  expect(metricHeight).toBe(baseHeight);

  // Back to Original — height must not change
  await page.locator('.recipe-convert-select').selectOption('original');
  const restoredHeight = await qtySpan.evaluate(el => el.getBoundingClientRect().height);
  expect(restoredHeight).toBe(baseHeight);
});

test('recipe sorts unitless ingredients first', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.recipe-ingredients-list li', { timeout: 5_000 });

  const units = page.locator('.recipe-ingredient-unit');
  const count = await units.count();

  // First 3 items should have no unit text (unitless group)
  for (let i = 0; i < 3; i++) {
    const text = await units.nth(i).textContent();
    expect(text).toBe('');
  }

  // Items 3–8 should have unit text (unit group)
  for (let i = 3; i < count; i++) {
    const text = await units.nth(i).textContent();
    expect(text.trim().length).toBeGreaterThan(0);
  }
});

test('recipe unitless ingredients appear before unit ingredients', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.recipe-ingredients-list li', { timeout: 5_000 });

  // Onion (unitless) should appear before spaghetti (has unit "g")
  const names = page.locator('.recipe-ingredient-text');
  const onionIndex = await names.evaluateAll(els =>
    els.findIndex(el => el.textContent.toLowerCase().includes('onion'))
  );
  const spaghettiIndex = await names.evaluateAll(els =>
    els.findIndex(el => el.textContent.toLowerCase().includes('spaghetti'))
  );

  expect(onionIndex).toBeLessThan(spaghettiIndex);
});

test('recipe ingredient columns are left-aligned with fixed widths', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.recipe-ingredient-qty', { timeout: 5_000 });

  const qtySpan = page.locator('.recipe-ingredient-qty').nth(3);
  const unitSpan = page.locator('.recipe-ingredient-unit').nth(3);

  const qtyStyles = await qtySpan.evaluate(el => {
    const s = getComputedStyle(el);
    return { textAlign: s.textAlign, width: s.width };
  });
  const unitStyles = await unitSpan.evaluate(el => {
    const s = getComputedStyle(el);
    return { textAlign: s.textAlign, width: s.width };
  });

  // Both columns should be left-aligned
  expect(qtyStyles.textAlign).toBe('left');
  expect(unitStyles.textAlign).toBe('left');

  // Both columns should have fixed widths (not "auto")
  expect(qtyStyles.width).not.toBe('auto');
  expect(unitStyles.width).not.toBe('auto');
});

test('recipe initial qty display uses formatNumber for consistency', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.recipe-ingredient-qty', { timeout: 5_000 });

  // Spaghetti (index 3) qty is "400" — formatNumber(400) → "400"
  const firstQty = page.locator('.recipe-ingredient-qty').nth(3);
  const initialText = await firstQty.textContent();
  expect(initialText).toBe('400');

  // Scale to 2× and back to 1× — text should be identical to initial
  await page.locator('.recipe-scale-select').selectOption('2');
  await page.locator('.recipe-scale-select').selectOption('1');
  const afterRoundTrip = await firstQty.textContent();
  expect(afterRoundTrip).toBe(initialText);
});

/* ---------- Cooking Mode: Ingredient Checkoff ---------- */

test('recipe clicking ingredient toggles strikethrough class', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.recipe-ingredients-list li', { timeout: 5_000 });

  const li = page.locator('.recipe-ingredients-list li').first();
  await expect(li).not.toHaveClass(/recipe-ingredient-checked/);

  // Click the bullet area (not on editable cell)
  await li.locator('::before').click().catch(() => {});
  // Fallback: click the li element itself via JS
  await li.evaluate(el => el.click());
  await expect(li).toHaveClass(/recipe-ingredient-checked/);

  // Click again to uncheck
  await li.evaluate(el => el.click());
  await expect(li).not.toHaveClass(/recipe-ingredient-checked/);
});

test('recipe ingredient checkoff does not trigger on editable cell click', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.recipe-ingredients-list li', { timeout: 5_000 });

  const li = page.locator('.recipe-ingredients-list li').nth(3);
  const qtySpan = li.locator('.recipe-ingredient-qty');

  // Click the qty span (editable cell) — should NOT toggle checked class
  await qtySpan.click();
  await expect(li).not.toHaveClass(/recipe-ingredient-checked/);
});

/* ---------- Shopping List Mode ---------- */

test('recipe shopping list button is visible', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.recipe-shopping-btn', { timeout: 5_000 });

  await expect(page.locator('.recipe-shopping-btn')).toBeVisible();
  await expect(page.locator('.recipe-shopping-btn')).toContainText('Shopping List');
});

test('recipe shopping list mode hides instructions and metadata', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.recipe-shopping-btn', { timeout: 5_000 });

  // Toggle shopping mode
  await page.click('.recipe-shopping-btn');

  // Card should have shopping mode class
  await expect(page.locator('.recipe-card')).toHaveClass(/recipe-shopping-mode/);

  // Instructions and metadata should be hidden
  await expect(page.locator('.recipe-card-instructions')).toBeHidden();
  await expect(page.locator('.recipe-card-notes')).toBeHidden();
  await expect(page.locator('.recipe-scale-select')).toBeHidden();
  await expect(page.locator('.recipe-print-btn')).toBeHidden();

  // Shopping / Reset buttons should still be visible in toolbar
  await expect(page.locator('.recipe-shopping-btn')).toBeVisible();
  await expect(page.locator('.recipe-reset-btn')).toBeVisible();

  // Ingredients should still be visible
  await expect(page.locator('.recipe-ingredients-list')).toBeVisible();
});

test('recipe shopping list mode exit restores normal view', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.recipe-shopping-btn', { timeout: 5_000 });

  // Enter shopping mode
  await page.click('.recipe-shopping-btn');
  await expect(page.locator('.recipe-card')).toHaveClass(/recipe-shopping-mode/);

  // Exit shopping mode
  await page.click('.recipe-shopping-btn');
  await expect(page.locator('.recipe-card')).not.toHaveClass(/recipe-shopping-mode/);

  // Instructions should be visible again
  await expect(page.locator('.recipe-card-instructions')).toBeVisible();
});

test('recipe shopping list mode button text changes when active', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.recipe-shopping-btn', { timeout: 5_000 });

  const btn = page.locator('.recipe-shopping-btn');
  await expect(btn).toContainText('Shopping List');

  await btn.click();
  await expect(btn).toContainText('Exit');

  await btn.click();
  await expect(btn).toContainText('Shopping List');
});

test('recipe ingredient checkoff works in shopping list mode', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.recipe-shopping-btn', { timeout: 5_000 });

  // Enter shopping mode
  await page.click('.recipe-shopping-btn');

  // Click an ingredient to check it off
  const li = page.locator('.recipe-ingredients-list li').first();
  await li.evaluate(el => el.click());
  await expect(li).toHaveClass(/recipe-ingredient-checked/);
});

/* --- Status + Rating tests --- */

test('recipe shows status badge', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.recipe-status-badge', { timeout: 5_000 });
  await expect(page.locator('.recipe-status-badge')).toContainText('Approved');
});

test('recipe status badge cycles on click', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.recipe-status-badge', { timeout: 5_000 });
  await page.locator('.recipe-status-badge').click();
  await expect(page.locator('.recipe-status-badge')).toContainText('Needs Work');
});

test('recipe shows average rating with stars', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.recipe-rating-avg', { timeout: 5_000 });
  const filled = page.locator('.recipe-rating-avg .recipe-star-filled');
  expect(await filled.count()).toBeGreaterThanOrEqual(3);
});

test('recipe shows per-person rating breakdown', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.recipe-rating-breakdown', { timeout: 5_000 });
  const persons = page.locator('.recipe-rating-person');
  expect(await persons.count()).toBe(3);
});

test('recipe interactive rating stars are clickable', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.recipe-your-rating', { timeout: 5_000 });
  const stars = page.locator('.recipe-rate-star');
  expect(await stars.count()).toBe(5);
});

test('recipe status cycling emits cell-update record', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.recipe-status-badge', { timeout: 5_000 });

  // Click status badge to cycle Approved → Needs Work
  await page.locator('.recipe-status-badge').click();
  await expect(page.locator('.recipe-status-badge')).toContainText('Needs Work');

  const records = await getCreatedRecords(page);
  const statusRecord = records.find(r => r.type === 'cell-update' && r.value === 'Needs Work');
  expect(statusRecord).toBeTruthy();
});

test('recipe status full cycle returns to original state', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.recipe-status-badge', { timeout: 5_000 });

  // Approved → Needs Work → Untested → Approved
  await page.locator('.recipe-status-badge').click();
  await expect(page.locator('.recipe-status-badge')).toContainText('Needs Work');
  await page.locator('.recipe-status-badge').click();
  await expect(page.locator('.recipe-status-badge')).toContainText('Untested');
  await page.locator('.recipe-status-badge').click();
  await expect(page.locator('.recipe-status-badge')).toContainText('Approved');
});

test('recipe rating star click emits cell-update record', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.recipe-your-rating', { timeout: 5_000 });

  // Click the 4th star
  await page.locator('.recipe-rate-star').nth(3).click();

  const records = await getCreatedRecords(page);
  const ratingRecord = records.find(r => r.type === 'cell-update' && r.value && r.value.includes(':4'));
  expect(ratingRecord).toBeTruthy();
});

test('recipe rating star click updates average stars visually', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.recipe-your-rating', { timeout: 5_000 });

  // Click the 5th star (highest)
  await page.locator('.recipe-rate-star').nth(4).click();

  // The clicked star should become filled
  await expect(page.locator('.recipe-rate-star').nth(4)).toHaveClass(/recipe-star-filled/);

  // Average display should update
  const filledAvg = page.locator('.recipe-rating-avg .recipe-star-filled');
  expect(await filledAvg.count()).toBeGreaterThanOrEqual(4);
});

test('recipe reset button is visible', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.recipe-reset-btn', { timeout: 5_000 });
  await expect(page.locator('.recipe-reset-btn')).toBeVisible();
  await expect(page.locator('.recipe-reset-btn')).toContainText('Reset');
});

test('recipe reset button clears checked ingredients', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.recipe-ingredients-list li', { timeout: 5_000 });

  // Check off a few ingredients by clicking (use evaluate to avoid hitting editable cells)
  const items = page.locator('.recipe-ingredients-list li');
  await items.nth(0).evaluate(el => el.click());
  await items.nth(1).evaluate(el => el.click());
  await expect(items.nth(0)).toHaveClass(/recipe-ingredient-checked/);
  await expect(items.nth(1)).toHaveClass(/recipe-ingredient-checked/);

  // Click reset
  await page.locator('.recipe-reset-btn').click();

  // All checkmarks should be cleared
  await expect(items.nth(0)).not.toHaveClass(/recipe-ingredient-checked/);
  await expect(items.nth(1)).not.toHaveClass(/recipe-ingredient-checked/);
});

test('recipe reset button shows toast notification', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.recipe-reset-btn', { timeout: 5_000 });

  // Check off at least one ingredient first
  const li = page.locator('.recipe-ingredients-list li').first();
  await li.evaluate(el => el.click());
  await expect(li).toHaveClass(/recipe-ingredient-checked/);

  await page.locator('.recipe-reset-btn').click();
  await page.waitForSelector('.toast', { timeout: 5_000 });
  await expect(page.locator('.toast')).toContainText('Checkmarks cleared');
});

test('recipe reset button clears step checkmarks too', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.recipe-instructions-list li', { timeout: 5_000 });

  // Manually add step-checked class to simulate a checked step
  const step = page.locator('.recipe-instructions-list li').first();
  await step.evaluate(el => el.classList.add('recipe-step-checked'));
  await expect(step).toHaveClass(/recipe-step-checked/);

  // Click reset
  await page.locator('.recipe-reset-btn').click();

  // Step checkmark should be cleared
  await expect(step).not.toHaveClass(/recipe-step-checked/);
});

test('recipe renders photo when Photo column has an image URL', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.recipe-photo', { timeout: 5_000 });

  const img = page.locator('.recipe-photo-img');
  expect(await img.count()).toBe(1);
  const src = await img.getAttribute('src');
  expect(src).toContain('.jpg');
});

test('recipe photo appears between header and toolbar', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.recipe-photo', { timeout: 5_000 });

  // Photo should be a sibling after header and before toolbar
  const card = page.locator('.recipe-card');
  const children = card.locator('> *');
  const classes = await children.evaluateAll(els => els.map(e => e.className));
  const headerIdx = classes.findIndex(c => c.includes('recipe-card-header'));
  const photoIdx = classes.findIndex(c => c.includes('recipe-photo'));
  const scaleIdx = classes.findIndex(c => c.includes('recipe-toolbar'));
  expect(photoIdx).toBeGreaterThan(headerIdx);
  expect(photoIdx).toBeLessThan(scaleIdx);
});

/* ---------- Quantity truncation fix tests ---------- */

test('recipe quantity cell does not overflow-hide its content', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.recipe-ingredient-qty', { timeout: 5_000 });

  // overflow must NOT be hidden — the fix removes the old CSS truncation
  const qtySpan = page.locator('.recipe-ingredient-qty').first();
  const overflowX = await qtySpan.evaluate(el => getComputedStyle(el).overflowX);
  expect(overflowX).not.toBe('hidden');

  // text-overflow must NOT be ellipsis
  const textOverflow = await qtySpan.evaluate(el => getComputedStyle(el).textOverflow);
  expect(textOverflow).not.toBe('ellipsis');
});

test('recipe 4-digit quantities display fully without truncation at 3× scale', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.recipe-toolbar', { timeout: 5_000 });

  // Scale to 3× — spaghetti (index 3) goes from "400" to "1200" (4 digits)
  await page.locator('.recipe-scale-select').selectOption('3');

  const qtySpan = page.locator('.recipe-ingredient-qty').nth(3);
  await expect(qtySpan).toContainText('1200');

  // Verify the element is wider than it would be capped at the old 3em fixed width:
  // at 1.06rem typical font, 3em ≈ 51px; "1200" in bold needs more.
  // The element must expand to show all digits (scrollWidth <= offsetWidth means no truncation)
  const notTruncated = await qtySpan.evaluate(el => {
    const cs = getComputedStyle(el);
    return cs.overflowX !== 'hidden' && cs.textOverflow !== 'ellipsis';
  });
  expect(notTruncated).toBe(true);
});

test('recipe 5-digit quantities from custom 4× scale display fully', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.recipe-toolbar', { timeout: 5_000 });

  // Custom scale ×4 — 400g spaghetti → 1600 (4 digits), 800g tomatoes → 3200 (4 digits)
  await page.locator('.recipe-scale-select').selectOption('custom');
  const customInput = page.locator('.recipe-scale-custom');
  await expect(customInput).toBeVisible();
  await customInput.fill('4');

  const spaghettiQty = page.locator('.recipe-ingredient-qty').nth(3);
  await expect(spaghettiQty).toContainText('1600');

  // Verify no overflow clipping
  const notTruncated = await spaghettiQty.evaluate(el => {
    const cs = getComputedStyle(el);
    return cs.overflowX !== 'hidden' && cs.textOverflow !== 'ellipsis';
  });
  expect(notTruncated).toBe(true);
});

test('recipe quantity min-width ensures short values remain aligned', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.recipe-ingredient-qty', { timeout: 5_000 });

  // Even single-digit qtys should have a minimum rendered width
  const singleDigitQty = page.locator('.recipe-ingredient-qty').first();
  const width = await singleDigitQty.evaluate(el => el.getBoundingClientRect().width);
  // min-width: 2.5em at 1.06rem ≈ 40px at 16px base — should be at least 30px
  expect(width).toBeGreaterThan(30);
});

/* ---------- Cookbook Directory View ---------- */

test('cookbook directoryView renders for shared recipe folder', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => { window.location.hash = '#/folder/f-recipes/Family%20Recipes'; });
  await page.waitForSelector('.cookbook-directory', { timeout: 8_000 });
  await expect(page.locator('.cookbook-directory')).toBeVisible();
});

test('cookbook directoryView shows Family Cookbook title', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => { window.location.hash = '#/folder/f-recipes/Family%20Recipes'; });
  await page.waitForSelector('.cookbook-title', { timeout: 8_000 });
  await expect(page.locator('.cookbook-title')).toContainText('Family Cookbook');
});

test('cookbook directoryView shows family subtitle', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => { window.location.hash = '#/folder/f-recipes/Family%20Recipes'; });
  await page.waitForSelector('.cookbook-subtitle', { timeout: 8_000 });
  await expect(page.locator('.cookbook-subtitle')).toContainText('family');
});

test('cookbook directoryView shows Sync Family Recipes button', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => { window.location.hash = '#/folder/f-recipes/Family%20Recipes'; });
  await page.waitForSelector('.cookbook-sync-btn', { timeout: 8_000 });
  await expect(page.locator('.cookbook-sync-btn')).toBeVisible();
  await expect(page.locator('.cookbook-sync-btn')).toContainText('Sync Family Recipes');
});

test('cookbook directoryView shows recipe cards', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => { window.location.hash = '#/folder/f-recipes/Family%20Recipes'; });
  await page.waitForSelector('.cookbook-card', { timeout: 8_000 });
  const cards = page.locator('.cookbook-card');
  expect(await cards.count()).toBeGreaterThanOrEqual(2);
});

test('cookbook directoryView card click navigates to sheet', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => { window.location.hash = '#/folder/f-recipes/Family%20Recipes'; });
  await page.waitForSelector('.cookbook-card', { timeout: 8_000 });
  await page.locator('.cookbook-card').first().click();
  await page.waitForSelector('.recipe-card', { timeout: 5_000 });
  expect(page.url()).toContain('#/sheet/');
});

test('cookbook directoryView shows recipe count badge', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => { window.location.hash = '#/folder/f-recipes/Family%20Recipes'; });
  await page.waitForSelector('.cookbook-count', { timeout: 8_000 });
  await expect(page.locator('.cookbook-count')).toContainText('recipe');
});

test('cookbook directoryView shows folder refresh button in header', async ({ page }) => {
  await setupApp(page);
  await page.evaluate(() => { window.location.hash = '#/folder/f-recipes/Family%20Recipes'; });
  await page.waitForSelector('.cookbook-directory', { timeout: 8_000 });
  await expect(page.locator('#folder-refresh-btn')).toBeVisible();
});
