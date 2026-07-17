const { test, expect } = require('@playwright/test');

test('model adapter — verify model adapter module created', () => {
  // This is a unit test that verifies the module exists in the file system
  // We'll do actual integration testing in the agent tests
  const modelAdapterPath = require('path').join(__dirname, '../../public/js/agent/model-adapter.js');
  const fs = require('fs');
  expect(fs.existsSync(modelAdapterPath)).toBe(true);
});

test('model adapter — claude request body conversion exists', () => {
  // Verify the utility functions are available in config.js
  const configPath = require('path').join(__dirname, '../../public/js/agent/config.js');
  const fs = require('fs');
  const content = fs.readFileSync(configPath, 'utf8');
  
  expect(content).toContain('buildClaudeRequestBody');
  expect(content).toContain('convertGeminiContentsToClaudeMessages');
  expect(content).toContain('claudeHeaders');
  expect(content).toContain('claudeUrl');
});

test('model adapter — vault integration exists', () => {
  // Verify vault.js exists and has necessary functions
  const vaultPath = require('path').join(__dirname, '../../public/js/agent/vault.js');
  const fs = require('fs');
  const content = fs.readFileSync(vaultPath, 'utf8');
  
  expect(content).toContain('getGeminiKeys');
  expect(content).toContain('getClaudeKeys');
  expect(content).toContain('unlockVault');
  expect(content).toContain('isVaultSetUp');
  expect(content).toContain('isVaultUnlocked');
});

test('model adapter — supports all three providers', () => {
  // Verify config has model definitions for all three providers
  const configPath = require('path').join(__dirname, '../../public/js/agent/config.js');
  const fs = require('fs');
  const content = fs.readFileSync(configPath, 'utf8');
  
  expect(content).toContain('GEMINI_API_BASE');
  expect(content).toContain('CLAUDE_API_BASE');
  expect(content).toContain('normalizeOllamaBaseUrl');
  expect(content).toContain('ollamaChatUrl');
});

