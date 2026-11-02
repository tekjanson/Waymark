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
  Portable record: `docs/sa1-upstream-patches/001-sbg-honor-gitignore.md`.
- **Result:** sbg suite 57→58 green; all four gates (cbg/dbg/drift/sbg) clean.

### Iteration 2 — template import boundary unenforced ✅ FIXED
- **Symptom:** 22 template files import non-template modules directly, violating
  AI_LAWS §1.5. Two cross the §1.4 ABSOLUTE LAW by importing the Google-API
  gateway directly: `templates/agents.js` and `templates/floorplan/index.js`
  both `import { api } from '…/api-client.js'`, which breaks mock mode + test
  isolation.
- **Root cause:** No gate enforced the import boundary. drift
  `canonical-abstractions` only restricts *primitives* (localStorage,
  RTCPeerConnection, crypto.subtle), not module imports. drift `forbidden-deps`
  exists but can't express the "shared.js is the sole gateway" exception.
- **Upgrade:** Added `GOOGLE_API_IMPORT_BOUNDARY` rule to
  `scripts/interaction-audit.js` — flags any template (except the `shared.js`
  gateway + top-level barrel) importing `api-client.js`/`drive.js`/`sheets.js`
  directly. Negative-tested the regex (catches all 3; passes shared.js imports).
- **Fix:** Added `api` to `shared.js`'s re-export block; re-pointed `agents.js`
  and `floorplan/index.js` to `import { api } from './shared.js'`. No circular
  import (api-client.js does not import shared.js).
- **Result:** audit scans 82 template modules clean; gates green; agents +
  floorplan + shared specs pass in isolation and at low parallelism.

### Iteration 3 — dynamic `innerHTML` XSS vectors ✅ FIXED
- **Symptom:** Two modules injected a runtime value into `innerHTML` via a
  template literal: `search.js` (`…${err.message}`) and `app.js`
  (`Failed to load folder: ${err.message}`) — an XSS vector per AI_LAWS §3.4/§12.
- **Root cause:** No gate flagged dynamic `innerHTML` interpolation. Static
  strings and `innerHTML = ''` clearing are fine, so a blunt grep over-reports;
  the real risk is *interpolated* content.
- **Upgrade:** Added `DYNAMIC_INNERHTML` rule to `scripts/interaction-audit.js`
  (`/\.innerHTML\s*=\s*` + backtick + `…${/`), scanning *all* of `public/js`
  (not just templates), skipping `vendor/`. Negative-tested: catches dynamic,
  ignores static strings, `''` clears, and sanitized function calls
  (`innerHTML = sanitizeDocHtml(...)`).
- **Fix:** Rebuilt both empty-states with `el('p', {className:'empty-state'}, [text])`
  + `textContent` semantics (el() escapes text). Confirmed 0 dynamic-innerHTML
  sites remain across `public/js`.
- **Result:** audit scans 141 public/js modules clean; gates green; 100
  search/folder specs pass.

### Backlog (found, not yet fixed)
- **B1 — broader §1.5 cleanup (18 remaining):** templates still import
  `storage.js`, `encryption.js`, `camera-capture.js`, `social-widget.js`
  directly, and the `arcade/*` template reaches its `public/js/arcade/**` game
  engine. The arcade engine is a legitimate subsystem (candidate for an
  allow-listed exception + an AI_LAWS §1.5 clarification); the storage /
  encryption / camera / social-widget imports should route through shared.js
  re-exports in a future iteration. The new audit rule is intentionally scoped
  to the §1.4 Google-API gateway for now to keep each iteration safe + tested.
- **B2 — pre-existing biometric test failures:** `agent.spec.js:3967` and
  `:4050` (mobile WebAuthn/passkey unlock) fail on `origin/main` independent of
  loop work (verified with loop changes stashed). Likely a headless WebAuthn
  virtual-authenticator gap. No gate covers the biometric unlock flow.

---

## Next Action

Spot-check counter is 0 (iteration 2 made a finding). Continue the loop:
- **Iteration 3 candidate:** pick one backlog item (B1 storage/encryption/camera
  routing through shared.js, or B2 headless WebAuthn) OR probe a new class:
  `.then()` chains (§3.5), `page.waitForTimeout()` in tests (§7.2), or
  `innerHTML =` with dynamic content (§3.4). For each: confirm a real present
  violation, add/extend a guard, fix, test, commit, record here.
- Keep each iteration **safe + fully tested**; never leave the tree red.
- After **12 consecutive clean spot-checks**, stop and open the final PR.

## How to resume if cut off
1. `cd /home/tekjanson/Documents/Code/Waymark && git checkout chore/sa1-audit-loop-20261101`
2. Read this file + `docs/sa1-upstream-patches/` + session DB tables `sa1_loop`,
   `sa1_loop_state`.
3. Re-run baseline: `make gates` + `node scripts/interaction-audit.js`.
4. Continue from "Next Action". Commit + push each iteration. Open/update the PR
   titled "chore(sa1-loop): harden SpamApply1 using Waymark as a test platform".
