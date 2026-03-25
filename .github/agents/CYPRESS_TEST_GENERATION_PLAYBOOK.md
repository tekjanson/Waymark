# Buildium Cypress Test Generation Playbook

**Cypress 12.0.2 | 3,950+ tests | BDD Given-When-Then | 6 portals | 24+ manager modules**
**Last Updated**: 2026-03-25 | **Version**: 2.9.2 (Self-Healing: execute-first rule — no research before first run, research only after screenshot diagnosis)

---

## Table of Contents

1. **Workflow** — Classify → Parallel Research → Generate → Validate → Execute → Diagnose → Heal → Pass (2x) → Deliver
2. **Source Code Access** — Local, GitHub MCP, Portal-to-Repo Mapping
3. **Test Template & Rules** — Code template, execution rules, SysTest.json
4. **Setup Functions** — Signatures, returns, trigger mapping
5. **Import Paths** — Depth table, standard block, file paths
6. **Locator Strategy** — 3-step verification, DOM rendering, navigation recipes, UI patterns
7. **Helpers & API Reference** — Pre-computed signatures, API index, URL constants, API function creation (§7.7)
8. **Data Generation** — faker, dayjs, enums
9. **Feature-Specific Verification** — Per-feature checks, workflow exclusions
10. **Common Mistakes** — Error/correction reference
11. **Quick-Start Patterns** — Copy-paste starter patterns
12. **Repository Structure & Config**
13. **Test Execution & Healing** — Run with monitoring loop, diagnose from screenshots+logs, heal using full playbook, pass 2x, deliver

---

## Non-Negotiable Rules

1. **Verify every behavior from source code** — Read the buildiumCode source for the SPECIFIC feature via GitHub MCP. Never assume behavior from a similar test applies.
2. **Search first** — Every function, selector, and import must be verified to exist before use.
3. **No placeholder code** — No `create[Entity]Api()`, no `#someButton`, no assumed paths.
4. **Exact locator verification** — 3-step rule: find in template → understand DOM rendering → cross-validate with existing test (see §6).
5. **Always generate BOTH files** — `[test-name].js` AND `[test-name].SysTest.json`.
6. **`return` only in givenExecution** — Never in whenExecution or thenExecution.
7. **No missing API for GIVEN data** — If the GIVEN phase needs data and no API function exists in `api-functions/`, create the API function first (see §7.7), then call it. Never leave test data setup incomplete or use UI-only workarounds when an API exists.
8. **No blind `cy.wait()` — always wait for real DOM assertions** — Use `cy.get("#element", { timeout: N }).should("be.visible")` or `.should("exist")` instead of `cy.wait(5000)`. Read the controller source to understand what async operations gate rendering (resolves, `AppState.connect()`, API calls), then wait for the DOM element those operations produce. Every test runs on a **fresh account** — resolves and API calls are slower on new accounts with no cached data; set timeouts accordingly (30s for initial page loads).
9. **Never heal with generic/guessed selectors** — When a locator fails, do NOT guess a fix (e.g., changing `text()="Units (0)"` to `contains(text(),"Units")`). Read the HTML template from the correct source repo to find the exact ID, class, or attribute. Every heal must be traceable to source code you read.
10. **Run the entire pipeline end-to-end without stopping** — When asked to create a test, execute the full flow (Classify → Parallel Research → Generate → Validate → Execute → Diagnose → Heal → Pass 2x → Deliver) autonomously. Never pause to ask the user to retry, never declare "infrastructure issue" and wait, never deliver an unexecuted or single-pass test. If the environment fails, retry after 2-3 minutes. If a test fails, diagnose and heal immediately. Only stop when the test has two consecutive passes and is delivered.

### Speed Optimization Rules

1. **Launch Agent A and Agent B in a SINGLE message** — parallel `Agent` tool calls, never sequential.
2. **Use pre-computed references first** — Setup signatures (§4), helper signatures (§7.1-7.2), API index (§7.4) are pre-computed. Do NOT search for anything already documented here.
3. **Agent B checks this playbook before searching** — only search the codebase for things NOT in this file.

---

## 1. Workflow: Classify → Parallel Research → Generate → Validate → Execute → Diagnose → Heal → Pass (2x) → Deliver

```
Request: "Create test for [feature]"
          │
          ▼
  ┌───────────────┐
  │   CLASSIFY    │  portal, module, test type, setup function
  └───────┬───────┘
          │
    ┌─────┴─────┐            LAUNCH BOTH IN ONE MESSAGE
    ▼           ▼
┌─────────┐ ┌─────────┐
│ AGENT A │ │ AGENT B │
│ GitHub  │ │ Local   │
│ MCP     │ │ Search  │
└────┬────┘ └────┬────┘
     └─────┬─────┘
           ▼
  ┌───────────────┐
  │   GENERATE    │  merge results, write test
  └───────┬───────┘
          ▼
  ┌───────────────┐
  │   VALIDATE    │  checklist (§1.4) before execution
  └───────┬───────┘
          │
          ▼
  ╔═══════════════╗
  ║    EXECUTE    ║  single Bash call: script + monitoring loop (§13.1)
  ╚═══════╤═══════╝  react to screenshots immediately, never blind sleep
          │
     FAIL?├─── YES ──┐
          │          ▼
          │  ┌───────────────┐
          │  │   DIAGNOSE    │  read screenshot both halves + logs (§13.3)
          │  └───────┬───────┘
          │          ▼
          │  ┌───────────────────────────────────────────────┐
          │  │              HEAL (§13.4)                     │
          │  │  Apply the FULL playbook to fix:              │
          │  │                                               │
          │  │  §2  Source Code Access — GitHub MCP          │
          │  │  §4  Setup Functions — trigger mapping        │
          │  │  §5  Import Paths — recalculate depth         │
          │  │  §6  Locator Strategy — 3-step verification   │
          │  │  §7  Helpers & API — signatures, API index    │
          │  │  §9  Feature-Specific — per-feature checks    │
          │  │  §10 Common Mistakes — error/correction table │
          │  │  §11 Quick-Start Patterns — nav recipes       │
          │  └───────────────────┬───────────────────────────┘
          │                     │
          │                     └──→ go back to VALIDATE (§1.4)
          │
          NO (PASS 1st)
          │
          ▼
  ╔═══════════════╗
  ║  RE-EXECUTE   ║  run again with retries=0 to confirm stability
  ╚═══════╤═══════╝
          │
     FAIL?├─── YES ──→ flaky — go back to DIAGNOSE
          │
          NO (PASS 2nd)  two consecutive passes confirmed
          │
          ▼
  ┌───────────────┐
  │    DELIVER    │
  └───────────────┘
```

### Alternate Entry: Self-Healing Test

When the user provides an **existing test to fix** (not create from scratch), skip Classify/Research/Generate and enter the pipeline at EXECUTE.

**CRITICAL — Non-negotiable rules for self-healing:**
1. **Execute FIRST, research LATER.** After reading the test, **immediately run it** — do NOT launch research agents, do NOT search GitHub MCP, do NOT read backend code before the first execution. You don't know what's broken until you see the screenshot. Research only happens inside the HEAL step after a failure is diagnosed.
2. **Never stop after fixing code.** After healing, **immediately re-run** the test. Do NOT ask "Shall I run?" or present a summary and wait. The fix is unverified until it passes twice.
3. **The pipeline is fully autonomous** from READ TEST through DELIVER — zero user prompts between steps.

```
Request: "Fix this failing test: [test-name].js"
          │
          ▼
  ┌───────────────┐
  │   READ TEST   │  read the test file to understand its structure
  └───────┬───────┘
          │
          ▼
  ╔═══════════════╗
  ║    EXECUTE    ║  single Bash call: script + monitoring loop (§13.1)
  ╚═══════╤═══════╝  open live viewer, react to screenshots immediately
          │
     FAIL?├─── YES ──┐
          │          ▼
          │  ┌───────────────┐
          │  │   DIAGNOSE    │  read screenshot both halves + logs (§13.3)
          │  └───────┬───────┘
          │          ▼
          │  ┌───────────────────────────────────────────────┐
          │  │              HEAL (§13.4)                     │
          │  │  Apply the FULL playbook to fix:              │
          │  │                                               │
          │  │  §2  Source Code Access — GitHub MCP          │
          │  │  §4  Setup Functions — trigger mapping        │
          │  │  §5  Import Paths — recalculate depth         │
          │  │  §6  Locator Strategy — 3-step verification   │
          │  │  §7  Helpers & API — signatures, API index    │
          │  │  §9  Feature-Specific — per-feature checks    │
          │  │  §10 Common Mistakes — error/correction table │
          │  │  §11 Quick-Start Patterns — nav recipes       │
          │  └───────────────────┬───────────────────────────┘
          │                     │
          │                     └──→ go back to VALIDATE (§1.4)
          │                              then EXECUTE
          │
          NO (PASS 1st)
          │
          ▼
  ╔═══════════════╗
  ║  RE-EXECUTE   ║  run again with retries=0 to confirm stability
  ╚═══════╤═══════╝
          │
     FAIL?├─── YES ──→ flaky — go back to DIAGNOSE
          │
          NO (PASS 2nd)  two consecutive passes confirmed
          │
          ▼
  ┌───────────────┐
  │    DELIVER    │
  └───────────────┘
```

The HEAL step uses the **full playbook** — same as for new tests. Read source code via GitHub MCP, verify locators from templates, check setup functions, apply DOM rendering rules.

