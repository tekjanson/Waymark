# Workboard Fleet Interruptions — Real-Time Notes

## Feature Overview

When you (the operator) add a note to a workboard task while an agent is working on it, the agent receives your message like an instant message and can respond inline before moving to the next task.

**Flow:**
1. Agent claims a task and starts working (session 1)
2. Agent completes session 1
3. System checks for new notes on that task
4. If new notes exist: agent receives them as an "interrupt" with full context
5. Agent responds to notes and continues working (session 2, same task)
6. After session 2, if no more notes: agent moves to next task

## How to Send Notes to an Agent

1. Open the Waymark workboard in your browser
2. Find the task card (already In Progress, assigned to an agent)
3. Add a sub-row note (NOT in the task row itself — below it as a child row)
4. Write your feedback as you would in a chat message
5. The note appears in the agent's next session poll

**Example:**
```
Row 42: Task: "Implement payment system" | Stage: In Progress | Assignee: Alex
Row 43: (empty) | (empty) | (empty) | (empty) | Tek Janson | (empty) | 2026-06-18 | (empty) | "This is taking longer than expected — maybe use Stripe's prebuilt components?"
```

## How Agents Respond to Notes

After receiving notes, the agent will:

1. **Acknowledge** via a note sub-row: "Ack: received your feedback"
2. **Implement changes** as directed
3. **Update workboard** with a progress note explaining what changed
4. Continue working or mark QA when done

Example agent response:
```
Row 44: (empty) | (empty) | (empty) | (empty) | Alex | (empty) | 2026-06-18 | (empty) | "Ack: Using Stripe prebuilt components. Updated payment form, tests green, committing now."
```

## Architecture

### Scripts

**`scripts/check-task-notes.js`** — One-shot poller for a specific task row
- Reads a task row and all sub-rows below it
- Returns only NEW notes (not previously seen by the agent)
- Maintains state file: `~/.waymark-notes/notes-{row}-{agent}.json`
- Output: `{ hasNewNotes: true|false, notes: [...], totalNotes: N }`

**`dev-worker/scripts/agent-runner.sh`** — Enhanced with note-checking
- After each agent session completes, calls `check-task-notes.js`
- If new notes detected: builds a "continue" prompt with note context
- Runs a second session (notes response) instead of moving to next task
- Then resumes normal loop (next task)

### Behavior

| Event | Agent Does | Next Step |
|-------|-----------|-----------|
| Session 1 ends | Check for notes | If notes: run session 2. Else: claim next task |
| Session 2 (notes response) | Acknowledge notes, make changes, respond | Claim next task |
| Operator adds note mid-session | (buffered) | Checked at next loop (agent unaware during active LLM call) |

## Limitations

- **No true interruption during active LLM call:** Notes are checked AFTER the agent session completes (when the LLM call finishes). The agent cannot be interrupted mid-reasoning.
- **State is per-task-per-agent:** Different agents can have independent note histories on the same task.
- **Notes are read-only in-session:** The agent cannot query for notes; it only receives them as injected context after session completion.

## Troubleshooting

### No response to my note
- Check the agent's last heartbeat time — it may be sleeping
- Verify the note is in a **sub-row** (column A empty), not the task row
- Ensure the note is in column I (Note column)

### Agent keeps responding to the same note
- The state file (`~/.waymark-notes/notes-{row}-{agent}.json`) may be corrupted
- Delete it and re-add the note

### Notes appear but agent doesn't respond
- The agent may interpret the note as informational and move to next task
- Add a clear request: "Please confirm by replying with a note when done"

## Configuration

No configuration needed — feature is enabled automatically when:
- `WAYMARK_WORKBOARD_ID` is set
- Agent is working on a task (In Progress stage)
- Task has a row number

To disable note checking in a custom setup:
- Comment out the `check_for_task_notes()` call in `dev-worker/scripts/agent-runner.sh`
- Or remove the call after the session block (lines ~495–530)
