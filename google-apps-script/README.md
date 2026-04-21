# Google Apps Script — Waymark Architecture & Patterns

> **Purpose:** Establish standard conventions for all GAS scripts that automate, extend, or integrate with Waymark-managed Google Sheets.

---

## Overview

Waymark is a browser-based reader/writer for Google Sheets. Google Apps Script (GAS) is the complementary server-side layer that runs *inside* Google Workspace. GAS scripts are used for:

- **Triggers** — React to sheet edits, open events, or scheduled times.
- **Custom menus** — Add a "Waymark" menu to a spreadsheet UI.
- **Automation** — Batch-process rows, send email notifications, export snapshots.
- **Data setup** — Seed template headers, populate example data.

GAS scripts do **not** replace Waymark's frontend. They extend what the browser cannot do alone (e.g., time-based jobs, email delivery, Sheet UI menus).

---

## Project Structure

Every GAS project lives in its own subdirectory under `google-apps-script/`:

```
google-apps-script/
  README.md                    ← this file
  appsscript.json              ← manifest template (copy per project)
  lib/
    waymark-format.js          ← pure helpers: row grouping, column roles
    utils.js                   ← GAS-specific: sheet access, logging, properties
    triggers.js                ← installable trigger registration helpers
  examples/
    notify-on-status-change.js ← trigger: email when a status column changes
    export-snapshot.js         ← automation: write _waymark_logs compatible export
```

When adding a **new** script project, create a subdirectory:

```
google-apps-script/
  my-project/
    appsscript.json            ← copied from lib/../appsscript.json, customized
    Code.js                    ← main entry point (menu, trigger handlers)
    lib/                       ← symlink or copy shared lib files here
```

---

## Script Types

| Type | When to use | Deployment |
|---|---|---|
| **Sheet-bound** | Script lives inside one spreadsheet; can add menus and use simple triggers | Tools → Script editor inside the sheet |
| **Standalone** | Reusable across multiple sheets; supports installable triggers and service accounts | GAS console (script.google.com), deployed via clasp |

For Waymark automation, prefer **standalone** scripts with installable triggers. They survive if the sheet is copied and can be version-controlled properly.

---

## Naming Conventions

| Context | Convention | Examples |
|---|---|---|
| GAS functions | `camelCase` | `onWaymarkEdit`, `exportSnapshot`, `registerTriggers` |
| Script properties | `UPPER_SNAKE_CASE` | `NOTIFY_EMAIL`, `TARGET_SHEET_ID` |
| Sheet names | `Title Case` | `Tasks`, `Budget`, `Recipe Book` |
| Log messages | `[LEVEL timestamp] message` | `[INFO 2026-01-01T00:00:00Z] snapshot created` |
| GAS files | `PascalCase.js` | `Code.js`, `Helpers.js` (clasp pushes as `.gs`) |
| Shared lib files | `kebab-case.js` | `waymark-format.js`, `triggers.js` |

All `lib/` filenames are kebab-case. Entry point files in a project are PascalCase per GAS convention.

---

## Comment Style

Matches the Waymark frontend (AI_LAWS §3.3):

```javascript
/* ============================================================
   filename.js — One-line description
   ============================================================ */

/* ---------- Section Name ---------- */

/**
 * JSDoc for every exported/global function.
 * @param {string} sheetId   the spreadsheet ID
 * @returns {string[][]}     2D array of cell values
 */
function readWaymarkSheet(sheetId) { ... }

// Inline comment for logic notes
```

---

## Waymark Data Format

All scripts **must** read and write sheets in the Waymark row-per-item group format (AI_LAWS §4.7):

- Each list item occupies its own row.
- A new group starts when the **primary identifier column** (e.g. Recipe name, Task title) is **non-empty**.
- Continuation rows leave the primary column blank.

**Example — Recipe Book:**

| Recipe | Servings | Ingredient | Step |
|---|---|---|---|
| Pasta Bolognese | 4 | 400g pasta | Boil pasta |
| | | 500g beef | Brown beef |
| Caesar Salad | 2 | 1 romaine | Chop lettuce |

Use `parseGroups(rows, primaryColIdx)` from `lib/waymark-format.js` to parse this format.

**Never** pack multiple values into one cell with delimiters (semicolons, pipes, commas, newlines).

---

## Column Role Mapping

Match the frontend template system (AI_LAWS §4.3). Use `mapColumnRoles(headers, rolePatterns)` from `lib/waymark-format.js`:

```javascript
// In a trigger or automation function:
const { headers, rows } = readSheetData(sheet);
const cols = mapColumnRoles(headers, {
  name:     /^(name|title|task|recipe)$/,
  status:   /^(status|stage|state|done)$/,
  assignee: /^(assignee|owner|assigned)$/,
  due:      /^(due|deadline|date)$/,
});

// Access a cell value:
const status = cellValue(row, cols.status); // '' if column not found
```

- Patterns are case-insensitive (headers lowercased before matching).
- Returns `-1` for unmatched roles; `cellValue()` returns `''` for index `-1`.
- Order matters: first match wins; already-mapped columns are excluded.

---

## Error Handling

All GAS functions follow this pattern:

```javascript
function myAutomation() {
  try {
    const ss = SpreadsheetApp.openById(requireProperty('TARGET_SHEET_ID'));
    const sheet = requireSheet(ss, 'Tasks');
    const { headers, rows } = readSheetData(sheet);
    // ... do work
    logInfo('automation complete');
  } catch (err) {
    logError('myAutomation', err);
    // Optionally: MailApp.sendEmail(adminEmail, 'GAS Error', err.message);
  }
}
```

- Wrap every top-level trigger/menu handler in `try/catch`.
- Use `logInfo`/`logError` from `lib/utils.js` (writes to Stackdriver/Logger).
- Never surface raw errors to the Sheets UI via `SpreadsheetApp.getUi().alert()` — that blocks execution.

---

## Trigger Patterns

Use helpers from `lib/triggers.js` for installable trigger registration:

```javascript
// In your project's Code.js — run once from the editor to install:
function setupTriggers() {
  const ss = SpreadsheetApp.openById(requireProperty('TARGET_SHEET_ID'));
  registerOnEditTrigger('onWaymarkEdit', ss);
  registerDailyTrigger('dailyExport', 8); // 8 AM in script timezone
}
```

**Simple vs Installable triggers:**

| Type | Runs as | Can send email? | Can write to other files? |
|---|---|---|---|
| Simple (`onEdit`) | anonymous | ✗ | ✗ |
| Installable | authorizing user | ✓ | ✓ |

Always use **installable** triggers for Waymark automations (they require authorization, which is expected for Drive/Sheets work).

---

## Script Properties

Never hardcode spreadsheet IDs, emails, or secrets in script files. Use `PropertiesService`:

```javascript
// Set once (via GAS console or setup function):
PropertiesService.getScriptProperties().setProperties({
  TARGET_SHEET_ID: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms',
  NOTIFY_EMAIL: 'team@example.com',
});

// Read in code via requireProperty():
const sheetId = requireProperty('TARGET_SHEET_ID');
```

---

## Authorization Scopes

Declare only the scopes your script needs. Edit `appsscript.json`:

| Scope | Use when |
|---|---|
| `spreadsheets` | Reading or writing any spreadsheet |
| `drive.file` | Creating or modifying files created by this script only |
| `drive` | Accessing all Drive files (avoid unless necessary) |
| `script.send_mail` | Sending email via `MailApp` |
| `script.external_request` | Calling external URLs via `UrlFetchApp` |

---

## Development Workflow (clasp)

```bash
# Install clasp globally
npm install -g @google/clasp

# Authenticate
clasp login

# Create a new standalone script project
clasp create --type standalone --title "Waymark Automation"

# Push local files to GAS
clasp push

# Pull remote changes (after editing in browser editor)
clasp pull

# Open the GAS editor
clasp open
```

The `.clasp.json` file stores the script ID. Add it to `.gitignore` if the ID is sensitive, or check in a `.clasp.json.example` without real IDs.

---

## Security

1. **Never log sensitive data** — script logs are visible to all script editors.
2. **Minimize scopes** — request only what the script needs.
3. **Use `PropertiesService`** for all secrets (IDs, emails, tokens).
4. **Validate inputs** in `onEdit` triggers before writing back to the sheet.
5. **Avoid `eval()`** and `UrlFetchApp` with user-controlled URLs.
6. **Check cell ranges** before writing — never write outside the data range.

---

## Relationship to the Waymark Frontend

GAS scripts operate on the same sheets that Waymark reads via the Google Sheets REST API. There is **no direct communication** between GAS and the Waymark browser app. Coordination happens through the sheet data itself:

- GAS writes values → Waymark reads them on next load.
- GAS uses the same column role conventions → headers stay compatible.
- GAS respects the row-per-item group format → `parseGroups()` works correctly on both sides.
- GAS writes to `_waymark_logs/` for snapshots → same folder Waymark's `records.js` uses.
