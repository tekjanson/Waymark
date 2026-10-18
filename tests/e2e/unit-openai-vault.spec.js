// @ts-check
/**
 * unit-openai-vault.spec.js — OpenAI API key persistence to the Vault Sheet.
 *
 * Saving an OpenAI key with a linked + unlocked keys sheet must write a row to
 * that Google Sheet (not just localStorage) and hydrate back into the session.
 */
const { test, expect } = require('@playwright/test');
const { setupApp, getCreatedRecords } = require('../helpers/test-utils');

test('saving an OpenAI key writes a row to the linked Vault sheet', async ({ page }) => {
  await setupApp(page);
  await page.waitForSelector('#app-screen:not(.hidden)', { timeout: 5_000 });

  const result = await page.evaluate(async () => {
    const vault = await import('/js/agent/vault.js');
    // Link + unlock the AI API Keys passwords sheet (sheet-070 fixture).
    vault.linkSheet('sheet-070', 'AI API Keys');
    const unlocked = await vault.unlockVault('');
    const ok = await vault.addKeyToSheet({
      key: 'sk-openai-vault-test-123', nickname: 'Primary', provider: 'openai', isBilled: true,
    });
    const openaiKeys = vault.getOpenAIKeys().map(k => k.key);
    return { unlocked, ok, openaiKeys };
  });

  expect(result.unlocked).toBe(true);
  expect(result.ok).toBe(true);
  expect(result.openaiKeys).toContain('sk-openai-vault-test-123');

  // A row was appended to the vault Google Sheet with an OpenAI site label.
  const records = await getCreatedRecords(page);
  const append = records.find(r => r.type === 'row-append' && r.spreadsheetId === 'sheet-070');
  expect(append).toBeTruthy();
  const flatRow = (append.rows[0] || []).join(' ');
  expect(flatRow).toContain('OpenAI API Key');
  expect(flatRow).toContain('sk-openai-vault-test-123');
});

test('vault hydrates OpenAI keys from the sheet on unlock', async ({ page }) => {
  await setupApp(page);
  await page.waitForSelector('#app-screen:not(.hidden)', { timeout: 5_000 });

  const keys = await page.evaluate(async () => {
    const vault = await import('/js/agent/vault.js');
    vault.linkSheet('sheet-070', 'AI API Keys');
    await vault.unlockVault('');
    // Persist an OpenAI key to the sheet, then drop the session and re-unlock
    // so the key must come back purely from the Google Sheet (hydration).
    await vault.addKeyToSheet({ key: 'sk-hydrated-openai-999', nickname: 'H', provider: 'openai' });
    vault.lockVault();
    await vault.unlockVault('');
    return vault.getOpenAIKeys().map(k => k.key);
  });

  expect(keys).toContain('sk-hydrated-openai-999');
});
