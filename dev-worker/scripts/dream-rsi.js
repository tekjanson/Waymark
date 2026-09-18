#!/usr/bin/env node
/* ============================================================
   dream-rsi.js — Gemini Dream-RSI task handler

   The Gemini-engine counterpart to the Copilot builder loop. One invocation
   solves ONE claimed workboard task through a recursive self-improvement
   cycle:

     1. dream_evaluator  — read the Discovery_Tree, simulate prior paths,
                           and collect the dead ends to avoid.
     2. generate         — ask Gemini (via the rotating key pool) for a fix,
                           expressed as full-file writes + a scoped test cmd.
     3. test             — apply the change and run the test command.
     4. adapt            — if the task is stuck (repeated failures), FAN OUT:
                           generate N alternatives in parallel across N keys,
                           evaluate each in an isolated git worktree, merge the
                           winner, and log every dead end back to the tree.
     5. record           — log the outcome to the Discovery_Tree and update
                           the workboard (→ QA on success, note on failure).

   Invoked by agent-runner.sh when ACTIVE_AGENT=gemini:
     node dream-rsi.js --row 42 --task "Add search bar" --desc "..."

   Env (see .env.example):
     GEMINI_KEY_POOL, GEMINI_MODEL, GEMINI_KEY_COOLDOWN_MS
     GOOGLE_APPLICATION_CREDENTIALS
     WAYMARK_WORKBOARD_ID, DISCOVERY_TREE_SHEET_ID, DISCOVERY_TREE_TAB
     DREAM_FANOUT_N (default 3), DREAM_TEST_TIMEOUT_MS (default 600000)
     DREAM_PUSH (default 1), AGENT_HUMAN_NAME, WORKSPACE_DIR (default /workspace)
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

/* ---------- Config ---------- */

const WORKSPACE = process.env.WORKSPACE_DIR || '/workspace';
const WORKBOARD_ID = process.env.WAYMARK_WORKBOARD_ID || '';
const TREE_SHEET_ID = process.env.DISCOVERY_TREE_SHEET_ID || WORKBOARD_ID;
const KEY_FILE = process.env.GOOGLE_APPLICATION_CREDENTIALS || '/credentials/gsa-key.json';
const FANOUT_N = parseInt(process.env.DREAM_FANOUT_N || '3', 10);
const TEST_TIMEOUT_MS = parseInt(process.env.DREAM_TEST_TIMEOUT_MS || '600000', 10);
const PUSH = process.env.DREAM_PUSH !== '0';
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

function shortSha(cwd = WORKSPACE) {
  return (git(['rev-parse', '--short', 'HEAD'], cwd).out || '').trim();
}

/**
 * Run a test command, returning { passed, code, tail }. Bounded by timeout.
 */
function runTests(command, cwd) {
  if (!command) return { passed: false, code: -1, tail: 'no test command provided' };
  log(`  running tests: ${command}`);
  const r = spawnSync('bash', ['-lc', command], {
    cwd,
    encoding: 'utf8',
    timeout: TEST_TIMEOUT_MS,
    env: { ...process.env, CI: '1' },
  });
  const output = (r.stdout || '') + (r.stderr || '');
  const passed = r.status === 0 && !r.error;
  return { passed, code: r.status ?? -1, tail: output.slice(-1500) };
}

/**
 * Safely write model-produced files into `dir`. Rejects path traversal and
 * absolute paths so a bad model response can never escape the workspace.
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

/* ---------- Repo context gathering ---------- */

function gatherContext(dir, task, desc) {
  // A capped file listing gives Gemini the lay of the land.
  const listing = git(['ls-files'], dir).out
    .split('\n')
    .filter(Boolean)
    .slice(0, 600)
    .join('\n');

  // Include the contents of any files explicitly named in the task/desc.
  const mentioned = new Set();
  const text = `${task} ${desc}`;
  const re = /([\w./-]+\.(?:js|mjs|css|json|html|md|sh|kt|java))/g;
  let m;
  while ((m = re.exec(text)) && mentioned.size < 6) {
    mentioned.add(m[1]);
  }
  let files = '';
  for (const rel of mentioned) {
    const abs = path.resolve(dir, rel);
    if (abs.startsWith(path.resolve(dir)) && fs.existsSync(abs) && fs.statSync(abs).isFile()) {
      const body = fs.readFileSync(abs, 'utf8').slice(0, 8000);
      files += `\n----- ${rel} -----\n${body}\n`;
    }
  }
  return { listing, files };
}

