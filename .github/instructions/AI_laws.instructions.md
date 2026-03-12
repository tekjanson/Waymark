# AI Laws — WayMark Codebase Rules

> **Purpose:** Strict pattern enforcement for AI agents working on this codebase.
> Every rule here is derived from the existing implementation. Do NOT deviate.

---

## 1. ABSOLUTE LAWS (violating any of these is a hard reject)

### 1.1 NO BACKEND BUSINESS LOGIC
The server (`server/`) does exactly three things: serve static files, broker OAuth, and inject runtime flags. **All** business logic, data fetching, rendering, and template detection runs in the browser. Never add routes, middleware, controllers, or any processing to `server/index.js`, `server/auth.js`, or `server/config.js`. Never create new server-side files.

### 1.2 VANILLA STACK — NO FRAMEWORKS, NO BUILD STEP
- **No** CSS frameworks (Tailwind, Bootstrap, etc.)
- **No** JS frameworks (React, Vue, Svelte, etc.)
- **No** bundlers, transpilers, or build tools (Webpack, Vite, esbuild, etc.)
- **No** SCSS, LESS, or PostCSS
- **No** TypeScript
- ES Modules loaded directly in the browser via `<script type="module">`
- Raw CSS with custom properties
- Pure DOM manipulation via the `el()` factory

### 1.3 ZERO SERVER STATE
The server stores nothing. No database, no in-memory cache, no session store, no user data. The httpOnly cookie holds only the refresh token. All persistent data lives in Google Drive (via `user-data.js`) or the browser's `localStorage` (via `storage.js`).

### 1.4 ALL GOOGLE API ACCESS GOES THROUGH api-client.js
`public/js/api-client.js` is the **sole gateway** to Google APIs. No module may import `drive.js` or `sheets.js` directly (except `api-client.js` itself). This abstraction enables the local-only mock mode that the entire test suite depends on.

### 1.5 TEMPLATES ONLY IMPORT FROM shared.js
Template files (`public/js/templates/*.js`) import exclusively from `./shared.js`. They never import from `../ui.js`, `../api-client.js`, or any other module. `shared.js` re-exports `el` from `ui.js` for convenience — templates use that re-export.

When a template uses the **folder layout** (`templates/{key}/`), sub-modules import from `../shared.js` and may also import from **sibling files** within the same `{key}/` directory. No template file ever imports from `../../ui.js`, `../../api-client.js`, or any other non-template module.

---

## 2. FILE STRUCTURE LAWS

### 2.1 Project Layout (canonical — do not restructure)
```
server/                        # Express: static files + OAuth only
  index.js                     # Entry point (serves public/, injects flags)
  auth.js                      # /auth/login, /auth/callback, /auth/refresh, /auth/logout
  config.js                    # Environment variable loader
public/                        # All frontend code (served as static)
  index.html                   # Single-page app shell (one file, one entry point)
  css/
    style.css                  # @import aggregator ONLY — no rules here
    base.css                   # CSS custom properties, reset, layout, components
    templates/                 # One CSS file per template
      {key}.css                # e.g. budget.css, kanban.css, recipe.css
  js/
    app.js                     # Entry point, routing, module orchestration
    api-client.js              # Google API abstraction + mock mode (THE critical module)
    auth.js                    # Client-side token management
    checklist.js               # Sheet viewer / template bridge
    drive.js                   # Google Drive REST wrapper
    sheets.js                  # Google Sheets REST wrapper
    explorer.js                # Drive sidebar tree
    search.js                  # Keyword search
    records.js                 # Snapshot/log creation
    storage.js                 # localStorage helpers
    ui.js                      # DOM helpers (el, showToast, timeAgo, etc.)
    user-data.js               # Drive-backed persistent user data
    import.js                  # Sheet import system
    example-data.js            # Static example sheet definitions
    examples.js                # Example generation UI
    gemini.js                  # DEPRECATED stubs (kept for import compat)
    recipe-scraper.js          # Browser-only URL scraper
    tutorial.js                # First-run tutorial
    templates/
      index.js                 # Barrel: side-effect imports all templates, exports detectTemplate()
      shared.js                # Registry, cell helpers, editableCell, el re-export, generic helpers
      {key}.js                 # One self-registering module per template
      {key}/                   # Folder layout for complex templates (>~300 LOC)
        index.js               # Barrel: definition, registerTemplate, export default
        helpers.js             # Constants & pure functions
        cards.js               # Card/item DOM builders
        modal.js               # Modal / overlay UI
tests/
  playwright.config.js
  helpers/
    mock-server.js             # Fixture loading, route overrides, error injection
    test-utils.js              # setupApp(), navigation helpers, assertion helpers
  fixtures/
    folders.json               # Mock Drive folder tree
    users.json                 # Mock user profiles
    sheets/
      {key}-{descriptor}.json  # One fixture per template type
  e2e/
    {feature}.spec.js          # One spec file per feature/template
template-registry.json         # Machine-readable registry of all templates
generated/                     # Output from generate-template.js script
scripts/
  generate-template.js         # Template scaffolding agent
  generate-examples.js         # Real Drive example creator
```