**Use this EXACT command to execute (and re-execute after each heal):**
```bash
# Open live viewer first
cmd.exe /c start chrome --incognito "http://localhost:1234/IQE/vnc.html?autoconnect=true" 2>/dev/null

# Write wrapper script and run with monitoring loop — ALL in one Bash call
cat > /tmp/run-cy-test.sh << 'SCRIPT'
#!/bin/bash
unset ELECTRON_RUN_AS_NODE
cd ~/mixeduse-cypress-local-dev/buildium-cypress
npx cypress run --config-file cypress/cypress.config.js --browser chrome --headed \
  --config retries=0 \
  --spec "cypress/e2e/buildiumcode/[portal]/[module]/[test-name].js" \
  > /tmp/cy-test.log 2>&1
SCRIPT
chmod +x /tmp/run-cy-test.sh

cd ~/mixeduse-cypress-local-dev/buildium-cypress
rm -rf cypress/screenshots/[test-name].js/ 2>/dev/null

/tmp/run-cy-test.sh &
PID=$!
while true; do
  screenshot=$(find cypress/screenshots -name "*.png" -newer /tmp/run-cy-test.sh 2>/dev/null | head -1)
  if [ -n "$screenshot" ]; then echo "FAILED: $screenshot"; kill $PID 2>/dev/null; break; fi
  if ! kill -0 $PID 2>/dev/null; then echo "Process finished"; break; fi
  sleep 5
done
tail -30 /tmp/cy-test.log
```

**NEVER deviate from this command** — see §13.1 for why each flag is mandatory. After two consecutive passes, deliver the fix.

### 1.1 Classify — Decision Tree

```
User request: "Create test for [feature]"
  │
  ├─ Simple CRUD? (add/edit/delete note, listing, file, custom field)
  │   → FAST PATH — Agent A reads backend flow + HTML template locators, Agent B reads similar test (for imports/structure only) → generate
  │
  ├─ New UI flow? (multi-step wizard, new modal, cross-page navigation)
  │   → STANDARD PATH — Controller → Service → UI templates
  │
  └─ Trigger / side-effect test? (workflows, scheduled emails, automated tasks)
      → FULL PATH — Controller → Service → ActionHandler → Events → Enums → UI
      → Map ALL side effects for the THEN phase
```

**Every feature has unique constraints.** Do NOT assume that behavior from a similar test applies. Read the buildiumCode source for the SPECIFIC feature via GitHub MCP.

### 1.2 Parallel Research — Launch Both Agents in ONE Message

**Agent A** (GitHub MCP) does:
1. Backend flow: Controller → Service → ActionHandler → Events → Enums in `buildium/buildiumcode`
2. HTML template locators from the correct source repo (see §2 Portal-to-Repo Mapping)
3. Resource strings from `en-US.json`

**Agent A speed rule — batch independent MCP calls in a single message:**
- First batch: multiple `search_code` calls in parallel (e.g., search for controller + search for template + search for en-US.json simultaneously)
- Second batch: multiple `get_file_content` calls in parallel using paths from the first batch
- Only chain calls that depend on a previous result (e.g., need search results before reading a file)

**Agent A returns**: entities needed for setup, exact user action for WHEN, ALL side effects for THEN, ALL verified locators.

**Agent B** (Local search) does:
1. Read 2-3 similar tests in `cypress/e2e/buildiumcode/[portal]/[module]/` — **always search**
2. Setup function signatures — **skip, use §4 below**
3. Module helpers in `[portal]/[module]/common/` — **always search**
4. API functions — **check §7.4 index first**, only search for unknowns
5. Conditional searches (feature flags, admin login, etc.) — **signatures in §7.2, skip search**
6. **API gap detection** — Identify ALL data the GIVEN phase needs. For each, check if an API function exists in `api-functions/`. Report any gaps.

**Agent B skip list — do NOT search for these, already pre-computed in playbook:**
- Setup function signatures & returns → §4
- Cross-module helper signatures (`adminLoginUI`, `runTaskHandler`, `invalidateCacheNew`, `optinBeta...`, `getManagerUrlConstants`, mailing template helpers) → §7.1
- Workflow helper signatures (`addEmailStep`, `addTaskStep`, etc.) → §7.2
- API function directory index (198 files) → §7.4
- URL constants (`.rentals.properties`, `.settings.workflows`, etc.) → §7.5
- Module helper locations → §7.6
- Import depth table → §5

**Only search** for: similar tests in the module folder, module-specific helpers NOT listed in §7.6, API functions NOT listed in §7.4.

**Agent B returns**: import paths with correct `../` depth, module helpers found, any API functions beyond §7.4, **list of missing API functions needed for GIVEN data setup**.

**Conditional Searches** (Agent B triggers ONLY if test requires them — signatures are pre-computed in §7.1):

| Requirement | What to Search |
|-------------|---------------|
| Feature flags | `optinBetaFeatureWithCacheInvalidation()` in `common/api/optin-beta-feature.js` |
| Admin login | `adminLoginUI()` in `common/test-data-setup/ui-functions/admin-login.js` |
| Task handler | `runTaskHandler()` in `admin/common/api/runTaskhandler-api.js` |
| Resident portal | `residentLogin()` in `common/test-data-setup/api-functions/resident-login.js` |
| File upload | `.attachFile()` pattern + fixture file in `cypress/fixtures/` |
| Iframe content | `cy.iframe().find("body")` pattern |
| SMS provisioning | `commonSmsSetup()` in `common/test-data-setup/sms-provision-setup.js` |

### 1.3 Generate — Merge Results and Write Test

After both agents return:
1. **Merge**: Combine Agent A's locators/side-effects with Agent B's import paths/helpers
2. **Fill API gaps**: If Agent B reported missing API functions needed for GIVEN data, create them NOW before writing the test (see §7.7). For each missing API:
   - Search buildiumCode backend via GitHub MCP for the API endpoint (controller routes, DTOs)
   - Create the API function file in `cypress/e2e/common/test-data-setup/api-functions/` following the pattern in §7.7
   - Use faker for dynamic data generation in DTO builder functions — never hardcode values
3. **Compute imports**: Use §5 depth table to calculate correct `[DEPTH]` and `[MGR]` for the test location
4. **Write givenExecution**: Call setup with `return`, init `account.testData = {}`, generate faker data, call any newly created API functions for additional data setup, call `invalidateCacheNew`, end with `order.setAccount` + `nextfunction`
5. **Write whenExecution**: `order.getAccount()`, navigate, perform business action, end with `order.setAccount` + `nextfunction`. **No `return`.**
6. **Write thenExecution**: `order.getAccount()`, assert EVERY side effect from Agent A, end with `order.setAccount` + `nextfunction`. **No `return`.**
7. **Write SysTest.json**: Standard format from §3
8. **Immediately proceed to VALIDATE then EXECUTE** — do NOT summarize the test and ask "Shall I run?" or wait for user confirmation. The pipeline is autonomous from Generate through Deliver.

### 1.4 Validate — Checklist Before First Execution

Run this checklist internally. Do NOT present it to the user or ask for approval — just verify and proceed to EXECUTE.

- [ ] Every import resolves to a real file
- [ ] Every function name matches exactly (name, casing, export)
- [ ] Every selector verified: find in template → understand DOM rendering → cross-validate with existing test
- [ ] Every feature behavior confirmed from buildiumCode source — not assumed from similar test
- [ ] Every helper call uses arguments derived from reading the helper source and understanding system state in THIS test
- [ ] `return` only in givenExecution
- [ ] Every phase ends with `order.setAccount(account)` then `nextfunction(order.shift(), order)`
- [ ] Timeouts account for fresh account async lifecycle — read controller to identify resolves/`ng-if` gates; use 30s for initial page loads, wait for parent container before child elements
- [ ] No `cy.wait(N)` used as a substitute for DOM assertions — every wait must target a real element
- [ ] Post-action redirects verified — read controller submit function to confirm destination page; THEN assertions target destination, not source page
- [ ] Both `.js` and `.SysTest.json` generated
- [ ] Any new API function files created follow §7.7 pattern (DTO builder + API caller, faker for data, JSDoc, correct require path)
- [ ] No placeholder code anywhere

### 1.5 Execute → Diagnose → Heal → Pass (2x) → Deliver

**Immediately after validation**, run the test. Do NOT ask the user "Shall I run the test?" or present a summary and wait — execute automatically. The entire flow from GENERATE to DELIVER is autonomous — no user confirmation needed between steps.

**Use this EXACT command pattern** — every flag is mandatory:
```bash
# Write to /tmp/run-cy-test.sh, then run with monitoring loop
cat > /tmp/run-cy-test.sh << 'SCRIPT'
#!/bin/bash
unset ELECTRON_RUN_AS_NODE
cd ~/mixeduse-cypress-local-dev/buildium-cypress
npx cypress run --config-file cypress/cypress.config.js --browser chrome --headed \
  --config retries=0 \
  --spec "cypress/e2e/buildiumcode/[portal]/[module]/[test-name].js" \
  > /tmp/cy-test.log 2>&1
SCRIPT
chmod +x /tmp/run-cy-test.sh
```
Then run with the monitoring loop from §13.1 in a **single Bash tool call**.

**NEVER deviate from this command:**
- `unset ELECTRON_RUN_AS_NODE` — VS Code sets this, breaks Cypress child processes
- `cd ~/mixeduse-cypress-local-dev/buildium-cypress` — repo root, NOT `cypress/` subdirectory
- `--config-file cypress/cypress.config.js` — config is inside `cypress/`, must be specified explicitly
- `--browser chrome --headed` — NEVER use `--headless`, tests require a visible browser
- `--spec` path starts with `cypress/e2e/` — relative to repo root

