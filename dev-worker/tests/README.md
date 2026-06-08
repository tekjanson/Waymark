# Dev Worker — E2E Test Suite

Real end-to-end tests for the `waymark-dev-worker` container. **Zero mocks.**
Every test uses actual Copilot credentials and executes the full code path.

---

## Prerequisites

1. **Container running:**
   ```bash
   docker compose -f dev-worker/docker-compose.yml up -d
   ```

2. **Copilot CLI authenticated on the host** (once, then tokens persist):
   ```bash
   copilot --login
   ```

3. **Docker available** on the host machine.

---

## Run All Tests

```bash
bash dev-worker/tests/run-tests.sh
```

---

## Run Individual Suites

```bash
bash dev-worker/tests/boot.test.sh       # Container health
bash dev-worker/tests/auth.test.sh       # Copilot CLI auth
bash dev-worker/tests/agent.test.sh      # Agent task execution
bash dev-worker/tests/browser.test.sh    # Real browser on Xvfb
bash dev-worker/tests/workspace.test.sh  # Code operations in workspace
```

---

## Options

```bash
# Use a different container name (e.g., for multi-agent testing)
bash dev-worker/tests/run-tests.sh --container waymark-dev-worker-alpha

# Run only specific suites
bash dev-worker/tests/run-tests.sh --only boot,auth

# Skip a slow suite
bash dev-worker/tests/run-tests.sh --skip workspace
```

---

## Test Suites

### 1. `boot.test.sh` — Container Infrastructure
Verifies the container started correctly. Runs in seconds.

| Test | What it checks |
|---|---|
| Container running | `docker ps` shows the container as running |
| Supervisord | All programs (xvfb, agent-runner) are RUNNING |
| agent-env.sh | Entrypoint wrote the env file correctly |
| Xvfb process | Virtual display daemon is running |
| DISPLAY=:99 | X display is usable (`xdpyinfo`) |
| /workspace | Volume mounted and non-empty |
| Git | Git repo valid in workspace |
| Node.js | Node.js binary present |

### 2. `auth.test.sh` — Copilot CLI Authentication ⚡ Real Creds
Verifies the Copilot CLI is authenticated. Makes a **live network call** to GitHub.

| Test | What it checks |
|---|---|
| Binary installed | `copilot` is in PATH |
| Config file | `/root/.copilot/config.json` exists and has content |
| Volume writable | Token refresh will work (needs write access) |
| CLI executes | `copilot --version` runs without crashing |
| Live auth probe | `copilot -p '/version'` — real GitHub API call |

**If this fails:** Run `copilot --login` on the host, then `docker compose restart`.

### 3. `agent.test.sh` — Agent Task Execution ⚡ Real AI
Five isolated tasks run in a temp workspace (`/tmp/agent-test-$$`). Each task invokes the Copilot CLI directly with a verifiable outcome.

| Task | Prompt | Verification |
|---|---|---|
| File creation | Create file with unique content | File exists, content matches |
| File reading | Read input.txt, write to output.txt | Output contains input |
| Code execution | Write + run Node.js that computes 7×6 | Result file contains `42` |
| Multi-step transform | Read JSON, multiply, write result | Output JSON contains `50` |
| Git operations | Init repo, create README, commit | `git log` shows a commit |

**Timeout:** 120s per task. Increase `AGENT_TEST_MODEL` env var to use a faster model.

### 4. `browser.test.sh` — Real Headed Browser
Verifies the full browser stack. Uses real Chrome on DISPLAY=:99 — **headed mode**, not headless.

| Test | What it checks |
|---|---|
| Display usable | DISPLAY=:99 responds to xdpyinfo |
| Chrome installed | google-chrome-stable binary present |
| Chrome launches | Navigates to example.com, produces screenshot |
| Playwright installed | node_modules has playwright |
| Playwright runs | Runs one real test against Waymark server |

**Why headed?** Headed browsers render CSS layout, fonts, and compositing exactly as users see them. `--headless` mode skips parts of the rendering pipeline — that's a mock.

### 5. `workspace.test.sh` — Code Operations ⚡ Real AI
Exercises the agent working on the actual codebase. Slow (up to 3 minutes).

| Task | What it checks |
|---|---|
| npm install | Dependencies installable |
| Code understanding | Agent reads README + package.json, describes project |
| Run tests | Agent runs `npm test`, reports PASSED/FAILED + count |
| Code change | Agent creates a file in /workspace (cleaned up after) |

---

## Why No Mocks?

The current Playwright E2E suite (`tests/e2e/`) tests the **Waymark app UI** in mock mode — fake Google credentials, pre-loaded fixture data, `WAYMARK_LOCAL=true`. That's appropriate for testing rendering and interactions.

These dev-worker tests are different: they test the **agent infrastructure** itself. You can't mock:
- Whether the Copilot CLI binary is authenticated
- Whether the virtual display serves real browser rendering
- Whether the agent can actually read, understand, and modify code
- Whether `npm test` passes in the real container environment

Mocking any of these would only prove that the mock works.

---

## Adding New Test Cases

Add tests to any existing `.test.sh` file following the pattern:
```bash
header "  Task N: Your New Task"

OUTPUT=$(run_agent_task "task-name" "Your precise prompt here" || echo "TASK_FAILED")

if [[ "$OUTPUT" == "TASK_FAILED" ]]; then
    fail "Task N: timed out"
elif exec_q "test -f '/tmp/expected-artifact'"; then
    pass "Task N: artifact created"
else
    fail "Task N: artifact not found"
fi
```

**Prompt design tips:**
- Be precise about file paths (use absolute paths)
- Give the agent a single unambiguous verifiable output (a file with specific content)
- Keep tasks short — the agent is smart but timeout is real
- Isolate to `/tmp/` to avoid workspace side effects
