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

## Notification Architecture — Frontend-Managed Rules

The most important design decision: **notification rules live in a Waymark-managed sheet, not in script properties**. This lets you add, edit, or disable rules from the Waymark UI without ever touching GAS or redeploying anything.

### The `_waymark_notify_sheet` Column

Every watched spreadsheet gets a hidden column appended as its **last column**, named `_waymark_notify_sheet`. Its value (in the first data row) is the spreadsheet ID of the notification rules sheet for that spreadsheet. The Waymark frontend writes this value when the user links a notification config; the GAS trigger reads it on every edit.

```
| Task | Status | Owner | Due | _waymark_notify_sheet    |
|------|--------|-------|-----|--------------------------|
| Plan | Done   | Ana   | Mon | 1BxiMVs0XRA5nFMdKvBdt…   |  ← config sheet ID here
| Buy  |        |       |     |                          |
```

- This column is **never displayed by Waymark** — the frontend skips columns whose header starts with `_waymark_`.
- It contains no user data. It is purely a pointer from the watched sheet to its notification config.
- `lib/notification-config.js` provides `readNotifyConfigSheetId(sheet)` to read this value.

### The Notification Config Sheet

The config sheet is a standard Waymark sheet (the Notification template). Each row defines one rule:

| Rule Name       | Watch Column | Trigger    | Trigger Value | Recipients              | Enabled |
|-----------------|--------------|------------|---------------|-------------------------|---------|
| Status done     | Status       | equals     | Done          | team@example.com        | yes     |
| Status changed  | Status       | any        |               | lead@example.com        | yes     |
| Urgent added    | Priority     | changes-to | Urgent        | boss@example.com        | yes     |

**Trigger values:**
- `any` — fire on any change to Watch Column.
- `equals` — fire when the new value matches Trigger Value (case-insensitive).
- `changes-to` — fire when the value changes *to* Trigger Value.

Rules are read live on every edit — no GAS redeploy required when rules change.

### End-to-End Flow

```
User edits a cell in the watched sheet
        │
        ▼
GAS onEdit trigger fires
        │
        ▼
Read _waymark_notify_sheet column → get config sheet ID
        │
        ├─ no ID found → exit silently (notifications not configured)
        │
        ▼
Open config sheet → parse notification rules (lib/notification-config.js)
        │
        ▼
Match edited column + new value against each rule
        │
        ├─ no match → exit silently
        │
        ▼
Send email to rule.recipients via MailApp
```

See `examples/multi-sheet-notifier.js` for the full implementation.

---

## Deployment — How Do You Install These?

**Short answer:** GAS scripts cannot be pushed from the Waymark frontend with the current OAuth scopes. There are three deployment paths, ordered by effort. The Waymark frontend can assist with configuration setup (path 2) but the GAS script itself always requires a one-time manual install.

### Path 1 — Manual (no new tools)

