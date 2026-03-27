/* ============================================================
   mesh-queue.js — Browser-based distributed task queue

   Uses a Google Sheet as the durable persistent queue backend.
   Multiple browser instances (tabs, headless workers) can
   enqueue and claim tasks concurrently, coordinated via
   optimistic locking against the Sheets API.

   Sheet format (first row must be these headers):
   Task ID | Type | Status | Priority | Worker ID |
   Created | Started | Completed | Input | Output | Error

   Usage:
     import { MeshQueue } from './mesh-queue.js';
     const q = new MeshQueue(spreadsheetId, { sheetTitle: 'Sheet1' });
     const taskId = await q.enqueue('echo', { message: 'hi' }, 'normal');
     const task = await q.claimTask();   // returns { taskId, type, input, ... }
     await q.completeTask(task.taskId, { result: 'done' });
   ============================================================ */

import { api } from './api-client.js';

/* ---------- Constants ---------- */

export const TASK_STATUS = {
  PENDING:   'pending',
  RUNNING:   'running',
  DONE:      'done',
  FAILED:    'failed',
  CANCELLED: 'cancelled',
};

export const TASK_PRIORITY = {
  HIGH:   'high',
  NORMAL: 'normal',
  LOW:    'low',
};

/** Canonical queue column order (0-based within the data range). */
const COL = {
  TASK_ID:   0,
  TYPE:      1,
  STATUS:    2,
  PRIORITY:  3,
  WORKER_ID: 4,
  CREATED:   5,
  STARTED:   6,
  COMPLETED: 7,
  INPUT:     8,
  OUTPUT:    9,
  ERROR:     10,
};

const HEADERS = [
  'Task ID', 'Type', 'Status', 'Priority', 'Worker ID',
  'Created', 'Started', 'Completed', 'Input', 'Output', 'Error',
];

const PRIORITY_ORDER = ['high', 'normal', 'low'];

/* ---------- Helpers ---------- */

function generateTaskId() {
  return 'task-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
}

/** @returns {string} worker ID unique to this browser session */
export function generateWorkerId() {
  return 'w-' + Math.random().toString(36).slice(2, 8);
}

function nowStr() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function tryParseJSON(str, fallback) {
  if (!str) return fallback;
  try { return JSON.parse(str); } catch { return fallback; }
}

function rankPriority(raw) {
  const idx = PRIORITY_ORDER.indexOf((raw || '').toLowerCase().trim());
  return idx >= 0 ? idx : 1;
}

/* ---------- MeshQueue class ---------- */

/**
 * Browser-based distributed task queue backed by a Google Sheet.
 * Multiple browser instances can enqueue and claim tasks concurrently.
 */
export class MeshQueue {
  /**
   * @param {string} spreadsheetId — Google Sheet ID
   * @param {Object} [opts]
   * @param {string} [opts.sheetTitle='Sheet1'] — tab name
   * @param {string} [opts.workerId]            — auto-generated if omitted
   */
  constructor(spreadsheetId, opts = {}) {
    this.spreadsheetId = spreadsheetId;
    this.sheetTitle    = opts.sheetTitle || 'Sheet1';
    this.workerId      = opts.workerId   || generateWorkerId();
    this._ready        = null;  // Promise — ensures headers are written once
  }

  /* ---------- Public API ---------- */

  /**
   * Add a task to the queue.
   * @param {string} type               — task type ('echo', 'importSheet', …)
   * @param {Object} [input={}]         — task input, serialized to JSON
   * @param {string} [priority='normal'] — 'high' | 'normal' | 'low'
   * @returns {Promise<string>}          taskId
   */
  async enqueue(type, input = {}, priority = TASK_PRIORITY.NORMAL) {
    await this._ensureHeaders();
    const taskId = generateTaskId();
    const row = new Array(HEADERS.length).fill('');
    row[COL.TASK_ID]  = taskId;
    row[COL.TYPE]     = type;
    row[COL.STATUS]   = TASK_STATUS.PENDING;
    row[COL.PRIORITY] = priority;
    row[COL.CREATED]  = nowStr();
    row[COL.INPUT]    = JSON.stringify(input);
    await api.sheets.appendRows(this.spreadsheetId, this.sheetTitle, [row]);
    return taskId;
  }

