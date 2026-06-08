---
name: git-workflow
description: Standard git branch → implement → test → commit → push workflow for the Waymark repo. Use this for every task.
---

# Git Workflow Skill

## Start a task (always create a branch)
```bash
git checkout main && git pull
git checkout -b feature/short-kebab-description
```

Branch naming: `feature/` for new things, `fix/` for bugs, `refactor/` for cleanup.
Keep it short and descriptive: `feature/kanban-drag-drop`, `fix/budget-total-negative`.

## After implementing

Run tests before committing:
```bash
make test
```

If tests pass:
```bash
git add -A
git status   # review what changed
git commit -m "feat: short description of what changed

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
git push origin feature/short-kebab-description
```

## Commit message format
```
type: short description (50 chars max)

Optional body explaining WHY, not WHAT. Keep it under 72 chars per line.

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
```
Types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`

## Rules
- Never commit directly to `main`.
- Never `git push --force` unless explicitly instructed.
- Always run `make test` before committing.
- If tests fail, fix them before committing — don't commit broken tests.
