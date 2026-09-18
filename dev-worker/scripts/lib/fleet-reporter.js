/* ============================================================
   lib/fleet-reporter.js — Live agent activity → Agent Registry sheet

   This is the tie-in between the Gemini Dream-RSI engine and the Waymark
   "Dev Fleet" plumbing. The same Agent Registry sheet that agent-runner.sh
   writes Status/Task/Heartbeat to (via write-agent-sheet.sh) is the sheet
   the AI Fleet tool (templates/agents.js) renders. This reporter streams the
   agent's live turn-by-turn activity INTO that sheet so the fleet tool shows a
   real chat-style feed of what the agent is doing right now.

   It auto-provisions:
     • a "Summary" column (appended to the header if the sheet lacks one),
     • a "Workboard feedback" column (appended to the header if the sheet lacks one),
     • a "Tuning feedback" column (appended to the header if the sheet lacks one),
     • an "Activity" column (appended to the header if the sheet lacks one), and
     • a row for this agent (appended if the agent's name isn't in the sheet),
   so it "just works" against any Agent Registry without manual setup.

   Every write is best-effort — a Sheets hiccup must never break the real work.

   Columns written (discovered by header name, so column order is irrelevant):
     Status    → 'Online' while the agent is working
     Task      → the current task title (set once per task)
     Activity  → a bounded, newline-joined transcript of recent turns (the feed)
     Heartbeat → ISO timestamp, refreshed on every push (drives "last seen")
   ============================================================ */

'use strict';

const { createSheetsClient } = require('./sheets');

const TAB = 'Sheet1';
const MAX_LINES = 12; // rolling transcript window shown in the fleet feed
// Coalesce all field updates and write them in ONE batched request per window.
// This is the fix for blowing past Sheets' 60 writes/min/user quota: instead of
// a write per field per turn, we buffer and flush at most once per FLUSH_MS.
const FLUSH_MS = parseInt(process.env.FLEET_FLUSH_MS || '5000', 10);

/** 0-based column index → A1 letter (Agent Registry stays well under 26 cols). */
function colLetter(idx) {
  return String.fromCharCode(65 + idx);
}

class FleetReporter {
  /**
   * @param {Object} opts
   * @param {string} opts.keyFile — service-account JSON key path
   * @param {string} opts.sheetId — Agent Registry sheet ID (AGENTS_SHEET_ID)
   * @param {string} opts.agent   — this agent's display name (AGENT_HUMAN_NAME)
   * @param {(...a:any)=>void} [opts.log]
   */
  constructor({ keyFile, sheetId, agent, log }) {
    this.agent = (agent || '').trim();
    this.log = log || (() => {});
    this.enabled = Boolean(keyFile && sheetId && this.agent);
    this.sheets = this.enabled ? createSheetsClient({ keyFile, spreadsheetId: sheetId }) : null;
    this.cols = null;
    this.row = -1;
    this.ready = false;
    this.task = '';
    this.summary = '';
    this.workboardFeedback = '';
    this.tuningFeedback = '';
    this.keyStatus = '';
    this.activityVersion = 0;
    this.ring = [];
    this.pending = new Map(); // colIdx -> value, coalesced until the next flush
    this.flushTimer = null;
    this.flushing = false;
  }