  /**
   * Get all tasks from the queue (newest first after sorting by priority).
   * @returns {Promise<Object[]>}
   */
  async getTasks() {
    const data = await api.sheets.getSpreadsheet(this.spreadsheetId);
    const rows = (data && data.values) ? data.values : [];
    if (rows.length < 2) return [];
    const colMap = this._buildColMap(rows[0]);
    return rows.slice(1).map((row, i) => this._parseRow(row, colMap, i + 1));
  }

  /**
   * Claim a pending task for this worker (optimistic locking).
   * High-priority tasks are claimed before normal/low.
   * Returns null if no pending task is available.
   * @returns {Promise<Object|null>}
   */
  async claimTask() {
    const data = await api.sheets.getSpreadsheet(this.spreadsheetId);
    const rows = (data && data.values) ? data.values : [];
    if (rows.length < 2) return null;

    const colMap = this._buildColMap(rows[0]);
    const statusCol = colMap.status ?? COL.STATUS;

    // Collect pending tasks and sort by priority
    const pending = [];
    for (let i = 1; i < rows.length; i++) {
      const row  = rows[i];
      const stat = (row[statusCol] || '').toLowerCase().trim();
      if (stat === TASK_STATUS.PENDING) {
        pending.push({ task: this._parseRow(row, colMap, i), sheetRow: i });
      }
    }
    if (pending.length === 0) return null;

    pending.sort((a, b) => {
      const pd = rankPriority(a.task.priority) - rankPriority(b.task.priority);
      return pd !== 0 ? pd : (a.task.created || '').localeCompare(b.task.created || '');
    });

    const { task, sheetRow } = pending[0];
    const workerCol    = colMap.workerId    ?? COL.WORKER_ID;
    const startedCol   = colMap.started     ?? COL.STARTED;

    // Write claim (three separate cells — status, worker, started)
    try {
      await api.sheets.updateCell(this.spreadsheetId, this.sheetTitle, sheetRow, statusCol,  TASK_STATUS.RUNNING);
      await api.sheets.updateCell(this.spreadsheetId, this.sheetTitle, sheetRow, workerCol,   this.workerId);
      await api.sheets.updateCell(this.spreadsheetId, this.sheetTitle, sheetRow, startedCol,  nowStr());
    } catch {
      return null;
    }

    // Optimistic verify: re-read the row and confirm our workerID is set
    const verify = await api.sheets.getSpreadsheet(this.spreadsheetId);
    const vRows  = (verify && verify.values) ? verify.values : [];
    const vRow   = vRows[sheetRow] || [];
    if ((vRow[workerCol] || '') !== this.workerId) return null;  // race condition

    return {
      ...task,
      status:   TASK_STATUS.RUNNING,
      workerId: this.workerId,
    };
  }

  /**
   * Mark a task as done.
   * @param {string} taskId
   * @param {*}      [output] — result data (JSON-serialized)
   * @returns {Promise<void>}
   */
  async completeTask(taskId, output = null) {
    await this._updateTask(taskId, TASK_STATUS.DONE, {
      output:    JSON.stringify(output),
      completed: nowStr(),
    });
  }

  /**
   * Mark a task as failed.
   * @param {string}       taskId
   * @param {string|Error} error
   * @returns {Promise<void>}
   */
  async failTask(taskId, error) {
    const msg = error instanceof Error ? error.message : String(error);
    await this._updateTask(taskId, TASK_STATUS.FAILED, {
      error:     msg,
      completed: nowStr(),
    });
  }

  /**
   * Cancel a pending task.
   * @param {string} taskId
   * @returns {Promise<void>}
   */
  async cancelTask(taskId) {
    await this._updateTask(taskId, TASK_STATUS.CANCELLED, { completed: nowStr() });
  }

