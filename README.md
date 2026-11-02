# WayMark

Transform Google Sheets into a shared life operating system for families, households, and small teams.

WayMark turns the spreadsheets you already use into beautiful, collaborative tools for planning life together: home projects, budgets, routines, meal planning, travel, family tasks, home design, and more.

> The spreadsheet was already your database. We just give it the interface your life actually needs.

---

## Why WayMark exists

Most people live in a mess of tabs, notes, calendars, checklists, shared docs, and half-finished plans.

Families and groups do not need a new database. They need a simple way to coordinate the real systems of life:

- weekly routines and household tasks
- groceries, meals, and home planning
- budgets and shared expenses
- trips and family logistics
- home renovation and floor-plan design
- home projects, maintenance, and upgrades
- shared goals and recurring decisions

WayMark keeps everything in Google Sheets — where people already work — and renders it into clear, interactive views that are easy for everyone to use.

No separate app database. No migration hell. No training required.

---

## Built for family life and shared planning

WayMark is designed for households, families, roommates, and small groups who want one place to keep everything aligned.

### Shared by default

- one Google Sheet, many collaborators
- each person can update the plan without learning a new system
- real-time collaborative workflows using the tools people already keep in Google Workspace
- custom views for different needs without changing the underlying data model

### Life management, not just project tracking

WayMark helps you manage the rhythm of real life:

- chores and recurring tasks
- household budgets and savings goals
- meal planning and grocery coordination
- health and habit tracking
- travel, logistics, and upcoming events
- home design and renovation planning
- household upgrades, repairs, and improvement projects

### Home design included

The new floor-plan template is a first-class example of the WayMark philosophy: make complex, real-world planning easier to visualize without forcing everyone into a separate CAD tool.

Whether you are mapping out a room layout, planning electrical and plumbing placement, or designing a home improvement project, WayMark helps you model the plan in a spreadsheet-backed, visual workspace.

---

## What WayMark does

1. Connect to your Google Drive and open a sheet
2. Auto-detect the right template from the columns you already have
3. Render it as a purpose-built tool: dashboard, board, tracker, planner, or map-like view
4. Edit data directly in the sheet or through the interface
5. Keep the system collaborative and easy to share with the people who need it

This is not a database replacement. It is a better interface for the spreadsheet system the world already uses.

---

## Template library

WayMark currently includes a broad set of collaborative planning templates, including:

| Template | Use case |
|---|---|
| Checklist | chores, personal tasks, recurring jobs |
| Kanban Board | family projects, home improvements, planning |
| Budget | household finances and shared spending |
| Habit Tracker | routines and accountability |
| Meal Planner | weekly meals and grocery planning |
| Schedule | calendars, events, and recurring plans |
| Travel Itinerary | trips, reservations, and trip logistics |
| Inventory | house supplies, pantry, emergency prep |
| Progress Tracker | goals and milestones |
| CRM | sales, customers, and relationship tracking |
| Contacts | family, friends, vendors, and service providers |
| Floor Plan | room layouts, home design, electrical and plumbing planning |
| Roster | family schedules and shift coverage |
| Poll / Survey | household decisions and group votes |
| Changelog | release notes and project history |
| Test Cases | QA and process verification |
| Timesheet | work tracking and team reporting |
| More templates keep expanding the platform |

WayMark is intentionally flexible enough to serve both personal planning and household-scale coordination.

---

## The WayMark approach

### Spreadsheets are the people's database

The instinct to reach for a spreadsheet is correct. The data model is already there: rows are records, columns are fields, and sheets are tables.

What people usually lack is not structure — it is clear presentation and a sensible workflow.

WayMark bridges that gap:

- the spreadsheet remains the source of truth
- the interface becomes the tool people actually want to use
- the data stays collaborative and editable by the whole household or team

---

## Getting started

### Prerequisites

- Node.js 18+
- a Google Cloud project with Sheets API v4 and Drive API v3 enabled
- OAuth credentials configured in `.env`

### Install and run

```bash
npm install
cp .env.example .env
npm start
```

Then open the app locally at `http://localhost:3000`.

### Local mock mode

```bash
npm run dev
```

This starts the app in local mock mode with fixture data, which is useful for development, UI iteration, and end-to-end testing without a Google account.

### Bare-Metal & Wayside AGY Orchestrator (Linux, macOS & Windows)

WayMark includes an autonomous **Wayside AI** orchestrator (`assistant@waymark.internal`) powered by Antigravity CLI (`agy`) and two local MCP servers (`waymark` + `google-sheets`) with 42 compiled template skills.

#### Linux & macOS

```bash
# Install dependencies, compile 42 AGY skills, register MCP servers, and verify Google OAuth
./scripts/install-headless.sh

# Launch the local WayMark web app + Wayside AI Orchestrator together
./run-waymark.sh --with-wayside

# Or run Wayside AI standalone (auto-discovers or provisions your Wayside Share Ledger)
./run-wayside.sh

# Optional: enable as a background user systemd daemon
systemctl --user enable --now waymark-wayside
```

#### Windows (PowerShell & Command Prompt)

```powershell
# Install dependencies, compile 42 AGY skills, register MCP servers, and verify Google OAuth
powershell -ExecutionPolicy Bypass -File .\scripts\install-headless.ps1

# Launch the local WayMark web app + Wayside AI Orchestrator together
.\run-waymark.ps1 -WithWayside
# (or from cmd.exe: run-waymark.cmd --with-wayside)

# Or run Wayside AI standalone (auto-discovers or provisions your Wayside Share Ledger)
.\run-wayside.ps1
# (or from cmd.exe: run-wayside.cmd)

# Optional: register and start as a background Windows Scheduled Task
powershell -ExecutionPolicy Bypass -File .\scripts\install-headless.ps1 -InstallTask -NonInteractive
```

---

## Testing

The project uses Playwright end-to-end tests for the app, templates, and mock-mode flows.

```bash
npm test
npm run test:changed
npm run test:headed
npm run test:debug
```

The test suite covers rendering, mock API flows, shared utilities, and template behavior so the app stays stable while the interface evolves.

---

## Architecture

WayMark uses a zero-build, browser-first stack with a lightweight Express server for serving static assets and OAuth flow.

```text
public/
├── index.html
├── css/
│   ├── style.css
│   ├── base.css
│   └── templates/
├── js/
│   ├── app.js
│   ├── api-client.js
│   ├── checklist.js
│   ├── ui.js
│   ├── example-data.js
│   └── templates/
server/
├── index.js
├── auth.js
└── config.js
tests/
├── playwright.config.js
├── helpers/
└── e2e/
```

The key architectural idea is simple:

- keep the data in Google Sheets
- render the right interface in the browser
- make the app feel like a purpose-built family/life planner, not a spreadsheet wall of cells

---

## License

WayMark is licensed under the GNU General Public License v3.0 only.

See `LICENSE` for details.

---

## Links

[Waymark](https://swiftirons.com/waymark.html)

[![Hypercommit](https://img.shields.io/badge/Hypercommit-DB2475)](https://hypercommit.com/waymark)
