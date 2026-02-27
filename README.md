# WayMark

**Every project ends with a spreadsheet.**

You know the drill. Somebody says *"we need a database"* and then somebody else opens Google Sheets, types a few headers, and — congratulations — that *is* the database now. Budgets, inventories, guest lists, bug trackers, meal plans, hiring pipelines, school grades — humanity runs on rows and columns maintained by people who never asked for a DBA certification.

Spreadsheets are easy to **make** but harder to **use**. A wall of cells doesn't care about your workflow. It won't show you a progress bar. It won't group your Kanban cards into swim lanes. It won't highlight which test cases are failing. It doesn't know that row 47 is a dinner recipe and row 48 is next Tuesday's meeting.

**WayMark does.**

WayMark reads your Google Sheets and renders them as the interactive tools they were always *meant* to be — checklists, trackers, schedules, dashboards, kanban boards, and more. Your data stays in Google Sheets where everyone can edit it. WayMark just makes it **useful**.

> The people already chose their database. We're just giving them an interface that respects the choice.

---

## What It Does

1. **Connect your Google Drive** — browse folders, open any spreadsheet.
2. **Auto-detect the template** — WayMark examines the column headers and figures out what kind of data you have (checklist? budget? timesheet? CRM pipeline?).
3. **Render an interactive view** — progress bars, clickable checkboxes, calendar groupings, status badges, swim lanes — whatever fits the data.
4. **Write changes back** — toggle a checkbox, cycle a status badge, and the edit goes straight back to Google Sheets.
5. **AI-powered search** — find sheets by describing what you're looking for in plain English, powered by Gemini.

No extra database. No migration. No export/import. Just your spreadsheet, made better.

---

## 18 Templates

| Template | What It Renders |
|---|---|
| **Checklist** | Toggleable checkboxes with completion state |
| **Progress Tracker** | Live progress bars with percentage |
| **Schedule** | Time-grouped events with location info |
| **Inventory** | Card grid with quantities and categories |
| **Contacts** | Clickable phone/email links |
| **Activity Log** | Timestamped entries with type badges and duration |
| **Test Cases** | Status summary bar, result badges (Pass/Fail/Blocked), priority levels |
| **Budget** | Income/expense/balance summary, category grouping |
| **Kanban Board** | Swim-lane columns (Backlog → Done), draggable-feel stage cycling |
| **Habit Tracker** | Weekly grid with streak counts and toggleable day cells |
| **Gradebook** | Student rows with score columns and letter grades |
| **Timesheet** | Hours summary, billable vs non-billable breakdown |
| **Poll / Survey** | Bar chart with vote counts and percentages |
| **Changelog** | Version-grouped entries with type badges (Added, Fixed, Breaking) |
| **CRM** | Pipeline summary, deal cards with stage badges |
| **Meal Planner** | Day-grouped meals with calorie/macro info |
| **Travel Itinerary** | Date-grouped activities with booking refs and costs |
| **Roster** | Employee shift grid with toggleable day assignments |

Detection is automatic — name your columns sensibly and WayMark figures out the rest.

---

## Getting Started

### Prerequisites

- **Node.js** 18+
- A **Google Cloud** project with Sheets API v4, Drive API v3, and (optionally) Gemini API enabled
- OAuth 2.0 credentials (see `.env.example`)

### Install & Run

```bash
npm install
cp .env.example .env   # fill in your Google OAuth credentials
npm start              # http://localhost:3000
```

### Local Development (No Google Account Needed)

```bash
npm run dev            # starts in mock mode with fixture data
```

This runs the full app with fake Drive/Sheets data — perfect for development, design iteration, and running the test suite.

### Docker

```bash
docker-compose up
```

---

## Testing

98 end-to-end tests covering every template, auth flow, Drive exploration, search, sharing, and record tracking.

```bash
npm test                  # headless
npm run test:headed       # watch it run
npm run test:debug        # step through with Playwright Inspector
```

Tests use the mock/local mode — no Google account required.

---

## Architecture

Zero-build vanilla stack. No bundler, no framework, no transpiler. ES Modules in the browser, Node.js + Express on the server.

```
public/
├── index.html                 # Single-page app shell
├── css/
│   ├── style.css              # @import aggregator
│   ├── base.css               # Variables, reset, layout, utilities
│   └── templates/             # One CSS file per template (17 files)
├── js/
│   ├── app.js                 # Entry point, routing, state
│   ├── checklist.js           # Sheet rendering orchestrator
│   ├── ui.js                  # DOM helpers (el, showToast, escapeHtml)
│   ├── api-client.js          # Google API abstraction + mock mode
│   ├── examples.js            # Example sheet generator
│   ├── example-data.js        # 33 example sheet definitions
│   └── templates/
│       ├── index.js            # Barrel — imports all, exports detectTemplate()
│       ├── shared.js           # Core: TEMPLATES registry, onEdit, cell helpers
│       └── [18 template files] # Self-registering modules (~50-120 lines each)
server/
├── index.js                   # Express server (91 lines)
└── auth.js                    # OAuth + session management
tests/
├── playwright.config.js
├── helpers/                   # Test utilities, fixtures, mock data
└── e2e/                       # 24 spec files
```

**Key patterns:**

- **Self-registering templates** — each template module imports `registerTemplate` from `shared.js` and registers itself at load time. No central switch statement, no config file to update. Add a template by creating one file.
- **CSS `@import` aggregation** — `style.css` is just imports. Template styles are co-located with their logic.
- **Mock mode** — `WAYMARK_LOCAL=true` swaps the real Google API layer for in-memory fixtures. The entire app works offline.

---

## Why Spreadsheets?

Because spreadsheets are the people's database. They always have been.

Every organization on earth — from Fortune 500 companies to a family planning Thanksgiving — has critical data living in a spreadsheet right now. Not because spreadsheets are the best tool. Because they're the most *accessible* tool. Anyone can open one. Anyone can add a row. No schema migrations, no deployment pipelines, no access control meetings.

The instinct to reach for a spreadsheet is **correct**. The data model is already there — rows are records, columns are fields, sheets are tables. That's a database. People figured out relational data without anyone teaching them normal forms.

What's missing isn't structure. What's missing is **presentation**. A checklist shouldn't look like a grid. A budget shouldn't make you squint at column E to find the total. A kanban board shouldn't require you to remember which column means "In Progress."

WayMark bridges that gap. Your spreadsheet stays your spreadsheet. We just make it look and act like the tool you actually needed.

---

## License

Private / Unlicensed. See `package.json`.