  /**
  * Discover columns, ensure Summary/feedback columns exist, and find-or-create this
   * agent's row. Safe to call repeatedly; only does the work once.
   * @returns {Promise<boolean>} whether the reporter is ready to stream
   */
  async init() {
    if (!this.enabled || this.ready) return this.ready;
    try {
      const header = (await this.sheets.get(`${TAB}!1:1`))[0] || [];
      const lower = header.map((h) => (h || '').toLowerCase().trim());
      this.cols = {
        name: lower.findIndex((h) => /^(name|agent|worker|identity)$/.test(h)),
        status: lower.findIndex((h) => /^(status|state|online|active)/.test(h)),
        task: lower.findIndex((h) => /^(task|current task|working on|job|doing)/.test(h)),
        summary: lower.findIndex((h) => /^(summary|state summary|ai summary|brief|synopsis)/.test(h)),
        workboardFeedback: lower.findIndex((h) => /^(workboard feedback|workbook feedback|workbook)/.test(h)),
        tuningFeedback: lower.findIndex((h) => /^(tuning feedback|tuning note|tuning summary|feedback)/.test(h)),
        keys: lower.findIndex((h) => /^(keys|key status|api keys|key pool|tokens)/.test(h)),
        activity: lower.findIndex((h) => /^(activity|feed|log|stream)/.test(h)),
        heartbeat: lower.findIndex((h) => /^(heartbeat|last seen|ping|updated|timestamp)/.test(h)),
      };
      if (this.cols.name < 0) this.cols.name = 0;

      // Ensure a Summary column exists — this is what the fleet tool renders
      // as the concise AI state snapshot above the raw activity log.
      if (this.cols.summary < 0) {
        const newCol = header.length;
        await this.sheets.update(`${TAB}!${colLetter(newCol)}1`, [['Summary']]);
        this.cols.summary = newCol;
        header.push('Summary');
      }

      if (this.cols.workboardFeedback < 0) {
        const newCol = header.length;
        await this.sheets.update(`${TAB}!${colLetter(newCol)}1`, [['Workboard feedback']]);
        this.cols.workboardFeedback = newCol;
        header.push('Workboard feedback');
      }

      if (this.cols.tuningFeedback < 0) {
        const newCol = header.length;
        await this.sheets.update(`${TAB}!${colLetter(newCol)}1`, [['Tuning feedback']]);
        this.cols.tuningFeedback = newCol;
        header.push('Tuning feedback');
      }

      // Ensure a Keys column exists — the AI key-pool status (throttle monitor).
      if (this.cols.keys < 0) {
        const newCol = header.length;
        await this.sheets.update(`${TAB}!${colLetter(newCol)}1`, [['Keys']]);
        this.cols.keys = newCol;
        header.push('Keys');
      }

      // Ensure an Activity column exists — this is what the fleet tool renders
      // as the live chat feed. Append it to the header if the sheet lacks one.
      if (this.cols.activity < 0) {
        const newCol = header.length;
        await this.sheets.update(`${TAB}!${colLetter(newCol)}1`, [['Activity']]);
        this.cols.activity = newCol;
        header.push('Activity');
      }

      // Find this agent's row by name (skip the header row).
      const nameCol = colLetter(this.cols.name);
      const names = await this.sheets.get(`${TAB}!${nameCol}:${nameCol}`);
      for (let i = 1; i < names.length; i++) {
        if ((names[i][0] || '').trim() === this.agent) {
          this.row = i + 1;
          break;
        }
      }

      // Auto-provision a row for this agent if it isn't registered yet.
      if (this.row < 0) {
        const width = Math.max(header.length, this.cols.activity + 1);
        const rowVals = new Array(width).fill('');
        rowVals[this.cols.name] = this.agent;
        if (this.cols.status >= 0) rowVals[this.cols.status] = 'Online';
        const resp = await this.sheets.append(`${TAB}!A1`, [rowVals]);
        this.row = parseAppendedRow(resp);
      }

      this.ready = this.row > 0;
      if (this.ready) this.log(`  [fleet] streaming to Agent Registry row ${this.row}`);
      return this.ready;
    } catch (e) {
      this.log(`  [fleet] init skipped: ${e.message}`);
      return false;
    }
  }

  /** Set the "Current task" title shown on the agent's fleet card. */
  async setTask(title) {
    if (!(await this._ensure())) return;
    this.task = String(title || '');
    this._queue(this.cols.task, this.task);
    this._queue(this.cols.status, 'Online');
  }

  /** Replace the short AI summary shown above the live feed. */
  async setSummary(text) {
    if (!(await this._ensure())) return;
    const v = String(text || '').trim();
    if (!v || v === this.summary) return;
    this.summary = v;
    this._queue(this.cols.summary, v);
  }

