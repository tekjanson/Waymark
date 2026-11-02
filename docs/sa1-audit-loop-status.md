# SA1 Audit Loop — Status & Handoff

> **Purpose:** Running log for the "use Waymark as a testing platform to find
> issues SpamApply1 (SA1) should catch but doesn't, upgrade SA1, repeat until a
> dozen clean spot-checks" loop. If this session is cut off, a fresh agent reads
> this file + `docs/sa1-audit-loop-handoff.md` and continues from "Next Action".

**Loop branch (Waymark):** `chore/sa1-audit-loop-20261101`
**Base:** `origin/main` @ `b4eb826` (PR #205 merged — AGY local-AI + #208 fixes)
**SA1 repo:** `/home/tekjanson/Documents/Code/SpamApply1` (NOT a git repo locally —
patches are applied to the on-disk source that `make gates` uses; mirror each
change into an upstream SpamApply1 PR when that repo is available).

---

## Rules of the loop

1. Run `make gates` + `node scripts/interaction-audit.js` + targeted tests.
2. Find a real Waymark issue a hygiene gate *should* have caught but didn't,
   OR a false positive the gate wrongly flags.
3. Upgrade the SA1 tool/manifest/in-repo audit so it catches (or stops
   mis-flagging) that class — add a test for the new behavior.
4. Fix the Waymark violation(s) the new rule surfaces.
5. Commit, record the finding in the session DB (`sa1_loop` table) + this doc.
6. Repeat. After **12 consecutive spot-checks that find nothing**, stop.
7. Write/refresh handoff docs every iteration so a lower model can resume.

**Spot-check counter:** reset to 0 whenever a new finding is made; increment on
a clean pass. Current: **0 clean / 12 needed.**

---

## Iterations

### Iteration 1 — gitignore-blind hygiene gate ✅ FIXED
- **Symptom:** `make gates` failed on `.env`, `dev-worker/dream-run.log`,
  `server/.git-repo/**` — all gitignored, none part of the repo.
- **Root cause:** `slop-be-gone` `_load_ignore_selectors` read only `.sbgignore`.
- **SA1 upgrade:** `SpamApply1/slop-be-gone/src/sbg/engine.py` now also parses
  `.gitignore` (skips `!` negations, strips leading `/` root-anchor, treats
  no-slash patterns as any-depth per git semantics). New test
  `test_gitignore_excludes_matching_paths` in `tests/test_engine.py`.
- **Result:** sbg suite 57→58 green; all four gates (cbg/dbg/drift/sbg) clean.

---

## Next Action

Continue iteration 2: scan Waymark for a class of real bug that no current gate
catches. Candidate leads to probe next:
- innerHTML-with-dynamic-content (AI_LAWS §3.4) — is there a drift/chaos rule?
- direct `drive.js`/`sheets.js` imports outside `api-client.js` (AI_LAWS §1.4).
- templates importing outside `shared.js` (AI_LAWS §1.5).
- `.then()` chains instead of async/await (AI_LAWS §3.5).
- `page.waitForTimeout()` in tests (AI_LAWS §7.2).
Pick the one with a real present violation in the tree, add the rule, fix it.
