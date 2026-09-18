#!/usr/bin/env node
/* ============================================================
   dream-rsi.js — Gemini Dream-RSI task handler

   The Gemini-engine counterpart to the Copilot builder loop. One invocation
   solves ONE claimed workboard task through a recursive self-improvement
   cycle:

     1. dream_evaluator  — read the Discovery_Tree, simulate prior paths,
                           and collect the dead ends to avoid.
     2. solve            — run an AGENTIC harness: the model explores the repo
                           and edits it through tools (read/search/edit/run),
                           iterating with test feedback until the tests pass.
     3. reflect          — on failure, distil a one-line lesson (Reflexion) so
                           the next attempt avoids the same dead end.
     4. adapt            — if the task is stuck (repeated failures), FAN OUT:
                           run N agentic attempts in parallel across N keys in
                           isolated git worktrees, merge the winner, and log
                           every dead end back to the tree.
     5. record           — log the outcome to the Discovery_Tree and update
                           the workboard (→ QA on success, note on failure).

   Invoked by agent-runner.sh when ACTIVE_AGENT=gemini:
     node dream-rsi.js --row 42 --task "Add search bar" --desc "..."

   Env (see .env.example):
     GEMINI_KEY_POOL, GEMINI_MODEL, GEMINI_KEY_COOLDOWN_MS
     GOOGLE_APPLICATION_CREDENTIALS
     WAYMARK_WORKBOARD_ID, DISCOVERY_TREE_SHEET_ID, DISCOVERY_TREE_TAB
     DREAM_FANOUT_N (default 3), DREAM_TEST_TIMEOUT_MS (default 600000)
     DREAM_MAX_TURNS (default 24), DREAM_PUSH (default 1)
     DREAM_EVAL_ENABLED (1), DREAM_EVAL_THRESHOLD (0.7), DREAM_EVAL_RETRIES (1)
     AGENT_HUMAN_NAME, WORKSPACE_DIR (default /workspace)
   ============================================================ */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const { KeyManager } = require('./key-manager');
const { GeminiClient } = require('./lib/gemini');
const { createSheetsClient } = require('./lib/sheets');
const { DiscoveryTree, STATUS } = require('./discovery-tree');
const { Harness } = require('./lib/agent-harness');
const { Evaluator } = require('./lib/evaluator');

/* ---------- Config ---------- */

const WORKSPACE = process.env.WORKSPACE_DIR || '/workspace';
const WORKBOARD_ID = process.env.WAYMARK_WORKBOARD_ID || '';
const TREE_SHEET_ID = process.env.DISCOVERY_TREE_SHEET_ID || WORKBOARD_ID;
const KEY_FILE = process.env.GOOGLE_APPLICATION_CREDENTIALS || '/credentials/gsa-key.json';
const FANOUT_N = parseInt(process.env.DREAM_FANOUT_N || '3', 10);
const MAX_TURNS = parseInt(process.env.DREAM_MAX_TURNS || '24', 10);
const TEST_TIMEOUT_MS = parseInt(process.env.DREAM_TEST_TIMEOUT_MS || '600000', 10);
const EVAL_ENABLED = process.env.DREAM_EVAL_ENABLED !== '0';
const EVAL_THRESHOLD = parseFloat(process.env.DREAM_EVAL_THRESHOLD || '0.7');
const EVAL_RETRIES = parseInt(process.env.DREAM_EVAL_RETRIES || '1', 10);
const PUSH = process.env.DREAM_PUSH !== '0';
// After this many failed attempts on a row, PARK it (return to Backlog at P3) so
// the loop stops spinning on one hard task and rotates to the rest of the board.
const MAX_ROW_ATTEMPTS = parseInt(process.env.DREAM_MAX_ROW_ATTEMPTS || '3', 10);
const AGENT = process.env.AGENT_HUMAN_NAME || 'Gemini';
const WORKBOARD_TAB = process.env.WAYMARK_WORKBOARD_TAB || 'Sheet1';

function log(...a) {
  console.log(`[dream-rsi ${new Date().toISOString().slice(11, 19)}]`, ...a);
}

/* ---------- CLI parsing ---------- */

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const k = argv[i].slice(2);
      const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
      out[k] = v;
    }
  }
  return out;
}

/* ---------- Git / shell helpers ---------- */

function git(args, cwd = WORKSPACE) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  return { code: r.status ?? 1, out: (r.stdout || '') + (r.stderr || '') };
}

