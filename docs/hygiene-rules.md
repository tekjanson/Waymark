# Default SBG hygiene rules

SBG ships with a small default rule set that is intentionally opinionated. Each
rule is meant to catch a class of low-value or risky changes before they become
part of a commit.

## 1. placeholder-comments

What it catches:
- Comments that look like unfinished work, such as "fill in later" or
  "sample text".

Why it matters:
- Scaffold leftovers usually mean the change is incomplete or copied from a
  starting point. They create confusion for reviewers and future maintainers.

Good pattern:
```python
# Build a user profile from the auth payload.
```

Bad pattern:
```python
# fill in later
```

## 2. marker-spam

What it catches:
- Repeated follow-up markers that accumulate in the codebase.

Why it matters:
- Marker spam is a sign that the change is carrying unresolved notes instead of
  clear implementation work. Too many markers make it harder to distinguish real
  defects from noise.

Good pattern:
```python
# Follow-up: wire this up after the API contract is finalized.
```

Bad pattern:
```python
# Follow-up Follow-up Follow-up Follow-up Follow-up
```

## 3. empty-files

What it catches:
- Files that are empty or contain only whitespace.

Why it matters:
- Empty files are rarely intentional. They usually indicate a failed edit, an
  incomplete migration, or a placeholder that should be deleted or filled in.

Good pattern:
```python
"""Configuration for the service client."""
```

Bad pattern:
```text
<empty file>
```

## 4. long-lines

What it catches:
- Lines that are overly long and hard to read in diffs or editors.

Why it matters:
- Long lines hurt readability, make review comments harder to place, and often
  hide multiple concerns in a single statement.

Good pattern:
```python
payload = {
    "user_id": user_id,
    "role": role,
}
```

Bad pattern:
```python
payload = {"user_id": user_id, "role": role, "status": status, "active": active, "name": name}
```

## 5. button-actions

What it catches:
- Buttons that lack an explicit action hook such as `data-action` or `onclick`.

Why it matters:
- A button without an explicit action is ambiguous. It looks interactive but does
  not communicate which behavior it is supposed to trigger, which makes generated
  UI harder to trust and review.

Good pattern:
```html
<button type="button" data-action="save">Save</button>
```

Bad pattern:
```html
<button>Save</button>
```

## 6. button-types

What it catches:
- Buttons that omit an explicit `type` attribute or declare a non-standard type.

Why it matters:
- Explicit button types make UI interactions predictable and reduce accidental
  submits or form resets. They are a low-friction way to keep the interface
  consistent across generated components.

Good pattern:
```html
<button type="button">Cancel</button>
```

Bad pattern:
```html
<button>Cancel</button>
```

## 7. form-labels

What it catches:
- Form controls that lack a clear label or accessible name.

Why it matters:
- Labels make forms usable for assistive tech and reduce the chance that agentic
  edits create confusing or broken interactive surfaces.

Good pattern:
```html
<label for="email">Email</label>
<input id="email" name="email" />
```

Bad pattern:
```html
<input name="email" />
```

## 8. file-size

What it catches:
- Files that grow beyond the configured size threshold, which defaults to 1 MiB.

Why it matters:
- Oversized files are harder to review, diff, and maintain. They often indicate
  generated output, copied assets, or a bad place for logic that should be split
  into smaller modules.

Good pattern:
```python
# Keep the implementation split across focused modules.
```

Bad pattern:
```text
A generated JSON payload that is hundreds of kilobytes long and committed as a
single source file.
```

## 9. asset-links

What it catches:
- Front-end actions declared in HTML that are not linked from the client-side
  script that is supposed to handle them.

Why it matters:
- A UI action that is not wired to a handler is a synthetic dead-end. It looks
  like the interface is complete while leaving the system with invisible gaps that
  are easy to miss in review.

Good pattern:
```html
<button type="button" data-action="save">Save</button>
```

```javascript
if (action === "save") {
  void saveDocument();
}
```

Bad pattern:
```html
<button type="button" data-action="save">Save</button>
```

```javascript
// no corresponding action branch exists
```

## 10. fully-defined-rules

What it catches:
- Rule definitions that do not include the metadata needed to explain, inspect, or
  trace them.

Why it matters:
- A rule without a description, a clear what/why explanation, or source references
  is effectively invisible policy. It cannot be reviewed or trusted, and it invites
  future slop because the policy itself is not anchored in the repository.

Good pattern:
```json
{
  "id": "fully-defined-rules",
  "type": "fully-defined-rules",
  "description": "Freeze rule definitions that are not fully explainable.",
  "what": "Require every rule to include human-readable context.",
  "why": "This keeps the policy self-explanatory and easier to maintain.",
  "source_refs": [{"path": "docs/hygiene-rules.md"}]
}
```

