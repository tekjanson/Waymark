#!/usr/bin/env node
/* ============================================================
   dream-rsi.test.js — Unit tests for the Gemini Dream-RSI engine

   Pure Node, zero network, zero framework. The key-manager and
   discovery-tree logic run for real — only the CLOCK and the SHEETS
   backend are injected (an in-memory sheet that implements the same
   interface as lib/sheets.js), so we exercise the real code paths
   without hitting Google or waiting an hour for a cooldown.

   Run:  node dev-worker/tests/dream-rsi.test.js
         make dream-test
   ============================================================ */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { KeyManager, parsePool } = require('../scripts/key-manager');
const { DiscoveryTree, STATUS } = require('../scripts/discovery-tree');
const { tryParseJSON } = require('../scripts/lib/gemini');
const { applyFiles } = require('../scripts/dream-rsi');
const { Harness } = require('../scripts/lib/agent-harness');
const { Evaluator, verdictOf } = require('../scripts/lib/evaluator');

/* ---------- tiny async test harness (queued, sequential) ---------- */

const queue = [];
let passed = 0;
let failed = 0;

function section(name) {
  queue.push({ section: name });
}
function test(name, fn) {
  queue.push({ name, fn });
}
function eq(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg || 'mismatch'} — expected ${e}, got ${a}`);
}
function ok(cond, msg) {
  if (!cond) throw new Error(msg || 'expected truthy');
}

/* ---------- fake sheets backend (in-memory, same interface) ---------- */

function fakeSheets() {
  const tabs = {}; // title → { gid, rows: [][] }
  let gidSeq = 100;
  return {
    tabs,
    async ensureTab(title, header) {
      if (!tabs[title]) {
        tabs[title] = { gid: gidSeq++, rows: header ? [header.slice()] : [] };
        return { created: true, gid: tabs[title].gid };
      }
      return { created: false, gid: tabs[title].gid };
    },
    async getTabGid(title) {
      return tabs[title] ? tabs[title].gid : null;
    },
    async append(range, values) {
      const title = range.split('!')[0];
      if (!tabs[title]) tabs[title] = { gid: gidSeq++, rows: [] };
      tabs[title].rows.push(...values);
    },
    async get(range) {
      const title = range.split('!')[0];
      if (!tabs[title]) return [];
      // Emulate "A2:K" (skip header row 1).
      return tabs[title].rows.slice(1);
    },
    async update() {
      /* not needed for these tests */
    },
    async insertRowAfter(gid, afterRow) {
      return afterRow + 1;
    },
  };
}

/* ---------- temp git repo + scripted model (for harness tests) ---------- */

function makeGitRepo(files = { 'README.md': '# test\n' }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-repo-'));
  const sh = (bin, args) => spawnSync(bin, args, { cwd: dir });
  sh('git', ['init', '-q']);
  sh('git', ['config', 'user.email', 't@t.local']);
  sh('git', ['config', 'user.name', 'T']);
  for (const [p, c] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true });
    fs.writeFileSync(path.join(dir, p), c);
  }
  sh('git', ['add', '-A']);
  sh('git', ['commit', '-qm', 'init']);
  return dir;
}

// A fake model that replays a fixed list of actions and records the observation
// it was shown on each turn (the last user message in the conversation).
function scriptedModel(actions) {
  let i = 0;
  const seen = [];
  const complete = async ({ contents }) => {
    const last = contents[contents.length - 1];
    if (last && last.role === 'user') seen.push(last.parts[0].text);
    const a = i < actions.length ? actions[i++] : { tool: 'finish', args: { summary: 'end', testCommand: 'true' } };
    return { text: JSON.stringify(a), keyIndex: 0 };
  };
  complete.seen = seen;
  return complete;
}

/* ======================================================================
   parsePool
   ====================================================================== */

section('parsePool');

test('splits comma-separated keys', () => {
  eq(parsePool('a,b,c'), ['a', 'b', 'c']);
});
test('splits newline-separated keys', () => {
  eq(parsePool('a\nb\nc'), ['a', 'b', 'c']);
});
test('mixed separators + whitespace + dedup', () => {
  eq(parsePool(' a , b\n a  c '), ['a', 'b', 'c']);
});
test('empty / undefined → empty array', () => {
  eq(parsePool(''), []);
  eq(parsePool(undefined), []);
});

/* ======================================================================
   KeyManager — rotation + cooldown (injected clock)
   ====================================================================== */

section('KeyManager');

test('getKey returns the first key initially', () => {
  const km = new KeyManager(['k1', 'k2', 'k3']);
  eq(km.getKey(), 'k1');
});

test('rotateKey advances to the next key', () => {
  const km = new KeyManager(['k1', 'k2', 'k3']);
  const info = km.rotateKey('429');
  eq(info.rotatedFrom, 0);
  eq(info.rotatedTo, 1);
  eq(km.getKey(), 'k2');
});

test('rotated key is on cooldown and skipped', () => {
  let t = 1_000_000;
  const km = new KeyManager(['k1', 'k2'], { cooldownMs: 3600_000, now: () => t });
  km.rotateKey('429'); // k1 parked until t+1h, active → k2
  eq(km.availableCount(), 1);
  eq(km.getKey(), 'k2');
  km.rotateKey('429'); // k2 parked too → all exhausted, soonest = k1
  eq(km.availableCount(), 0);
  ok(km.msUntilAvailable() > 0, 'pool should report time until recovery');
});

test('key becomes available again after cooldown elapses', () => {
  let t = 0;
  const km = new KeyManager(['k1', 'k2'], { cooldownMs: 1000, now: () => t });
  km.rotateKey('429'); // k1 parked until t=1000
  eq(km.availableCount(), 1);
  t = 1001; // cooldown elapsed
  eq(km.availableCount(), 2);
  eq(km.msUntilAvailable(), 0);
});

test('all-exhausted picks the soonest-to-recover key', () => {
  let t = 0;
  const km = new KeyManager(['k1', 'k2'], { cooldownMs: 1000, now: () => t });
  km.rotateKey('429'); // parks k1 until 1000, active=k2
  t = 500;
  km.rotateKey('429'); // parks k2 until 1500, active → soonest = k1 (1000)
  eq(km.getKey(), 'k1');
});

test('getKey throws on empty pool', () => {
  const km = new KeyManager([]);
  let threw = false;
  try {
    km.getKey();
  } catch {
    threw = true;
  }
  ok(threw, 'empty pool should throw');
});

test('rate-limit + quota detectors', () => {
  ok(KeyManager.isRateLimit(429), '429 is a rate limit');
  ok(KeyManager.isRateLimit(403), '403 is treated as rotate-worthy');
  ok(!KeyManager.isRateLimit(500), '500 is not a rate limit');
  ok(KeyManager.isQuotaError('RESOURCE_EXHAUSTED: quota'), 'quota string detected');
  ok(KeyManager.isQuotaError({ error: { status: 'RESOURCE_EXHAUSTED' } }), 'quota object detected');
  ok(!KeyManager.isQuotaError('bad request'), 'non-quota not flagged');
});

test('status never leaks raw keys', () => {
  const km = new KeyManager(['secret-key-1', 'secret-key-2']);
  km.rotateKey('429');
  const s = JSON.stringify(km.status());
  ok(!s.includes('secret-key'), 'status must not contain key material');
});

/* ======================================================================
   DiscoveryTree — memory + dream_evaluator (real logic, fake backend)
   ====================================================================== */

section('DiscoveryTree');

test('logAttempt + readTree round-trip', async () => {
  const sheets = fakeSheets();
  const tree = new DiscoveryTree(sheets);
  await tree.ensureProvisioned();
  await tree.logAttempt({
    branchId: 'r5-abc', taskRow: 5, task: 'Add search', prompt: 'try X',
    status: STATUS.FAIL, tests: 'fail', result: 'selector missing', keyIndex: 0,
  });
  const nodes = await tree.readTree();
  eq(nodes.length, 1);
  eq(nodes[0].branchId, 'r5-abc');
  eq(nodes[0].status, 'fail');
});

test('dreamEvaluator collects dead ends and recommends fan-out', async () => {
  const sheets = fakeSheets();
  const tree = new DiscoveryTree(sheets, { deadEndThreshold: 2 });
  await tree.ensureProvisioned();
  await tree.logAttempt({ branchId: 'b1', taskRow: 7, task: 'Fix bug', prompt: 'p1', status: STATUS.FAIL, result: 'approach A failed' });
  await tree.logAttempt({ branchId: 'b2', taskRow: 7, task: 'Fix bug', prompt: 'p2', status: STATUS.FAIL, result: 'approach B failed' });

  const ev = await tree.dreamEvaluator(7, 'Fix bug');
  eq(ev.attemptCount, 2);
  eq(ev.failureCount, 2);
  ok(ev.recommendFanout, 'two dead ends with no pass should recommend fan-out');
  ok(ev.avoid.includes('approach A failed'), 'avoid-list should include prior failures');
  ok(ev.avoid.includes('approach B failed'), 'avoid-list should include prior failures');
  ok(ev.suggestedTemperature > 0.6, 'temperature should rise with dead ends');
});

test('dreamEvaluator stops recommending fan-out once a path passes', async () => {
  const sheets = fakeSheets();
  const tree = new DiscoveryTree(sheets, { deadEndThreshold: 2 });
  await tree.ensureProvisioned();
  await tree.logAttempt({ branchId: 'b1', taskRow: 9, task: 'T', prompt: 'p', status: STATUS.FAIL, result: 'x' });
  await tree.logAttempt({ branchId: 'b2', taskRow: 9, task: 'T', prompt: 'p', status: STATUS.FAIL, result: 'y' });
  await tree.logAttempt({ branchId: 'b3', taskRow: 9, task: 'T', prompt: 'p', status: STATUS.PASS, result: 'worked' });

  const ev = await tree.dreamEvaluator(9, 'T');
  eq(ev.passCount, 1);
  ok(!ev.recommendFanout, 'a passing branch means no fan-out needed');
  eq(ev.bestParent, 'b3');
});

test('dreamEvaluator isolates by task', async () => {
  const sheets = fakeSheets();
  const tree = new DiscoveryTree(sheets);
  await tree.ensureProvisioned();
  await tree.logAttempt({ branchId: 'a', taskRow: 1, task: 'Task One', prompt: 'p', status: STATUS.FAIL, result: 'e' });
  await tree.logAttempt({ branchId: 'b', taskRow: 2, task: 'Task Two', prompt: 'p', status: STATUS.FAIL, result: 'e' });
  const ev = await tree.dreamEvaluator(1, 'Task One');
  eq(ev.attemptCount, 1);
});

test('dreamEvaluator tolerates an empty / missing tree', async () => {
  const sheets = fakeSheets(); // no tab provisioned
  const tree = new DiscoveryTree(sheets);
  const ev = await tree.dreamEvaluator(1, 'Anything');
  eq(ev.attemptCount, 0);
  ok(!ev.recommendFanout, 'no history → no fan-out');
});

/* ======================================================================
   applyFiles — path-traversal safety (real disk writes in a temp dir)
   ====================================================================== */

section('applyFiles safety');

test('writes safe files and rejects path traversal', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dream-test-'));
  try {
    const written = applyFiles(dir, [
      { path: 'sub/ok.js', content: 'export const a = 1;' },
      { path: '../escape.js', content: 'evil' },
      { path: '/etc/evil.js', content: 'evil' },
    ]);
    ok(written.includes('sub/ok.js'), 'safe file should be written');
    ok(!written.includes('../escape.js'), 'traversal path must be rejected');
    ok(fs.existsSync(path.join(dir, 'sub/ok.js')), 'safe file exists on disk');
    ok(!fs.existsSync(path.join(path.dirname(dir), 'escape.js')), 'no file escaped the workspace');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/* ======================================================================
   tryParseJSON — resilient JSON extraction from model output
   ====================================================================== */

section('tryParseJSON');

test('parses clean JSON', () => {
  eq(tryParseJSON('{"a":1}'), { a: 1 });
});
test('strips ```json fences', () => {
  eq(tryParseJSON('```json\n{"a":2}\n```'), { a: 2 });
});
test('extracts the outermost object from noisy output', () => {
  eq(tryParseJSON('sure! {"a":3} done'), { a: 3 });
});
test('returns undefined for non-JSON', () => {
  eq(tryParseJSON('not json at all'), undefined);
});