If it fails, diagnose from the screenshot (§13.3) and heal using the full playbook (§13.4). Re-validate (§1.4), re-execute. Only deliver after two consecutive passes (§13.5).

---

## 2. Source Code Access

### Local — buildium-cypress Test Suite

Use Read, Glob, Grep tools. Path: `~/mixeduse-cypress-local-dev/buildium-cypress/`

### Remote — Application Source Code via GitHub MCP

| Operation | MCP Tool | Example |
|-----------|----------|---------|
| Read file | `mcp__github-mcp__get_file_content` | `owner="buildium", repo="buildiumcode", path="Manager/client/..."` |
| Browse folder | `mcp__github-mcp__list_directory` | `owner="buildium", repo="buildiumcode", path="Manager/client/src/app/features/"` |
| Search code | `mcp__github-mcp__search_code` | `query="selector-text repo:buildium/buildiumcode path:Manager/client"` |
| Full tree | `mcp__github-mcp__get_repository_tree` | `owner="buildium", repo="buildiumcode"` |

**Branch rule — EVERY `get_file_content` call MUST include `ref='test'`** (use `ref='master'` ONLY for `buildium.resident`). Subagents do NOT inherit branch context — always include this in Agent A prompts. Without it, you read stale `master` code and generate wrong locators/logic.

### Portal-to-Repository Mapping (Locator Sources)

| Portal | Source Repo | Template Paths | URL Pattern |
|--------|------------|----------------|-------------|
| **Manager** | `buildium/buildiumcode` | Ng18: `Manager/client/src/app/features/[module]/**/*.component.html`, AJS: `Manager/client/app/[module]/**/*.html` | `/manager/app/...` |
| **Admin** | `buildium/buildium-admin-console` | AJS: `apps/admin-console/src/ajs-app/features/**/*.html`, Ng: `libs/admin-console/domains/**/*.component.html` | `admin.{domain}/home` |
| **Resident** | `buildium/buildium.resident` | `src/app/[module]/**/*.component.html` | `/Resident/portal` |
| **Applicant Center** | `buildium/buildium-rental-application` | `src/app/features/**/*.component.html` + `src/app/core/**/*.component.html` | `/Resident/rental-application/...` |
| **Board Member** | `buildium/buildium.resident` | Same as Resident | Same as Resident |

**Note**: `buildiumcode/Resident.Web` and `buildiumcode/Admin.Web` are backend-only. Templates are in the separate repos above.

### buildiumcode Backend Paths

| Layer | Path |
|-------|------|
| C# Action Handlers | `Buildium.Enterprise.TaskHandlers/` |
| C# Enums | `Buildium.Enterprise.Framework.Enum/` |
| C# Core Services | `Buildium.Enterprise.Core/` |
| C# Data Services | `Buildium.Enterprise.Data/` |
| Resource strings | Search `en-US.json` in `Manager/client/` |

### Supporting Repos

`buildium/Workflows` (workflow engine), `buildium/Telephony` (SMS), `buildium/activityfeed`, `buildium/esignatures`, `buildium/notifications`

---

## 3. Test Template & Rules

```javascript
const { permissions, sysTestOrder } = require("./test-name.SysTest.json");
const { executionOrder } = require("[DEPTH]common/system-level-testing/execution-order-new.js");
const { createUnitSetup } = require("[DEPTH]common/test-data-setup/create-unit.js");
const { getManagerUrlConstants } = require("[MGR]common/manager-navbar-urls.js");
const { invalidateCacheNew } = require("[DEPTH]common/api/invalidate-cache-new.js");
const faker = require("faker");
const forceAction = { force: true };
const extendedTimeout = { timeout: 60000 };  // Common: 40000, 50000, 60000, 80000
const shortWait = 4000;                      // Common: 3000, 4000, 5000

const functionalTestOrder = ["givenExecution", "whenExecution", "thenExecution"];

describe("test-name.js", () => {
  it("test-name.js test", () => {
    cy.allure().tag("UUID=xxxxx");  // MUST be unique — see UUID rule below
    cy.allure().owner("XE");
    cy.allure().severity("Normal");
    const toMap = sysTestOrder || functionalTestOrder;
    const sysTestOrderFunctions = toMap.map((funcName) =>
      funcName.includes("systemLevelTestingUtils") ? funcName : eval(funcName)
    );
    executionOrder(sysTestOrderFunctions, permissions);
  });
});

const givenExecution = (nextfunction = () => {}, order) => {
  return createUnitSetup().then((account) => {
    account.testData = {};
    account.testData.someValue = faker.random.words();
    invalidateCacheNew(account.AccountId, true);
    order.setAccount(account);
    nextfunction(order.shift(), order);
  });
};

const whenExecution = (nextfunction = () => {}, order) => {
  const account = order.getAccount();
  // Navigate and perform the business action
  order.setAccount(account);
  nextfunction(order.shift(), order);
};

const thenExecution = (nextfunction = () => {}, order) => {
  const account = order.getAccount();
  // Assert results
  order.setAccount(account);
  nextfunction(order.shift(), order);
};
```

### Execution Rules

| Rule | Detail |
|------|--------|
| `return` | ONLY in `givenExecution`. NEVER in whenExecution or thenExecution. |
| Phase ending | `order.setAccount(account);` then `nextfunction(order.shift(), order);` |
| Data passing | `account.testData = {}` in GIVEN. `order.getAccount()` in subsequent phases. |
| Data init | Initialize ALL `account.testData` values immediately after `account.testData = {}`, before any API/UI calls. |
| UUID | Generate a random 5-char hex string, then **grep the entire buildium-cypress codebase** to confirm no collision before using it. Never use placeholders like `xxxxx` or `a1b2c`. |
| Comments | Phase-level GWT comments in `functionalTestOrder` ONLY. No inline comments inside execution functions. |
| No unused code | Only declare variables (`shortWait`, `forceAction`, `faker`, etc.) if actually used in the test. |
| URLs | Always use `getManagerUrlConstants()` — never hardcode URL paths. |
| File naming | `kebab-case.js` (e.g., `add-listing-and-note-in-unit-summary.js`). |
| Output | Always `.js` AND `.SysTest.json`. |
| Comments | Phase-level only. Self-documenting code. |

### SysTest.json

```json
{
  "sysTestOrder": ["givenExecution", "whenExecution", "thenExecution"],
  "permissions": {
    "givenExecution": { "role": "Manager", "permissions": [{ "name": "doNotChange" }] },
    "whenExecution": { "role": "Manager", "permissions": [{ "name": "doNotChange" }] },
    "thenExecution": { "role": "Manager", "permissions": [{ "name": "doNotChange" }] }
  }
}
```

For multi-phase tests needing login between phases:

```json
{
  "sysTestOrder": [
    "givenExecution",
    "systemLevelTestingUtils.saveAccount",
    "systemLevelTestingUtils.grabAccountAndLogin",
    "whenExecution",
    "thenExecution"
  ]
}
```

---

## 4. Setup Functions — Signatures, Returns, Trigger Mapping

### Chain

```
createAccountSetup() → createBankAccountSetup() → createPropertySetup() → createUnitSetup() → createLeaseSetup()
                                                 → createRentalOwnerSetup()
                     → createAssociationSetup() → createAssociationUnit() → createOwnershipAccountSetup()
```

Each function includes ALL entities from its ancestors.

### Signatures & Returns (Pre-computed — DO NOT search)

| Function | File | Params | Returns on `account` |
|----------|------|--------|---------------------|
| `createAccountSetup` | `create-account.js` | `(options = { loginCounter: 5 })` | `AccountId, ServerName, email, Password, contactFirstName, contactLastName, PrimaryContactId` |
| `createBankAccountSetup` | `create-bank-account.js` | `(billingEnabledOption)` | + `bankAccount: { Id }` |
| `createPropertySetup` | `create-property.js` | `(newPropertyObject, billingEnabledOption)` | + `property: { Id, Name, Address }` |
| `createUnitSetup` | `create-unit.js` | `(newPropertyObject, billingEnabledOption)` | + `unit: { Id, UnitNumber }` |
| `createLeaseSetup` | `create-lease.js` | `(tenantObjects, newPropertyObject, billingEnabledOption)` | + `lease: { LeaseId }` |
| `createLeaseWithEpayEnabled` | `create-lease.js` | `()` | + lease with e-pay provisioned |
| `createRentalOwnerSetup` | `create-rental-owner.js` | `(rentalOwnerDto)` | + `rentalOwner: { Id, ContactId }` |
| `createAssociationSetup` | `create-association.js` | `()` | + `association: { Id, Name }` |
| `createAssociationUnit` | `create-association-unit.js` | `()` | + `associationUnit, association, bankAccount` |
| `createOwnershipAccountSetup` | `create-association-ownership.js` | `(customOwnerObject, chargeDate = null)` | + `ownershipAccount, ownerDetails, association, associationUnit` |

All files in `cypress/e2e/common/test-data-setup/`.

### Trigger → Setup Mapping

| Workflow Trigger | Setup Function | Reason |
|-----------------|---------------|--------|
| Lease renewed / Move-in completed | `createLeaseSetup()` | Needs existing lease |
| Delinquency status | `createOwnershipAccountSetup()` | Needs ownership account |
| Applicant status | `createRentalOwnerSetup()` | Needs property for applicant |
| Create lease / Create rental unit | `createUnitSetup()` | Entity created in WHEN |
| Create rental owner / Create property | `createPropertySetup()` | Entity created in WHEN |
| Rental prospect property request | `createRentalOwnerSetup()` | Needs property for prospect |