### 2.2 Template Folder Layout
For complex templates exceeding ~300 lines, use the **folder layout**: `templates/{key}/index.js` as the barrel module. The barrel import in `templates/index.js` changes from `import './{key}.js'` to `import './{key}/index.js'`. Sub-modules import from `../shared.js` and may import siblings within the same folder. CSS stays at `css/templates/{key}.css` (unchanged). See `kanban/` for the reference implementation.

### 2.3 When Adding a New Template
Every new template requires ALL of these artifacts:

| Artifact | Path | Notes |
|---|---|---|
| Template JS | `public/js/templates/{key}.js` or `{key}/index.js` | Self-registers via `registerTemplate()` |
| Template CSS | `public/css/templates/{key}.css` | All classes prefixed `.{key}-` |
| CSS import | `public/css/style.css` | Add `@import 'templates/{key}.css';` |
| Template import | `public/js/templates/index.js` | Add `import './{key}.js';` (or `'./{key}/index.js'` for folder layout) |
| Fixture JSON | `tests/fixtures/sheets/{key}-{desc}.json` | Sheet data for tests |
| Fixture ID mapping | `public/js/api-client.js` | Add `'sheet-NNN': '{key}-{desc}'` to `mapping` |
| Folder entry | `tests/fixtures/folders.json` | Add sheet ref under Examples folder |
| E2E test | `tests/e2e/{key}.spec.js` | At minimum: detection, rendering, interaction |
| Registry entry | `template-registry.json` | Full metadata + bump `nextSheetId` and `totalTemplates` |
| Example data | `public/js/example-data.js` | Add example sheet definitions |
| Import roles | `public/js/import.js` | Add `ROLE_LABELS` entries for the template |

Missing any artifact breaks either the app, tests, or the generation pipeline.

---

## 3. JAVASCRIPT PATTERNS

### 3.1 Module & Export Style
- **Named exports everywhere.** Every public function is a named export.
- **Template files also `export default`** the definition object (in addition to self-registering).
- `api-client.js` uses `export const api = { auth, drive, sheets }` — single named export containing the full API surface.
- No `module.exports` in frontend code. No CommonJS. (Server code uses `require()`/`module.exports`.)

### 3.2 Naming Conventions
| Context | Convention | Examples |
|---|---|---|
| Functions/variables | `camelCase` | `loadSheet`, `handleRoute`, `currentSheetId` |
| Constants | `UPPER_SNAKE_CASE` | `TEMPLATES`, `BASE`, `PREFIX`, `MAX_RECENT_SHEETS` |
| Template keys | `lowercase` | `checklist`, `kanban`, `testcases`, `crm` |
| CSS classes | `{key}-{element}` | `.budget-summary`, `.kanban-lane`, `.recipe-card` |
| DOM IDs | `kebab-case` | `#checklist-view`, `#search-input`, `#top-bar` |
| Fixture files | `{key}-{descriptor}.json` | `budget-personal.json`, `kanban-project.json` |
| Sheet IDs | `sheet-NNN` | `sheet-001`, `sheet-027` (zero-padded, sequential) |
| Spec files | `{feature}.spec.js` | `budget.spec.js`, `inline-edit.spec.js` |

### 3.3 Comment Style
```javascript
/* ============================================================
   filename.js — One-line description
   ============================================================ */

/* ---------- Section Name ---------- */

/** JSDoc for public functions
 * @param {string} name — description
 * @returns {Object}
 */

// Inline comments for logic notes
```
- Block header at top of every file.
- Section dividers with `/* ---------- Name ---------- */`.
- JSDoc `@param`/`@returns` on all exported functions.
- Inline `//` for brief logic notes.