Bad pattern:
```json
{
  "id": "fully-defined-rules",
  "type": "fully-defined-rules"
}
```

## 11. source-loadable

What it catches:
- Rule source references that do not resolve to a file the dashboard can read.

Why it matters:
- If a policy points to a missing or unreadable file, the rule becomes opaque. The
  repository loses the traceability and reviewability that the UI is supposed to
  provide.

Good pattern:
```json
{
  "id": "source-loadable",
  "type": "source-loadable",
  "description": "Freeze source references that cannot be loaded.",
  "what": "Require every source reference to resolve to a readable file.",
  "why": "This keeps the policy inspectable from the same UI it is meant to defend.",
  "source_refs": [{"path": "docs/hygiene-rules.md"}]
}
```

Bad pattern:
```json
{
  "id": "source-loadable",
  "type": "source-loadable",
  "source_refs": [{"path": "docs/missing.md"}]
}
```

## 12. dynamic-config

What it catches:
- Hard-coded absolute paths or loopback endpoints in code, manifests, and other
  config-like files.

Why it matters:
- Hard-coded machine-specific values make the framework brittle. A repo that works
  only on one filesystem or one localhost port is not actually reusable.

Good pattern:
```python
host = os.environ.get("SBG_WEB_HOST") or "127.0.0.1"
repo_root = Path(os.environ.get("SBG_REPO_ROOT") or ".").resolve()
```

Bad pattern:
```python
ROOT = os.environ.get("SBG_REPO_ROOT") or "."
endpoint = os.environ.get("SBG_API_URL") or "<api-url>"
```

## 13. composite

What it catches:
- Higher-level "ideas" that are not a single pattern, but a combination of
  smaller checks scoped to a set of files and combined with `all` or `any` logic.

Why it matters:
- Real hygiene expectations are often compound: "every module under `src/`
  must pass these three checks", or "a config file must satisfy at least one of
  these acceptable forms". A `composite` rule lets you express those compound
  ideas by reusing the existing rule primitives instead of writing new engine
  code each time.

Fields:
- `match` (optional): a glob or list of globs (supports `*`, `?`, and `**`)
  matched against each file's repo-relative POSIX path. When omitted, the
  composite applies to every scanned file.
- `logic`: `all` (default) means every child rule must pass for each matched
  file (violations from all children are reported). `any` means each matched
  file must pass at least one child rule (a file is only flagged when it fails
  every child).
- `rules`: a list of ordinary rule definitions evaluated over the matched files.

Good pattern:
```json
{
  "id": "src-module-quality",
  "type": "composite",
  "match": ["src/**/*.py"],
  "logic": "all",
  "rules": [
    { "type": "long-lines", "max_length": 120 },
    { "type": "placeholder-comments", "patterns": ["placeholder"] }
  ],
  "description": "Every source module must stay readable and free of scaffolding.",
  "what": "Bundle readability and placeholder checks for src modules.",
  "why": "Compound expectations should be expressed as one reviewable idea.",
  "source_refs": [{ "path": "docs/hygiene-rules.md" }]
}
```

Bad pattern:
```json
{
  "id": "src-module-quality",
  "type": "composite",
  "rules": [
    { "type": "long-lines" }
  ]
}
```

## 14. merge-conflict-markers

What it catches:
- Files left in a half-merged state, where a line begins with seven `<`
  characters (the current side), seven `=` characters (the divider), or seven
  `>` characters (the incoming side) produced by an unfinished git merge or
  rebase.

Why it matters:
- A file with conflict markers is broken: it will not parse or run, and if it is
  committed it corrupts history and confuses every later reader. This is one of
  the highest-signal, lowest-false-positive checks a commit gate can enforce.

How to fix:
- Finish resolving the conflict, delete every marker line, keep the intended
  content, and re-stage the file before committing.

## 15. secret-scan

What it catches:
- High-confidence committed credentials such as AWS access key ids (the `AKIA`
  prefix followed by sixteen uppercase characters), GitHub tokens (the `ghp_`
  family), Slack tokens (the `xoxb`/`xoxp` family), Google API keys (the `AIza`
  prefix), Stripe live secret keys, and PEM `BEGIN ... PRIVATE KEY` blocks.

Why it matters:
- A committed secret is a security incident. Once it lands in history it leaks
  into clones, forks, mirrors, and backups, so the credential must be rotated
  even after it is removed. Blocking it at commit time is the only reliable fix.

How to fix:
- Remove the value from source, rotate the exposed credential, and load it from
  an environment variable or secret manager at runtime instead.

## 16. debug-artifacts