/* ======================================================================
   Harness — the agentic tool loop (real tools, scripted model)
   ====================================================================== */

section('Harness (agentic loop)');

test('runs a tool loop and finishes when tests pass', async () => {
  const dir = makeGitRepo();
  try {
    const model = scriptedModel([
      { tool: 'list_files', args: {} },
      { tool: 'write_file', args: { path: 'feature.js', content: 'export const x = 1;\n' } },
      { tool: 'run', args: { cmd: 'test -f feature.js' } },
      { tool: 'finish', args: { summary: 'add feature', testCommand: 'true' } },
    ]);
    const h = new Harness({ complete: model, workdir: dir, maxTurns: 10, runTimeoutMs: 10000 });
    const r = await h.run({ task: 'Add feature', desc: '' });
    ok(r.passed, 'should finish green');
    ok(r.filesTouched.includes('feature.js'), 'tracks the written file');
    ok(fs.existsSync(path.join(dir, 'feature.js')), 'file exists on disk');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a failing finish does NOT end the episode (test-fix loop)', async () => {
  const dir = makeGitRepo();
  try {
    const model = scriptedModel([
      { tool: 'finish', args: { summary: 'x', testCommand: 'false' } }, // fails → keep going
      { tool: 'finish', args: { summary: 'x', testCommand: 'true' } }, // passes
    ]);
    const h = new Harness({ complete: model, workdir: dir, maxTurns: 5, runTimeoutMs: 10000 });
    const r = await h.run({ task: 'T', desc: '' });
    ok(r.passed, 'second finish passes');
    ok(r.turns >= 2, 'took at least two turns');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('edit_file needs an exact unique match and blocks traversal', async () => {
  const dir = makeGitRepo({ 'a.js': 'const a = 1;\nconst b = 2;\n' });
  try {
    const model = scriptedModel([
      { tool: 'edit_file', args: { path: 'a.js', search: 'NOPE', replace: 'x' } }, // not found
      { tool: 'write_file', args: { path: '../evil.js', content: 'bad' } }, // traversal
      { tool: 'edit_file', args: { path: 'a.js', search: 'const a = 1;', replace: 'const a = 42;' } },
      { tool: 'finish', args: { summary: 'edit', testCommand: 'true' } },
    ]);
    const h = new Harness({ complete: model, workdir: dir, maxTurns: 10, runTimeoutMs: 10000 });
    const r = await h.run({ task: 'edit', desc: '' });
    ok(r.passed, 'finishes green after a successful edit');
    ok(fs.readFileSync(path.join(dir, 'a.js'), 'utf8').includes('const a = 42;'), 'edit applied');
    ok(!fs.existsSync(path.join(path.dirname(dir), 'evil.js')), 'traversal write blocked');
    ok(model.seen.some((o) => /not found/i.test(o)), 'reports search-not-found');
    ok(model.seen.some((o) => /escapes the workspace/i.test(o)), 'reports traversal error');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('run blocks dangerous / push commands', async () => {
  const dir = makeGitRepo();
  try {
    const model = scriptedModel([
      { tool: 'run', args: { cmd: 'git push origin main' } },
      { tool: 'finish', args: { summary: 'x', testCommand: 'true' } },
    ]);
    const h = new Harness({ complete: model, workdir: dir, maxTurns: 5, runTimeoutMs: 10000 });
    await h.run({ task: 'x', desc: '' });
    ok(model.seen.some((o) => /blocked for safety/i.test(o)), 'git push was blocked');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/* ======================================================================
   Evaluator — LLM-as-judge self-evaluation (fake judge client)
   ====================================================================== */

section('Evaluator (self-judge)');

test('empty diff is rejected without calling the model', async () => {
  let called = false;
  const gemini = { generateJSON: async () => { called = true; return { data: {} }; } };
  const v = await new Evaluator(gemini, { threshold: 0.7 }).judge({ task: 'x', diff: '' });
  ok(!v.approved, 'empty diff is not approved');
  ok(!called, 'model is not called for an empty diff');
});

test('approves a solid change above threshold', async () => {
  const gemini = { generateJSON: async () => ({ data: { score: 0.9, fulfillsTask: true, testGaming: false, issues: [] } }) };
  const v = await new Evaluator(gemini, { threshold: 0.7 }).judge({ task: 'x', diff: 'diff --git a b' });
  ok(v.approved, 'approved');
  eq(v.verdict, 'approve');
});

test('rejects test gaming even with a high score', async () => {
  const gemini = { generateJSON: async () => ({ data: { score: 0.95, fulfillsTask: true, testGaming: true, issues: ['deleted an assertion'] } }) };
  const v = await new Evaluator(gemini, { threshold: 0.7 }).judge({ task: 'x', diff: 'd' });
  ok(!v.approved, 'gaming blocks approval');
  ok(v.testGaming, 'flagged as gaming');
});

test('rejects a low score and surfaces issues', async () => {
  const gemini = { generateJSON: async () => ({ data: { score: 0.3, fulfillsTask: false, testGaming: false, issues: ['does not implement the feature'] } }) };
  const v = await new Evaluator(gemini, { threshold: 0.7 }).judge({ task: 'x', diff: 'd' });
  ok(!v.approved, 'low score not approved');
  eq(v.verdict, 'reject');
  ok(v.issues.includes('does not implement the feature'), 'surfaces issues');
});

test('disabled evaluator passes through without a call', async () => {
  const gemini = { generateJSON: async () => { throw new Error('should not be called'); } };
  const v = await new Evaluator(gemini, { enabled: false }).judge({ task: 'x', diff: 'd' });
  ok(v.approved, 'disabled → approve');
  ok(v.skipped, 'marked skipped');
});

test('verdictOf marks the revise band below threshold', () => {
  const v = verdictOf({ score: 0.6, fulfillsTask: true, testGaming: false, issues: ['minor'] }, 0.7);
  ok(!v.approved, 'below threshold not approved');
  eq(v.verdict, 'revise');
});

/* ---------- runner ---------- */

(async () => {
  for (const item of queue) {
    if (item.section) {
      console.log(`\n${item.section}`);
      continue;
    }
    try {
      await item.fn();
      passed++;
      console.log(`  ✓ ${item.name}`);
    } catch (err) {
      failed++;
      console.log(`  ✗ ${item.name}\n      ${err.message}`);
    }
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
