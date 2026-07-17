const { test, expect } = require('@playwright/test');

test('unit-model-swap-ui resolves a provider key from a vault sheet', async ({ page }) => {
  await page.goto('http://localhost:3000/');
  await page.waitForLoadState('networkidle');

  const result = await page.evaluate(async () => {
    const { getModelKey, setVaultSheet } = await import('/js/model-swap-ui.js');
    const vaultSheet = {
      headers: ['Site', 'Username', 'Password', 'Category', 'Notes'],
      rows: [['Gemini API Key', 'google', 'gemini-test-key', 'AI', 'UAT']],
      cols: { site: 0, username: 1, password: 2, category: 3, notes: 4 },
    };

    setVaultSheet(vaultSheet, 'sheet-123');
    return getModelKey('gemini');
  });

  expect(result).toBe('gemini-test-key');
});