### 3.4 DOM Construction
All DOM is built via the `el()` factory from `ui.js` (or `shared.js` for templates):
```javascript
el('div', { className: 'my-class', on: { click: handler } }, [
  el('span', {}, ['text content']),
  el('input', { type: 'text', placeholder: 'Enter...' }),
]);
```
**Rules:**
- **Never** use `innerHTML` with dynamic/user content (XSS risk).
- `innerHTML = ''` is acceptable only for clearing a container.
- Never use template literals to build HTML strings.
- Use `el()` for all element creation.

### 3.5 Async Patterns
- `async/await` throughout. No raw `.then()` chains.
- `Promise.all()` for parallel independent operations.
- Top-level `await` is used in `api-client.js` (ES module).
- Error handling: `try/catch` at the call site, surface errors via `showToast('message', 'error')`.

### 3.6 State Management
- **Module-scoped `let` variables** — no classes, no global state objects, no stores.
- Singleton init patterns with promise guards (e.g., `_initPromise` in `user-data.js`).
- `window.__WAYMARK_LOCAL` — runtime mode flag (injected by server).
- `window.__WAYMARK_RECORDS` — mock record store (test assertions only).
- `window.__WAYMARK_MOCK_ERROR` — error simulation flag (tests only).

### 3.7 Token Pattern (drive.js / sheets.js)
All Google API wrapper functions take `token` as the **first parameter**:
```javascript
export async function getSpreadsheet(token, spreadsheetId) { ... }
export async function listRootFolders(token) { ... }
```
They hold no internal auth state. `api-client.js` injects the token.

### 3.8 Error Handling in API Wrappers
```javascript
if (!res.ok) throw new Error(`Sheets API ${res.status}`);
```
Terse status-code errors. Let the caller (`checklist.js`, `explorer.js`, etc.) catch and display via `showToast()`.

---

## 4. TEMPLATE SYSTEM LAWS

### 4.1 Template Definition Shape
Every template file exports an object with this exact shape:
```javascript
const definition = {
  name: 'Template Name',         // Human-readable
  icon: '📊',                    // Single emoji
  color: '#2563eb',              // Hex color for badge
  priority: 20,                  // Higher = more specific (range: 10–25)
  detect(lower) { ... },         // (string[]) → boolean — lowercased headers
  columns(lower) { ... },        // (string[]) → { role: index, ... }
  render(container, rows, cols, template) { ... },
};
registerTemplate('key', definition);
export default definition;
```

### 4.1a shared.js Generic Helpers
`shared.js` exports these reusable helpers in addition to cell/edit utilities:

| Export | Signature | Purpose |
|---|---|---|
| `delegateEvent` | `(container, eventType, selector, handler)` | Attach a single listener that fires when the target matches `selector` (event delegation) |
| `lazySection` | `(parent, selector, buildFn)` | Build a DOM section on first use; reveal it on subsequent calls (lazy rendering) |
| `parseGroups` | `(rows, primaryColIdx, opts?)` | Group contiguous rows per §4.7; supports `opts.initGroup` and `opts.classifyChild` callbacks |

Templates should prefer these over ad-hoc implementations for consistency and to reduce per-element listener counts.

### 4.2 detect() Rules
- Receives `lower`: array of lowercased, trimmed header strings.
- Returns `boolean`.
- Uses `regex.test()` against header strings — never plain string equality.
- Must be specific enough to avoid false positives against other templates.
- Higher `priority` wins when multiple templates match.

### 4.3 columns() Rules
- Receives same `lower` array.
- Returns a `cols` object mapping role names to column indices.
- Uses `lower.findIndex(h => /pattern/.test(h))`.
- Must include exclusion guards (`&& i !== cols.previousRole`) to prevent double-mapping.
- Return `-1` for unmatched roles.

### 4.4 render() Rules
- Receives: `container` (DOM element), `rows` (2D string array, header excluded), `cols` (from `columns()`), `template` (self-reference, optional).
- Clears container: `container.innerHTML = ''`.
- Builds all DOM via `el()` and `editableCell()` from `shared.js`.
- Appends directly to `container`.
- For interactive elements (checkboxes, status cycling), emit changes via `emitEdit(rowIndex, colIndex, newValue)`.
- `rowIndex` is 1-based (offset from header row in the sheet).

