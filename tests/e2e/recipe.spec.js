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

  // First ingredient: qty "400" in qty span, "g" in unit span, name separate
  const firstQty = page.locator('.recipe-ingredient-qty').first();
  await expect(firstQty).toContainText('400');

  const firstUnit = page.locator('.recipe-ingredient-unit').first();
  await expect(firstUnit).toContainText('g');

  const firstName = page.locator('.recipe-ingredient-text').first();
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
  await page.waitForSelector('.recipe-scale-bar', { timeout: 5_000 });

  const scaleBar = page.locator('.recipe-scale-bar');
  await expect(scaleBar).toBeVisible();

  // 1× button should be active by default
  const activeBtn = page.locator('.recipe-scale-btn.active');
  await expect(activeBtn).toContainText('1×');
});

test('recipe scaling doubles quantities when 2× is clicked', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.recipe-scale-bar', { timeout: 5_000 });

  // Click 2× button
  const btn2x = page.locator('.recipe-scale-btn[data-scale="2"]');
  await btn2x.click();

  // 2× should now be active
  await expect(btn2x).toHaveClass(/active/);

  // First quantity "400" → "800", unit stays "g"
  const firstQty = page.locator('.recipe-ingredient-qty').first();
  await expect(firstQty).toContainText('800');
  await expect(page.locator('.recipe-ingredient-unit').first()).toContainText('g');

  // Servings "4" → "8"
  const servings = page.locator('.recipe-meta-item .meta-label').first();
  await expect(servings).toContainText('8');
});

test('recipe scaling halves quantities when ½× is clicked', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.recipe-scale-bar', { timeout: 5_000 });

  // Click ½× button
  const btnHalf = page.locator('.recipe-scale-btn[data-scale="0.5"]');
  await btnHalf.click();

  // First quantity "400" → "200"
  const firstQty = page.locator('.recipe-ingredient-qty').first();
  await expect(firstQty).toContainText('200');

  // Servings "4" → "2"
  const servings = page.locator('.recipe-meta-item .meta-label').first();
  await expect(servings).toContainText('2');
});

test('recipe scaling resets to original when 1× is clicked back', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.recipe-scale-bar', { timeout: 5_000 });

  // Scale to 3×
  await page.locator('.recipe-scale-btn[data-scale="3"]').click();
  const firstQty = page.locator('.recipe-ingredient-qty').first();
  await expect(firstQty).toContainText('1200');

  // Reset to 1×
  await page.locator('.recipe-scale-btn[data-scale="1"]').click();
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
  await page.waitForSelector('.recipe-scale-bar', { timeout: 5_000 });

  // Type a custom scale of 4
  const customInput = page.locator('.recipe-scale-custom');
  await expect(customInput).toBeVisible();
  await customInput.fill('4');

  // First quantity "400" → "1600"
  const firstQty = page.locator('.recipe-ingredient-qty').first();
  await expect(firstQty).toContainText('1600');

  // Servings "4" → "16"
  const servings = page.locator('.recipe-meta-item .meta-label').first();
  await expect(servings).toContainText('16');

  // Preset buttons should not be active
  const activePresets = page.locator('.recipe-scale-btn.active');
  await expect(activePresets).toHaveCount(0);
});

test('recipe custom scale input clears when preset is clicked', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.recipe-scale-bar', { timeout: 5_000 });

  // Type a custom scale
  const customInput = page.locator('.recipe-scale-custom');
  await customInput.fill('5');

  // Now click a preset button
  await page.locator('.recipe-scale-btn[data-scale="2"]').click();

  // Custom input should be cleared
  await expect(customInput).toHaveValue('');

  // 2× should be active
  const activeBtn = page.locator('.recipe-scale-btn.active');
  await expect(activeBtn).toContainText('2×');
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
  await page.waitForSelector('.recipe-scale-bar', { timeout: 5_000 });

  // Scale to 2×
  await page.locator('.recipe-scale-btn[data-scale="2"]').click();

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
  await page.waitForSelector('.recipe-scale-bar', { timeout: 5_000 });

  // Scale to 3×
  await page.locator('.recipe-scale-btn[data-scale="3"]').click();
  const qtyCell = page.locator('.recipe-ingredient-qty').first();
  await expect(qtyCell).not.toHaveClass(/editable-cell/);

  // Return to 1×
  await page.locator('.recipe-scale-btn[data-scale="1"]').click();
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
  await page.waitForSelector('.recipe-scale-bar', { timeout: 5_000 });

  const printBtn = page.locator('.recipe-print-btn');
  await expect(printBtn).toBeVisible();
  await expect(printBtn).toContainText('Print');
});