/**
 * Safely write files into `dir`. Rejects path traversal and absolute paths so a
 * bad response can never escape the workspace. Used to merge a fan-out winner's
 * files from its worktree back into the main workspace.
 */
function applyFiles(dir, files) {
  const written = [];
  for (const f of files || []) {
    if (!f || typeof f.path !== 'string' || typeof f.content !== 'string') continue;
    const rel = f.path.replace(/^\/+/, '');
    const abs = path.resolve(dir, rel);
    if (!abs.startsWith(path.resolve(dir) + path.sep)) {
      log(`  ! skipping unsafe path: ${f.path}`);
      continue;
    }
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, f.content);
    written.push(rel);
  }
  return written;
}

/** Read the given relative files from a worktree → [{ path, content }]. */
function readTouched(dir, relPaths) {
  const out = [];
  for (const rel of relPaths || []) {
    const abs = path.resolve(dir, rel);
    if (abs.startsWith(path.resolve(dir)) && fs.existsSync(abs) && fs.statSync(abs).isFile()) {
      out.push({ path: rel, content: fs.readFileSync(abs, 'utf8') });
    }
  }
  return out;
}

/**
 * Build a review diff for the given files: `git diff` for tracked changes, full
 * body for new files. Bounded so the judge prompt stays compact.
 */
function computeDiff(dir, files) {
  let out = '';
  for (const rel of files || []) {
    const tracked = git(['ls-files', '--error-unmatch', rel], dir).code === 0;
    if (tracked) {
      const d = git(['diff', '--no-color', 'HEAD', '--', rel], dir).out;
      if (d.trim()) out += `${d}\n`;
    } else {
      const abs = path.resolve(dir, rel);
      if (fs.existsSync(abs)) {
        out += `\n+++ NEW FILE ${rel}\n${fs.readFileSync(abs, 'utf8').slice(0, 4000)}\n`;
      }
    }
  }
  return out.slice(0, 12000);
}

/* ---------- The Dream-RSI engine ---------- */

class DreamRSI {
  constructor({ gemini, tree, sheets, keyManager }) {
    this.gemini = gemini;
    this.tree = tree;
    this.sheets = sheets;
    this.km = keyManager;
    this.evaluator = new Evaluator(gemini, { threshold: EVAL_THRESHOLD, enabled: EVAL_ENABLED, log });
    this.liveRow = null;
    this.currentTaskRow = null;
  }

  /** Adapter: one agent turn through the rotating key pool → { text, keyIndex }. */
  _complete(args) {
    return this.gemini.generateContents({
      ...args,
      responseMimeType: 'application/json',
      maxOutputTokens: 2048,
    });
  }

  /**
   * Run ONE agentic attempt: the harness explores `workdir` and edits it with
   * tools until the scoped tests pass (or the turn budget is spent).
   * @returns harness result { passed, summary, testCommand, filesTouched, ... }
   */
  async runAttempt({ workdir, task, desc, avoid, temperature }) {
    const harness = new Harness({
      complete: (a) => this._complete(a),
      workdir,
      log,
      maxTurns: MAX_TURNS,
      runTimeoutMs: TEST_TIMEOUT_MS,
    });
    harness.onProgress = async ({ turn, tool }) => {
      await this.setLiveStatus(`Turn ${turn}/${MAX_TURNS}: ${tool}`);
    };
    return harness.run({ task, desc, avoid, temperature });
  }

