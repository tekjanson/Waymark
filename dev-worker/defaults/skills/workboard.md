---
name: workboard
description: Check and update a workboard for task management. Supports both the Waymark MCP tools (preferred) and direct shell scripts (fallback). Use this skill to pick tasks and report progress.
---

# Workboard Skill

## Check for tasks (MCP — preferred when available)
Use the `waymark/*` or `google-sheets/*` MCP tools to read the workboard sheet directly.

## Check for tasks (shell fallback)
```bash
if [ -f /workspace/scripts/check-workboard.js ]; then
  GOOGLE_APPLICATION_CREDENTIALS=/credentials/gsa-key.json \
    node /workspace/scripts/check-workboard.js
fi
```
Output: `{"todo":[{row, task, priority, assignee}...],"inProgress":[...],"qa":N,"done":N}`

## Claim a task (mark In Progress)
```bash
GOOGLE_APPLICATION_CREDENTIALS=/credentials/gsa-key.json \
  node /workspace/scripts/update-workboard.js \
    --row ROW_NUMBER \
    --stage "In Progress" \
    --assignee "${AGENT_HUMAN_NAME:-dev-worker}"
```

## Mark done
```bash
GOOGLE_APPLICATION_CREDENTIALS=/credentials/gsa-key.json \
  node /workspace/scripts/update-workboard.js \
    --row ROW_NUMBER \
    --stage "QA"
```

## Add a note
```bash
GOOGLE_APPLICATION_CREDENTIALS=/credentials/gsa-key.json \
  node /workspace/scripts/update-workboard.js \
    --row ROW_NUMBER \
    --note "Progress: what was done"
```

## Rules
- Mark In Progress BEFORE touching any code.
- One task at a time per agent.
- Only pick from `todo` array — never steal `inProgress` tasks assigned to others.
- Mark QA only after: implementation done + tests pass + committed + pushed.
- If no workboard script exists, check for `WAYMARK_WORKBOARD_ID` env var and use MCP.
