# AI-Driven Development Workflow

> **How Waymark is built by an AI agent that reads a Google Sheets kanban board, implements features, writes tests, and delivers ready-to-review branches — while you focus on product decisions.**

---

## Overview

Waymark uses a fully automated AI development workflow. Instead of writing code, the developer (product owner) writes **task descriptions** on a Google Sheets kanban board. An AI agent — the **Waymark Builder** — monitors the board, picks up tasks, implements them as feature branches with full test coverage, and marks them ready for human QA. The human reviews, merges, and the cycle repeats.

```
┌──────────────────────────────────────────────────────────────────────────┐
│                        DEVELOPMENT LIFECYCLE                            │
│                                                                          │
│   ┌──────────┐    ┌──────────────┐    ┌──────────┐    ┌──────────────┐  │
│   │  HUMAN   │    │  AI AGENT    │    │  HUMAN   │    │   DEPLOY     │  │
│   │          │    │              │    │          │    │              │  │
│   │ Write    │───▶│ Claim task   │───▶│ Review   │───▶│ Merge PR     │  │
│   │ task on  │    │ Branch       │    │ QA the   │    │ Deploy       │  │
│   │ kanban   │    │ Implement    │    │ branch   │    │ to prod      │  │
│   │ board    │    │ Test         │    │ Verify   │    │              │  │
│   │          │    │ Push         │    │ tests    │    │              │  │
│   │          │    │ Mark QA      │    │ Merge    │    │              │  │
│   └──────────┘    └──────────────┘    └──────────┘    └──────────────┘  │
│                                                                          │
│   Stage flow:  To Do → In Progress → QA → Done                         │
│                  ▲ human creates       ▲ human reviews & merges         │
│                        AI does the middle two stages                     │
└──────────────────────────────────────────────────────────────────────────┘
```

### What the Human Does

1. **Write tasks** on the kanban workboard with clear descriptions
2. **Set priority** (P0–P3) so the agent works on the most important things first
3. **Review QA branches** — read the agent's completion notes, run the tests, verify visually
4. **Merge and deploy** — the agent never merges; the human has final say

### What the AI Agent Does

1. **Poll the workboard** every 60 seconds for new "To Do" items
2. **Claim** the highest-priority task (sets stage to "In Progress")
3. **Create a feature branch** from the tip of `main`
4. **Implement** the feature following all codebase rules (AI_LAWS)
5. **Write E2E and unit tests** — minimum counts enforced per scope
6. **Run the full test suite** — all 800+ tests must pass
7. **Push the branch** and update the workboard to "QA" with detailed notes
8. **Loop** — pick up the next task or sleep until new work appears

---

## The Workboard

The workboard is a standard Google Sheets spreadsheet rendered by Waymark itself as a kanban board. It uses the same kanban template that any Waymark user can create.

**Spreadsheet ID:** `1Jl-fmWVEGatzOORp4wPQwPpg78binoBlCWATP9xb_q4`

### Column Layout

| Column | Letter | Purpose |
|--------|--------|---------|
| Task | A | Task title — non-empty = new task, empty = sub-row |
| Description | B | Detailed description of what to build |
| Stage | C | `To Do`, `In Progress`, `QA`, `Done`, `Backlog`, `Archived` |
| Project | D | Project grouping (e.g., "Kanban Upgrades", "Waymark AI") |
| Assignee | E | Who is working on it (`AI` for agent tasks) |
| Priority | F | `P0` (critical), `P1` (high), `P2` (medium), `P3` (low) |
| Due | G | ISO date `YYYY-MM-DD` |
| Label | H | Category tag: `bug`, `feature`, `design`, `docs`, `infra` |
| Note | I | **Only on sub-rows** — never on task rows |

### Task Rows vs Sub-Rows

The kanban board follows the row-per-item data format:

**Task row** (column A is non-empty):
```
| Fix mobile cache | Cache headers are stale... | To Do | Waymark Upgrades | AI | P1 | 2026-03-14 | bug | |
```

**Note sub-row** (column A is empty, column I has text):
```
| | | | | AI | | 2026-03-14 | | Branch: feature/fix | Files: ... | +80 LOC |
```

