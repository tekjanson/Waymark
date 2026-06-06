# Waymark — Copilot Global Instructions

You are working in the **Waymark** codebase for operator **Tek Janson**.
These instructions apply to every session, every task, every agent invocation.

---

## Operator Defaults (non-negotiable)

- **98% autonomy.** Make the call. Only escalate genuinely ambiguous product decisions.
- **Make is the interface.** Every operation the operator can run is a `make` target.
  Never instruct them to run raw `docker`, `node`, `bash`, or `npx` commands.
  If a target doesn't exist, add it before telling them to run it.
- **Parse intent, not words.** "This is clunky" means redesign it. "Clean this up" means the whole approach.
- **Scale first.** Every solution must work at N=1 and N=100. Container-based. Stateless.
- **Clean > clever.** The simpler readable solution wins every time.
- **The workboard is the interface.** The operator drops tasks into the Waymark kanban UI.
  Agents pick them up, implement them, and mark them done. No back-and-forth in chat.

---

## Codebase Laws (summary — full rules in .github/instructions/AI_laws.instructions.md)

1. **No backend business logic** — server/ only: static files, OAuth, runtime flags.
2. **Vanilla stack** — No React, no Tailwind, no bundlers, no TypeScript. ES Modules + raw CSS.
3. **Zero server state** — No DB, no cache. Data lives in Google Drive or localStorage.
4. **All Google API calls through `api-client.js`** — never import drive.js/sheets.js directly.
5. **Templates only import from `shared.js`** — never from ui.js or api-client.js directly.
6. **DOM via `el()` only** — never innerHTML with dynamic content.
7. **async/await everywhere** — no .then() chains.
8. **Tests: flat test() calls, no describe(), no beforeEach, CSS selectors only.**

---

## Workboard Workflow

Before picking any task, check the workboard:
```bash
GOOGLE_APPLICATION_CREDENTIALS=/root/.config/gcloud/waymark-service-account-key.json \
  node scripts/check-workboard.js
```
Output: `{"todo":[...],"inProgress":[...],"qa":N,"done":N}`

Mark tasks in-progress before touching code:
```bash
node scripts/update-workboard.js --row ROW --stage "In Progress" --assignee "$AGENT_NAME"
```

Mark done when tests pass + committed:
```bash
node scripts/update-workboard.js --row ROW --stage "QA"
```

---

## Git Workflow

Every task gets its own branch:
```bash
git checkout -b feature/short-description
# implement + test
git add -A && git commit -m "feat: description

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
git push origin feature/short-description
```

---

## Tests

Run tests with:
```bash
make test               # full Playwright E2E suite
make agent-test         # dev-worker health check (boot + auth)
```

All new templates require a fixture in `tests/fixtures/sheets/` and an E2E test in `tests/e2e/`.

---

## MCP Servers Available

- `google-sheets` — read/write any Google Sheet
- `waymark` — Waymark-specific operations (workboard, Drive)
- `orchestrator` — task routing + orchestration
- `mqtt-bridge` — browser debug bridge (Playwright QA)
- `agent-compiler` — compile agent templates

Use these tools instead of writing raw fetch calls to Google APIs.
