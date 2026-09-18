/* ============================================================
   lib/agent-harness.js — Agentic coding harness (ReAct tool loop)

   Turns a plain text/JSON LLM into a real coding agent that operates the
   repository through TOOLS, one action per turn, iterating until the task's
   tests pass. This is the "coding harness" layer that distinguishes a serious
   autonomous engineer from a single-shot code generator.

   Design borrows the proven ideas from open-source coding agents:
     • SWE-agent's Agent-Computer Interface — a small, well-documented set of
       tools (view/edit/search/run) with structured observations fed back.
     • Aider's edit model — precise SEARCH/REPLACE edits over full-file rewrites,
       plus a compact repo map for orientation.
     • The lint / test → fix loop — after each edit we can run checks, and
       `finish` re-runs the test command; a failing finish does NOT end the
       episode, it feeds the failure back so the agent self-corrects.
     • ReAct — every turn is {thought, tool, args}; observations drive the next
       action.

   The harness is model-agnostic: it takes a `complete({system, contents,
   temperature})` function that returns { text, keyIndex }. Wiring it to the
   Gemini key-pool client keeps rate-limit rotation working across every turn.
   It is also fully testable — inject a scripted `complete` and a temp workdir.

   Returns: {
     passed, done, summary, testCommand,
     filesTouched: string[],   // relative paths the agent created/edited
     turns, keyIndex, transcriptTail
   }
   ============================================================ */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { tryParseJSON } = require('./gemini');

const MAX_OBS = 6000; // max characters returned to the model per observation
const READ_MAX_LINES = 240;