### 4.5 Interaction Types
| Type | Behavior | Example |
|---|---|---|
| `toggle` | Click flips between two states | Checklist (done/empty) |
| `status-cycle` | Click cycles through ordered states | Test Cases, Kanban |
| `inline-edit` | Click opens text input on the cell | Budget, Contacts, Tracker |
| `toggle-grid` | Click toggles grid cells | Habit Tracker, Roster |
| `none` | Read-only display | Poll, Changelog |

### 4.6 Priority Ranges
| Range | Use |
|---|---|
| 10 | Generic/fallback templates (checklist) |
| 15–20 | Standard templates |
| 21–25 | Highly specific templates (testcases, recipe) |

Checklist is the default fallback when no template matches. Its priority of 10 is intentionally the lowest.

### 4.7 Human-Friendly Sheet Data Format
All template data stored in Google Sheets MUST be easy for a human to read and edit directly in the spreadsheet. **Never** pack multiple values into a single cell using delimiters (semicolons, pipes, commas, newlines, etc.).

**Rule:** If a data field is a list (ingredients, steps, tasks, items, etc.), each list item MUST occupy its own row in the sheet. Group membership is determined by leaving the primary identifier column (e.g. recipe name) blank on continuation rows — a new group starts whenever that column is non-empty.

**Example — Recipe Book (row-per-item):**
```
| Recipe              | Servings | Prep  | Cook  | Category | Difficulty | Ingredient       | Step                        |
|---------------------|----------|-------|-------|----------|------------|------------------|-----------------------------||
| Spaghetti Bolognese | 4        | 15 min| 45 min| Italian  | Easy       | 400g spaghetti   | Cook spaghetti              |
|                     |          |       |       |          |            | 500g ground beef | Brown beef                  |
|                     |          |       |       |          |            | 1 onion, diced   | Add onion and garlic 3 min  |
| Caesar Salad        | 2        | 10 min| 0 min | American | Easy       | 1 romaine lettuce| Chop lettuce                |
|                     |          |       |       |          |            | croutons         | Toss with dressing          |
```

**Why:** Users edit these sheets in Google Sheets. Semicolon-packed cells are hard to scan, select, reorder, insert into, or delete from. One item per row is immediately scannable and uses standard spreadsheet editing.

**When designing templates:**
- Use singular column headers for per-row items (`Ingredient` not `Ingredients`, `Step` not `Instructions`).
- Group metadata (name, servings, category, etc.) goes on the first row only; continuation rows leave those cells blank.
- The template's `render()` function must group contiguous rows by detecting when the primary identifier column is non-empty (new group) vs empty (continuation).
- The `columns()` role names must match the singular form (`ingredient`, `step`).
- `detect()` must accept both singular and plural header forms for backwards compatibility.
- Example data in `example-data.js` must follow the row-per-item layout.
- Fixture data in `tests/fixtures/sheets/` must follow the row-per-item layout.
- The recipe scraper (and any future importers) must expand lists into individual rows, not join them with delimiters.

---

## 5. CSS LAWS

### 5.1 Architecture
- `style.css` is a **pure aggregator** — only `@import` statements, no rules.
- `base.css` holds all custom properties, reset, layout, and shared component styles.
- Each template has its own file: `templates/{key}.css`.
- **Exception:** `checklist` styles live in `base.css` because `#checklist-view` is the universal detail view for all templates (§6.2), not just the checklist template.

### 5.2 Custom Properties (mandatory)
All colors and design tokens come from `:root` variables in `base.css`:
```css
:root {
  --color-primary: #2563eb;
  --color-bg: #f1f5f9;
  --color-surface: #ffffff;
  --color-text: #1e293b;
  --color-border: #e2e8f0;
  --color-success: #16a34a;
  --color-error: #dc2626;
  --radius: 8px;
  --radius-sm: 4px;
  --shadow: 0 1px 3px rgba(0,0,0,0.08);
  --transition: 200ms ease;
}
```
**Rules:**
- Use `var(--color-*)`, `var(--radius)`, `var(--transition)` — never hardcoded colors in `base.css`.
- Template CSS files MAY hardcode template-specific accent colors for unique visual elements (e.g., status badges), but MUST use design tokens for backgrounds, borders, and text.

### 5.3 Class Naming
- **Flat, descriptive names.** Pattern: `.{key}-{element}` or `.{key}-{modifier}`.
- **NO BEM** (`__` or `--` suffixes).
- **NO utility-first classes.**
- State via modifier classes chained directly: `.checklist-row.completed`, `.kanban-lane-backlog`.
- Utility class: `.hidden` (display: none !important) — the ONLY use of `!important`.