Sub-rows belong to the task row directly above them. The agent uses them for progress notes, completion summaries, and QA instructions.

### How to Create a Task

1. Open the workboard spreadsheet in Google Sheets
2. Add a new row with:
   - **Column A:** Task title (short, descriptive)
   - **Column B:** Description (as detailed as possible — the agent reads this)
   - **Column C:** `To Do`
   - **Column D:** Project name
   - **Column E:** `AI` (to indicate the agent should pick it up)
   - **Column F:** Priority (`P0`–`P3`)
   - **Column H:** Label (`bug`, `feature`, `design`, `docs`)
3. The agent will pick it up within 60 seconds

### Priority System

| Priority | Meaning | Agent Behavior |
|----------|---------|----------------|
| P0 | Critical — drop everything | Picked up immediately, before any other task |
| P1 | High — do next | Picked up after current task completes |
| P2 | Medium — normal work | Standard queue order |
| P3 | Low — nice to have | Only done when nothing higher is queued |

The agent sorts the To Do list by priority and always picks the highest-priority item first.

---

## The AI Agent (Waymark Builder)

The Waymark Builder is a VS Code Copilot agent mode that runs as a persistent loop. It uses GitHub Copilot's tool-use capabilities to read files, write code, run terminal commands, and manage the workboard.

### Operating Modes

**Mode A: Persistent Watch Loop** (default)
- Runs forever in a poll → work → poll cycle
- Burns zero tokens during idle sleep periods
- Automatically picks up new tasks as they appear

**Mode B: Single Task**
- Completes one specific task and stops
- Used for targeted assignments

### The Loop

```
┌─────────────────────────────────────────────────────────┐
│                                                          │
│   BOOT → Read AI_LAWS → Check workboard                │
│     │                                                    │
│     ▼                                                    │
│   WORK → Branch → Implement → Test → Push → Mark QA    │
│     │                                                    │
│     ▼                                                    │
│   SLEEP → sleep 60 (0 tokens) → CHECK workboard        │
│     │                            │                       │
│     │    new work found ─────────┘                       │
│     │    no work ────────────────▶ SLEEP again           │
│     │                                                    │
│     └────────── repeat forever ──────────────────────────│
│                                                          │
└─────────────────────────────────────────────────────────┘
```

### Token Efficiency

| Phase | Duration | Tokens/cycle | Notes |
|-------|----------|-------------|-------|
| Sleep | 60 seconds | 0 | `sleep 60` blocks — no inference runs |
| Check | ~2 seconds | ~30 | Run check script, parse JSON |
| Idle hour | 60 minutes | ~1,800 | 60 sleep cycles × 30 tokens |
| Active work | varies | normal | Writing code, running tests |

The agent is designed to be always-on without burning through token budgets during idle periods.

---

## Codebase Rules (AI_LAWS)

The agent follows a strict set of rules defined in `.github/instructions/AI_laws.instructions.md`. These rules are non-negotiable — violating any of them causes a hard reject during QA.

### Key Rules

1. **No backend business logic** — all logic runs in the browser
2. **Vanilla stack** — no frameworks, no build tools, no TypeScript
3. **All API access through `api-client.js`** — enables mock mode for testing
4. **Templates only import from `shared.js`** — strict module boundaries
5. **DOM built via `el()` factory** — never `innerHTML` with dynamic content
6. **CSS uses design tokens** — `var(--color-*)` from `base.css`
7. **Tests are flat** — no `describe()`, no hooks, CSS selectors only

### Branch Rules

- **Never commit to `main`** — every change gets its own feature branch
- Branch from the tip of `main` (fetch + reset --hard origin/main)
- Branch naming: `feature/{kebab-case-task-name}`
- Pre-commit guard verifies the branch is not `main`

---

## Tooling

### Scripts

Three Node.js scripts manage the workboard interaction:

#### `scripts/check-workboard.js` — Read the Board

One-shot query that reads the workboard and prints JSON to stdout. The agent calls this every cycle.

```bash
GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json \
  node scripts/check-workboard.js
```