test('recipe renders separate unit column for ingredients', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.recipe-ingredients-list li', { timeout: 5_000 });

  // Second ingredient (ground beef): qty "500" and unit "g" in separate spans
  const secondQty = page.locator('.recipe-ingredient-qty').nth(1);
  await expect(secondQty).toContainText('500');
  const secondUnit = page.locator('.recipe-ingredient-unit').nth(1);
  await expect(secondUnit).toContainText('g');

  // Fourth ingredient (garlic): qty "3" and unit "cloves"
  const fourthQty = page.locator('.recipe-ingredient-qty').nth(3);
  await expect(fourthQty).toContainText('3');
  const fourthUnit = page.locator('.recipe-ingredient-unit').nth(3);
  await expect(fourthUnit).toContainText('cloves');
});

/* ---------- Unit Conversion Tests ---------- */

test('recipe unit conversion bar is visible with three buttons', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.recipe-convert-bar', { timeout: 5_000 });

  const bar = page.locator('.recipe-convert-bar');
  await expect(bar).toBeVisible();

  const buttons = page.locator('.recipe-convert-btn');
  await expect(buttons).toHaveCount(3);

  // "Original" should be active by default
  const activeBtn = page.locator('.recipe-convert-btn.active');
  await expect(activeBtn).toContainText('Original');
});

test('recipe converts grams to imperial (oz/lb) when Imperial is clicked', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.recipe-convert-bar', { timeout: 5_000 });

  // Click "Imperial" button
  const imperialBtn = page.locator('.recipe-convert-btn[data-conversion="imperial"]');
  await imperialBtn.click();
  await expect(imperialBtn).toHaveClass(/active/);

  // 400 g spaghetti → unit span now shows "oz"
  const firstUnit = page.locator('.recipe-ingredient-unit').first();
  await expect(firstUnit).toContainText('oz');

  // 800 g canned tomatoes → unit should show "lb" (>= 453.592g threshold)
  const fifthUnit = page.locator('.recipe-ingredient-unit').nth(4);
  await expect(fifthUnit).toContainText('lb');
});

test('recipe converts tbsp/tsp to metric (ml) when Metric is clicked', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.recipe-convert-bar', { timeout: 5_000 });

  // Click "Metric" button
  const metricBtn = page.locator('.recipe-convert-btn[data-conversion="metric"]');
  await metricBtn.click();
  await expect(metricBtn).toHaveClass(/active/);

  // 2 tbsp olive oil → unit span now shows "ml"
  const sixthUnit = page.locator('.recipe-ingredient-unit').nth(5);
  await expect(sixthUnit).toContainText('ml');

  // 1 tsp dried oregano → unit span also shows "ml"
  const seventhUnit = page.locator('.recipe-ingredient-unit').nth(6);
  await expect(seventhUnit).toContainText('ml');

  // 400 g spaghetti → stays metric: qty "400", unit "g"
  const firstQty = page.locator('.recipe-ingredient-qty').first();
  await expect(firstQty).toContainText('400');
  const firstUnit = page.locator('.recipe-ingredient-unit').first();
  await expect(firstUnit).toContainText('g');
});

test('recipe non-convertible units stay unchanged during conversion', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.recipe-convert-bar', { timeout: 5_000 });

  // Click "Imperial"
  await page.locator('.recipe-convert-btn[data-conversion="imperial"]').click();

  // "3 cloves" garlic — not convertible: qty stays "3", unit stays "cloves"
  const fourthQty = page.locator('.recipe-ingredient-qty').nth(3);
  await expect(fourthQty).toContainText('3');
  const fourthUnit = page.locator('.recipe-ingredient-unit').nth(3);
  await expect(fourthUnit).toContainText('cloves');

  // "1" onion (no unit) — stays as "1"
  const thirdQty = page.locator('.recipe-ingredient-qty').nth(2);
  await expect(thirdQty).toContainText('1');
});

test('recipe restores original values when Original is clicked after conversion', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.recipe-convert-bar', { timeout: 5_000 });

  // Convert to Imperial
  await page.locator('.recipe-convert-btn[data-conversion="imperial"]').click();
  const firstUnit = page.locator('.recipe-ingredient-unit').first();
  await expect(firstUnit).toContainText('oz');

  // Switch back to Original
  await page.locator('.recipe-convert-btn[data-conversion="original"]').click();
  const firstQty = page.locator('.recipe-ingredient-qty').first();
  await expect(firstQty).toContainText('400');
  await expect(firstUnit).toContainText('g');

  // Original button should be active
  const activeBtn = page.locator('.recipe-convert-btn.active');
  await expect(activeBtn).toContainText('Original');
});

