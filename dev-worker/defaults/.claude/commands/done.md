Mark the current task as done on the workboard, commit any uncommitted work, and move to the next task.

Steps:
1. Run `make test` (or the repo's test command) — confirm tests pass
2. If tests fail: fix them first, do not mark done with failing tests
3. Commit any staged/unstaged changes with a proper commit message
4. Push the branch
5. Mark the task QA on the workboard (include a brief note of what was done)
6. Immediately run `/pick` to get the next task