**Always verify by reading the action handler in buildiumCode via GitHub MCP.**

**Setup gotcha — `SelectAllPropertiesAsync`**: This query uses `includePropertiesWithNoUnits=null`, which means properties WITHOUT units are EXCLUDED (`AND u.id IS NOT NULL`). If the feature under test calls this query, use `createUnitSetup()` not `createPropertySetup()` — otherwise the property silently won't appear in results.

---

## 5. Import Paths

### Depth Table

| Test File Location | `[DEPTH]` (to `common/`) | `[MGR]` (to `manager/common/`) |
|-------------------|------------------------|-------------------------------|
| `manager/[module]/` | `../../../common/` | `../common/` |
| `manager/[module]/[sub]/` | `../../../../common/` | `../../common/` |
| `manager/[module]/[sub]/[sub2]/` | `../../../../../common/` | `../../../common/` |
| `manager/[module]/[sub]/[sub2]/[sub3]/` | `../../../../../../common/` | `../../../../common/` |

### Standard Import Block

```javascript
const { permissions, sysTestOrder } = require("./TEST-NAME.SysTest.json");
const { executionOrder } = require("[DEPTH]common/system-level-testing/execution-order-new.js");
const { SETUP_FUNCTION } = require("[DEPTH]common/test-data-setup/SETUP-FILE.js");
const { getManagerUrlConstants } = require("[MGR]common/manager-navbar-urls.js");
const { invalidateCacheNew } = require("[DEPTH]common/api/invalidate-cache-new.js");
```

### File Path Table (all relative to `cypress/e2e/`)

| Category | Path |
|----------|------|
| Execution order | `common/system-level-testing/execution-order-new.js` |
| API request (body) | `common/api/api-request-for-data.js` |
| API request (full) | `common/api/create-internal-api-request.js` |
| Cache invalidation | `common/api/invalidate-cache-new.js` |
| Beta features | `common/api/optin-beta-feature.js` |
| Utilities | `common/utilities.js` |
| Financials | `common/financials.js` |
| Constants/enums | `common/constants/` (70+ files) |
| Toast checker | `common/toast-message-checker.js` |
| Setup orchestrators | `common/test-data-setup/` |
| Entity APIs | `common/test-data-setup/api-functions/` (198 files) |
| Form data | `common/form-data/data/user-data.js` |
| Fixtures | `cypress/fixtures/` |
| Manager URLs | `buildiumcode/manager/common/manager-navbar-urls.js` |
| Admin login UI | `common/test-data-setup/ui-functions/admin-login.js` |
| Task handler | `buildiumcode/admin/common/api/runTaskhandler-api.js` |
| Mailing templates | `buildiumcode/manager/communication/common/create-mailing-template-api.js` |

---

## 6. Locator Strategy

### 3-Step Verification Rule (Non-Negotiable)

**Step 1** — Find and **READ THE FULL** HTML template in the CORRECT source repo via GitHub MCP (see §2 Portal-to-Repo Mapping).
- Use `mcp__github-mcp__search_code` to **locate** the file path
- Then use `mcp__github-mcp__get_file_content` to **read the entire template file** — search snippets are NOT sufficient, you MUST read the full file to understand the complete DOM structure, sibling elements, and rendering context
- **NEVER guess selectors from search snippets alone** — snippets show fragments, not the full picture. The full template reveals: element ordering, `ng-if` conditions, parent containers, and how multiple similar elements are distinguished

**Step 2** — Understand DOM rendering:

| Template Element | Rendered As | Selector |
|-----------------|-------------|----------|
| `<bdx-dropdown>` (Angular) | `#bdx-dropdown--N` (0-indexed) | `cy.get("#bdx-dropdown--1")` |
| `<bd-combobox>` (AngularJS) | Selectize plugin transforms the `<select>`: typing input = `#{id}_innerSelectizeInput`, toggle = `.combobox__dropdown-toggle`. Read the **full template** to find the element's `id`, then derive the selectize input ID. | To type: `cy.get("#{id}_innerSelectizeInput")`. To click open: `.combobox__dropdown-toggle`. If multiple comboboxes exist, scope with `.within()` on the parent. |
| `<bdx-drawer>` / `<bdx-modal>` | ID does NOT render | Use CSS class from component template |
| `<bd-dropdown>` (AngularJS) | `#presenterId-dropdown` | `cy.get("#unitsDropdown-dropdown")` |
| `bd-i18n="Key.Path"` | Localized text | `cy.contains("text from en-US.json")` |
| `<bdx-save-bar>` | Conditional | Read `.ts` — auto-save = no bar; manual-save = bar shown |
| `<bd-editable-panel>` (AngularJS) | `<div class="panel non-editable">` (read mode), `<div class="editable-panel-editing">` (edit mode) | Read mode: `cy.get('[class="panel non-editable"]')`. Edit link: `#panelId-edit` (e.g., `#propertyListings-edit`) |
| `bdLocalDate` filter (AngularJS) | Renders dates as `M/D/YYYY` — no leading zeros | `cy.contains("3/5/2026")` NOT `cy.contains("03/05/2026")`. Use `dayjs().format("M/D/YYYY")` for assertions. |

**Step 3** — Cross-validate with existing working test in buildium-cypress. **Source code (Steps 1-2) is the authority.** Existing tests can use fragile/outdated selectors (e.g., xpath on dynamic text when a stable ID exists). If an existing test contradicts what you found in the template, trust the template — the existing test may work by luck or may itself be flaky. Use existing tests to confirm your source-code-derived selector, never as a substitute for Steps 1-2.

**If not found in templates AND no existing test uses it → DO NOT GUESS. Ask the user.**

### Selector Priority

1. `id` → 2. `data-automation` → 3. Unique CSS class → 4. XPath → 5. `cy.contains()`

**NEVER use `.eq(0)` or positional indexing** on non-unique selectors (e.g., `cy.xpath('//span[text()="Add"]').eq(0)`). Always find the unique ID from the HTML template, or scope with `.within()` on the parent container.

### Navigation Recipes

```javascript
// Property Summary
cy.visit(`https://${account.ServerName}${getManagerUrlConstants().rentals.properties}`);
cy.get(".data-grid__cell--quick-menu", extendedTimeout).click();
cy.get("#btn-propertySummary-0").click();

// Tab Navigation (property chrome — applies to ALL property tabs: units, financials, etc.)
// Tabs are gated by ng-if on vm.propertyNavigationTabs (async resolve) — wait for <ul> first
// PATTERN: wait for parent container that gates rendering → then click the specific tab
cy.get("#tabbedNav ul", extendedTimeout).should("exist");
cy.get("#TAB_ID").should("be.visible").find("a").click();  // e.g., #units_tab_id, #financials_tab_id
// From Units Grid: cy.get(".quick-menu-icon", extendedTimeout).click(); cy.get("#btn-propertyUnits-0").click();

// Tenant Summary
cy.visit(`https://${account.ServerName}${getManagerUrlConstants().rentals.tenants}`);
cy.get(".quick-menu-icon", extendedTimeout).click();
cy.get("#btn-tenantSummary-0").click();

// Ownership Account Summary
cy.visit(`https://${account.ServerName}${getManagerUrlConstants().associations.ownershipAccounts}`);
cy.get(".quick-menu-icon", extendedTimeout).click();
cy.get("#btn-ownershipAccountSummary-0").click();

// Lease Renewals
cy.visit(`https://${account.ServerName}${getManagerUrlConstants().leasing.leaseRenewals}`);
cy.get(".quick-menu-icon", extendedTimeout).click();

// Workflows Settings
cy.visit(`https://${account.ServerName}${getManagerUrlConstants().settings.workflows}`);
```

### Common UI Patterns

```javascript
// Grid Quick Menu (open action menu on a grid row)
cy.get(".data-grid__cell--quick-menu", extendedTimeout).click();  // or ".quick-menu-icon"
cy.get("#btn-ACTION-0").click();  // e.g., #btn-propertySummary-0, #btn-tenantSummary-0

// Tab Navigation (wait for parent container gated by async resolve, then click tab)
cy.get("#tabbedNav ul", extendedTimeout).should("exist");
cy.get("#TAB_ID").should("be.visible").find("a").click();  // e.g., #units_tab_id, #financials_tab_id

// Standard click
cy.get("#element", extendedTimeout).should("be.visible").click(forceAction);

// Scoped assertion (ambiguous text)
cy.get(".specific-container-class", extendedTimeout).within(() => {
  cy.contains("Ambiguous Text").should("exist");
});

// Dropdown (bdx-selectize)
cy.get("#dropdown_innerSelectizeInput").type("Option{enter}", forceAction);

// Listing Information (Unit)
cy.get("#propertyListings-edit", extendedTimeout).click();
cy.get("#size", { timeout: 15000 }).should("be.visible").clear().type("2000");
cy.get("#ddlBedType_innerSelectizeInput").type("4 Bed{enter}", forceAction);
cy.get("#ddlBathtype_innerSelectizeInput").type("3 Bath{enter}", forceAction);
cy.get(".col-sm-8 > .form-element__input").clear().type("Description text");
cy.get("#marketRent").clear().type("$100.00");
cy.get("#btnSaveListings").click();

// Post-Action Redirects (know WHERE you land after form submit — read the controller source)
// Many "Create" buttons redirect to the entity summary page, NOT back to the grid.
// Read the controller's submit function to find $state.go() / router.navigate() / window.location calls.
// Your THEN assertions must target the DESTINATION page's elements, not the source page's.
// Example: after creating an entity, the summary page may show bd-editable-panel (renders as "panel non-editable")
//          — assert within that panel, not within a grid that's no longer rendered.