### 5.4 Selectors
- Max 2 levels of nesting.
- Prefer class selectors over element selectors.
- ID selectors only for unique page-level elements (`#sidebar`, `#content`, `#top-bar`).

### 5.5 Responsive
- Two breakpoints: `768px` (tablet) and `480px` (phone).
- Base layout: flexbox and grid.
- Template-specific media queries go at the bottom of the template's CSS file.

### 5.6 Template CSS File Structure
```css
/* Template Name Template */

.{key}-container { ... }
.{key}-card { ... }
.{key}-header { ... }

/* Responsive */
@media (max-width: 768px) { ... }
```

---

## 6. HTML LAWS

### 6.1 Single Page App
One HTML file: `public/index.html`. One JS entry point: `<script type="module" src="js/app.js">`.

### 6.2 View System
```html
<section id="{name}-view" class="view hidden" data-view="{name}">
```
- Views are toggled via the `hidden` class.
- `showView(name)` in `ui.js` flips visibility based on `data-view`.
- `#checklist-view` is the **universal detail view** for ALL template types.

### 6.3 Hash Routing
| Route | View | Handler |
|---|---|---|
| `#/` | Home | `renderPinnedFolders()` |
| `#/sheet/{id}` | Checklist | `checklist.show(id)` |
| `#/folder/{id}/{name}` | Folder | `showFolderContents()` |
| `#/search?q={query}` | Search | `search.searchFromHash()` |

### 6.4 Modal Pattern
```html
<div id="{name}-modal" class="modal-overlay hidden">
  <div class="modal">
    <div class="modal-header">...</div>
    <div class="modal-body">...</div>
    <div class="modal-footer">...</div>
  </div>
</div>
```
Close on: X button click, cancel button click, overlay click.

### 6.5 No Web Components, No Shadow DOM
All rendering is flat DOM manipulation via `el()`. No custom elements.

---

## 7. TESTING LAWS

### 7.1 Framework
Playwright E2E tests. All tests run against `WAYMARK_LOCAL=true` mock mode. No real Google accounts in tests.

### 7.2 Test File Structure
```javascript
const { test, expect } = require('@playwright/test');
const { setupApp, navigateToSheet, ... } = require('../helpers/test-utils');

test('descriptive name', async ({ page }) => {
  await setupApp(page);
  await navigateToSheet(page, 'sheet-NNN');
  // assertions
});
```
**Rules:**
- **Flat `test()` calls** — NO `describe()` blocks.
- **NO `beforeAll`/`beforeEach`/`afterAll` hooks.**
- **NO shared state between tests.** Every test is fully isolated.
- Every test calls `setupApp(page)` first.
- **CSS selectors only** for element selection — no XPath, no `text=` selectors.
- No `data-testid` attributes — use semantic CSS classes and element IDs.
- No `page.waitForTimeout()` — use `waitForSelector()` with explicit timeout.

### 7.3 Test Setup Pattern
`setupApp(page, opts)` handles:
1. Mock auth cookie injection
2. localStorage seeding (pinned folders, tutorial=complete, auto-refresh, sidebar)
3. Navigation to `/` or specific hash
4. Wait for `#app-screen:not(.hidden)`

Default: `tutorialCompleted: true` (suppresses tutorial overlay in tests).

### 7.4 Navigation Helpers
```javascript
await navigateToSheet(page, 'sheet-016');   // → #/sheet/sheet-016
await navigateToHome(page);                 // → #/
```

### 7.5 Assertion Patterns
```javascript
// Visibility
await expect(page.locator('.element')).toBeVisible();
await expect(page.locator('.element')).toBeHidden();

// Text content
await expect(page.locator('.element')).toContainText('expected');

// Count
await expect(page.locator('.items')).toHaveCount(5);

// Class membership
await expect(page.locator('.row')).toHaveClass(/completed/);

// Record verification (inline edits)
const records = await getCreatedRecords(page);
expect(records.some(r => r.type === 'cell-update' && r.value === 'new value')).toBe(true);
```

### 7.6 Inline Edit Test Pattern
```javascript
async function startInlineEdit(page, selector) {
  await page.click(selector);
  return page.waitForSelector(`${selector} input.editable-cell-input`);
}
```
Test three modes: Enter (commit), Escape (cancel), blur (commit).

