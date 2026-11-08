# SA1 Upstream Patch 002 — generalizable "layout-variant parity / dead-CSS" drift rule

> These patches target the **SpamApply1** repo, which is vendored locally and not
> a git repo in this workspace. Apply them upstream and open a SpamApply1 PR. The
> Waymark-side guard already ships (see "Reference implementation"); this file is
> the portable record so the class can be generalized into `drift-be-gone`.

**Suggested home:** `drift-be-gone` — a new `style-variant-parity` rule.
**Reference implementation (already live in Waymark):**
`scripts/interaction-audit.js` → `auditWayboardLayouts()` (rule `WAYBOARD_LAYOUT_PARITY`).

## Why

Waymark's home "Wayboard" shipped **50 near-identical layout variants** in
`home-modes.css`. They were thin, desktop-only CSS overrides — many visually
indistinguishable, all collapsing to the same stacked view on mobile — and they
styled a pile of **reference-shell selectors that never render in the live DOM**
(`aside.left-nav`, `header.app-header`, `.viewport-box`, `.search-bar`,
`.nav-item`). None of the existing gates caught this: cbg/dbg/drift/sbg don't
model "a CSS file carries style blocks for variants that no longer exist" or
"selectors with no corresponding DOM node."

When the Wayboard was rebuilt to a curated set of **12 distinct, mobile-first
layouts**, a drift guard was added so the cruft cannot creep back:

1. A single source of truth declares the variant count (`LAYOUT_COUNT` in
   `wayboard.js`); retired variant numbers are remapped at runtime
   (`resolveLayout`) and must **not** carry their own CSS.
2. Every declared variant `2..N` must have a corresponding style block (variant
   1 is the base shell) — so each option is genuinely distinct.
3. A deny-list of dead "reference shell" selectors must not appear in the CSS.

## Generalizable rule shape (for drift-be-gone)

A manifest-driven rule:

```jsonc
{
  "id": "style-variant-parity",
  "type": "style-variant-parity",
  "enabled": true,
  // JS/TS file + regex capturing the authoritative variant count.
  "countSource": { "file": "public/js/wayboard.js", "pattern": "LAYOUT_COUNT\\s*=\\s*(\\d+)" },
  // CSS file whose `.variantPrefix-N` blocks must match [1..count].
  "styleFile": "public/css/home-modes.css",
  "variantPrefix": "mode",
  // Selectors that must never appear (no corresponding DOM node).
  "deadSelectors": ["aside.left-nav", "header.app-header", ".viewport-box", ".search-bar", ".nav-item"]
}
```

Violations:
- `styleFile` references `.<prefix>-<n>` for any `n > count` → **stale variant CSS**.
- Any `n` in `2..count` has no `.<prefix>-<n>` block → **missing/duplicate variant**.
- Any `deadSelectors` entry is present → **dead reference-shell CSS**.

## Reference implementation (verbatim, Node)

See `scripts/interaction-audit.js::auditWayboardLayouts`. Behaviour verified:
- Positive: the rebuilt 12-layout `home-modes.css` passes clean.
- Negative: injecting `#wayboard-root.mode-30 {…}` and
  `#wayboard-root aside.left-nav {…}` both fail the gate with precise messages.

Until SpamApply1 ships the generic rule, the Waymark-local guard enforces the
same contract via `make audit` / `node scripts/interaction-audit.js`.
