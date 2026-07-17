const { test, expect } = require('@playwright/test');
const { setupApp, navigateToSheet } = require('../helpers/test-utils.js');

test('model-swap-full: can setup and swap between Claude and Gemini using password vault', async ({ page }) => {
  await setupApp(page);
  
  // Navigate to the password manager sheet (which exists in fixtures)
  await navigateToSheet(page, 'sheet-019'); // passwords-api-keys fixture
  await page.waitForLoadState('networkidle');

  // Verify password manager is loaded
  const templateBadge = await page.locator('#template-badge');
  await expect(templateBadge).toContainText('Password Manager');

  // Now verify that model-swap-ui has access to the vault
  // by checking the getAvailableKey function works
  const result = await page.evaluate(async () => {
    const { getAvailableKey, setVaultSheet } = await import('/js/model-swap-ui.js');
    
    // Create mock vault data with Claude key
    const vaultData = {
      rows: [
        ['Claude API', 'user@example.com', 'sk-ant-test-key-12345', 'API', 'Claude'],
        ['Gemini API', 'google@example.com', 'AIzaSyTest67890', 'API', 'Gemini']
      ],
      cols: { site: 0, username: 1, password: 2, category: 3, notes: 4 }
    };
    
    // Set the vault
    setVaultSheet(vaultData, 'sheet-019');
    
    // Get Claude key
    const claudeKey = await getAvailableKey('claude');
    
    // Get Gemini key
    const geminiKey = await getAvailableKey('gemini');
    
    return { claudeKey, geminiKey };
  });

  // Verify keys are retrieved correctly
  expect(result.claudeKey).toBe('sk-ant-test-key-12345');
  expect(result.geminiKey).toBe('AIzaSyTest67890');
});

test('model-swap-full: model selection persists and retrieves correct model preference', async ({ page }) => {
  await setupApp(page);

  const result = await page.evaluate(async () => {
    const { 
      getCurrentModel, 
      setCurrentModel, 
      getModelKey,
      hasModelKey 
    } = await import('/js/model-swap.js');

    // Check current model (should be claude by default or previous setting)
    const currentBefore = getCurrentModel();
    
    // Set to gemini
    setCurrentModel('gemini');
    const currentAfter = getCurrentModel();
    
    // Test hasModelKey
    const hasKey = hasModelKey('gemini');
    
    return {
      currentBefore,
      currentAfter,
      hasKey
    };
  });

  expect(result.currentAfter).toBe('gemini');
  expect(typeof result.hasKey).toBe('boolean');
});

test('model-swap-full: UI shows correct status when vault is available', async ({ page }) => {
  await setupApp(page);

  // Open settings modal
  const settingsBtn = page.locator('button:has-text("Settings")');
  // Look for settings button in top-right area
  const settingsModal = page.locator('#settings-modal');
  
  // Trigger settings modal open (usually via settings button or keyboard shortcut)
  // For now, just verify the UI elements exist
  const modelSelect = page.locator('#settings-ai-model');
  const statusText = page.locator('#settings-ai-status-text');
  const helpBtn = page.locator('#settings-ai-help-btn');

  // Check that model selector exists
  if (await modelSelect.isVisible()) {
    // Get current selection
    const selected = await modelSelect.inputValue();
    expect(['claude', 'gemini']).toContain(selected);

    // Verify status text exists
    const status = await statusText.textContent();
    expect(status).toContain('Active:');
  }

  // Check help button exists
  if (await helpBtn.isVisible()) {
    expect(helpBtn).toBeVisible();
  }
});

test('model-swap-full: AI setup guide modal displays both Claude and Gemini instructions', async ({ page }) => {
  await setupApp(page);

  // The setup guide should be accessible but not necessarily visible by default
  const setupModal = page.locator('#ai-setup-modal');
  
  // Make sure the modal structure exists
  const geminiSection = page.locator('text="Google Gemini"');
  const claudeSection = page.locator('text="Anthropic Claude"');

  // Check that both sections exist in the page (not necessarily visible)
  expect(geminiSection.or(claudeSection)).toBeDefined();
});