### 7.7 Fixture Data Shape
```json
{
  "id": "sheet-NNN",
  "title": "Human-Readable Title",
  "sheetTitle": "Sheet1",
  "values": [
    ["Header1", "Header2", "Header3"],
    ["row1col1", "row1col2", "row1col3"]
  ]
}
```
- `values` is a 2D string array. Row 0 = headers, subsequent rows = data.
- All cell values are strings — even numbers (`"5000"`), booleans (`"FALSE"`), dates (`"2026-02-27"`).

### 7.8 Mock Error Testing
```javascript
await injectError(page, 'drive');   // sets window.__WAYMARK_MOCK_ERROR = 'drive'
await injectError(page, 'sheets');  // sets window.__WAYMARK_MOCK_ERROR = 'sheets'
```

### 7.9 Running Tests
The Playwright config lives at `tests/playwright.config.js`, **not** at the project root. A root-level `playwright.config.js` re-exports the real config with a corrected `testDir`. Both methods work:
```bash
npm test                         # ✅ recommended — uses --config tests/playwright.config.js
npx playwright test              # ✅ works — uses root playwright.config.js redirect
```
**Common failure mode:** If all tests fail with `Protocol error (Page.navigate): Cannot navigate to invalid URL` at `page.goto('/')`, it means `baseURL` is `undefined` — Playwright cannot find the config. Causes:
- Running from a subdirectory where neither config file is found.
- A deleted or corrupted root `playwright.config.js`.
- Running an older Playwright version that doesn't auto-detect the config.

**Fix:** Always run tests from the project root via `npm test`. If the root `playwright.config.js` is missing, recreate it:
```javascript
const config = require('./tests/playwright.config.js');
const path = require('path');
module.exports = { ...config, testDir: path.resolve(__dirname, 'tests/e2e') };
```

---

## 8. api-client.js LAWS

### 8.1 Dual-Mode Architecture
`api-client.js` checks `window.__WAYMARK_LOCAL`:
- **Production** → imports `drive.js` and `sheets.js` dynamically, calls real Google APIs with bearer tokens.
- **Local/Test** → fetches fixture JSON from `/__fixtures/`, stores records in `window.__WAYMARK_RECORDS`.

### 8.2 Mock Fixture ID Mapping
Every test fixture sheet must be registered in the `mapping` object inside `api-client.js`:
```javascript
const mapping = {
  'sheet-001': 'groceries',
  'sheet-016': 'budget-personal',
  // ...
};
```
Key = sheet ID, value = fixture filename without `.json`.

### 8.3 Record Tracking for Tests
In local mode, all created records are pushed to `window.__WAYMARK_RECORDS`:
```javascript
window.__WAYMARK_RECORDS.push({ type, spreadsheetId, sheetId, rowIndex, colIndex, value });
```
Tests assert against this array via `getCreatedRecords(page)`.

---

## 9. DATA & PERSISTENCE LAWS

### 9.1 User Data (user-data.js)
- Persistent data stored as `Waymark/.waymark-data.json` in user's Google Drive.
- Schema versioned (`version: 2`). New fields added via `defaultUserData()` spread merge.
- **Reads are synchronous** (from in-memory cache). **Writes are async** (flush to Drive + localStorage fallback).
- Capacity limits enforced: `MAX_RECENT_SHEETS = 20`, `MAX_SEARCH_HISTORY = 30`, `MAX_IMPORT_HISTORY = 50`. Truncate arrays, don't error.

### 9.2 localStorage (storage.js)
- All keys prefixed `waymark_`.
- Getter/setter pairs with JSON parse/stringify and try/catch.
- `clearAll()` removes only `waymark_*` keys.

### 9.3 Folder Structure in Drive
```
Waymark/
  .waymark-data.json    # User preferences, pins, history
  Examples/             # Generated example sheets
  Imports/              # Imported sheets (sub-folders per template)
_waymark_logs/          # Completion snapshots (per pinned folder)
```

---

## 10. TEMPLATE REGISTRY (template-registry.json)

### 10.1 Purpose
Machine-readable metadata for all templates. Used by `generate-template.js` and as a source of truth for template counts, IDs, and capabilities.