  /**
   * Solve a task, then SELF-JUDGE the result. A passing attempt is only accepted
   * if the LLM-as-judge approves it — this guards against test gaming and
   * off-scope work. On a rejected-but-passing attempt the judge's issues are fed
   * back to the harness for up to `retries` self-repair rounds.
   * @returns { passed(=approved), testsPassed, summary, testCommand,
   *            filesTouched(union), evalScore, evalVerdict, evalIssues, ... }
   */
  async solveWithReview({ row, workdir, task, desc, avoid, temperature, retries = EVAL_RETRIES }) {
    this.currentTaskRow = row || null;
    const touched = new Set();
    await this.setLiveStatus(`Starting attempt for ${task}`);
    let r = await this.runAttempt({ workdir, task, desc, avoid, temperature });
    (r.filesTouched || []).forEach((f) => touched.add(f));

    // No judge (disabled or tests already failed) → tests are the only signal.
    let ev = { approved: r.passed, score: r.passed ? 1 : 0, verdict: r.passed ? 'approve' : 'reject', issues: [], skipped: true };

    if (r.passed && this.evaluator.enabled) {
      await this.setLiveStatus(`Tests passed; running review for ${task}`);
      ev = await this.evaluator.judge({
        task,
        desc,
        diff: computeDiff(workdir, [...touched]),
        testCommand: r.testCommand,
        testOutput: r.transcriptTail,
      });
      log(`  ⚖ review: ${ev.verdict} (score ${ev.score})${ev.testGaming ? ' — TEST GAMING detected' : ''}`);

      let tries = 0;
      while (!ev.approved && tries < retries) {
        tries++;
        await this.setLiveStatus(`Reviewer asked for another pass (${tries}/${retries})`);
        log(`  ↻ self-repair ${tries}/${retries} — feeding reviewer issues back`);
        const feedback = `${desc || ''}\n\nA REVIEWER REJECTED the previous attempt. Address ALL of these, then finish again:\n- ${ev.issues.join('\n- ')}`;
        r = await this.runAttempt({ workdir, task, desc: feedback, avoid, temperature });
        (r.filesTouched || []).forEach((f) => touched.add(f));
        if (!r.passed) {
          ev = { approved: false, score: 0, verdict: 'reject', issues: [...(ev.issues || []), 'tests failed after self-repair'] };
          break;
        }
        ev = await this.evaluator.judge({
          task,
          desc,
          diff: computeDiff(workdir, [...touched]),
          testCommand: r.testCommand,
          testOutput: r.transcriptTail,
        });
        log(`  ⚖ review: ${ev.verdict} (score ${ev.score})`);
      }
    }

    return {
      passed: r.passed && ev.approved,
      testsPassed: r.passed,
      summary: r.summary,
      testCommand: r.testCommand,
      filesTouched: [...touched],
      evalScore: ev.score,
      evalVerdict: ev.verdict,
      evalIssues: ev.issues || [],
      keyIndex: r.keyIndex,
      transcriptTail: r.transcriptTail,
    };
  }

  async setLiveStatus(text) {
    if (!WORKBOARD_ID || !this.sheets || !text || !this.currentTaskRow) return;
    if (!this.liveRow) {
      this.liveRow = await this.addNoteRow(`Dream-RSI live: ${text}`, this.currentTaskRow);
      return;
    }
    await this.updateNote(this.liveRow, `Dream-RSI live: ${text}`);
  }

  /**
   * Reflexion — turn a failed attempt into a one-sentence lesson so it becomes
   * a concrete dead end in the Discovery_Tree and a concrete "avoid" next time.
   */
  async reflect({ task, tail }) {
    try {
      const { text } = await this.gemini.generate({
        system: 'You analyse a failed coding attempt. Reply in ONE concise sentence.',
        prompt: `Task: ${task}\nFailure output:\n${(tail || '').slice(-1200)}\n\nIn one sentence: what should the next attempt AVOID and try differently?`,
        temperature: 0.4,
        maxOutputTokens: 120,
      });
      return (text || '').trim().slice(0, 200) || (tail || '').slice(-160);
    } catch {
      return (tail || '').slice(-160);
    }
  }

  /**
   * Adaptive fan-out: run N independent agentic attempts in parallel across N
   * keys, each in an isolated git worktree. The model calls overlap across the
   * key pool; subprocess/test execution serialises naturally so test runs never
   * collide. Returns the winner (its edited files) + all attempts for logging.
   */
  async fanOut({ row, task, desc, avoid, baseTemp, parentId }) {
    const n = Math.max(1, Math.min(FANOUT_N, Math.max(1, this.km.availableCount() || this.km.size)));
    log(`  ⇉ fanning out ${n} agentic attempts across the key pool`);
    const worktrees = [];
    try {
      const attempts = await Promise.all(
        Array.from({ length: n }, async (_, i) => {
          const branchId = this.tree.newBranchId(row);
          let wt;
          try {
            wt = this._makeWorktree(`${row}-${i}`);
            worktrees.push(wt);
          } catch (e) {
            return { passed: false, summary: `worktree failed: ${e.message}`, filesTouched: [], branchId };
          }
          try {
            // Each fan-out attempt is judged; diversity comes from N, so no
            // per-attempt self-repair (retries: 0). Best review score wins.
            const s = await this.solveWithReview({
              workdir: wt,
              task,
              desc,
              avoid,
              temperature: Math.min(baseTemp + i * 0.15, 1.0),
              retries: 0,
            });
            return { ...s, branchId, wt };
          } catch (e) {
            return { passed: false, testsPassed: false, evalScore: -1, summary: String(e.message || e), filesTouched: [], branchId, wt };
          }
        })
      );

      // Log every branch to the Discovery_Tree with its review score.
      for (const a of attempts) {
        await this.tree.logAttempt({
          branchId: a.branchId,
          parentId,
          taskRow: row,
          task,
          prompt: a.summary,
          status: a.passed ? STATUS.PASS : STATUS.DEAD_END,
          tests: a.testsPassed ? 'pass' : 'fail',
          result: a.passed
            ? `${a.summary} (review ${a.evalScore})`
            : ((a.evalIssues && a.evalIssues.length) ? a.evalIssues.join('; ') : (a.transcriptTail || a.summary || '')).slice(-160),
          keyIndex: a.keyIndex,
          score: a.testsPassed ? (a.evalScore ?? 0) : -1,
        });
      }

      // Best-of-N: among JUDGE-APPROVED attempts, the highest review score wins.
      const winner =
        attempts.filter((a) => a.passed).sort((x, y) => (y.evalScore || 0) - (x.evalScore || 0))[0] || null;
      const files = winner && winner.wt ? readTouched(winner.wt, winner.filesTouched) : [];
      return { winner: winner ? { ...winner, files } : null, attempts };
    } finally {
      for (const wt of worktrees) this._removeWorktree(wt);
    }
  }

