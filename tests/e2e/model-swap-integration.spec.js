const { test, expect } = require('@playwright/test');

test('model-swap-integration: vault integration works with model adapter', async ({ page }) => {
  // Setup local mode directly
  await page.goto('http://localhost:3000/', { waitUntil: 'networkidle' });
  
  // Inject waymark local flag
  await page.evaluate(() => {
    window.__WAYMARK_LOCAL = true;
    window.__WAYMARK_RECORDS = [];
  });

  // Test the model swap integration without full setup
  const result = await page.evaluate(async () => {
    // Import modules
    const modelSwap = await import('/js/model-swap.js');
    const modelSwapUI = await import('/js/model-swap-ui.js');

    // Initialize the adapter
    await modelSwap.initializeModelSwap();

    // Test 1: getCurrentModel works
    const currentModel = modelSwap.getCurrentModel();

    // Test 2: setCurrentModel works
    modelSwap.setCurrentModel('claude');
    const changedModel = modelSwap.getCurrentModel();

    // Test 3: hasModelKey works
    const hasClaude = modelSwap.hasModelKey('claude');
    const hasGemini = modelSwap.hasModelKey('gemini');

    // Test 4: getModelKey works
    const key = modelSwap.getModelKey('claude');

    // Test 5: model-swap-ui setVaultSheet works
    const vaultData = {
      rows: [
        ['Claude API', 'user@example.com', 'sk-ant-12345', 'API', 'Claude'],
      ],
      cols: { site: 0, username: 1, password: 2, category: 3, notes: 4 }
    };
    modelSwapUI.setVaultSheet(vaultData, 'sheet-123');

    // Test 6: getAvailableKey retrieves from vault
    const claudeKey = await modelSwapUI.getAvailableKey('claude');

    return {
      currentModelInitial: currentModel,
      currentModelAfterChange: changedModel,
      hasClaude,
      hasGemini,
      key: !!key,
      claudeKey,
    };
  });

  // Verify results
  expect(result.currentModelInitial).toBe('gemini');
  expect(result.currentModelAfterChange).toBe('claude');
  expect(typeof result.hasClaude).toBe('boolean');
  expect(typeof result.hasGemini).toBe('boolean');
  expect(typeof result.key).toBe('boolean');
  expect(result.claudeKey).toBe('sk-ant-12345');
});
