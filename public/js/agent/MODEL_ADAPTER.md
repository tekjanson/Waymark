# Model Adapter — Gemini ↔ Claude Swap

**Status:** ✅ Implemented  
**Key Files:** `public/js/agent/model-adapter.js`, `public/js/agent/vault.js`, `public/js/agent/config.js`

## Overview

The **Model Adapter** is a lightweight abstraction layer that enables seamless, low-friction swapping between Gemini (Google), Claude (Anthropic), and Ollama (local) LLM providers.

### Design Goals

1. **Centralize** provider-specific request/response handling
2. **Unify** key management across providers (localStorage + Password Manager vault)
3. **Abstract** provider differences (URLs, headers, message formats)
4. **Enable** easy switching in UI without code changes
5. **Maintain backward compatibility** with existing agent code

---

## Architecture

### Three Layers

```
┌─────────────────────────────────────────┐
│   Agent UI (settings.js, agent.js)      │
│   User picks provider; switches models  │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│   Model Adapter (model-adapter.js)      │
│   • buildRequest()                      │
│   • extractResponseText()               │
│   • pickBestApiKey()                    │
│   • vault integration                   │
└──────────────┬──────────────────────────┘
               │
┌──────────────────────────────────────────┐
│   Key Sources                            │
│   • localStorage (storage.js)            │
│   • Password Manager vault (vault.js)    │
└──────────────────────────────────────────┘
```

### Supported Providers

| Provider | Config | Keys From | Models |
|----------|--------|-----------|--------|
| **Gemini** | `GEMINI_API_BASE` | `getAgentKeys()` or vault | `gemini-flash-latest`, etc. |
| **Claude** | `CLAUDE_API_BASE` | `getClaudeKeys()` or vault | `claude-opus`, `claude-sonnet`, etc. |
| **Ollama** | Local HTTP | None (no auth) | Any local model |

---

## API Reference

### Provider Management

```javascript
import { 
  getCurrentProvider,
  setCurrentProvider,
  PROVIDERS,
  getProviderConfig,
} from './model-adapter.js';

// Get active provider
const provider = getCurrentProvider(); // 'gemini' | 'claude' | 'ollama'

// Switch provider
setCurrentProvider(PROVIDERS.CLAUDE);

// Get provider metadata
const config = getProviderConfig(PROVIDERS.CLAUDE);
// { name: 'Anthropic Claude', icon: '🟣', buildUrl, buildHeaders, ... }
```

### Key Management

Keys are fetched in order of preference:

1. **Vault (if set up and unlocked)** — encrypted Password Manager sheet
2. **localStorage** — local key ring in browser
3. **Fallback** — environment key (if server-injected)

```javascript
import { getApiKeys, pickBestApiKey } from './model-adapter.js';

// Get all keys for current provider
const keys = getApiKeys();
// [{ key: 'sk-...', nickname: 'My API Key', requestsToday: 5, ... }]

// Get the best key using LRU strategy
const { key, idx } = pickBestApiKey({ model: 'claude-opus' });
// idx = -1 for server key, 0+ for localStorage/vault keys
```

### Request Building

```javascript
import { buildRequest } from './model-adapter.js';

const req = buildRequest({
  contents: [
    { role: 'user', parts: [{text: 'Hello'}] },
    { role: 'model', parts: [{text: 'Hi!'}] },
  ],
  systemPrompt: 'You are helpful.',
  model: 'claude-opus', // optional; uses active model if omitted
});

// Result for Claude:
// {
//   url: 'https://api.anthropic.com/v1/messages',
//   method: 'POST',
//   headers: { 'x-api-key': 'sk-...', ... },
//   body: '{"model":"claude-opus","messages":[...],...}'
// }

// Then send:
const res = await fetch(req.url, {
  method: req.method,
  headers: req.headers,
  body: req.body,
});
```

### Response Parsing

```javascript
import {
  extractResponseText,
  extractToolCalls,
  isResponseFinished,
} from './model-adapter.js';

// Extract text from ANY provider's response
const text = extractResponseText(response, 'claude');

// Extract tool calls (Claude/Gemini format → normalized)
const tools = extractToolCalls(response, 'claude');
// [{ name: 'create_sheet', args: { title: '...' } }]

// Check if response is finished
const done = isResponseFinished(response);
```