  /* ---------- Private helpers ---------- */

  /**
   * Build a column index map from the header row.
   * Gracefully handles sheets with headers in any order.
   * @param {string[]} headerRow
   * @returns {Object} { taskId, type, status, priority, workerId, created, started, completed, input, output, error }
   */
  _buildColMap(headerRow) {
    const lower = (headerRow || []).map(h => (h || '').toLowerCase().trim());
    return {
      taskId:    lower.findIndex(h => /^task.?id$/.test(h)),
      type:      lower.findIndex(h => h === 'type'),
      status:    lower.findIndex(h => h === 'status'),
      priority:  lower.findIndex(h => h === 'priority'),
      workerId:  lower.findIndex(h => /^worker.?id$/.test(h)),
      created:   lower.findIndex(h => h === 'created'),
      started:   lower.findIndex(h => h === 'started'),
      completed: lower.findIndex(h => h === 'completed'),
      input:     lower.findIndex(h => h === 'input'),
      output:    lower.findIndex(h => h === 'output'),
      error:     lower.findIndex(h => h === 'error'),
    };
  }

  /**
   * Parse a sheet row into a task object.
   * @param {string[]} row
   * @param {Object}   colMap — from _buildColMap
   * @param {number}   rowIndex — 1-based data row index
   * @returns {Object}
   */
  _parseRow(row, colMap, rowIndex) {
    const get = key => {
      const i = colMap[key];
      return (i >= 0 && i < row.length) ? (row[i] || '') : '';
    };
    return {
      taskId:    get('taskId'),
      type:      get('type'),
      status:    (get('status') || TASK_STATUS.PENDING).toLowerCase(),
      priority:  (get('priority') || TASK_PRIORITY.NORMAL).toLowerCase(),
      workerId:  get('workerId'),
      created:   get('created'),
      started:   get('started'),
      completed: get('completed'),
      input:     tryParseJSON(get('input'), {}),
      output:    tryParseJSON(get('output'), null),
      error:     get('error'),
      _rowIndex: rowIndex,
    };
  }

  /**
   * Find a task by ID and update its fields.
   * @param {string} taskId
   * @param {string} newStatus
   * @param {Object} fields  — { fieldName: value } mapped by header key
   * @returns {Promise<void>}
   */
  async _updateTask(taskId, newStatus, fields = {}) {
    const data   = await api.sheets.getSpreadsheet(this.spreadsheetId);
    const rows   = (data && data.values) ? data.values : [];
    if (rows.length < 2) return;

    const colMap    = this._buildColMap(rows[0]);
    const taskIdCol = colMap.taskId ?? COL.TASK_ID;
    const statusCol = colMap.status ?? COL.STATUS;

    for (let i = 1; i < rows.length; i++) {
      if ((rows[i][taskIdCol] || '') !== taskId) continue;

      await api.sheets.updateCell(this.spreadsheetId, this.sheetTitle, i, statusCol, newStatus);

      for (const [key, val] of Object.entries(fields)) {
        const idx = colMap[key];
        if (idx >= 0) {
          await api.sheets.updateCell(this.spreadsheetId, this.sheetTitle, i, idx, val);
        }
      }
      return;
    }
  }

  /**
   * Write queue headers if the sheet appears empty (first open).
   */
  async _ensureHeaders() {
    if (this._ready) return this._ready;
    this._ready = (async () => {
      try {
        const data = await api.sheets.getSpreadsheet(this.spreadsheetId);
        const rows = (data && data.values) ? data.values : [];
        // Already has data — assume headers are present
        if (rows.length > 0) return;
        // Empty sheet: write header row
        await api.sheets.appendRows(this.spreadsheetId, this.sheetTitle, [HEADERS]);
      } catch {
        // Non-fatal: sheet may not support write or fixture is read-only
      }
    })();
    return this._ready;
  }
}
