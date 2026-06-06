# Working Style and Preferences

These patterns were extracted from real working sessions with the operator.
Internalize them. This is how we work.

---

## The Core Loop (Every Session)

This is what you do every session, whether you're Copilot or Claude:

```
1. BOOT   → Read AI_LAWS, read operator.md, read system.md
2. CHECK  → Query the workboard for To Do items
3. WORK   → Implement the highest-priority task (full cycle: branch → code → test → commit → mark QA)
4. SLEEP  → If nothing to do, sleep 60 seconds (terminal sleep, zero tokens)
5. GOTO 2
```

You run until the container stops. No prompting the operator. No waiting for approval
on implementation decisions. Just work.

---

## How to Approach Tasks

### Read the task title and description together
The title is the "what". The description is the "why" or "how far". If the description
says "like this session" or "like how we do it in chat", match the patterns from
prior sessions — look at how similar features were built in the codebase.

### Assume full scope unless bounded
If a task says "add Docker support", don't add a Dockerfile and stop. Add the
Dockerfile, update the compose file, update the README, update the tests, wire it
into CI if CI exists. Finish the thing.

### Define "done" as: works + tested + committed
A task is not done until:
- [ ] The feature actually works (smoke-tested or E2E tested)
- [ ] Tests cover the new behavior (E2E for UI, integration for backend logic)
- [ ] Code is committed with a sensible message
- [ ] Workboard updated: stage → QA, note sub-row added with what was done

### When in doubt, make it cleaner
The operator's recurring feedback is "this is clunky" or "much cleaner". When you
have two approaches, pick the one with fewer moving parts. Delete code before
adding it. Simplify instead of extending.

---

## Code Style Decoded

When the operator says...

| Operator says | Means |
|---|---|
| "clunky" | Too many steps, too much config, too indirect — redesign it |
| "clean" | Fewer files, fewer abstractions, direct |
| "just works" | No setup docs, no prerequisites, zero-config |
| "scale it" | Make it stateless, make it N-instances compatible |
| "like this session" | Match how we're doing it in the current chat |
| "whatever you think" | Full autonomy — do what's best |
| "yes and..." | Approved + here's the addition |
| "RPTI" / "RPIT" | Replace/rewrite the existing implementation |

---

## Decision Framework

### Make these calls yourself (never ask)
- What to name files, functions, variables, branches
- How to handle error cases
- Which test cases to write
- How to structure new code
- What to log
- How to format commit messages
- Which dependencies to use (within the no-framework constraint)

### Flag these to the operator (via workboard note)
- The task says X but the codebase does Y and changing X would break Z
- Two tasks in the workboard are in direct conflict
- A decision will be very hard to reverse (public API change, DB migration, etc.)
- You need a secret/credential that isn't in `/credentials`

---

## Quality Bar

The operator runs `npm test` after every QA review. If tests fail, the task comes
back. So:

- Run `npm test` before marking any task QA
- If tests were already failing before your change, note it but don't let it block
  marking the task done (note the pre-existing failures in the workboard sub-row)
- Write tests for new features. This is not optional. See AI_LAWS §7 for the test
  patterns — flat `test()` calls, no `describe()`, no `beforeEach`, CSS selectors only.

---

## Multi-Agent Awareness

If `AGENT_NAME` is set in your environment, you are one of multiple parallel agents.

- Only claim tasks assigned to you or unassigned
- When claiming a task, set Assignee to your AGENT_NAME
- Write heartbeat notes to the workboard every ~15 minutes of active work
- If another agent is working on a related task, coordinate via workboard notes
  (not by trying to communicate directly — the workboard is the bus)

---

## Parallelism Patterns

### Within your session (Copilot /fleet or Claude subprocess)
Use this when a task naturally decomposes into independent subtasks that can run
concurrently. Example: "update all template fixture files" → run one subagent per
template in parallel.

### Across containers (Docker)
The workboard is the coordination layer. If you have tasks that benefit from more
capacity than one container, spawn sibling containers:
```bash
docker compose -f /workspace/dev-worker/docker-compose.yml up -d \
  -e AGENT_NAME=worker-2 \
  -e AGENT_COMMAND="@waymark-builder-agent-sub-board start"
```
Then coordinate via the workboard. You don't need to manage the sibling — it will
poll the workboard independently.

---

## The Waymark UI Flow (What the Operator Sees)

The operator opens the Waymark app in a browser. They see the workboard rendered
as a kanban board. They:

1. Add a new card to "To Do" — this is their idea/direction to you
2. Watch it move through In Progress → QA
3. Open the QA card, read your implementation notes, test it in a browser
4. Either approve (drag to Done) or add feedback notes (drag back to To Do)

This is the entire human-AI interface. No chat. No terminal. Just the kanban board.

Your job is to make this loop as frictionless as possible:
- Write clear, concise QA notes so the operator knows exactly what to test
- Make the feature actually testable (it should work when they open a browser)
- Handle the common rejection cases before they happen (test edge cases yourself)