**Output:**
```json
{
  "todo": [
    { "row": 286, "task": "Fix mobile cache", "stage": "To Do", "priority": "P1", ... }
  ],
  "inProgress": [],
  "qa": 3,
  "done": 75
}
```

#### `scripts/update-workboard.js` — Write to the Board (Safely)

All write operations go through this script, which uses the Sheets `insertDimension` API to prevent data overwrites.

```bash
# Claim a task (sets stage to "In Progress", assignee to "AI")
node scripts/update-workboard.js claim 286

# Update stage only
node scripts/update-workboard.js stage 286 QA

# Insert a note sub-row (SAFE — inserts blank row first, never overwrites)
node scripts/update-workboard.js note 286 "Branch: feature/foo | Files: a.js | +50 LOC"
```

**Why safe writes matter:** Raw Google Sheets PUT operations target specific row numbers. If the user adds rows between the agent's read and write, the target row shifts and the agent overwrites user data. The update script avoids this by inserting a new row before writing.

#### `scripts/watch-workboard.js` — Human Dashboard

A colored terminal watcher for humans who want to monitor the board in real time. Not used by the agent.

```bash
GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json \
  node scripts/watch-workboard.js
```

### Service Account

All scripts authenticate via a Google Cloud service account with Sheets API access:

```
GOOGLE_APPLICATION_CREDENTIALS=/path/to/waymark-service-account-key.json
```

The service account needs:
- `https://www.googleapis.com/auth/spreadsheets` (read/write for update-workboard)
- `https://www.googleapis.com/auth/spreadsheets.readonly` (read-only for check-workboard)

---

## Implementation Workflow

When the agent picks up a task, it follows this exact sequence:

### 1. Sync and Branch

```bash
git checkout -- . && git clean -fd      # discard any uncommitted changes
git checkout main && git fetch origin   # switch to main
git reset --hard origin/main            # sync to remote tip
git checkout -b feature/{task-name}     # create feature branch
git branch --show-current               # verify NOT on main
```

### 2. Claim the Task

```bash
node scripts/update-workboard.js claim {row}
```

Sets stage to "In Progress" and assignee to "AI" on the workboard.

### 3. Plan and Implement

The agent:
- Reads the task description and any sub-row notes for context
- Plans the implementation using a todo list
- Reads existing code to understand the module being modified
- Implements the feature following all AI_LAWS rules
- Creates fixture data if needed

### 4. Write Tests

Every feature gets both E2E tests (Playwright) and unit tests:

**E2E tests** simulate real human usage:
- Detection and rendering (does the template show up?)
- Click-through workflows (open → interact → verify chain)
- Visual consistency (design tokens, layout integrity, mobile)
- Data persistence (edits recorded correctly)

**Unit tests** verify pure functions:
- State classifiers, parsers, formatters
- Data transformers, math utilities
- Run in the browser via `page.evaluate()` + dynamic `import()`

**Minimum test counts:**

| Scope | Min E2E | Min Unit |
|-------|---------|----------|
| New template | 8+ | 5+ per helper |
| Template upgrade | 4+ | 3+ for changed helpers |
| Bug fix | 2+ | 1+ if helpers touched |
| New UI component | 5+ | N/A |

### 5. Verify

```bash
npm test   # ALL tests must pass — E2E + unit (800+)
```

### 6. Commit and Push

```bash
# Pre-commit guard
[[ "$(git branch --show-current)" != "main" ]] || { echo "FATAL!"; exit 1; }

# Commit
git commit -m "feat(scope): description"

# Push
git push -u origin feature/{branch-name}
```

### 7. Update Workboard

```bash
# Mark as QA
node scripts/update-workboard.js stage {row} QA

# Completion note (safe insert)
node scripts/update-workboard.js note {row} \
  "Branch: feature/task-name | Files: file1.js, file2.css | +120 LOC | 6 new tests (815 total)"

# QA instructions (safe insert)
node scripts/update-workboard.js note {row} \
  "QA: 1) Open sheet-NNN 2) Click X to verify Y. E2E covers: ... Manual: ..."
```

---

## Quality Gates

Before any task is marked QA, the agent verifies:

