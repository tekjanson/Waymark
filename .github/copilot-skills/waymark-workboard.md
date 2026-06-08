---
name: waymark-workboard
description: Check the Waymark workboard for tasks, update task status, and mark work done. Use this skill whenever you need to query or update the kanban board.
---

# Waymark Workboard Skill

## Check for tasks
```bash
GOOGLE_APPLICATION_CREDENTIALS=/root/.config/gcloud/waymark-service-account-key.json \
  node scripts/check-workboard.js
```
Returns JSON: `{"todo":[{row, task, priority, assignee}...],"inProgress":[...],"qa":N,"done":N}`

## Claim a task (mark In Progress)
```bash
GOOGLE_APPLICATION_CREDENTIALS=/root/.config/gcloud/waymark-service-account-key.json \
  node scripts/update-workboard.js --row ROW_NUMBER --stage "In Progress" --assignee "AGENT_NAME"
```

## Mark task done (send to QA)
```bash
GOOGLE_APPLICATION_CREDENTIALS=/root/.config/gcloud/waymark-service-account-key.json \
  node scripts/update-workboard.js --row ROW_NUMBER --stage "QA"
```

## Add a progress note
```bash
GOOGLE_APPLICATION_CREDENTIALS=/root/.config/gcloud/waymark-service-account-key.json \
  node scripts/update-workboard.js --row ROW_NUMBER --note "Progress update text"
```

## Rules
- Always check the workboard FIRST before picking a task.
- Only pick tasks from the `todo` array. Never pick tasks already `inProgress` unless assigned to you.
- Mark In Progress BEFORE touching any code.
- Mark QA only after: implementation done + tests pass + committed + pushed.
- One task at a time per agent.