What it catches:
- Temporary debugging instrumentation left in source: `debugger` statements and
  `console.log`/`console.debug`/`console.trace` calls in JavaScript or
  TypeScript, and `breakpoint()` or `pdb.set_trace()` calls in Python.

Why it matters:
- Debug artifacts are noise that was never meant to ship. They can pause
  execution, leak internal state to logs, and are a clear signal that a change
  was not cleaned up before it was committed.

How to fix:
- Remove the debugging statement, or replace it with an intentional, configured
  logging call that belongs in the codebase.

## Ignoring files with .sbgignore

Place a `.sbgignore` file at the repository root to keep whole paths or trees
out of every scan. Blank lines and lines starting with `#` are ignored; every
other line is a glob (supporting `*`, `?`, and `**`) matched against a file's
repo-relative POSIX path.

- A trailing slash ignores a directory subtree: `build/` ignores everything
  under `build/`.
- A bare name ignores both a matching file and its subtree: `vendor` ignores a
  file named `vendor` and everything under `vendor/`.
- Globs work directly: `**/*.min.js` ignores minified bundles anywhere.

```gitignore
# .sbgignore
build/
dist/
vendor
**/*.generated.*
```

## Rule severity

Every rule accepts an optional `severity` of `error` (default) or `warning`.

- `error`: a violation fails the check (non-zero exit), blocking the commit.
- `warning`: a violation is printed but does not fail the check, unless the
  scan is run with `sbg check --strict`.

This supports gradual rollout: introduce a new rule as a `warning`, let a team
see the findings without breaking their workflow, then promote it to `error`
once the codebase is clean.

```json
{
  "id": "long-lines",
  "type": "long-lines",
  "max_length": 120,
  "severity": "warning"
}
```

## Scoping any rule with include / exclude

Every rule (not just `composite`) accepts optional `include` and `exclude`
fields. Each is a glob or list of globs matched against a file's repo-relative
POSIX path, supporting `*`, `?`, and `**`.

- `include`: when present, the rule only applies to files matching at least one
  glob.
- `exclude`: files matching any glob are skipped, even if they matched
  `include`.

This lets you keep a broad rule from firing on generated or vendored trees:

```json
{
  "id": "long-lines",
  "type": "long-lines",
  "max_length": 120,
  "include": ["src/**/*.py"],
  "exclude": ["**/generated/**", "**/vendor/**"]
}
```

## 17. trailing-whitespace

What it catches:
- Lines that end with stray spaces or tabs.

Why it matters:
- Trailing whitespace creates noisy diffs and inconsistent formatting, and it is
  a classic low-value artifact that distracts reviewers from real changes.

How to fix:
- Strip the trailing spaces or tabs. Most editors can do this on save.

## 18. final-newline

What it catches:
- Non-empty files whose last line is not terminated with a newline.

Why it matters:
- A missing final newline produces the noisy "No newline at end of file" marker
  in diffs and breaks some POSIX tools that expect newline-terminated text.

How to fix:
- Add a single trailing newline at the end of the file.

## Python static analysis (AST rules)

These rules parse each `.py` file into an abstract syntax tree, so they reason
about real program structure instead of text. That makes them precise: a snippet
that merely appears inside a string or comment is never flagged. Non-Python
files are skipped, and a file that cannot be parsed is reported by
`python-syntax` rather than crashing the scan.

Correctness and security (shipped as blocking errors):

- **python-syntax** — the file must parse; a `SyntaxError` is reported with its
  line and message.
- **python-bare-except** — flags `except:` with no exception type, which
  swallows every error (including `KeyboardInterrupt`).
- **python-broad-except** — flags `except Exception` / `except BaseException`;
  catch the specific errors you expect. Configurable via `names`.
- **python-mutable-default** — flags list/dict/set default arguments, which are
  created once and shared across calls.
- **python-eval-exec** — flags `eval()`/`exec()` calls as code-injection risks.
  Configurable via `names`.

Complexity and maintainability (shipped as advisory warnings you can promote to
errors with `severity`):

- **python-function-args** — functions with more than `max_args` parameters
  (default 6; `self`/`cls` excluded).
- **python-function-length** — functions longer than `max_lines` (default 60).
- **python-nesting-depth** — control flow nested deeper than `max_depth`
  (default 4) inside a function.

```json
{
  "id": "python-function-length",
  "type": "python-function-length",
  "severity": "warning",
  "max_lines": 60,
  "include": ["src/**/*.py"]
}
```

## How to use this guide

Use these rules as a quick reference when a check fails. If a violation appears,
fix the underlying issue in the code rather than trying to silence the rule.
The goal is to keep changes small, clear, and reviewable.