// File upload
cy.get("#file-input", extendedTimeout).attachFile({ filePath: "file.pdf", mimeType: "application/pdf", encoding: "binary" });

// Iframe (rich text editor)
cy.iframe().find("body").type("Content");

// Notes: Add
cy.get("#btn-addNoteToEntity", extendedTimeout).click();
cy.get("#noteInput").type(noteText);
cy.get(".modal__dialog-container").within(() => { cy.get('button[type="button"]').click(); });
// Notes: Edit → .quick-menu-icon → #btn-notesEdit-0 → #noteInput → .modal__dialog-container button
// Notes: Delete → .quick-menu-icon → #btn-notesDelete-0
```

---

## 7. Helpers & API Reference (Pre-computed — DO NOT search for these)

### 7.1 Cross-Module Helpers — Exact Signatures

```javascript
// Admin Login — no params, no return, full OAuth flow
const { adminLoginUI } = require("[DEPTH]common/test-data-setup/ui-functions/admin-login.js");

// Task Handler — takes OBJECT: { AccountId, TaskHandlerId, Description, Args, TimeoutInSeconds }
const { runTaskHandler } = require("../../../admin/common/api/runTaskhandler-api.js");

// Cache Invalidation — invalidateCacheNew(accountId, true)
const { invalidateCacheNew } = require("[DEPTH]common/api/invalidate-cache-new.js");

// Beta Features — (betaFeatureFlagKeyArray, accountId, serverName, force = false)
const { optinBetaFeatureWithCacheInvalidation } = require("[DEPTH]common/api/optin-beta-feature.js");

// Manager URLs — returns nested object (see §7.5 for key paths)
const { getManagerUrlConstants } = require("[MGR]common/manager-navbar-urls.js");

// Mailing Templates
const { createMailingTemplate, getDefaultMailingTemplate, getRecipientTypes } = require("../../communication/common/create-mailing-template-api.js");
// getRecipientTypes() → PLAIN OBJECT (NOT promise):
//   { Tenants:"1", AssociationOwners:"2", RentalOwners:"4", Vendors:"8", Managers:"16",
//     BoardMembers:"32", Applicants:"64", Cosigners:"128", PrimaryContacts:"256",
//     AssociationTenants:"512", ResidentOwners:"1024", Others:"2048" }
// getDefaultMailingTemplate(templateName, recipientType, subject) → plain object
// createMailingTemplate(template) → call DIRECTLY, no .then()

// Utilities
const utilities = require("[DEPTH]common/utilities.js");
// .generateRandomkey() → 6-char string | .generateRandomWholeNumber(min,max) → int
// .generateRandomNumber(min,max,precision) → float | .generateRandomStringOfNumberByLength(length) → string of digits
// .generateRandomAccountNumber() → 8-digit string starting with "2" | .routingNumber() → "321174851"
// .getEnumNameFromValue(enum,val) → string|null

// Currency
const financials = require("[DEPTH]common/financials.js");
// financials.formatToUSCurrency(number) → "$100.00"

// Toast checker
const { checkToastMessage } = require("[DEPTH]common/toast-message-checker.js");
```

### 7.2 Workflow Helpers — Exact Signatures

```javascript
const workFlowsTestDataUI = require("./common/workflows-test-data.js");

// addEmailStep(stepName, stepDetails, recipient, mailingTemplate, recipentExist = false) — #btn-addStep-1
// addTaskStep(stepName, stepDetails, taskSubject, taskDescription, assignedTo) — #btn-addStep-2
//   assignedTo: `${account.contactFirstName} ${account.contactLastName}`, auto-selects "Maintenance Request">"Appliances"
// addTextMessageStep(stepName, stepDetails, recipient, textMessageContent, recipentExist = false) — #btn-addStep-4
// addProjectStep(stepName, stepDetails) — #btn-addStep-5
// workflowEventName(workflowName, workflowDescription) — clicks Edit, types name+desc, saves
// publishWorkflow(workflowName) — clicks Publish, confirms, verifies toast+name
```

### 7.3 Core API Modules

```javascript
const { apiRequestForData } = require("[DEPTH]common/api/api-request-for-data.js");     // returns body
const { createInternalApiRequest } = require("[DEPTH]common/api/create-internal-api-request.js"); // returns full response
const { apiRequestDataFromAdmin } = require("[DEPTH]common/api/api-request-for-data.js"); // admin API
```

### 7.4 API Functions Directory Index (198 files)

**Create**: `create-applicant-api`, `create-applicant-group-api`, `create-charge-api`, `create-cosigners-api`, `create-draft-lease-api`, `create-glaccount-api`, `create-lease-api`, `create-listed-unit`, `create-property-api`, `create-prospect-api`, `create-rental-owner-api`, `create-unit-api`, `create-user-api`, `create-vendor-api`, `create-work-order-api`, `create-staff-calendar-event-api`

**Get**: `get-applicant-api`, `get-lease-api`, `get-lease-renewal-api`, `get-tenant-details-from-lease-api`, `get-rental-owner-details-api`, `get-unit-details-api`, `get-properties-list`, `get-email-log-id-api`, `get-emails-details-api`

**Update**: `update-applicant-status-api`, `update-property-api`, `update-tenant-info`, `update-unit-api`, `update-user-api`

**Financial**: `enter-charge-for-lease-api`, `receive-payment-api`, `create-payment`, `record-check-api`, `pay-bill-api`

**Auth**: `account-apis` (updateAccountInfoApi, getAccountInfo), `resident-login`, `applicant-center-login`

All in `cypress/e2e/common/test-data-setup/api-functions/`. For unlisted functions, search that directory.

Key API function signatures:

| File | Functions |
|------|----------|
| `create-unit-api.js` | `createUnitApi(dto)`, `generateUnitDTO(propertyId)` |
| `create-lease-api.js` | `createLease(dto)`, `getDefaultLease(propId, unitId, tenantDto)`, `addNewTenant(email, first, last)`, `addTenants(n)` |
| `create-property-api.js` | `createProperty(bankAccountId, propObj)` |
| `create-rental-owner-api.js` | `createRentalOwnerApi(dto)`, `generateRentalOwnerDTO(propIds, first, last)` |
| `add-notes-api.js` | `createNote(dto)`, `generateNoteDTO(entityId, entityTypeId, details)` |
| `create-listed-unit.js` | `createListing(payload)`, `generateListingObject(propId, unitId)` |
| `account-apis.js` | `updateAccountInfoApi(dto)`, `getAccountInfo()` |

### 7.5 Top URL Constants

| Constant | Path |
|----------|------|
| `.homepage` | `/manager/app/homepage/dashboard` |
| `.rentals.properties` | `/manager/app/properties` |
| `.rentals.tenants` | `/manager/app/tenants` |
| `.rentals.rentalOwners` | `/manager/app/rentalowners` |
| `.rentals.rentRoll` | `/manager/app/properties/rentroll` |
| `.leasing.applicants` | `/manager/app/leasing/applicants` |
| `.leasing.leaseRenewals` | `/manager/app/renewals/list` |
| `.associations.ownershipAccounts` | `/manager/app/associations/ownership-accounts` |
| `.communication.emails` | `/manager/app/communication/emails/list` |
| `.tasks.allTasks` | `/manager/app/tasks/list?searchOption=all` |
| `.tasks.allProjects` | `/manager/app/projects/in-progress` |
| `.settings.workflows` | `/manager/app/workflows/settings` |
| `.settings.applicationSettings` | `/manager/app/settings/appSettings` |
| `.maintenance.workOrders` | `/manager/app/maintenance/vendors/work-orders` |
| `.accounting.bills` | `/manager/app/accounting/bills` |
| `.accounting.banking` | `/manager/app/banking` |
| `.leasing.eLeaseAndDraftLeases` | `/manager/app/draft-leases/leases` |
| `.leasing.prospect` | `/manager/app/rentalprospects/prospects` |
| `.associations.associations` | `/manager/app/associations` |
| `.communication.mailings` | `/manager/app/communication/mailings` |

### 7.6 Module Helpers (search BEFORE writing inline code)

| Module | Location | Key Functions |
|--------|----------|---------------|
| Workflows | `manager/settings/workflows/common/workflows-test-data.js` | See §7.2 |
| Communication | `manager/communication/common/` | `createMailingTemplate`, `getDefaultMailingTemplate`, `getRecipientTypes` |
| Leasing | `manager/leasing/common/` | `attachTenant`, `completeRentalAppUi` |
| Tasks | `manager/tasks/common/` | `getTaskInfo` |
| Associations | `manager/associations/common/` | `createAssociationWithUnit` |
| Projects | `manager/tasks/all-projects/project-common/` | `addProjectTemplate`, `addProjectTemplateTask` |

### 7.7 API Function Creation — When GIVEN Needs Missing Data

**When to create**: The GIVEN phase needs to set up data (e.g., a vendor, a work order, a charge, a note) but no existing API function in `api-functions/` handles it.

**Step 1 — Confirm the gap**: Search `cypress/e2e/common/test-data-setup/api-functions/` for any file that already handles the entity. Check §7.4 index first. If found, use the existing one.

**Step 2 — Find the API endpoint**: Search buildiumCode backend via GitHub MCP (use `ref='test'` on every `get_file_content` call, `ref='master'` only for `buildium.resident`):
- Search controller routes: `mcp__github-mcp__search_code` with `query="[EntityName] repo:buildium/buildiumcode path:Manager"` to find the API controller
- Read the controller to find the POST/PUT endpoint URL and expected DTO shape
- Read the DTO class to understand all fields, required vs optional

**Step 3 — Create the API function file** in `cypress/e2e/common/test-data-setup/api-functions/` following this exact pattern:

```javascript
const { apiRequestForData } = require("../../api/api-request-for-data.js");