/* ---------- The Dream-RSI engine ---------- */

const SYSTEM_PROMPT = `You are a precise autonomous software engineer working in the Waymark codebase.
You MUST obey the repository rules in .github/instructions/AI_laws.instructions.md:
vanilla ES modules + raw CSS, no frameworks, no build step, DOM via el() only,
all Google API calls through api-client.js, templates import only from shared.js,
tests are flat test() calls with CSS selectors only.
You produce complete, working files — never diffs, never partial snippets.
You always respond with STRICT JSON matching the requested schema and nothing else.`;

class DreamRSI {
  constructor({ gemini, tree, sheets, keyManager }) {
    this.gemini = gemini;
    this.tree = tree;
    this.sheets = sheets;
    this.km = keyManager;
  }

  /** Build the generation prompt including the dead-ends to avoid. */
  buildPrompt({ task, desc, avoid, context }) {
    const avoidBlock = avoid.length
      ? `\nApproaches that ALREADY FAILED for this task — do NOT repeat them:\n${avoid
          .map((a, i) => `  ${i + 1}. ${a}`)
          .join('\n')}\n`
      : '';
    return `TASK: ${task}
DETAILS: ${desc || '(none)'}
${avoidBlock}
Repository files (truncated):
${context.listing}
${context.files ? `\nRelevant file contents:\n${context.files}` : ''}

Respond with STRICT JSON:
{
  "reasoning": "one or two sentences on your approach",
  "summary": "one-line description of the change",
  "files": [{ "path": "relative/path/from/repo/root", "content": "FULL file content" }],
  "testCommand": "a single shell command that verifies the change, e.g. 'npm test' or a scoped 'npx playwright test tests/e2e/foo.spec.js --config tests/playwright.config.js'"
}`;
  }

  /** Generate one candidate solution from Gemini. */
  async generateCandidate({ task, desc, avoid, context, temperature }) {
    const prompt = this.buildPrompt({ task, desc, avoid, context });
    const { data, keyIndex } = await this.gemini.generateJSON({
      prompt,
      system: SYSTEM_PROMPT,
      temperature,
      maxOutputTokens: 8192,
    });
    return {
      reasoning: data.reasoning || '',
      summary: data.summary || 'change',
      files: Array.isArray(data.files) ? data.files : [],
      testCommand: data.testCommand || 'npm test',
      keyIndex,
    };
  }

  /**
   * Adaptive fan-out: generate N candidates in parallel across N keys, then
   * evaluate each in an isolated git worktree (shared node_modules, unique
   * PORT) so tests never collide. Returns the winner + all evaluated nodes.
   */
  async fanOut({ row, task, desc, avoid, context, baseTemp, parentId }) {
    const n = Math.max(1, Math.min(FANOUT_N, Math.max(1, this.km.availableCount() || this.km.size)));
    log(`  ⇉ fanning out ${n} candidates across the key pool`);

    // Generation is the expensive, rate-limited step — parallelise it.
    const candidates = await Promise.all(
      Array.from({ length: n }, (_, i) =>
        this.generateCandidate({
          task,
          desc,
          avoid,
          context,
          temperature: Math.min(baseTemp + i * 0.15, 1.0),
        }).catch((e) => ({ error: String(e.message || e), files: [] }))
      )
    );

    // Evaluation is serialized in one reusable worktree to avoid port clashes.
    const worktree = this._makeWorktree(row);
    const results = [];
    try {
      for (let i = 0; i < candidates.length; i++) {
        const c = candidates[i];
        const branchId = this.tree.newBranchId(row);
        if (c.error || !c.files.length) {
          results.push({ ...c, branchId, passed: false, tail: c.error || 'empty candidate' });
          continue;
        }
        this._resetWorktree(worktree);
        applyFiles(worktree, c.files);
        const test = runTests(c.testCommand, worktree);
        log(`  candidate ${i + 1}/${candidates.length} (key #${c.keyIndex}) → ${test.passed ? 'PASS' : 'fail'}`);
        results.push({ ...c, branchId, passed: test.passed, tail: test.tail });
      }
    } finally {
      this._removeWorktree(worktree);
    }

    // Winner = first passing candidate; otherwise none.
    const winner = results.find((r) => r.passed) || null;

    // Log every branch to the Discovery_Tree.
    for (const r of results) {
      await this.tree.logAttempt({
        branchId: r.branchId,
        parentId,
        taskRow: row,
        task,
        prompt: r.summary,
        status: r.passed ? STATUS.PASS : STATUS.DEAD_END,
        tests: r.passed ? 'pass' : 'fail',
        result: r.passed ? r.summary : (r.tail || '').slice(-160),
        keyIndex: r.keyIndex,
        score: r.passed ? 1 : -1,
      });
    }
    return { winner, results };
  }