### Vault Integration

```javascript
import {
  isVaultSetUp,
  isVaultUnlocked,
  unlockVault,
  lockVault,
  linkVaultSheet,
  getLinkedVaultSheetId,
  addKeyToVault,
} from './model-adapter.js';

// Check vault status
if (isVaultSetUp()) {
  if (!isVaultUnlocked()) {
    const success = await unlockVault('vault password');
    if (!success) throw new Error('Wrong password');
  }
}

// Link a passwords sheet
linkVaultSheet('123abc', 'My Passwords');

// Add key to vault
await addKeyToVault({
  key: 'sk-...', 
  nickname: 'Production Claude',
  provider: 'claude',
  isBilled: true,
});
```

---

## Usage in agent.js

### Before (tightly coupled)

```javascript
// Scattered across agent.js
if (provider === 'claude') {
  const url = claudeUrl();
  const headers = claudeHeaders(apiKey);
  const body = buildClaudeRequestBody(contents, systemPrompt, model);
  // ... custom Claude response parsing ...
  const text = data.content[0]?.text;
} else {
  // ... Gemini-specific code ...
}
```

### After (unified)

```javascript
import * as adapter from './agent/model-adapter.js';

// Build request (handles all provider differences)
const req = adapter.buildRequest({
  contents,
  systemPrompt,
  model: adapter.getActiveModel(),
});

// Send (same code for all providers)
const res = await fetch(req.url, {
  method: req.method,
  headers: req.headers,
  body: req.body,
});

// Parse (unified extraction)
const text = adapter.extractResponseText(await res.json());
```

---

## Key Features

### ✅ Automatic Key Selection

- **LRU strategy**: Rotates through keys by usage count
- **Error tracking**: Skips keys with recent errors
- **Billed preference**: Prioritizes paid keys for expensive models
- **Daily reset**: Counters reset automatically at midnight

```javascript
// Same call, different behavior based on active provider
const { key, idx } = adapter.pickBestApiKey({ model: 'claude-opus' });
// Gemini: uses getAgentKeys()
// Claude: uses getClaudeKeys()
// Ollama: returns empty (no auth needed)
```

### ✅ Vault-First Key Fetching

When a Password Manager sheet is linked:

1. User unlocks vault with password
2. `getApiKeys()` returns keys from vault (decrypted in-memory)
3. On key error, tries next key (vault keys rotate too)
4. Lock clears keys from memory (or on page close)

```javascript
// In settings.js or agent.js
const keys = adapter.getApiKeys();
// Returns vault keys if unlocked, else localStorage
```

### ✅ Format Conversion

- **Gemini format** → **Claude format**: `convertGeminiContentsToClaudeMessages()`
- **Claude responses** → **Gemini format**: `extractResponseText(response, 'claude')`
- **Tool calls**: Normalized `{ name, args }` format

---

## Migration Checklist

If updating `agent.js` to use the adapter:

- [ ] Import `model-adapter.js`
- [ ] Replace `_buildRequestBody(contents)` with `adapter.buildRequest({...})`
- [ ] Replace `fetch(geminiUrl(...))` with `fetch(req.url, {method, headers, body})`
- [ ] Replace response parsing with `adapter.extractResponseText(res)`
- [ ] Update `pickBestKey()` calls to use `adapter.pickBestApiKey()`
- [ ] Ensure settings.js uses `adapter.setCurrentProvider()` and `adapter.getApiKeys()`
- [ ] Test all three providers (Gemini, Claude, Ollama)

---

## Testing

```bash
# Unit tests (file existence, exports)
npm test -- model-adapter-unit.spec.js

# All tests
npm test
```

Tests verify:
- Model adapter file exists
- Config exports all provider functions
- Vault methods are available
- All three providers are configured

---

## Future Enhancements

- [ ] Stream support for all providers (Gemini streaming exists; Claude/Ollama TBD)
- [ ] Cost tracking per provider/model
- [ ] Fallback chain (try Claude → fallback to Gemini → fallback to Ollama)
- [ ] Rate limit auto-detection
- [ ] Key rotation policy (per model tier)

