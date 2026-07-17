# Model Swap: Gemini ↔ Claude

Waymark now supports easy switching between Google Gemini and Anthropic Claude as your AI provider.

## Overview

The **Model Swap** system is a lightweight adapter that enables:

1. **Easy model switching** via the Settings modal
2. **Credential centralization** through the Password Manager vault
3. **Fallback to environment variables** for local development
4. **Session persistence** - your model choice is remembered across sessions

## Quick Start

### 1. Set Your Model Preference

Open Waymark → Settings → AI Model → Select **Claude** or **Gemini** (default)

Your choice is saved to localStorage and remembered on next login.

### 2. Configure API Keys

Choose one method:

#### Option A: Environment Variables (Local Development)

Set these in your `.env`:

```bash
# For Claude
ANTHROPIC_API_KEY=sk-ant-...

# For Gemini  
GOOGLE_GEMINI_API_KEY=AIzaSy...
```

#### Option B: Password Manager Vault (Recommended)

1. Open your **Password Manager** sheet in Waymark
2. Add a new entry:
   - **Site**: "Claude" or "Gemini"
   - **Username**: (leave blank or use your account name)
   - **Password**: Your API key
   - **Category**: "AI" (optional)

3. Waymark automatically detects and uses vault keys

The vault lookup is smart about names:
- Claude: matches "claude", "anthropic", "sonnet", "haiku", "opus"
- Gemini: matches "gemini", "google", "aistudio", "ai.google"

#### Option C: Window Globals (Runtime Injection)

For special cases, set at runtime:

```javascript
window.__WAYMARK_CLAUDE_KEY = 'sk-ant-...';
window.__WAYMARK_GEMINI_KEY = 'AIzaSy...';
```

## Architecture

### Files

- `public/js/model-swap.js` — Core adapter (model selection, credential management)
- `public/js/model-swap-ui.js` — UI controls (Settings modal, vault integration)
- `public/js/storage.js` — Persistence layer (localStorage)
- `public/js/templates/passwords.js` — Vault credential extraction

### Module API

#### model-swap.js

```javascript
// Initialize the adapter (called at boot)
await initializeModelSwap()

// Get/set current model
getCurrentModel()              // → 'claude' | 'gemini'
setCurrentModel(model)         // → void

// Get API key
getModelKey(service)           // → string | null

// Check availability
hasModelKey(model)             // → boolean

// Convenience
getCurrentModelWithKey()       // → { model, key } | null
```

#### model-swap-ui.js

```javascript
// Initialize UI (called at boot)
initializeModelSwapUI()

// Get key from vault (if open)
getModelKey(model)             // → string | null (sync, for tests)
getAvailableKey(model)         // → Promise<string | null>

// Manage vault context
setVaultSheet(vaultData, sheetId)  // Called when Password Manager is open
clearVaultSheet()                   // Called when Password Manager is closed
```

## How It Works

### Initialization Flow

1. **App boot** → calls `initializeModelSwap()` to load env keys
2. **Storage load** → reads saved model preference from localStorage
3. **UI init** → `initializeModelSwapUI()` wires up Settings modal
4. **On model change** → calls `setCurrentModel(model)`, persists to localStorage

### Key Resolution Priority

When looking up an API key:

1. **Vault (if Password Manager is open)** — `getDecryptedKey()` from vault data
2. **Environment variables** — `ANTHROPIC_API_KEY`, `GOOGLE_GEMINI_API_KEY`
3. **Window globals** — `__WAYMARK_CLAUDE_KEY`, `__WAYMARK_GEMINI_KEY`
4. **Not found** → `null`

### Template AI Integration (Future)

The template-ai.js overlay will detect the current model and route requests to:
- Claude: `POST https://api.anthropic.com/v1/messages`
- Gemini: `POST https://generativelanguage.googleapis.com/v1beta/models/{model}:streamGenerateContent`

## Testing

### Unit Test (Vault Integration)

```bash
npm test -- unit-model-swap-ui.spec.js
```

Tests credential resolution from a vault sheet.

### Manual Testing

1. **Local dev with env vars:**
   ```bash
   ANTHROPIC_API_KEY=sk-ant-... npm run dev
   # Select Claude in Settings → should work
   ```

2. **Vault key:**
   - Create a Password Manager sheet
   - Add entry: Site="Claude", Password="sk-ant-..."
   - Open Password Manager in Waymark
   - Switch to Claude in Settings
   - Should resolve the vault key

## Examples

### Switch Model via Code

```javascript
import { setCurrentModel, getCurrentModel } from './model-swap.js';

// Switch to Claude
setCurrentModel('claude');
console.log(getCurrentModel()); // → 'claude'
```

### Check If Key Is Available

```javascript
import { hasModelKey } from './model-swap.js';

if (hasModelKey('claude')) {
  // Use Claude
} else {
  console.warn('Claude API key not configured');
}
```

### Get Current Model with Key

```javascript
import { getCurrentModelWithKey } from './model-swap.js';

const config = getCurrentModelWithKey();
if (config) {
  const { model, key } = config;
  // Make API call with key to the appropriate endpoint
}
```

## Troubleshooting

### "No API key found for claude"

**Check:**
1. Is ANTHROPIC_API_KEY set in `.env`?
2. Is there a "Claude" entry in your Password Manager vault?
3. Is the vault key encrypted? (If yes, ensure the sheet is unlocked in Waymark)

### Model won't switch

**Check:**
1. Ensure the new model has a valid API key configured
2. Check browser console for error messages
3. Try refreshing the page

### Vault key not being detected

**Check:**
1. Is the Password Manager sheet open in Waymark?
2. Does the entry name match? ("claude", "anthropic", "gemini", "google")
3. Is the password field filled in?

## Future Work

- [ ] Support for additional models (OpenAI, Ollama, etc.)
- [ ] Model fallback strategy (if Claude fails, try Gemini)
- [ ] Per-sheet model override
- [ ] Usage statistics per model
- [ ] Rate limiting by model/API key