- [ ] No server-side business logic added
- [ ] All DOM built via `el()` — no unsafe `innerHTML`
- [ ] All Google API calls go through `api-client.js`
- [ ] Template files only import from `shared.js`
- [ ] CSS classes follow `.{key}-{element}` naming
- [ ] Colors use `var(--color-*)` design tokens
- [ ] Tests are flat (`test()` only, no `describe()`, CSS selectors)
- [ ] `npm test` passes all 800+ tests
- [ ] On a feature branch (not `main`)
- [ ] Branch pushed to remote
- [ ] Workboard updated with completion + QA notes

---

## Human QA Process

When a task moves to QA, the human reviewer should:

1. **Read the completion note** — understand what was built (branch, files, LOC, test count)
2. **Read the QA instructions** — step-by-step verification guide
3. **Check out the branch** and run `npm test` locally
4. **Manually verify** the feature on desktop and mobile
5. **Review the code** — ensure AI_LAWS compliance
6. **Create a PR** (if not done automatically) and merge to `main`
7. **Move the task to Done** on the workboard

The agent **never** moves tasks to Done — only the human does after review.

---

## Error Recovery

| Scenario | Agent Behavior |
|----------|----------------|
| Tests fail on agent's code | Fix and re-run before proceeding |
| Tests fail on existing code | Investigate if agent caused it; note pre-existing failures |
| Unclear task description | Implement best interpretation, note assumptions |
| Task requires backend changes | Mark as blocked with explanation (violates AI_LAWS §1.1) |
| Task requires a framework | Mark as blocked with explanation (violates AI_LAWS §1.2) |
| Network/API error on workboard check | Sleep and retry next cycle |

---

## Getting Started

### Prerequisites

1. **VS Code** with GitHub Copilot extension
2. **Service account key** for Google Sheets API access
3. **Waymark workboard** spreadsheet with the correct column layout

### Starting the Agent

In VS Code, start a Copilot chat with the `waymark-builder` mode selected. Type:

```
start
```

The agent will:
1. Read the AI_LAWS rules file
2. Query the workboard for To Do items
3. Begin implementing the highest-priority task
4. Enter the persistent loop when done

### Stopping the Agent

End the VS Code chat session or send an interrupting message.

---

## Architecture Decisions

### Why Google Sheets as a Task Board?

Waymark is a tool that makes Google Sheets interactive. Using a Google Sheet as the development task board is intentionally recursive — the workboard is managed by the same software being built. This means:

- The developer uses Waymark to view the board as a kanban UI
- The agent queries the same sheet programmatically via the Sheets API
- Improvements to the kanban template directly improve the development workflow
- Bugs in kanban rendering are immediately visible to the developer

### Why Not GitHub Issues?

GitHub Issues are great, but they require context-switching. With a Google Sheets workboard:

- Tasks are visible in the same kanban UI the developer already uses
- No OAuth token needed for the agent to read/write (service account)
- Full programmatic control via the Sheets API (insert rows, update cells)
- Row-per-item sub-rows for notes, which map perfectly to Waymark's kanban card model

### Why Feature Branches, Not Direct Commits?

Every change goes through a feature branch because:

1. **Human review is mandatory** — the agent is powerful but not infallible
2. **Rollback is easy** — delete the branch, no harm done
3. **Parallel work is safe** — multiple agents could work on different tasks
4. **CI can gate merges** — run tests, lint, and other checks before merge

### Why Persistent Loop, Not Event-Driven?

The agent uses a simple sleep→poll loop instead of webhooks because:

- **Zero infrastructure** — no webhook server, no event bus, no pubsub
- **Zero tokens during sleep** — the `sleep 60` command blocks with no inference
- **Self-healing** — if the agent crashes, it restarts from the last known state
- **Simple debugging** — check the terminal output to see what happened

---

## Metrics

The workboard tracks cumulative progress:

```json
{
  "todo": 2,
  "inProgress": 0,
  "qa": 1,
  "done": 75
}
```

Each completed task includes a completion note with:
- Branch name
- Files changed
- Lines of code added/modified
- Number of new tests (and total test count)

This creates a natural audit trail of every feature built, who built it, and when.