### 10.2 Entry Shape
```json
{
  "key": "budget",
  "name": "Budget",
  "icon": "💰",
  "color": "#059669",
  "priority": 21,
  "category": "Finance",
  "detectSignals": ["income", "expense", "budget", "amount"],
  "columnRoles": ["text", "category", "amount", "date", "notes"],
  "interactive": true,
  "interactionType": "inline-edit",
  "interactionStates": [],
  "exampleCount": 2,
  "fixtureIds": ["sheet-016"],
  "fixtureFiles": ["budget-personal"]
}
```

### 10.3 When Adding a Template
You MUST also update:
- `nextSheetId` (increment to next available `sheet-NNN`)
- `totalTemplates` (increment by 1)
- Add the new template entry to the `templates` array

---

## 11. IMPORT SYSTEM LAWS

### 11.1 Pure Code Analysis
All import detection is code-based (no AI). `scoreAllTemplates(headers)` ranks templates by:
- 40% `detect()` match
- 40% column fill ratio
- 20% priority bonus

### 11.2 ROLE_LABELS
Every template's column roles must have human-readable labels in the `ROLE_LABELS` constant in `import.js`:
```javascript
'budget.text': 'Description / Item name',
'budget.category': 'Category grouping',
```

### 11.3 Import Folder Structure
Imported sheets go to `Waymark/Imports/{TemplateName}/` — one sub-folder per template type.

---

## 12. SECURITY LAWS

- Refresh token: httpOnly, Secure, SameSite=Strict cookie. Path scoped to `/auth`.
- Access token: in-memory JS variable only. Never in localStorage, never in cookies.
- `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`.
- CSP in production: `default-src 'self'`, connect only to `googleapis.com`.
- No `innerHTML` with user/dynamic content. Use `el()` for all DOM construction.
- Never log or expose tokens in console output.

---

## 13. ANTI-PATTERNS (things you must NEVER do)

| Anti-Pattern | Why |
|---|---|
| Add a database | Zero server state is a core architectural decision |
| Use `innerHTML` with dynamic content | XSS vulnerability |
| Import `drive.js`/`sheets.js` directly | Breaks mock mode and test isolation |
| Add `describe()` blocks in tests | Project uses flat `test()` calls only |
| Add `beforeEach`/`afterAll` hooks | Every test is independently isolated |
| Use `data-testid` attributes | Selectors use semantic CSS classes |
| Use BEM naming in CSS | Project uses flat `{key}-{element}` pattern |
| Add SCSS/LESS/PostCSS | Raw CSS only |
| Use `.then()` chains | Use `async/await` |
| Add global state objects or classes | Module-scoped `let` variables only |
| Hardcode colors in base.css | Use `var(--color-*)` tokens |
| Use `!important` | Only `.hidden` uses it |
| Create new server routes for business logic | Frontend-only business logic |
| Delete or update existing user sheets | CR-only: Create + Read |
| Use `page.waitForTimeout()` in tests | Use `waitForSelector()` with explicit timeout |
| Skip `registerTemplate()` call | Templates MUST self-register |
| Skip `template-registry.json` update | Registry is source of truth for tooling |
| Use AI/Gemini for analysis | AI features are removed; all analysis is code-based |
| Pack multiple values into one cell with delimiters | Sheet data must be human-friendly: one item per row (§4.7) |
| Run `npx playwright test` from a subdirectory | Config lives at `tests/playwright.config.js`; run from project root via `npm test` (§7.9) |
| Put notes/progress in the task row's Note column | Notes are sub-rows inserted BELOW the task row (§15.2) |

---

## 15. WAYMARK WORKBOARD — KANBAN SHEET INTERACTION

> **Context:** The Waymark development workboard is itself a kanban Google Sheet rendered by Waymark. When AI agents update this sheet (or any kanban sheet), they **must** follow the row-per-item format (§4.7) as it applies to the kanban template specifically.

### 15.1 Kanban Column Layout
The workboard uses these columns (headers in row 1):

| Column | Index | Purpose |
|---|---|---|
| Task | A | Primary identifier — non-empty = new task. Empty = sub-row. |
| Description | B | Task description (task rows) or sub-task text (sub-rows) |
| Stage | C | `To Do`, `In Progress`, `QA`, `Done`, `Backlog`, `Archived` |
| Project | D | Project grouping label |
| Assignee | E | Person responsible (task rows) or note author (note sub-rows) |
| Priority | F | `P0`, `P1`, `P2`, `P3` |
| Due | G | ISO date `YYYY-MM-DD` |
| Label | H | `bug`, `feature`, `design`, `infra`, etc. |
| Note | I | Note text — **ONLY on sub-rows, NEVER on task rows** |

