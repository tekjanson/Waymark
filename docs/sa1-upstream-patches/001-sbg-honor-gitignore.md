# SA1 Upstream Patch 001 — slop-be-gone honors `.gitignore`

> These patches target the **SpamApply1** repo, which is vendored locally and not
> a git repo in this workspace. Apply them upstream and open a SpamApply1 PR. The
> on-disk source that `make gates` uses has already been patched so Waymark's
> gates pass; this file is the portable record for the upstream change.

**Target file:** `slop-be-gone/src/sbg/engine.py`
**Method:** `RuleEngine._load_ignore_selectors`
**Test added:** `slop-be-gone/tests/test_engine.py::test_gitignore_excludes_matching_paths`

## Why

`make gates` failed on files that are gitignored and therefore not part of the
repo: `.env`, `dev-worker/dream-run.log`, `server/.git-repo/**`. A hygiene gate
must never scan files git already ignores. Previously `_load_ignore_selectors`
read only `.sbgignore`, forcing every consumer to duplicate their `.gitignore`.

## Change (full replacement of `_load_ignore_selectors`)

```python
    def _load_ignore_selectors(self, repo_root: Path) -> list[re.Pattern[str]]:
        # Honor both the tool-specific .sbgignore and the repo's .gitignore so
        # untracked build artifacts, logs, and secrets never trigger false
        # positives. Files git already ignores are not part of the repo and
        # must not be scanned by a hygiene gate.
        selectors: list[re.Pattern[str]] = []
        for ignore_name in (".sbgignore", ".gitignore"):
            ignore_file = repo_root / ignore_name
            try:
                text = ignore_file.read_text(encoding="utf-8")
            except (FileNotFoundError, OSError, UnicodeDecodeError):
                continue
            for raw_line in text.splitlines():
                line = raw_line.strip()
                if not line or line.startswith("#"):
                    continue
                # Negation rules (git "un-ignore") can't be modeled by a flat
                # allow-list, so skip them rather than over-exclude.
                if line.startswith("!"):
                    continue
                # A leading slash anchors to the repo root in gitignore syntax;
                # our selectors are already root-relative, so drop it.
                line = line.lstrip("/")
                trailing_dir = line.endswith("/")
                base = line.rstrip("/")
                if not base:
                    continue
                # Gitignore semantics: a pattern without a slash matches at any
                # depth, so also anchor it under every directory ("**/base").
                anchors = [base]
                if "/" not in base:
                    anchors.append(f"**/{base}")
                patterns: list[str] = []
                for anchor in anchors:
                    if trailing_dir:
                        patterns.append(f"{anchor}/**")
                    else:
                        patterns.append(anchor)
                        if "*" not in anchor and "?" not in anchor:
                            patterns.append(f"{anchor}/**")
                for pattern in patterns:
                    selectors.append(self._glob_to_regex(pattern))
        return selectors
```

## Test (append in `tests/test_engine.py`)

```python
    def test_gitignore_excludes_matching_paths(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            repo_root = Path(temp_dir)
            (repo_root / "keep.py").write_text("# placeholder\n", encoding="utf-8")
            (repo_root / "logs").mkdir()
            (repo_root / "logs" / "run.log").write_text("# placeholder\n", encoding="utf-8")
            (repo_root / ".env").write_text("# placeholder\n", encoding="utf-8")
            (repo_root / ".gitignore").write_text("*.log\n/.env\n", encoding="utf-8")
            engine = RuleEngine({"rules": [{"id": "placeholder-comments",
                "type": "placeholder-comments", "enabled": True,
                "patterns": ["placeholder"]}]})
            violations = engine.scan_repository(repo_root)
            self.assertEqual({v.path for v in violations}, {"keep.py"})
```

Result: `slop-be-gone` suite 57 → 58 tests, all green.
