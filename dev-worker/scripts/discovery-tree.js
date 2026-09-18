/* ============================================================
   discovery-tree.js — Dream-RSI memory on the Google Sheets control plane

   The Discovery Tree is the agent's long-term memory of what it has already
   tried. Every Gemini execution attempt is logged as a node (a row) in a
   `Discovery_Tree` tab. Nodes form a tree via Parent ID so the agent can see
   which branches led to passing tests and which dead-ended.

   Two responsibilities:
     1. Persistence — provision the tab, append attempt nodes, read them back.
     2. dream_evaluator — the pre-computation step that reads the tree BEFORE
        generating code, scores candidate paths, and returns the set of known
        dead ends to avoid (so the agent never re-walks a failed branch).

   Tab schema (row 1 headers):
     Timestamp | Branch ID | Parent ID | Task Row | Task | Prompt |
     Status | Tests | Result | Key Index | Score

   Status vocabulary:
     exploring  — attempt started, outcome unknown
     pass       — tests passed on this branch
     fail       — tests failed on this branch
     dead-end   — branch abandoned (fan-out loser or repeated failure)
     merged     — winning branch merged into the workspace
   ============================================================ */

'use strict';

const HEADERS = [
  'Timestamp', 'Branch ID', 'Parent ID', 'Task Row', 'Task', 'Prompt',
  'Status', 'Tests', 'Result', 'Key Index', 'Score',
];

const STATUS = Object.freeze({
  EXPLORING: 'exploring',
  PASS: 'pass',
  FAIL: 'fail',
  DEAD_END: 'dead-end',
  MERGED: 'merged',
});

class DiscoveryTree {
  /**
   * @param {Object} sheets — a client from lib/sheets.js (or a compatible stub)
   * @param {Object} [opts]
   * @param {string} [opts.tab] — tab name (default 'Discovery_Tree')
   * @param {number} [opts.deadEndThreshold] — failures before fan-out is advised
   * @param {() => number} [opts.now] — clock injection for tests
   */
  constructor(sheets, opts = {}) {
    this.sheets = sheets;
    this.tab = opts.tab || process.env.DISCOVERY_TREE_TAB || 'Discovery_Tree';
    this.deadEndThreshold = opts.deadEndThreshold ?? 2;
    this._now = opts.now || Date.now;
  }

  /** Create the tab + header row if it does not already exist. */
  async ensureProvisioned() {
    return this.sheets.ensureTab(this.tab, HEADERS);
  }

  /** Wipe all attempt rows (keeps the header row). Used to reset memory. */
  async clear() {
    const gid = await this.sheets.getTabGid(this.tab);
    if (gid === null) return { cleared: false };
    await this.sheets.update(
      `${this.tab}!A2:K400`,
      Array.from({ length: 399 }, () => Array(HEADERS.length).fill(''))
    );
    return { cleared: true };
  }

  /** Mint a unique branch id for a task attempt. */
  newBranchId(taskRow) {
    const t = this._now().toString(36);
    const rand = Math.random().toString(36).slice(2, 6);
    return `r${taskRow || 0}-${t}-${rand}`;
  }

  /**
   * Append one attempt node to the tree.
   * @param {Object} node
   * @param {string} node.branchId
   * @param {string} [node.parentId]
   * @param {number|string} node.taskRow
   * @param {string} node.task
   * @param {string} node.prompt
   * @param {string} node.status — one of STATUS
   * @param {string} [node.tests] — 'pass' | 'fail' | 'n/a'
   * @param {string} [node.result] — short summary / error
   * @param {number} [node.keyIndex]
   * @param {number} [node.score]
   */
  async logAttempt(node) {
    const row = [
      new Date(this._now()).toISOString(),
      node.branchId || '',
      node.parentId || '',
      String(node.taskRow ?? ''),
      trunc(node.task, 200),
      trunc(node.prompt, 500),
      node.status || STATUS.EXPLORING,
      node.tests || 'n/a',
      trunc(node.result, 500),
      node.keyIndex ?? '',
      node.score ?? '',
    ];
    await this.sheets.append(`${this.tab}!A:K`, [row]);
    return node.branchId;
  }

  /** Read the whole tree back as structured node objects. */
  async readTree() {
    const rows = await this.sheets.get(`${this.tab}!A2:K`);
    return rows
      .filter((r) => r && r[1]) // must have a Branch ID
      .map((r) => ({
        timestamp: r[0] || '',
        branchId: r[1] || '',
        parentId: r[2] || '',
        taskRow: r[3] || '',
        task: r[4] || '',
        prompt: r[5] || '',
        status: r[6] || '',
        tests: r[7] || '',
        result: r[8] || '',
        keyIndex: r[9] || '',
        score: Number(r[10]) || 0,
      }));
  }

  /**
   * dream_evaluator — the pre-computation step run BEFORE generating code.
   *
   * Reads the tree, isolates the nodes for this task, and simulates the
   * candidate paths: it scores prior branches, collects the dead ends to
   * avoid, and recommends whether the task is stuck enough to warrant an
   * adaptive fan-out (parallel exploration).
   *
   * @param {number|string} taskRow
   * @param {string} taskTitle
   * @returns {Promise<{
   *   attemptCount: number, failureCount: number, passCount: number,
   *   avoid: string[], deadEnds: Object[], passes: Object[],
   *   recommendFanout: boolean, suggestedTemperature: number,
   *   bestParent: string|null
   * }>}
   */
  async dreamEvaluator(taskRow, taskTitle) {
    let tree = [];
    try {
      tree = await this.readTree();
    } catch {
      // Tab may not exist yet on the very first run — treat as empty memory.
      tree = [];
    }

    const key = normalizeTask(taskTitle);
    const related = tree.filter(
      (n) => String(n.taskRow) === String(taskRow) || normalizeTask(n.task) === key
    );

    const deadEnds = related.filter(
      (n) => n.status === STATUS.FAIL || n.status === STATUS.DEAD_END
    );
    const passes = related.filter(
      (n) => n.status === STATUS.PASS || n.status === STATUS.MERGED
    );

    // Avoid-list: distinct, human-readable summaries of what already failed.
    const avoid = uniq(
      deadEnds
        .map((d) => (d.result || d.prompt || '').trim())
        .filter(Boolean)
        .map((s) => trunc(s, 160))
    );

    // Path simulation: more prior dead ends → explore wider (higher temp) and
    // recommend fanning out. A known passing parent becomes the branch base.
    const failureCount = deadEnds.length;
    const recommendFanout = failureCount >= this.deadEndThreshold && passes.length === 0;
    const suggestedTemperature = Math.min(0.4 + 0.2 * failureCount, 1.0);
    const bestParent = passes.length
      ? passes[passes.length - 1].branchId
      : deadEnds.length
        ? deadEnds[deadEnds.length - 1].branchId
        : null;

    return {
      attemptCount: related.length,
      failureCount,
      passCount: passes.length,
      avoid,
      deadEnds,
      passes,
      recommendFanout,
      suggestedTemperature,
      bestParent,
    };
  }
}

/* ---------- Helpers ---------- */

function normalizeTask(s) {
  return (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function uniq(arr) {
  return [...new Set(arr)];
}

function trunc(s, n) {
  s = s == null ? '' : String(s);
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

module.exports = { DiscoveryTree, HEADERS, STATUS, normalizeTask };