/**
 * Build the DTO for [entity description].
 * @param {type} param1 description
 * @param {type} param2 description
 */
function generateEntityNameDTO(param1, param2) {
  const entityDTO = {
    RequiredField1: param1,
    RequiredField2: param2,
    // Only include fields that the API requires or that the test needs to control
  };
  return entityDTO;
}

/**
 * Create a [entity] via API.
 * @param {object} entityDTO entity details
 */
function createEntityName(entityDTO) {
  return apiRequestForData("POST", `/manager/api/[endpoint]`, entityDTO, 201);
}

module.exports = { generateEntityNameDTO, createEntityName };
```

**Rules for API function creation:**
1. **Two functions per entity**: DTO builder (`generate*DTO` or `set*`) + API caller (`create*` or `add*`)
2. **DTO builder takes parameters** — expose only fields the test needs to control. Use `faker` for defaults when the caller doesn't care about specific values
3. **API caller returns the `apiRequestForData` promise** — callers chain with `.then()` in givenExecution
4. **Endpoint URL from source** — read the actual controller route from buildiumCode, never guess
5. **Success code from source** — typically `201` for POST (create), `200` for PUT (update). Verify from the controller
6. **File naming**: `kebab-case.js` matching the pattern `[action]-[entity]-api.js` (e.g., `create-vendor-api.js`, `add-work-order-api.js`)
7. **No hardcoded test data** — use `faker` for names, emails, descriptions. Accept IDs (accountId, propertyId, etc.) as parameters since those come from the setup chain
8. **Headers only when needed** — only add custom headers (e.g., feature flags) if the API endpoint requires them. Follow the `addStaffAvailability` pattern for header usage
9. **Require path**: Always `require("../../api/api-request-for-data.js")` — this is the standard relative path from `api-functions/` to the API module

**Calling in givenExecution:**
```javascript
const { generateEntityDTO, createEntity } = require("[DEPTH]common/test-data-setup/api-functions/create-entity-api.js");

const givenExecution = (nextfunction = () => {}, order) => {
  return createUnitSetup().then((account) => {
    account.testData = {};
    const entityDto = generateEntityDTO(account.property.Id, faker.name.firstName());
    createEntity(entityDto).then((entity) => {
      account.testData.entityId = entity.Id;
      invalidateCacheNew(account.AccountId, true);
      order.setAccount(account);
      nextfunction(order.shift(), order);
    });
  });
};
```

**Output**: When creating a new API function file, deliver it alongside the test `.js` and `.SysTest.json` — three files total.

---

## 8. Data Generation

```javascript
const faker = require("faker");
const dayjs = require("dayjs");

faker.random.words(3)                                   // random text
faker.random.alphaNumeric(4)                            // "a3b9"
faker.name.firstName() / faker.name.lastName()          // names
faker.internet.exampleEmail(first, key)                 // email
dayjs().add(100, "days").format("M/D/YYYY")             // future date
dayjs().format("YYYY-MM-DD")                            // today

// entityTypeEnum values
entityTypeEnum.Property     // 2
entityTypeEnum.RentalUnit   // 3
entityTypeEnum.Lease        // 4
entityTypeEnum.Tenant       // 5
entityTypeEnum.Listing      // 8
```

---

## 9. Feature-Specific Verification (Non-Negotiable)

**What to verify from buildiumCode source for each feature:**
- Which **workflow step types** are supported (check `UnsupportedStepTypes` in `WorkflowsSettingsService.cs`)
- Which **recipients** are available for the trigger context
- Which **entities** exist in scope when the trigger fires
- Which **side effects** occur (emails, tasks, notifications, status changes)
- Which **UI elements** are rendered for this feature
- Which **API parameters** the endpoint accepts

**What to verify for every helper function call:**
- Read the helper's **source code** to understand signature and behavior
- Understand **system state** at the call site in THIS test
- Parameters depending on sequence/state must be derived from THIS test's flow

**Known workflow step exclusions:**

| Trigger | Unsupported Step |
|---------|-----------------|
| General rental application submitted | `CreateProjectFromTemplate` |
| Create new rental owner | `CreateProjectFromTemplate` |
| Inactivate property | `CreateProjectFromTemplate` |

Runtime failure: *"The draft workflow contains a step type that is not supported for the selected starting event."*

---

## 10. Common Mistakes

| Mistake | Correction |
|---------|-----------|
| Placeholder code (`create[Entity]Api()`, `#someButton`) | Search codebase for exact names |
| Wrong setup function | Match to entities needed (§4) |
| `return` in when/thenExecution | `return` ONLY in givenExecution |
| `getRecipientTypes()` as promise | Plain object: `getRecipientTypes().Tenants` |
| `.then()` on `createMailingTemplate()` | Call directly |
| Hardcoded URLs | Use `getManagerUrlConstants()` |
| No timeout on slow elements | `cy.get("#el", extendedTimeout)` |
| Missing "Add" click before workflow step | `cy.xpath("//span[contains(text(),'Add')]").last().click(forceAction)` |
| Unscoped `cy.contains()` | `.within()` on unique parent |
| `bdx-drawer`/`bdx-modal` ID in `cy.get()` | IDs don't render — use CSS classes |
| `#bdx-dropdown--N` wrong count | Count position on page (0-indexed) |
| `bd-combobox` ID directly | Renders as `.combobox__dropdown-toggle` |
| `bd-dropdown` ID directly | Renders as `#presenterId-dropdown` |
| Guessing locator | 3-step rule: template → rendering → cross-validate |
| Assuming text without resource files | Check `en-US.json` |
| Assuming behavior from similar test | Every feature has its own rules — verify from source (§9) |
| Copying helper args from another test | Read helper source, understand system state in THIS test |
| Unsupported workflow step | Check `UnsupportedStepTypes` for specific trigger (§9) |
| GIVEN needs data but no API function exists | Search `api-functions/`, if missing → create it per §7.7 (find endpoint in buildiumCode, create file, then call it) |
| Hardcoded values in new API function DTO | Use `faker` for names/emails/descriptions; accept IDs as params |
| Guessed API endpoint in new function | Read the actual controller route from buildiumCode via GitHub MCP |
| Used `search_code` snippets to derive selectors without reading the full template | Search snippets show fragments, not the full DOM structure — you miss element ordering, parent containers, `ng-if` conditions, and sibling elements. Always call `get_file_content` to read the FULL template file after locating it with `search_code`. |
| `cy.wait(N)` before interacting with page | Read controller to find the `ng-if`/resolve gate → wait for the parent element: `cy.get("#parentEl", { timeout: 30000 }).should("exist")` |
| XPath on dynamic text (`//a[text()="Tab (0)"]`) | Text changes with data; use stable ID from source template: `cy.get("#tab_id").find("a").click()` |
| Default 15s timeout on fresh account page load | Fresh accounts = no cache = slow resolves; read controller async lifecycle, use 30s: `cy.get("#el", { timeout: 30000 })` |
| Healing with `contains(text(),"...")` without reading source | Read HTML template → find exact ID/class → use that. Every heal must be traceable to source code |
| Asserting on source page after form submit redirect | Read the controller's submit function to find where it redirects → assert on the destination page's elements |

---

## 11. Quick-Start Patterns

### Property / Unit CRUD
```
Setup:  createUnitSetup()
Nav:    properties grid → .data-grid__cell--quick-menu → #btn-propertySummary-0 → #units_tab_id → .quick-menu-icon → #btn-propertyUnits-0
URL:    getManagerUrlConstants().rentals.properties
```

### Lease / Tenant
```
Setup:  createLeaseSetup()
Nav:    rent roll or tenants grid → quick-menu → lease/tenant summary
URL:    getManagerUrlConstants().rentals.rentRoll  OR  .rentals.tenants
```

### Association / Ownership Account
```
Setup:  createOwnershipAccountSetup()
Nav:    ownership accounts grid → quick-menu → ownership account summary
URL:    getManagerUrlConstants().associations.ownershipAccounts
```

### Workflow (Trigger / Side-Effect)
```
Setup:  Varies by trigger (see §4 Trigger Mapping)
Nav:    workflows settings → create workflow → builder UI
URL:    getManagerUrlConstants().settings.workflows
```

---

## 12. Repository Structure

```
cypress/e2e/
  buildiumcode/                       # Tests by portal
    manager/ (24+ modules)            # accounting/ associations/ communication/ leasing/
                                      # maintenance/ rentals/ settings/ tasks/ ...
      common/                         # manager-navbar-urls.js, permission-function-id-constants.js
    admin/ resident/ applicant-center/ board-member/ public-api/
  common/
    api/                              # api-request-for-data.js, invalidate-cache-new.js, optin-beta-feature.js
    constants/                        # 70+ enum files
    test-data-setup/                  # Setup orchestrators + api-functions/ (198 files)
    system-level-testing/             # execution-order-new.js
```

**Config**: Viewport 1920×1080, Retries 2, Default timeout 15s, Response timeout 600s, Plugins: cypress-xpath, cypress-file-upload, cypress-iframe-plugin, cypress-allure-plugin

---

## 13. Test Execution & Healing

After generating and validating a test, **run it, fix failures using the full playbook, and confirm with two consecutive passes**. Never deliver an unexecuted test.

### 13.1 Execution — Run the Test