### 15.2 Task Row vs Sub-Row Rules

**Task row** (column A is non-empty):
```
| Task Name | Description of the task | Stage | Project | Assignee | P2 | 2026-03-11 | feature | |
```
- Column A (Task): the task title — **must be non-empty**
- Column I (Note): **must be EMPTY** on task rows
- All metadata (stage, project, priority, etc.) lives here

**Note sub-row** (column A is empty):
```
| | | | | Author Name | | 2026-03-11 | | The note text goes here |
```
- Column A (Task): **EMPTY** — this is what makes it a sub-row
- Columns B, C, D: **EMPTY**
- Column E (Assignee): the author of the note
- Column G (Due): date the note was written
- Column I (Note): the actual note content
- All other columns: **EMPTY**

**Sub-task sub-row** (column A is empty, column B has text, column I is empty):
```
| | Sub-task description text | Stage | | Assignee | | 2026-03-11 | | |
```
- Column A (Task): **EMPTY**
- Column B (Description): the sub-task text
- Column C (Stage): sub-task status
- Column I (Note): **EMPTY** (this distinguishes it from a note sub-row)

### 15.3 How Waymark Renders This
The kanban template uses `parseGroups()` (§4.1a) to group rows:
1. A row with a **non-empty Task column** starts a new group (card).
2. Subsequent rows with an **empty Task column** are children of that group.
3. Children are classified by `classifyChild()`:
   - If column I (Note) has content → it's a **note** (shown in notes section)
   - If column I is empty → it's a **sub-task** (shown in sub-tasks section)

**Critical:** If you put note text in column I of a **task row** (where column A is non-empty), Waymark ignores it — it is not rendered as a note. The note will be invisible in the UI.

### 15.4 Updating the Workboard — Correct Procedure

**To update a task's stage:**
- Update column C (Stage) of the **task row** directly.

**To add a progress note:**
- **INSERT a new row** below the task row (or below existing sub-rows).
- The new row must have: column A empty, column E = author, column G = date, column I = note text.
- **Do NOT** write into the task row's Note column.

**To update an existing note:**
- Update column I of the **note sub-row** directly.

**Example — marking a task Done and adding a completion note:**
If the task is on row 180:
1. Update `Sheet1!C180` to `QA` (or `Done` if the human has reviewed and approved)
2. Count existing sub-rows below row 180 (rows 181, 182… where column A is empty)
3. **Insert** a new row after the last sub-row with: `["", "", "", "", "AI", "", "2026-03-11", "", "Completed: summary of what was done"]`

### 15.5 Common Mistakes to Avoid

| Mistake | Why It Breaks |
|---|---|
| Writing note text into column I of a task row | Waymark's `classifyChild()` only checks sub-rows; task-row notes are invisible |
| Inserting a note row without clearing column A | Waymark treats it as a new task instead of a sub-row |
| Putting sub-task text in column I | Makes it render as a note instead of a sub-task |
| Updating column C on a note sub-row | Notes don't have stages; this data is ignored |
| Forgetting to leave columns B-D empty on note sub-rows | May confuse the group parser |

---

## 16. CHECKLIST — Before Submitting Any Change

- [ ] No new server-side business logic added
- [ ] All DOM built via `el()` — no unsafe `innerHTML`
- [ ] All Google API calls go through `api-client.js`
- [ ] Template files only import from `shared.js`
- [ ] New template has ALL required artifacts (§2.3)
- [ ] CSS classes follow `.{key}-{element}` naming
- [ ] Colors use `var(--color-*)` tokens (base.css) or template-scoped accents
- [ ] Tests use `setupApp(page)` + no `describe()` blocks + CSS selectors only
- [ ] Fixture added with correct `{ id, title, sheetTitle, values }` shape
- [ ] `api-client.js` mapping updated for new fixture
- [ ] `template-registry.json` updated with new entry
- [ ] `import.js` ROLE_LABELS updated for new template roles
- [ ] `example-data.js` updated with example sheet definitions
- [ ] Sheet data uses row-per-item format — no delimiter-packed cells (§4.7)
- [ ] No build step required — changes work with raw ES module loading
- [ ] `docker compose build` succeeds
- [ ] `npm test` passes (all Playwright E2E tests green) — run from project root (§7.9)