/* ---------- Commands the agent is never allowed to run ---------- */
// Pushing is owned by the finalize step, not the agent. The rest are guards
// against destructive or host-affecting operations.
const BLOCKED = [
  /\brm\s+-rf?\s+[/~]/, /\bgit\s+push\b/, /\bsudo\b/, /\bshutdown\b/, /\breboot\b/,
  /\bmkfs\b/, /\bdd\s+if=/, />\s*\/dev\/sd/, /:\(\)\s*\{/, /\bcurl\b[^\n|]*\|\s*(ba)?sh/,
  /\bwget\b[^\n|]*\|\s*(ba)?sh/, /\bchmod\s+-R\s+777\s+\//,
];

const SYSTEM = `You are an autonomous software engineer working INSIDE a real repository.
You operate a computer through TOOLS — exactly one action per turn — until the
task is implemented AND its tests pass.

Obey the Waymark repository rules (.github/instructions/AI_laws.instructions.md):
vanilla ES modules + raw CSS, no frameworks, no build step, DOM via el() only,
Google API calls go through api-client.js, templates import only from shared.js,
tests are flat test() calls using CSS selectors only.

PROTOCOL — respond with EXACTLY ONE JSON object and NOTHING else:
{"thought":"brief reasoning","tool":"<name>","args":{ ... }}

TOOLS:
- list_files {"dir":"optional/prefix"}                       list tracked files
- read_file  {"path":"p","start":1,"end":120}               show a file with line numbers
- search     {"pattern":"regex","path":"optional/prefix"}   grep the repo
- write_file {"path":"p","content":"FULL new file content"} create or overwrite a file
- edit_file  {"path":"p","search":"EXACT text","replace":"new text"}  precise in-place edit
- run        {"cmd":"shell command"}                        run a test/check (bounded)
- finish     {"summary":"one line","testCommand":"cmd that proves it works"}

RULES:
1. Explore BRIEFLY (a few list_files / search / read_file turns), then ACT. Do
   not re-list or re-search the same thing — after ~5 exploration turns you must
   make your first edit.
2. Use FULL repository-relative paths exactly as shown in the repo map and search
   results (e.g. public/js/templates/shared.js, NOT shared.js). A bare filename
   will not resolve.
3. Every tool needs its required args: search needs "pattern", read_file/edit_file/
   write_file need "path". Never emit an action with empty args.
4. Prefer edit_file for existing files. The "search" text must appear EXACTLY once.
5. Verify with run before finishing — prefer a SINGLE scoped test spec or
   'node --check <file>' over the whole suite so feedback is fast.
6. finish re-runs testCommand. If it FAILS you must keep going and fix it —
   a failing finish does not end the task.
7. Keep changes minimal and correct. Never output prose outside the JSON action.`;

class Harness {
  /**
   * @param {Object} opts
   * @param {(a:{system:string,contents:any[],temperature:number}) => Promise<{text:string,keyIndex:number}>} opts.complete
   * @param {string} opts.workdir — directory the agent operates in
   * @param {(...a:any)=>void} [opts.log]
   * @param {number} [opts.maxTurns] — hard cap on agent turns (default 24)
   * @param {number} [opts.runTimeoutMs] — per-command timeout (default 300000)
   */
  constructor({ complete, workdir, log, maxTurns = 24, runTimeoutMs = 300000 }) {
    this.complete = complete;
    this.workdir = path.resolve(workdir);
    this.log = log || (() => {});
    this.maxTurns = maxTurns;
    this.runTimeoutMs = runTimeoutMs;
    this.filesTouched = new Set();
    this.lastKeyIndex = undefined;
  }

  /** Build a compact repository map to orient the agent on turn one. */
  repoMap() {
    const files = this._sh('git', ['ls-files']).out.split('\n').filter(Boolean);
    const groups = {};
    for (const f of files) {
      const top = f.includes('/') ? `${f.split('/')[0]}/` : f;
      groups[top] = (groups[top] || 0) + 1;
    }
    const summary = Object.entries(groups)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 40)
      .map(([k, v]) => `  ${k} (${v})`)
      .join('\n');
    return `Repository layout (${files.length} tracked files):\n${summary}`;
  }

  /**
   * Drive the agent loop for one task.
   * @returns {Promise<Object>} result (see file header)
   */
  async run({ task, desc, avoid = [], temperature = 0.6 }) {
    const avoidBlock = avoid.length
      ? `\nApproaches that ALREADY FAILED — do NOT repeat them:\n${avoid.map((a, i) => `  ${i + 1}. ${a}`).join('\n')}\n`
      : '';
    const first =
      `TASK: ${task}\nDETAILS: ${desc || '(none)'}\n${avoidBlock}\n${this.repoMap()}\n\n` +
      `Begin. Respond with one JSON action.`;

    const contents = [{ role: 'user', parts: [{ text: first }] }];
    let result = { passed: false, done: false, summary: 'did not finish', testCommand: 'npm test' };

    // Weaker models over-explore and never commit to an edit. Once this many
    // turns pass with no edit, we escalate a firm directive to force action.
    const exploreBudget = Math.max(4, Math.ceil(this.maxTurns * 0.4));
    let edited = false;

    // Firm nudge appended to observations once exploration has gone on too long.
    const directive = (turn) => {
      if (edited || turn < exploreBudget) return '';
      const last = turn >= this.maxTurns - 2;
      return (
        `\n\n[DIRECTIVE] ${turn}/${this.maxTurns} turns used and NO edit made yet. ` +
        (last
          ? 'This is your LAST chance — your next action MUST be edit_file or write_file that implements the task, then finish.'
          : 'STOP exploring. Your NEXT action MUST be edit_file or write_file that implements the task. A reasonable edit beats more searching.')
      );
    };

    // `turn` counts only PRODUCTIVE actions against the budget. Malformed
    // replies and actions that produce an ERROR observation (e.g. a search with
    // no pattern) are free retries — weak models waste many turns on these, and
    // charging them for it starves the real work. Bounded by maxIter so a model
    // stuck emitting junk still terminates.
    let turn = 0;
    const maxIter = this.maxTurns + 10;
    for (let iter = 0; turn < this.maxTurns && iter < maxIter; iter++) {
      let text;
      let keyIndex;
      try {
        ({ text, keyIndex } = await this.complete({ system: SYSTEM, contents, temperature }));
      } catch (e) {
        this.log(`  [harness] model call failed: ${e.message}`);
        break;
      }
      this.lastKeyIndex = keyIndex;
      contents.push({ role: 'model', parts: [{ text }] });

      const action = tryParseJSON(text);
      if (!action || !action.tool) {
        contents.push(obs(`ERROR: your reply was not a valid JSON action. Reply with EXACTLY one JSON object {"thought":...,"tool":...,"args":{...}}.${directive(turn)}`));
        continue; // free retry
      }
      this.log(`  [harness] turn ${turn + 1}: ${action.tool} ${short(JSON.stringify(action.args || {}))}`);

      if (action.tool === 'finish') {
        const testCommand = (action.args && (action.args.testCommand || action.args.test)) || 'npm test';
        const summary = (action.args && action.args.summary) || 'change';
        const test = this._run(testCommand);
        if (test.passed) {
          result = { passed: true, done: true, summary, testCommand };
          break;
        }
        // Failing finish → feed the failure back and keep going (counts as a turn).
        contents.push(obs(`Tests FAILED for \`${testCommand}\` (exit ${test.code}). Fix the problem and finish again.\n${test.tail}`));
        result = { passed: false, done: false, summary, testCommand, transcriptTail: test.tail };
        turn++;
        continue;
      }

      if (action.tool === 'write_file' || action.tool === 'edit_file') edited = true;

      // Hard rail: once the explore budget is spent with no edit, block the pure
      // discovery tools. A soft directive isn't enough for weak models — they
      // keep searching forever. read_file stays allowed so the model can grab the
      // exact lines it needs to form a precise edit.
      if (!edited && turn >= exploreBudget && (action.tool === 'list_files' || action.tool === 'search')) {
        contents.push(obs(
          `Exploration is DISABLED now (${turn}/${this.maxTurns} turns used, no edit yet). ` +
          `Valid actions: read_file (only to prepare an edit), edit_file, write_file, finish. Make your edit NOW.`
        ));
        continue; // free retry (bounded by maxIter)
      }

      const observation = this._exec(action);
      contents.push(obs(observation + directive(turn)));
      // Only productive actions consume the budget; errored ones are free retries.
      if (!/^ERROR:/.test(observation)) turn++;
    }

    return {
      ...result,
      filesTouched: [...this.filesTouched],
      turns: contents.filter((c) => c.role === 'model').length,
      keyIndex: this.lastKeyIndex,
      transcriptTail: result.transcriptTail || short(lastUserText(contents), 1200),
    };
  }

  /* ---------- Tool executor ---------- */

  _exec(action) {
    const a = action.args || {};
    try {
      switch (action.tool) {
        case 'list_files':
          return this._listFiles(a.dir);
        case 'read_file':
          return this._readFile(a.path, a.start, a.end);
        case 'search':
          return this._search(a.pattern, a.path);
        case 'write_file':
          return this._writeFile(a.path, a.content);
        case 'edit_file':
          return this._editFile(a.path, a.search, a.replace);
        case 'run':
          return this._runObs(a.cmd);
        default:
          return `ERROR: unknown tool "${action.tool}". Valid: list_files, read_file, search, write_file, edit_file, run, finish.`;
      }
    } catch (e) {
      return `ERROR: ${e.message}`;
    }
  }

  /* ---------- Tools ---------- */

  _listFiles(dir) {
    const args = ['ls-files'];
    if (dir) args.push('--', dir);
    const files = this._sh('git', args).out.split('\n').filter(Boolean);
    const shown = files.slice(0, 200).join('\n');
    return cap(`${files.length} file(s)${dir ? ` under ${dir}` : ''}:\n${shown}`);
  }

  _readFile(rel, start, end) {
    const abs = this._safe(rel);
    if (!fs.existsSync(abs)) return `ERROR: ${rel} does not exist`;
    const lines = fs.readFileSync(abs, 'utf8').split('\n');
    const s = Math.max(1, parseInt(start || 1, 10));
    const e = Math.min(lines.length, parseInt(end || s + READ_MAX_LINES - 1, 10), s + READ_MAX_LINES - 1);
    const body = lines.slice(s - 1, e).map((l, i) => `${s + i}\t${l}`).join('\n');
    return cap(`[${rel} lines ${s}-${e} of ${lines.length}]\n${body}`);
  }

  _search(pattern, dir) {
    if (!pattern) return 'ERROR: search requires a "pattern"';
    let r = this._sh('git', ['grep', '-n', '-I', '-E', '-e', pattern, ...(dir ? ['--', dir] : [])]);
    if (r.code !== 0 && !r.out.trim()) {
      r = this._sh('grep', ['-rIn', '-E', pattern, dir || '.']);
    }
    const lines = r.out.split('\n').filter(Boolean).slice(0, 80).join('\n');
    return cap(lines ? `Matches for /${pattern}/:\n${lines}` : `No matches for /${pattern}/`);
  }

  _writeFile(rel, content) {
    if (typeof content !== 'string') return 'ERROR: write_file requires string "content"';
    const abs = this._safe(rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
    this.filesTouched.add(this._rel(abs));
    return `Wrote ${this._rel(abs)} (${Buffer.byteLength(content)} bytes).${this._lint(abs)}`;
  }

  _editFile(rel, search, replace) {
    if (typeof search !== 'string' || typeof replace !== 'string') {
      return 'ERROR: edit_file requires string "search" and "replace"';
    }
    const abs = this._safe(rel);
    if (!fs.existsSync(abs)) return `ERROR: ${rel} does not exist — use write_file to create it`;
    const body = fs.readFileSync(abs, 'utf8');
    const count = body.split(search).length - 1;
    if (count === 0) return `ERROR: the search text was not found in ${rel}. Read the file and copy the exact text.`;
    if (count > 1) return `ERROR: the search text matches ${count} times in ${rel}. Add surrounding context to make it unique.`;
    const updated = body.replace(search, replace);
    fs.writeFileSync(abs, updated);
    this.filesTouched.add(this._rel(abs));
    return `Edited ${this._rel(abs)}.${this._lint(abs)}`;
  }

  _runObs(cmd) {
    const r = this._run(cmd);
    return cap(`$ ${cmd}\nexit ${r.code}\n${r.tail}`);
  }

  /* ---------- Internals ---------- */

  /** Resolve a repo-relative path, rejecting traversal outside the workdir. */
  _safe(rel) {
    if (typeof rel !== 'string' || !rel) throw new Error('a "path" is required');
    const abs = path.resolve(this.workdir, rel.replace(/^\/+/, ''));
    if (abs !== this.workdir && !abs.startsWith(this.workdir + path.sep)) {
      throw new Error(`path "${rel}" escapes the workspace`);
    }
    return abs;
  }

  _rel(abs) {
    return path.relative(this.workdir, abs);
  }

  /** Quick syntax feedback for JS files after an edit (the lint-fix loop). */
  _lint(abs) {
    if (!/\.(js|mjs|cjs)$/.test(abs)) return '';
    const r = this._sh('node', ['--check', abs]);
    return r.code === 0 ? ' Syntax OK.' : ` SYNTAX ERROR: ${short(r.out, 300)}`;
  }

  /** Run a shell command (guarded + bounded). Returns { passed, code, tail }. */
  _run(cmd) {
    if (!cmd || typeof cmd !== 'string') return { passed: false, code: -1, tail: 'no command' };
    if (BLOCKED.some((re) => re.test(cmd))) {
      return { passed: false, code: -1, tail: 'command blocked for safety (pushing/destructive ops are not allowed here)' };
    }
    const r = spawnSync('bash', ['-lc', cmd], {
      cwd: this.workdir,
      encoding: 'utf8',
      timeout: this.runTimeoutMs,
      env: { ...process.env, CI: '1' },
    });
    const out = (r.stdout || '') + (r.stderr || '');
    return { passed: r.status === 0 && !r.error, code: r.status ?? -1, tail: out.slice(-1800) };
  }

  _sh(bin, args) {
    const r = spawnSync(bin, args, { cwd: this.workdir, encoding: 'utf8' });
    return { code: r.status ?? 1, out: (r.stdout || '') + (r.stderr || '') };
  }
}

/* ---------- helpers ---------- */

function obs(text) {
  return { role: 'user', parts: [{ text: cap(text) }] };
}
function cap(s, n = MAX_OBS) {
  s = s == null ? '' : String(s);
  return s.length > n ? `${s.slice(0, n)}\n…[truncated ${s.length - n} chars]` : s;
}
function short(s, n = 120) {
  s = s == null ? '' : String(s);
  return s.length > n ? `${s.slice(0, n)}…` : s;
}
function lastUserText(contents) {
  for (let i = contents.length - 1; i >= 0; i--) {
    if (contents[i].role === 'user') return contents[i].parts[0].text;
  }
  return '';
}

module.exports = { Harness, SYSTEM, BLOCKED };