```bash
# Wrapper script — ELECTRON_RUN_AS_NODE must be unset (VS Code sets it)
#!/bin/bash
unset ELECTRON_RUN_AS_NODE
cd ~/mixeduse-cypress-local-dev/buildium-cypress
npx cypress run --config-file cypress/cypress.config.js --browser chrome --headed \
  --config retries=0 \
  --spec "cypress/e2e/buildiumcode/[portal]/[module]/[test-name].js" \
  > /tmp/cy-test.log 2>&1
```

**Open live viewer** — before starting the test, open the noVNC viewer so the user can watch live execution:
```bash
cmd.exe /c start chrome --incognito "http://localhost:1234/IQE/vnc.html?autoconnect=true" 2>/dev/null
```

**Monitoring pattern** — run the script in background and watch for failure screenshots.
**MANDATORY**: Always use this exact loop in a **single Bash tool call** (script + monitoring together). NEVER split into separate calls (e.g., `run_in_background` for the test, then `sleep 60` in another call to check). That wastes time, misses failures, and loses the reactive loop.
```bash
/tmp/run-cy-test.sh &
PID=$!
while true; do
  screenshot=$(find cypress/screenshots -name "*.png" -newer /tmp/run-cy-test.sh 2>/dev/null | head -1)
  if [ -n "$screenshot" ]; then echo "FAILED: $screenshot"; kill $PID 2>/dev/null; break; fi
  if ! kill -0 $PID 2>/dev/null; then echo "Process finished"; break; fi
  sleep 5
done
tail -30 /tmp/cy-test.log
```

**Execution rules — every flag is mandatory, no exceptions:**
- `unset ELECTRON_RUN_AS_NODE` — **MUST be first line** in the wrapper script. VS Code sets this env var which breaks Cypress child processes. Without it, Cypress exits silently with no output.
- `cd ~/mixeduse-cypress-local-dev/buildium-cypress` — run from the **repo root**, NOT from `cypress/` subdirectory — `specPattern: "cypress/e2e/**/*.js"` is relative to root
- `--config-file cypress/cypress.config.js` — **MUST be specified**. The config file lives inside `cypress/`, not at repo root. Without it, Cypress can't find the config and fails silently.
- `--browser chrome --headed` — **NEVER use `--headless`**. Tests require a visible browser for UI interactions.
- `--spec` path starts with `cypress/e2e/` — relative to repo root, matching the `specPattern`
- Use `--config retries=0` during healing — retries waste time when the failure is deterministic; re-enable retries only for the final passing run
- `cypress.env.json` must exist at **repo root** (copy from `cypress/cypress.env.json` if missing) — without it, `Cypress.env("DOMAIN")` is `undefined` and all URLs resolve to `signin.undefined`
- `/cypress/cypress/screenshots/` directory must exist and be writable — the `support/e2e.js` afterAll hook writes metadata there (Docker path; create locally via `mkdir -p /cypress/cypress/screenshots`)

**NEVER do any of these — they all cause silent failures:**
- `npx cypress run --spec ...` without `--config-file` → Cypress can't find config, exits with no output
- `--headless` → UI interactions fail silently
- Running from `cypress/` subdirectory → spec paths don't resolve
- Forgetting `unset ELECTRON_RUN_AS_NODE` → Cypress exits immediately with exit code 1 and no output
- Using `node -e "require('cypress').run(...)"` → bypasses the wrapper script and all required flags
- Declaring "Docker needed" or "infrastructure issue" when the command fails → the command is wrong, not the environment. Use the exact command from this section.

**Environment prerequisite — VPN must be connected:**
- The QMS service hostname (`qms_v2.buildiumstaging.io`) resolves through the **corporate VPN DNS**, not public DNS.
- If Cypress fails with `getaddrinfo ENOTFOUND qms_v2.buildiumstaging.io` → VPN is disconnected. Ask the user to connect VPN, then re-run.
- Do NOT add entries to `/etc/hosts`, do NOT declare "infrastructure issue", do NOT retry with `sleep` — just check VPN.

### 13.2 Detect and Read Failure

Monitor two sources simultaneously:

**Screenshot** (primary diagnostic):
- Watch `cypress/screenshots/[test-name].js/` for new `.png` files
- Cypress captures a screenshot at the exact moment of failure
- **Read it programmatically**: use the `Read` tool on the `.png` file path — the image renders visually

**How to read the screenshot — two halves:**
- **Right side (browser)**: Shows the page URL (address bar), the page content, any open modals/drawers. This tells you WHERE the test was when it failed.
- **Left sidebar (Cypress command log)**: Shows every command that ran. Green checkmarks = passed. The **last red entry** = the failing command. Read the red command name and its arguments to identify WHAT failed.

**Stdout log** (secondary diagnostic):
- Capture output to a log file: `> /tmp/cy-test.log 2>&1`
- Contains: spec found/not found, test duration, pass/fail count, error message text
- `Duration: 0 seconds` + `Skipped: 1` = test never executed (environment issue, not a test bug — see §13.3)
- `Screenshots: 0` + `Passing: 1` = test passed
- `Screenshots: N` + `Failing: 1` = test failed N times (1 per attempt if retries enabled)

**When a screenshot appears → stop the test** (`kill $PID`). Do NOT wait for retries. Read the screenshot immediately.

**Distinguish test failure from afterAll hook failure:**
- Screenshot named `[test-name] (failed).png` = test body failed → fix the test
- Screenshot named `[test-name] test -- after all hook (failed).png` OR the Cypress command log shows `after all` with the red error = afterAll in `support/e2e.js` failed → the **test logic itself PASSED** but the post-test metadata hook failed
- The afterAll hook calls `qms_v2.buildiumstaging.io:1234/h2m/pingMQTT` to report test metadata. If QMS is unreachable (VPN disconnected), the hook fails with `ENOTFOUND` and Cypress marks the entire run as failed even though all assertions passed.
- **Action**: Ask the user to connect VPN, then re-run. Do NOT enter the HEAL loop — the test code is correct.
- Check the log: if `Passing: 0, Failing: 1` but the left sidebar shows all Given/When/Then steps green and only the `after all` entry is red, the test logic passed — fix the environment (VPN), not the test

**Infrastructure validation** — if the test shows unexpected behavior (skipped in 0s, no output, login page redirect, immediate exit):
1. Run a known passing test from the same module to verify Cypress itself works
2. If the known test also fails → environment issue (QMS, login service, missing env vars, Cypress binary, display)
3. If the known test passes → the issue is in YOUR test code specifically
4. **Environment issues can be intermittent** — do NOT stop and wait for the user. Retry after 2-3 minutes automatically. Only escalate after 3 consecutive failed attempts across different runs.

### 13.3 Diagnose — Failure Classification

Read the failure screenshot and classify into exactly one of these categories:

| Category | What the screenshot shows | Where to look for root cause |
|----------|--------------------------|------------------------------|
| **Spec not found** | No screenshot — log says `Can't run because no spec files were found` | Running from wrong directory. Must run from **repo root** with `--config-file cypress/cypress.config.js`. The `--spec` path must match `specPattern` relative to repo root (e.g., `cypress/e2e/buildiumcode/...`). |
| **Navigation failure** | Wrong URL in address bar (e.g., `signin.undefined`, blank page) | Environment config: `cypress.env.json` missing or `DOMAIN` not set. Check `Cypress.env()` values. |
| **Element not found** | Correct page loaded, but the red command shows `cy.get()` or `cy.contains()` timed out | Selector is wrong: read the HTML template from the CORRECT source repo — template is the authority (§2, §6). Cross-validate with existing test, but if they conflict, trust the template. |
| **Page loaded but data missing** | Correct page, correct selectors, but the content is absent (e.g., empty grid, "No results found") | 1. **Feature flag missing** — compare with working tests for the same feature; check what flags they enable. 2. **Task handler not run** — async operations (emails, workflows) need `runTaskHandler()` after the triggering action. 3. **Timing** — data hasn't been indexed yet; add targeted `cy.wait()` or `cy.reload()`. |
| **Modal/overlay conflict** | A modal or overlay is blocking the target element; selector matches multiple elements | Scope with `.within()` on the modal container, or use a more specific selector. Compare with existing tests that interact with the same modal. |
| **API call failed** | The command log shows a `cy.request()` in red, or the page shows an error response | Read the backend controller (via GitHub MCP) to understand: expected DTO shape, required headers, success status code. Check if `cy.request()` supports the payload format (e.g., `FormData` is NOT supported by `cy.request()`). |
| **Backend limitation** | API returns 200 but the expected side effect doesn't happen (e.g., attachment not saved, status not changed) | Read the backend service code to trace the full execution path. The API may silently ignore fields (e.g., `[FromForm]` binding missing, property not mapped). This is NOT a test bug — document the limitation. |

### 13.4 Heal — Fix Using the Full Playbook

**Non-negotiable rule: every fix must be traceable to code you read, not to a guess.**

**Healing IS the playbook** — a fix is not a one-line patch. Apply the same rigor as the original GENERATE phase:

| Failure type | Playbook sections to apply |
|---|---|
| Wrong/missing locator | §2 (source repo mapping) → §6 (3-step verification: template → DOM rendering → cross-validate) |
| Setup data missing | §4 (setup function signatures, trigger mapping) → §7.4 (API index) → §7.7 (create missing API) |
| Import broken | §5 (depth table, standard import block) |
| Timing / element not found on fresh account | §6 (DOM rendering, `ng-if` gates) + read controller source via §2 |
| Feature behavior wrong | §9 (per-feature constraints, workflow exclusions) |
| Unknown error | §10 (common mistakes table) → §11 (quick-start patterns for reference) |