  _makeWorktree(row) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `dream-${row}-`));
    const wt = path.join(dir, 'wt');
    const r = git(['worktree', 'add', '--detach', wt, 'HEAD']);
    if (r.code !== 0) throw new Error(`git worktree add failed: ${r.out}`);
    // Share the installed dependencies so tests can run without reinstalling.
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

  _resetWorktree(wt) {
    git(['reset', '--hard', '-q', 'HEAD'], wt);
    git(['clean', '-fdq', '-e', 'node_modules'], wt);
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

  async addNote(row, text) {
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
  }
}

/* ---------- Orchestration ---------- */

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const row = args.row || '';
  const task = args.task || process.env.AGENT_COMMAND || '';
  const desc = args.desc || '';

  if (!task) {
    log('No task provided (--task) — nothing to do');
    process.exit(0);
  }

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
  const context = gatherContext(WORKSPACE, task, desc);
  let outcome;

  if (evaln.recommendFanout && km.size > 1) {
    // ── Adaptive compute path ──────────────────────────────────────────────
    const { winner } = await engine.fanOut({
      row,
      task,
      desc,
      avoid: evaln.avoid,
      context,
      baseTemp: evaln.suggestedTemperature,
      parentId: evaln.bestParent,
    });
    if (winner) {
      const written = applyFiles(WORKSPACE, winner.files);
      outcome = { passed: true, summary: winner.summary, branchId: winner.branchId, testCommand: winner.testCommand, written };
    } else {
      outcome = { passed: false, summary: 'fan-out found no passing branch', branchId, written: [] };
    }
  } else {
    // ── Single-attempt path ────────────────────────────────────────────────
    const c = await engine.generateCandidate({
      task,
      desc,
      avoid: evaln.avoid,
      context,
      temperature: evaln.suggestedTemperature,
    });
    const written = applyFiles(WORKSPACE, c.files);
    const test = runTests(c.testCommand, WORKSPACE);
    outcome = { passed: test.passed, summary: c.summary, branchId, testCommand: c.testCommand, written, tail: test.tail, keyIndex: c.keyIndex };

    await tree.logAttempt({
      branchId,
      parentId: evaln.bestParent,
      taskRow: row,
      task,
      prompt: c.summary,
      status: test.passed ? STATUS.PASS : STATUS.FAIL,
      tests: test.passed ? 'pass' : 'fail',
      result: test.passed ? c.summary : (test.tail || '').slice(-160),
      keyIndex: c.keyIndex,
      score: test.passed ? 1 : -1,
    });
  }

  // ── 2. Finalize: commit + workboard ──────────────────────────────────────
  await finalize({ engine, row, task, outcome });
  log(`Done — ${outcome.passed ? 'PASS (task → QA)' : 'fail (logged dead end)'}`);
}

async function finalize({ engine, row, task, outcome }) {
  const written = outcome.written || [];
  const orig = (git(['rev-parse', '--abbrev-ref', 'HEAD']).out || 'HEAD').trim();

  // ── Failure: surgically undo ONLY the files this attempt produced ────────
  // Never run a blanket `git clean` — that could destroy the operator's
  // unrelated in-progress work in the mounted workspace.
  if (!outcome.passed) {
    revertFiles(written);
    if (row) {
      await engine
        .addNote(row, `Dream-RSI ⚠ attempt failed (branch ${outcome.branchId}). Dead end logged to Discovery_Tree; will retry a different path.`)
        .catch((e) => log(`addNote failed: ${e.message}`));
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
      .addNote(row, `Dream-RSI ✅ ${outcome.summary}. Branch: ${branch}. Verify: ${outcome.testCommand}`)
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
