/* ============================================================
   lib/fleet-reporter.js — Live agent activity → Agent Registry sheet

   This is the tie-in between the Gemini Dream-RSI engine and the Waymark
   "Dev Fleet" plumbing. The same Agent Registry sheet that agent-runner.sh
   writes Status/Task/Heartbeat to (via write-agent-sheet.sh) is the sheet
   the AI Fleet tool (templates/agents.js) renders. This reporter streams the
   agent's live turn-by-turn activity INTO that sheet so the fleet tool shows a
   real chat-style feed of what the agent is doing right now.

   It auto-provisions:
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
    this.ring = [];
  }

  /**
   * Discover columns, ensure an Activity column exists, and find-or-create this
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
        activity: lower.findIndex((h) => /^(activity|feed|log|stream)/.test(h)),
        heartbeat: lower.findIndex((h) => /^(heartbeat|last seen|ping|updated|timestamp)/.test(h)),
      };
      if (this.cols.name < 0) this.cols.name = 0;

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
    const data = [];
    if (this.cols.task >= 0) data.push(this._cell(this.cols.task, String(title || '')));
    if (this.cols.status >= 0) data.push(this._cell(this.cols.status, 'Online'));
    await this._write(data);
  }

  /** Push one live line into the rolling feed (Activity + Heartbeat + Online). */
  async pushActivity(line) {
    if (!line || !(await this._ensure())) return;
    const ts = new Date().toISOString().slice(11, 19);
    this.ring.push(`[${ts}] ${line}`);
    while (this.ring.length > MAX_LINES) this.ring.shift();

    const data = [this._cell(this.cols.activity, this.ring.join('\n'))];
    if (this.cols.heartbeat >= 0) data.push(this._cell(this.cols.heartbeat, new Date().toISOString()));
    if (this.cols.status >= 0) data.push(this._cell(this.cols.status, 'Online'));
    await this._write(data);
  }

  /** Flip the agent's status (e.g. 'Idle' when the task is done). */
  async setStatus(status) {
    if (!(await this._ensure()) || this.cols.status < 0) return;
    await this._write([this._cell(this.cols.status, String(status))]);
  }

  /* ---------- internals ---------- */

  /** Build a single-cell batchUpdate entry; guards against unknown columns. */
  _cell(colIdx, value) {
    return { range: `${TAB}!${colLetter(colIdx)}${this.row}`, values: [[value]] };
  }

  async _ensure() {
    if (!this.enabled) return false;
    if (!this.ready) await this.init();
    return this.ready;
  }

  async _write(data) {
    if (!data || !data.length) return;
    try {
      await this.sheets.batchUpdate(data);
    } catch (e) {
      this.log(`  [fleet] write skipped: ${e.message}`);
    }
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