  /** Replace the concise workboard/workbook feedback shown in the fleet card. */
  async setWorkboardFeedback(text) {
    if (!(await this._ensure())) return;
    const v = String(text || '').trim();
    if (!v || v === this.workboardFeedback) return;
    this.workboardFeedback = v;
    this._queue(this.cols.workboardFeedback, v);
  }

  /** Replace the concise tuning feedback shown in the fleet card. */
  async setTuningFeedback(text) {
    if (!(await this._ensure())) return;
    const v = String(text || '').trim();
    if (!v || v === this.tuningFeedback) return;
    this.tuningFeedback = v;
    this._queue(this.cols.tuningFeedback, v);
  }

  /** Report the AI key-pool status (availability + cooldowns) for throttle monitoring. */
  async setKeyStatus(text) {
    if (!(await this._ensure())) return;
    const v = String(text || '').trim();
    if (!v || v === this.keyStatus) return;
    this.keyStatus = v;
    this._queue(this.cols.keys, v);
  }

  /** Push one live line into the rolling feed (coalesced into the next flush). */
  async pushActivity(line) {
    if (!line || !(await this._ensure())) return;
    const ts = new Date().toISOString().slice(11, 19);
    this.ring.push(`[${ts}] ${line}`);
    this.activityVersion += 1;
    while (this.ring.length > MAX_LINES) this.ring.shift();
    this._queue(this.cols.activity, this.ring.join('\n'));
    this._queue(this.cols.status, 'Online');
  }

  /** Flip the agent's status (e.g. 'Idle' when the task is done). */
  async setStatus(status) {
    if (!(await this._ensure())) return;
    this._queue(this.cols.status, String(status));
  }

  /** Snapshot the live state so the Dream-RSI summarizer can inspect it. */
  getSnapshot() {
    return {
      task: this.task,
      summary: this.summary,
      workboardFeedback: this.workboardFeedback,
      tuningFeedback: this.tuningFeedback,
      activity: this.ring.slice(),
      activityVersion: this.activityVersion,
    };
  }

  /* ---------- internals ---------- */

  /**
   * Queue a single cell for the next flush. Many field updates within one
   * FLUSH_MS window collapse into ONE Sheets write — this is what keeps us under
   * the 60 writes/min/user quota that was throttling the fleet stream.
   */
  _queue(colIdx, value) {
    if (colIdx == null || colIdx < 0) return;
    this.pending.set(colIdx, value);
    this._scheduleFlush();
  }

  _scheduleFlush() {
    if (this.flushTimer || !this.enabled) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flush().catch(() => {});
    }, FLUSH_MS);
    if (typeof this.flushTimer.unref === 'function') this.flushTimer.unref();
  }

  /**
   * Write all queued cells in ONE batched request (plus a fresh heartbeat).
   * Call directly for an immediate flush (task start / end of run).
   */
  async flush() {
    if (this.flushing) return;
    if (!(await this._ensure())) { this.pending.clear(); return; }
    if (this.pending.size === 0) return;
    if (this.cols.heartbeat >= 0) this.pending.set(this.cols.heartbeat, new Date().toISOString());
    const data = [...this.pending.entries()].map(([c, v]) => this._cell(c, v));
    this.pending.clear();
    this.flushing = true;
    try {
      await this.sheets.batchUpdate(data);
    } catch (e) {
      this.log(`  [fleet] flush skipped: ${e.message}`);
    } finally {
      this.flushing = false;
      if (this.pending.size) this._scheduleFlush();
    }
  }

  /** Build a single-cell batchUpdate entry; guards against unknown columns. */
  _cell(colIdx, value) {
    return { range: `${TAB}!${colLetter(colIdx)}${this.row}`, values: [[value]] };
  }

  async _ensure() {
    if (!this.enabled) return false;
    if (!this.ready) await this.init();
    return this.ready;
  }
}

/** Parse the 1-based row number from an append response's updatedRange. */
function parseAppendedRow(resp) {
  const range = resp && resp.updates && resp.updates.updatedRange;
  if (!range) return -1;
  const m = String(range).match(/![A-Z]+(\d+)/);
  return m ? parseInt(m[1], 10) : -1;
}

module.exports = { FleetReporter };