test('recipe unit conversion combines with scaling', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.recipe-convert-bar', { timeout: 5_000 });

  // Scale to 2× first
  await page.locator('.recipe-scale-btn[data-scale="2"]').click();
  const firstQty = page.locator('.recipe-ingredient-qty').first();
  await expect(firstQty).toContainText('800');
  const firstUnit = page.locator('.recipe-ingredient-unit').first();
  await expect(firstUnit).toContainText('g');

  // Now convert to Imperial — should show 2× scaled imperial value
  await page.locator('.recipe-convert-btn[data-conversion="imperial"]').click();
  // 800 g → 800 >= 453.592 → lb: 800/453.592 = 1.76 → unit span shows "lb"
  await expect(firstUnit).toContainText('lb');

  // Back to Original restores scaled values
  await page.locator('.recipe-convert-btn[data-conversion="original"]').click();
  await expect(firstQty).toContainText('800');
  await expect(firstUnit).toContainText('g');
});

test('recipe quantity is not editable when unit conversion is active', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.recipe-convert-bar', { timeout: 5_000 });

  // At default (1× scale, original units), qty should be editable
  const qtyCell = page.locator('.recipe-ingredient-qty').first();
  await expect(qtyCell).toHaveClass(/editable-cell/);

  // Convert to Metric — qty should no longer be editable
  await page.locator('.recipe-convert-btn[data-conversion="metric"]').click();
  await expect(qtyCell).not.toHaveClass(/editable-cell/);

  // Back to Original — should be editable again
  await page.locator('.recipe-convert-btn[data-conversion="original"]').click();
  await expect(qtyCell).toHaveClass(/editable-cell/);
});

test('recipe imperial units (tbsp/tsp) stay when Imperial conversion is selected', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.recipe-convert-bar', { timeout: 5_000 });

  // Click "Imperial"
  await page.locator('.recipe-convert-btn[data-conversion="imperial"]').click();

  // "2 tbsp" is already imperial — qty stays "2", unit stays "tbsp"
  const sixthQty = page.locator('.recipe-ingredient-qty').nth(5);
  await expect(sixthQty).toContainText('2');
  const sixthUnit = page.locator('.recipe-ingredient-unit').nth(5);
  await expect(sixthUnit).toContainText('tbsp');

  // "1 tsp" is already imperial — qty stays "1", unit stays "tsp"
  const seventhQty = page.locator('.recipe-ingredient-qty').nth(6);
  await expect(seventhQty).toContainText('1');
  const seventhUnit = page.locator('.recipe-ingredient-unit').nth(6);
  await expect(seventhUnit).toContainText('tsp');
});

/* ---------- Bug regression tests ---------- */

test('recipe empty unit does not show em-dash', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.recipe-ingredients-list li', { timeout: 5_000 });

  // Third ingredient "onion, diced" has no unit — unit span should be empty, not "—"
  const thirdUnit = page.locator('.recipe-ingredient-unit').nth(2);
  const unitText = await thirdUnit.textContent();
  expect(unitText).toBe('');
});

test('recipe scaling produces vulgar fractions for common values', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.recipe-scale-bar', { timeout: 5_000 });

  // Scale ½×: qty "3" cloves garlic → should show "1 ½" (or similar fraction)
  await page.locator('.recipe-scale-btn[data-scale="0.5"]').click();

  // 1 tsp → 0.5 → should show "½"
  const seventhQty = page.locator('.recipe-ingredient-qty').nth(6);
  await expect(seventhQty).toContainText('½');

  // 3 cloves → 1.5 → should show "1 ½"
  const fourthQty = page.locator('.recipe-ingredient-qty').nth(3);
  await expect(fourthQty).toContainText('½');
});

test('recipe unit span updates correctly during conversion', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.recipe-convert-bar', { timeout: 5_000 });

  // Original state: first ingredient unit is "g"
  const firstUnit = page.locator('.recipe-ingredient-unit').first();
  await expect(firstUnit).toContainText('g');

  // Convert to Imperial — unit span should update to "oz"
  await page.locator('.recipe-convert-btn[data-conversion="imperial"]').click();
  await expect(firstUnit).toContainText('oz');

  // Convert to Metric — should return to "g" (already metric)
  await page.locator('.recipe-convert-btn[data-conversion="metric"]').click();
  await expect(firstUnit).toContainText('g');

  // Back to Original
  await page.locator('.recipe-convert-btn[data-conversion="original"]').click();
  await expect(firstUnit).toContainText('g');
});