1. Open [script.google.com](https://script.google.com) and create a new standalone project.
2. Paste the files from `google-apps-script/lib/` and the example you want.
3. Edit `appsscript.json` with the required scopes.
4. Run `setProperties()` (or set properties via Project Settings → Script Properties).
5. Run `setupTriggers()` once to install the installable trigger.
6. Authorize when prompted.

The script then watches the sheet indefinitely. No re-deployment needed when notification rules change (they live in the config sheet).

### Path 2 — Waymark-Assisted Setup (recommended, no new scopes)

The Waymark frontend can handle **everything except the GAS script install itself**:

1. **User clicks "Set up notifications" in Waymark UI.**
2. Waymark creates the notification config sheet (uses existing Sheets API scope).
3. Waymark appends `_waymark_notify_sheet` to the watched sheet and writes the config sheet ID (uses existing Sheets API scope).
4. Waymark shows a pre-filled setup bundle:
   - The GAS files (pre-configured with the master config sheet ID already filled in)
   - A step-by-step install guide with one-click "Open GAS Editor" link
5. **User pastes the bundle into the GAS editor and runs `setupTriggers()` once.**

After that one-time step, all ongoing rule management (add rules, change triggers, update recipients) happens entirely in Waymark — no GAS interaction ever again.

**No new OAuth scopes required for the Waymark side.** The watched sheet and config sheet are both written via the standard `spreadsheets` scope Waymark already holds.

### Path 3 — Script API Deployment (future, requires new scope)

The [Google Apps Script API](https://developers.google.com/apps-script/api/reference/rest) (`script.projects`) lets a web app programmatically create and update GAS projects. Adding this scope to Waymark's OAuth consent would allow:

- Waymark creates the GAS project automatically.
- Waymark pushes the pre-configured script files.
- User is prompted to authorize the GAS script once (unavoidable — GAS scripts run under user credentials and must be explicitly authorized by that user).

**Scope change required:** `https://www.googleapis.com/auth/script.projects`

**Trade-offs:**
- This is a broad scope — it lets the app read and write *all* the user's GAS projects, not just ones created by Waymark. Users will see this in the OAuth consent dialog.
- Google may flag this scope for additional review in the OAuth consent screen configuration.
- The user still must complete a one-time authorization of the GAS script itself (this cannot be skipped — it is a Google security requirement for scripts that send email or access Drive).
- Recommendation: implement Path 2 first (no new scopes, nearly as seamless), then revisit Path 3 if user drop-off at the manual step is a measurable problem.

---

## Scalability Model

### The 20-Trigger Limit

GAS allows a maximum of **20 installable triggers per project**. Each watched spreadsheet requires one `onEdit` trigger. This means one GAS project can watch at most 20 sheets.

### Scaling to Many Sheets — The Multi-Project Pattern

The architecture scales horizontally: deploy additional standalone GAS projects, each with its own master config sheet.

```
GAS Project A (20 triggers max)          GAS Project B (20 triggers max)
  master-config-A sheet                    master-config-B sheet
    → sheet-1 (+ _waymark_notify_sheet)      → sheet-21 (+ _waymark_notify_sheet)
    → sheet-2 (+ _waymark_notify_sheet)      → sheet-22 (+ _waymark_notify_sheet)
    → …up to sheet-20                        → …up to sheet-40
```

Each project is independent and watches its own set of sheets. The `_waymark_notify_sheet` column pattern and notification config sheets work identically across all projects — there is no central coordination needed.

### When to Spin Up a Second Project

- You have more than 20 sheets that need notifications.
- A single project's trigger count hits 20 (the script logs a warning and stops at 20).
- You want separate authorization contexts (e.g., different Google accounts owning different project sets).

See `examples/multi-sheet-notifier.js` for the implementation of the master config pattern. Registering a new sheet is as simple as adding a row to the master config sheet and re-running `setupTriggersFromMasterConfig()`.

### Practical Scale Ceiling

| Projects | Max watched sheets | Notes |
|---|---|---|
| 1 | 20 | Single install, single auth |
| 5 | 100 | One auth per project |
| 10 | 200 | Reasonable upper bound for one team |

For Waymark teams with hundreds of sheets, consider moving to a service-account-based GAS script (runs as a bot account, not an individual user). This is outside the scope of this document but follows the same architecture.

---

## Project Structure

Every GAS project lives in its own subdirectory under `google-apps-script/`:

```
google-apps-script/
  README.md                          ← this file
  appsscript.json                    ← manifest template (copy per project)
  lib/
    waymark-format.js                ← pure helpers: row grouping, column roles
    utils.js                         ← GAS-specific: sheet access, logging, properties
    triggers.js                      ← installable trigger registration helpers
    notification-config.js           ← frontend-managed notification rule helpers
  examples/
    notify-on-status-change.js       ← single-sheet: email on status column change
    multi-sheet-notifier.js          ← scalable: watch N sheets via master config
    export-snapshot.js               ← automation: write _waymark_logs compatible export
```

When adding a **new** script project, create a subdirectory:

```
google-apps-script/
  my-project/
    appsscript.json            ← copied from appsscript.json, customized
    Code.js                    ← main entry point (menu, trigger handlers)
    lib/                       ← copy (or symlink) shared lib files here
```

---

## Script Types

| Type | When to use | Deployment |
|---|---|---|
| **Sheet-bound** | Script lives inside one spreadsheet; can add menus and use simple triggers | Tools → Script editor inside the sheet |
| **Standalone** | Reusable across multiple sheets; supports installable triggers | GAS console (script.google.com) or clasp |

For Waymark automation, prefer **standalone** scripts with installable triggers. They survive if the sheet is copied and can be version-controlled via clasp.

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

Matches the Waymark frontend:

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

All scripts **must** read and write sheets in the Waymark row-per-item group format:

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

Use `mapColumnRoles(headers, rolePatterns)` from `lib/waymark-format.js`:

```javascript
var data = readSheetData(sheet);
var cols = mapColumnRoles(data.headers, {
  name:     /^(name|title|task|recipe)$/,
  status:   /^(status|stage|state|done)$/,
  assignee: /^(assignee|owner|assigned)$/,
  due:      /^(due|deadline|date)$/,
});

// Access a cell value:
var status = cellValue(row, cols.status); // '' if column not found
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
    var ss = SpreadsheetApp.openById(requireProperty('TARGET_SHEET_ID'));
    var sheet = requireSheet(ss, 'Tasks');
    var data = readSheetData(sheet);
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
  var ss = SpreadsheetApp.openById(requireProperty('TARGET_SHEET_ID'));
  registerOnEditTrigger('onWaymarkEdit', ss);
  registerDailyTrigger('dailyExport', 8); // 8 AM in script timezone
}
```

**Simple vs Installable triggers:**

| Type | Runs as | Can send email? | Can write to other files? |
|---|---|---|---|
| Simple (`onEdit`) | anonymous | ✗ | ✗ |
| Installable | authorizing user | ✓ | ✓ |

Always use **installable** triggers for Waymark automations.

---

## Script Properties

Never hardcode spreadsheet IDs, emails, or secrets in script files. Use `PropertiesService`:

```javascript
// Set once (via GAS console or setup function):
PropertiesService.getScriptProperties().setProperties({
  MASTER_CONFIG_SHEET_ID: '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms',
});

// Read in code:
var configId = requireProperty('MASTER_CONFIG_SHEET_ID');
```

---

## Authorization Scopes

Declare only the scopes your script needs in `appsscript.json`:

| Scope | Use when |
|---|---|
| `spreadsheets` | Reading or writing any spreadsheet |
| `drive.file` | Creating or modifying files created by this script only |
| `drive` | Accessing all Drive files (avoid unless necessary) |
| `script.send_mail` | Sending email via `MailApp` |
| `script.external_request` | Calling external URLs via `UrlFetchApp` |
| `script.projects` | Creating/pushing GAS projects via Script API (Waymark Path 3 only) |

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

The `.clasp.json` file stores the script ID. Check in a `.clasp.json.example` without real IDs, and add the real `.clasp.json` to `.gitignore`.

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

GAS scripts operate on the same sheets that Waymark reads via the Google Sheets REST API. Coordination happens through the sheet data itself:

- GAS reads `_waymark_notify_sheet` → finds its config sheet without hardcoded IDs.
- GAS uses the same column role conventions → headers stay compatible with templates.
- GAS respects the row-per-item group format → `parseGroups()` works correctly on both sides.
- GAS writes to `_waymark_logs/` for snapshots → same folder Waymark's `records.js` uses.
- Waymark frontend writes `_waymark_notify_sheet` and creates config sheets → no GAS changes needed for setup or rule updates.