  _makeWorktree(label) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `dream-${label}-`));
    const wt = path.join(dir, 'wt');
    const r = git(['worktree', 'add', '--detach', wt, 'HEAD']);
    if (r.code !== 0) throw new Error(`git worktree add failed: ${r.out}`);
    // Share the installed dependencies so tests run without reinstalling.
    const nm = path.join(WORKSPACE, 'node_modules');
    if (fs.existsSync(nm)) {
      try {
        fs.symlinkSync(nm, path.join(wt, 'node_modules'), 'dir');
      } catch {
        /* symlink may already exist — ignore */
      }
    }
    return wt;
  }

  _removeWorktree(wt) {
    git(['worktree', 'remove', '--force', wt]);
    try {
      fs.rmSync(path.dirname(wt), { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  }

  /* ---------- Workboard writes (AI_LAWS §15 note sub-rows) ---------- */

  async markStage(row, stage) {
    if (!WORKBOARD_ID) return;
    await this.sheets.update(`${WORKBOARD_TAB}!C${row}`, [[stage]]);
  }

  async setPriority(row, priority) {
    if (!WORKBOARD_ID || !row) return;
    await this.sheets.update(`${WORKBOARD_TAB}!F${row}`, [[priority]]);
  }

  async addNote(row, text) {
    return this.addNoteRow(text, row);
  }

  async addNoteRow(text, row = null) {
    if (!WORKBOARD_ID || !row) return;
    const gid = await this.sheets.getTabGid(WORKBOARD_TAB);
    if (gid === null) return;
    // Insert a blank sub-row directly below the task row, then fill it:
    // col A empty (marks sub-row), E = author, G = date, I = note text.
    const newRow = await this.sheets.insertRowAfter(gid, Number(row));
    const today = new Date().toISOString().slice(0, 10);
    await this.sheets.update(`${WORKBOARD_TAB}!A${newRow}:I${newRow}`, [
      ['', '', '', '', AGENT, '', today, '', text],
    ]);
    return newRow;
  }

  async updateNote(row, text) {
    if (!WORKBOARD_ID || !row) return;
    const today = new Date().toISOString().slice(0, 10);
    await this.sheets.update(`${WORKBOARD_TAB}!A${row}:I${row}`, [
      ['', '', '', '', AGENT, '', today, '', text],
    ]);
  }
}

/* ---------- Orchestration ---------- */

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const row = args.row || '';
  const task = args.task || process.env.AGENT_COMMAND || '';
  const desc = args.desc || '';

  // --reset-tree: wipe the Discovery_Tree memory and exit (clean-experiment aid).
  if (args['reset-tree']) {
    const sheets = TREE_SHEET_ID
      ? createSheetsClient({ keyFile: KEY_FILE, spreadsheetId: TREE_SHEET_ID })
      : null;
    if (!sheets) {
      log('No DISCOVERY_TREE_SHEET_ID / WAYMARK_WORKBOARD_ID configured — nothing to reset');
      process.exit(0);
    }
    const r = await new DiscoveryTree(sheets).clear();
    log(r.cleared ? 'Discovery_Tree cleared' : 'No Discovery_Tree tab to clear');
    process.exit(0);
  }

  if (!task) {
    log('No task provided (--task) — nothing to do');
    process.exit(0);
  }

  // Ensure git trusts the (bind-mounted, often root-owned) workspace. The
  // container entrypoint normally sets this, but when the handler is invoked
  // with a bypassed entrypoint (e.g. `make dream-run` uses --entrypoint bash),
  // safe.directory is unset and EVERY git call fails with "dubious ownership" —
  // which silently breaks the harness's git ls-files/grep tools, fan-out
  // worktrees, and the finalize commit/push. Configure it defensively here.
  git(['config', '--global', '--add', 'safe.directory', WORKSPACE]);
  git(['config', '--global', '--add', 'safe.directory', '*']);

  const km = KeyManager.fromEnv();
  if (km.size === 0) {
    log('ERROR: GEMINI_KEY_POOL is empty. Set it in .env — see .env.example');
    process.exit(2);
  }
  log(`Key pool: ${km.size} key(s), ${km.availableCount()} available`);

  const gemini = new GeminiClient(km, { log });
  const sheets = TREE_SHEET_ID
    ? createSheetsClient({ keyFile: KEY_FILE, spreadsheetId: TREE_SHEET_ID })
    : null;
  const wbSheets = WORKBOARD_ID
    ? createSheetsClient({ keyFile: KEY_FILE, spreadsheetId: WORKBOARD_ID })
    : null;

  if (!sheets) {
    log('WARNING: no DISCOVERY_TREE_SHEET_ID / WAYMARK_WORKBOARD_ID — memory disabled');
  }
  const tree = sheets ? new DiscoveryTree(sheets) : nullTree();
  if (sheets) {
    const prov = await tree.ensureProvisioned().catch((e) => ({ error: e.message }));
    if (prov && prov.created) log(`Provisioned Discovery_Tree tab`);
  }

  const engine = new DreamRSI({ gemini, tree, sheets: wbSheets || sheets, keyManager: km });

  // ── 1. dream_evaluator: simulate paths, collect dead ends ────────────────
  const evaln = await tree.dreamEvaluator(row, task);
  log(
    `dream_evaluator: ${evaln.attemptCount} prior attempts, ${evaln.failureCount} dead ends` +
      (evaln.recommendFanout ? ' → recommending FAN-OUT' : '')
  );

  const branchId = tree.newBranchId(row);
  let outcome;

  if (evaln.recommendFanout && km.size > 1) {
    // ── Adaptive compute path — parallel agentic attempts ──────────────────
    const { winner } = await engine.fanOut({
      row,
      task,
      desc,
      avoid: evaln.avoid,
      baseTemp: evaln.suggestedTemperature,
      parentId: evaln.bestParent,
    });
    if (winner) {
      const written = applyFiles(WORKSPACE, winner.files);
      outcome = { passed: true, summary: winner.summary, branchId: winner.branchId, testCommand: winner.testCommand, written, evalScore: winner.evalScore };
    } else {
      outcome = { passed: false, summary: 'fan-out found no judge-approved branch', branchId, written: [] };
    }
  } else {
    // ── Single agentic attempt + self-review in the main workspace ─────────
    const s = await engine.solveWithReview({
        row,
      workdir: WORKSPACE,
      task,
      desc,
      avoid: evaln.avoid,
      temperature: evaln.suggestedTemperature,
    });
    const written = s.filesTouched || [];
    const review = s.testsPassed && !s.passed ? s.evalIssues.join('; ') : '';
    // Result string: approval + score, review rejection, or a Reflexion lesson.
    const result = s.passed
      ? `${s.summary} (review ${s.evalScore})`
      : review || (await engine.reflect({ task, tail: s.transcriptTail }));
    outcome = {
      passed: s.passed,
      summary: s.summary,
      branchId,
      testCommand: s.testCommand,
      written,
      keyIndex: s.keyIndex,
      evalScore: s.evalScore,
      review,
    };

    await tree.logAttempt({
      branchId,
      parentId: evaln.bestParent,
      taskRow: row,
      task,
      prompt: s.summary,
      status: s.passed ? STATUS.PASS : STATUS.FAIL,
      tests: s.testsPassed ? 'pass' : 'fail',
      result,
      keyIndex: s.keyIndex,
      score: s.testsPassed ? s.evalScore : -1,
    });
  }

  // ── 2. Finalize: commit + workboard ──────────────────────────────────────
  await finalize({ engine, row, task, outcome, attemptCount: evaln.attemptCount });
  log(`Done — ${outcome.passed ? 'PASS (task → QA)' : 'fail (logged dead end)'}`);
}

async function finalize({ engine, row, task, outcome, attemptCount = 0 }) {
  const written = outcome.written || [];
  const orig = (git(['rev-parse', '--abbrev-ref', 'HEAD']).out || 'HEAD').trim();

  // ── Failure: surgically undo ONLY the files this attempt produced ────────
  // Never run a blanket `git clean` — that could destroy the operator's
  // unrelated in-progress work in the mounted workspace.
  if (!outcome.passed) {
    revertFiles(written);
    if (row) {
      const attempts = attemptCount + 1; // include this just-failed attempt
      const reviewNote = outcome.review ? ` Review: ${outcome.review}.` : '';
      if (attempts >= MAX_ROW_ATTEMPTS) {
        // Park: stop blocking the board. Return In Progress → Backlog and
        // deprioritize to P3 so claim_next_task rotates to other tasks instead
        // of resuming this same row forever.
        await engine.markStage(row, 'Backlog').catch((e) => log(`markStage failed: ${e.message}`));
        await engine.setPriority(row, 'P3').catch((e) => log(`setPriority failed: ${e.message}`));
        await engine
          .addNote(row, `Dream-RSI ⏸ parked after ${attempts} failed attempts.${reviewNote} Returned to Backlog at P3 for human review or a stronger model — lessons saved in Discovery_Tree. The loop is moving on to other tasks.`)
          .catch((e) => log(`addNote failed: ${e.message}`));
        log(`Parked row ${row} after ${attempts} attempts — loop will move on`);
      } else {
        await engine
          .addNote(row, `Dream-RSI ⚠ attempt ${attempts}/${MAX_ROW_ATTEMPTS} not approved (branch ${outcome.branchId}).${reviewNote} Dead end logged to Discovery_Tree; will retry.`)
          .catch((e) => log(`addNote failed: ${e.message}`));
      }
    }
    return;
  }

  if (!written.length) {
    log('No file changes produced');
    if (row) await engine.addNote(row, `Dream-RSI: ${outcome.summary}. No file change was needed.`).catch(() => {});
    return;
  }

  // ── Success: commit ONLY our files onto a dedicated branch, then restore ──
  // the original branch so the next task starts from a clean base.
  const branch = `dream/row-${row || 'x'}-${Date.now().toString(36)}`;
  git(['checkout', '-b', branch]);
  git(['add', ...written]);
  const msg = `feat: ${outcome.summary}\n\nDream-RSI branch ${outcome.branchId}\nTask row ${row}: ${task}\n\nCo-authored-by: Gemini Dream-RSI <gemini@waymark.local>`;
  git(['commit', '-m', msg]);

  if (PUSH) {
    const push = git(['push', '-u', 'origin', branch]);
    log(push.code === 0 ? `Pushed ${branch}` : `Push failed (non-fatal): ${push.out.slice(-160)}`);
  }

  if (row) {
    await engine.markStage(row, 'QA').catch((e) => log(`markStage failed: ${e.message}`));
    await engine
      .addNote(row, `Dream-RSI ✅ ${outcome.summary}${outcome.evalScore != null ? ` (review ${outcome.evalScore})` : ''}. Branch: ${branch}. Verify: ${outcome.testCommand}`)
      .catch((e) => log(`addNote failed: ${e.message}`));
  }

  // Return to the original branch for the next task (dream branch is preserved).
  git(['checkout', orig]);
}

/** Undo only the given files: restore tracked ones, delete newly-created ones. */
function revertFiles(written) {
  for (const rel of written) {
    const tracked = git(['ls-files', '--error-unmatch', rel]).code === 0;
    if (tracked) {
      git(['checkout', '--', rel]);
    } else {
      try {
        fs.rmSync(path.resolve(WORKSPACE, rel), { force: true });
      } catch {
        /* best-effort */
      }
    }
  }
}

/** No-op tree when no sheet is configured (keeps the loop runnable locally). */
function nullTree() {
  return {
    newBranchId: (r) => `r${r || 0}-${Date.now().toString(36)}`,
    ensureProvisioned: async () => ({ created: false }),
    logAttempt: async () => {},
    dreamEvaluator: async () => ({
      attemptCount: 0, failureCount: 0, passCount: 0, avoid: [],
      deadEnds: [], passes: [], recommendFanout: false,
      suggestedTemperature: 0.6, bestParent: null,
    }),
  };
}

if (require.main === module) {
  main().catch((err) => {
    log('FATAL:', err.message || err);
    process.exit(1);
  });
}

module.exports = { DreamRSI, applyFiles, parseArgs };