After fixing, re-run the §1.4 validation checklist before re-executing.

**Expect sequential failures**: Each fix advances the test further. The first failure may be at login, the second at compose, the third at verify. Each iteration reveals a NEW failure type — do not assume one fix will make the whole test pass.

**Feature flag discovery**: When a page loads correctly but shows empty/disabled content, find an existing PASSING test for the same feature (search by module path or feature keyword). Compare their `givenExecution` for `optinBetaFeatureWithCacheInvalidation()` calls — replicate the exact same flags. Never guess flag names.

For each failure category, follow the specific healing procedure:

**Navigation failure:**
1. Check `cypress.env.json` exists at repo root with `DOMAIN` set
2. Check the setup function returns `account.ServerName` — read the setup function source
3. Check URL construction uses `getManagerUrlConstants()` — never hardcoded paths

**Element not found:**
1. Read the HTML template from the correct source repo via GitHub MCP (§2 Portal-to-Repo Mapping)
2. Understand DOM rendering rules (§6) — `bdx-dropdown` renders as `#bdx-dropdown--{id}`, `bdx-drawer` IDs don't render, etc.
3. Find an existing passing test that interacts with the same element — replicate its exact selector
4. If the selector matches multiple elements, scope with `.within()` on a unique parent
5. Check if a **guard assertion** is needed before the failing command — e.g., combobox dropdowns require `.contains("Select a recipient category")` to confirm the panel rendered before typing into it. Compare with the working helper or test that does the same interaction.
6. **Fresh account timing** — Read the controller/component source to understand what gates rendering (route resolves, `AppState.connect()`, `ng-if` on async data). On fresh accounts, resolves are slower because there's no cached data. Wait for the parent container to exist before targeting child elements:
   - Pattern: identify the `ng-if` or resolve that gates your target element → wait for a parent that only renders after that async completes → then interact with the child
   - Example: tab navigation gated by `ng-if="vm.tabs && vm.tabs.length"` → `cy.get("#tabbedNav ul", { timeout: 30000 }).should("exist")` before clicking any tab
   - Example: grid gated by data load → `cy.get(".data-grid__body", { timeout: 30000 }).should("exist")` before asserting row content
   - Example: form panel gated by entity fetch → `cy.get("#panelId", { timeout: 30000 }).should("exist")` before interacting with form fields
   - Never use `cy.wait(N)` as a substitute — it masks the real timing issue and is unreliable across environments

**Page loaded but data missing:**
1. **Verify the setup function created the right entities** — check §4 Trigger → Setup Mapping. Wrong setup = missing data (e.g., `createUnitSetup()` has no tenant, `createPropertySetup()` has no unit). Read the setup function's return values and confirm each entity the test needs is present on `account`.
2. Check if the existing working test for this feature enables feature flags — add the same `optinBetaFeatureWithCacheInvalidation()` call
3. Check if async processing is needed — add `runTaskHandler()` after actions that trigger background jobs (emails need TaskHandlerId `"10"`, workflows need their own handlers)
4. Add `cy.wait()` + `cy.reload()` only AFTER confirming the data should exist — waits are a last resort, not a first fix

**Modal/overlay conflict:**
1. Read the modal component template to find a unique container selector
2. Use `.within()` or scope the click to the specific modal: `cy.get("mat-dialog-container").within(() => { ... })`
3. Check the existing test (`compose-attachements-email-with-access-to-files.js` etc.) for the exact interaction pattern

**API call failed:**
1. Read the controller via GitHub MCP to find: route, `[FromForm]`/`[FromBody]` binding, DTO shape, success status code
2. Read the `createApiRequest` function to understand how it sends the payload — it handles `FormData` detection (line 21–23, 47–49) but `cy.request()` does NOT actually support `FormData` as a body
3. If the API needs `FormData` (multipart file upload), use `cy.window().then(win => win.fetch(...))` from the browser context instead of `cy.request()`
4. If the backend silently ignores the payload (e.g., `[FromForm]` attribute missing on a property), this is a backend limitation — document it and adjust the test scope

**Backend limitation:**
1. Confirm by reading the full backend path: Controller → Service → Manager → Entity
2. Document the limitation in the test file as a comment in `functionalTestOrder`
3. Adjust assertions to verify only what the backend actually supports
4. Do NOT hack around backend limitations with retries or waits — the data will never appear

### 13.5 Re-run After Healing

After applying a fix:
1. Delete old screenshots: `rm -rf cypress/screenshots/[test-name].js/`
2. Run again with `--config retries=0` using the monitoring pattern (§13.1) — react to screenshots immediately, do NOT wait blindly with `sleep`
3. If it fails again, go back to §13.3 — the new failure may be a different category than the first
4. Once the test passes with `retries=0`, **run it a second time with `retries=0`** to confirm stability — a single pass is NOT sufficient (flaky tests can pass once due to timing). Only proceed to step 5 after two consecutive passes.
5. Do a **final confirmation run** with default retries to ensure stability:

```bash
# Final confirmation — remove --config retries=0 to use default retries (2)
unset ELECTRON_RUN_AS_NODE
cd ~/mixeduse-cypress-local-dev/buildium-cypress
npx cypress run --config-file cypress/cypress.config.js --browser chrome --headed \
  --spec "cypress/e2e/buildiumcode/[portal]/[module]/[test-name].js"
```

6. Only deliver when the final confirmation shows `Passing: 1, Failing: 0`

### 13.6 Healing Anti-Patterns (Never Do These)

| Anti-Pattern | Why it fails | Correct approach |
|-------------|-------------|------------------|
| Retry the same test without reading the screenshot | The same failure repeats indefinitely | Read screenshot → classify → fix from source code |
| Add `cy.wait(30000)` without confirming the data will eventually appear | The data may never appear (backend limitation, missing flag) | Verify the feature works by reading backend code first |
| Guess a selector because the screenshot "looks like" it should work | DOM rendering transforms element IDs (§6) | Read the HTML template and apply DOM rendering rules |
| Copy a fix from a different module's test | Each feature has unique constraints, flags, and timing | Read the source code for THIS specific feature |
| Blame flakiness and add `.should("exist")` guards everywhere | Masks real bugs in the test or environment setup | Find and fix the root cause |
| Let Cypress retry 3 times before investigating | Wastes 3x the execution time on deterministic failures | Use `retries=0` during healing, read the first failure immediately |
| Fix the test when only the afterAll hook failed | The test logic passed — the afterAll failure is an environment issue | Check screenshot filename: `after all hook (failed)` = environment, not test code |
| Skip infrastructure validation when test shows 0s/skipped | Wastes iterations debugging test code when the runner itself is broken | Run a known passing test first to isolate environment vs test issues |
| Heal with generic selectors (`contains(text(),"...")` instead of the actual element ID) | Generic selectors match wrong elements, break on text changes, and don't prove you understand the DOM | Read the HTML template source to find the exact ID/class — every heal must be traceable to code you read |
| Use `cy.wait(N)` instead of DOM assertions | Blind waits are unreliable across environments; too short = flaky, too long = slow | Wait for real elements: `cy.get("#el", { timeout: 30000 }).should("exist")` — read the controller to know WHAT to wait for |
| Declare "test passed" after a single run | Flaky tests can pass once by luck (e.g., fast server response hiding a timeout that's too short) | Run twice with `retries=0` — only deliver after two consecutive passes |
| Use default 15s timeout for fresh account page loads | Fresh accounts have no cached data; route resolves and API calls take longer (up to 30s) | Read the controller to identify async gates (resolves, `AppState.connect()`, `ng-if` on data), set timeout to 30s for initial page renders |
| Run `npx cypress run` without `--config-file cypress/cypress.config.js` | Cypress can't find config, exits silently with no output and exit code 1 | Always use the exact wrapper script from §13.1 — every flag is mandatory |
| Use `--headless` instead of `--headed` | UI interactions fail silently in headless mode | Always use `--headed` — tests require a visible browser |
| Forget `unset ELECTRON_RUN_AS_NODE` | VS Code sets this env var; Cypress child processes break, exits immediately with no output | First line of wrapper script must be `unset ELECTRON_RUN_AS_NODE` |
| Run from `cypress/` subdirectory instead of repo root | `--spec` paths don't resolve, Cypress reports "no spec files found" | Always `cd ~/mixeduse-cypress-local-dev/buildium-cypress` (repo root) |
| Use `node -e "require('cypress').run(...)"` instead of wrapper script | Bypasses required flags (`unset ELECTRON_RUN_AS_NODE`, `--config-file`, `--headed`) | Always use the wrapper script from §13.1 |
| Declare "Docker needed" or "environment can't run tests" when Cypress fails silently | The command is wrong, not the environment — tests run fine with the correct flags | Fix the command: check `unset ELECTRON_RUN_AS_NODE`, `--config-file`, `--headed`, repo root. See §13.1 |
| Try multiple wrong Cypress commands hoping one works | Wastes iterations; the correct command is documented in §13.1 | Use the EXACT command from §13.1 — copy it, don't improvise |
| `getaddrinfo ENOTFOUND qms_v2.buildiumstaging.io` → retry with `sleep` or add `/etc/hosts` entry | QMS hostname resolves through corporate VPN DNS — retrying won't help if VPN is off | Ask the user to connect VPN, then re-run. Do NOT retry blindly or edit `/etc/hosts` |

---

**CLASSIFY → PARALLEL RESEARCH → GENERATE → VALIDATE → EXECUTE → DIAGNOSE → HEAL → PASS (2x) → DELIVER**