test('recipe unit span is not editable during conversion', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.recipe-convert-bar', { timeout: 5_000 });

  // Default: unit span should be editable
  const firstUnit = page.locator('.recipe-ingredient-unit').first();
  await expect(firstUnit).toHaveClass(/editable-cell/);

  // Convert to Imperial — unit span should not be editable
  await page.locator('.recipe-convert-btn[data-conversion="imperial"]').click();
  await expect(firstUnit).not.toHaveClass(/editable-cell/);

  // Back to Original — editable again
  await page.locator('.recipe-convert-btn[data-conversion="original"]').click();
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
  await page.locator('.recipe-scale-btn[data-scale="2"]').click();
  const scaledStyles = await qtySpan.evaluate(el => {
    const s = getComputedStyle(el);
    return { fontSize: s.fontSize, fontWeight: s.fontWeight, padding: s.padding };
  });
  expect(scaledStyles.fontSize).toBe(baseStyles.fontSize);
  expect(scaledStyles.fontWeight).toBe(baseStyles.fontWeight);
  expect(scaledStyles.padding).toBe(baseStyles.padding);

  // Scale to ½×
  await page.locator('.recipe-scale-btn[data-scale="0.5"]').click();
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
  await page.locator('.recipe-convert-btn[data-conversion="imperial"]').click();
  const imperialStyles = await qtySpan.evaluate(el => {
    const s = getComputedStyle(el);
    return { fontSize: s.fontSize, fontWeight: s.fontWeight, padding: s.padding };
  });
  expect(imperialStyles.fontSize).toBe(baseStyles.fontSize);
  expect(imperialStyles.fontWeight).toBe(baseStyles.fontWeight);
  expect(imperialStyles.padding).toBe(baseStyles.padding);

  // Convert to Metric
  await page.locator('.recipe-convert-btn[data-conversion="metric"]').click();
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

  const qtySpan = page.locator('.recipe-ingredient-qty').first();
  const unitSpan = page.locator('.recipe-ingredient-unit').first();

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
  await page.locator('.recipe-convert-btn[data-conversion="imperial"]').click();
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
  await page.locator('.recipe-scale-btn[data-scale="2"]').click();
  const scaledHeight = await qtySpan.evaluate(el => el.getBoundingClientRect().height);
  expect(scaledHeight).toBe(baseHeight);

  // Scale to ½× — height must not change
  await page.locator('.recipe-scale-btn[data-scale="0.5"]').click();
  const halfHeight = await qtySpan.evaluate(el => el.getBoundingClientRect().height);
  expect(halfHeight).toBe(baseHeight);

  // Back to 1× — height must not change
  await page.locator('.recipe-scale-btn[data-scale="1"]').click();
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
  await page.locator('.recipe-convert-btn[data-conversion="imperial"]').click();
  const imperialHeight = await qtySpan.evaluate(el => el.getBoundingClientRect().height);
  expect(imperialHeight).toBe(baseHeight);

  // Metric — height must not change
  await page.locator('.recipe-convert-btn[data-conversion="metric"]').click();
  const metricHeight = await qtySpan.evaluate(el => el.getBoundingClientRect().height);
  expect(metricHeight).toBe(baseHeight);

  // Back to Original — height must not change
  await page.locator('.recipe-convert-btn[data-conversion="original"]').click();
  const restoredHeight = await qtySpan.evaluate(el => el.getBoundingClientRect().height);
  expect(restoredHeight).toBe(baseHeight);
});

test('recipe initial qty display uses formatNumber for consistency', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-027');
  await page.waitForSelector('.recipe-ingredient-qty', { timeout: 5_000 });

  // Fixture first ingredient qty is "400" — formatNumber(400) → "400"
  const firstQty = page.locator('.recipe-ingredient-qty').first();
  const initialText = await firstQty.textContent();
  expect(initialText).toBe('400');

  // Scale to 2× and back to 1× — text should be identical to initial
  await page.locator('.recipe-scale-btn[data-scale="2"]').click();
  await page.locator('.recipe-scale-btn[data-scale="1"]').click();
  const afterRoundTrip = await firstQty.textContent();
  expect(afterRoundTrip).toBe(initialText);
});
