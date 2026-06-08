---
name: git-workflow
description: Standard git workflow for any repo. Branch → implement → test → commit → push. Use this for every task.
---

# Git Workflow

## Start a task
```bash
git -C /workspace checkout main 2>/dev/null || git -C /workspace checkout master
git -C /workspace pull
git -C /workspace checkout -b feature/short-kebab-description
```

Branch prefixes: `feature/` new things, `fix/` bugs, `refactor/` cleanup, `chore/` tooling.

## Run tests
```bash
# Try make first
if [ -f /workspace/Makefile ]; then
  cd /workspace && make test
elif [ -f /workspace/package.json ]; then
  cd /workspace && npm test
fi
```

## Commit
```bash
git -C /workspace add -A
git -C /workspace diff --staged --stat   # review what changed
git -C /workspace commit -m "feat: short description

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
git -C /workspace push origin HEAD
```

## Rules
- Never commit to `main`/`master` directly.
- Never `git push --force`.
- Tests must pass before committing — fix failures, don't skip them.
- Keep commits atomic: one logical change per commit.
