/* ============================================================
   mesh-worker.js — In-browser task queue worker

   Polls a MeshQueue (Google-Sheet-backed) for pending tasks,
   executes them, and reports results back to the queue.

   Built-in task types:
     'echo'  — returns the input as output (useful for testing)

   Custom types are registered via worker.register(type, fn).

   Usage:
     import { MeshWorker } from './mesh-worker.js';

     const worker = new MeshWorker(spreadsheetId);
     worker.register('echo', async input => ({ echoed: input }));
     worker.start();    // begins polling every POLL_MS
     // …later…
     worker.stop();
   ============================================================ */

import { MeshQueue, TASK_STATUS, generateWorkerId } from './mesh-queue.js';

/* ---------- Constants ---------- */

const POLL_MS     = 5000;   // poll interval (5s — conservative to respect rate limits)
const MAX_RETRIES = 3;      // max consecutive poll failures before backing off

/* ---------- MeshWorker ---------- */

/**
 * In-browser worker that polls a MeshQueue and executes tasks.
 */
export class MeshWorker {
  /**
   * @param {string} spreadsheetId — backing Google Sheet
   * @param {Object} [opts]
   * @param {string}   [opts.sheetTitle='Sheet1']  — queue tab name
   * @param {string}   [opts.workerId]             — auto-generated if omitted
   * @param {number}   [opts.pollMs=5000]          — poll interval in ms
   * @param {function} [opts.onStatusChange]       — (status:string) => void
   * @param {function} [opts.onTaskStart]          — (task:Object) => void
   * @param {function} [opts.onTaskComplete]       — (task:Object, output) => void
   * @param {function} [opts.onTaskFail]           — (task:Object, error) => void
   */
  constructor(spreadsheetId, opts = {}) {
    this.spreadsheetId  = spreadsheetId;
    this.workerId       = opts.workerId || generateWorkerId();
    this._pollMs        = opts.pollMs   || POLL_MS;
    this._onStatusChange = opts.onStatusChange || (() => {});
    this._onTaskStart    = opts.onTaskStart    || (() => {});
    this._onTaskComplete = opts.onTaskComplete || (() => {});
    this._onTaskFail     = opts.onTaskFail     || (() => {});

    this._queue     = new MeshQueue(spreadsheetId, {
      sheetTitle: opts.sheetTitle || 'Sheet1',
      workerId:   this.workerId,
    });
    this._handlers  = new Map();
    this._timer     = null;
    this._running   = false;
    this._failures  = 0;
    this._status    = 'idle';

    // Register built-in handlers
    this._registerBuiltins();
  }

  /* ---------- Public API ---------- */

  /**
   * Register a handler for a task type.
   * The handler receives the task's input object and must return the output.
   * Throwing causes the task to be marked failed.
   * @param {string}   type    — task type string (e.g. 'importSheet')
   * @param {function} handler — async (input: Object) => output: any
   */
  register(type, handler) {
    this._handlers.set(type, handler);
    return this;
  }

  /** Start polling the queue. */
  start() {
    if (this._running) return this;
    this._running = true;
    this._setStatus('polling');
    this._scheduleNext(0);
    return this;
  }

  /** Stop polling and clear any scheduled timers. */
  stop() {
    this._running = false;
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    this._setStatus('idle');
    return this;
  }

  /** Whether this worker is currently active. */
  get isRunning() { return this._running; }

  /** Current worker status string. */
  get status() { return this._status; }

  /** Expose the underlying queue for direct access (enqueue, getTasks, etc.). */
  get queue() { return this._queue; }

  /* ---------- Internal ---------- */

  _setStatus(s) {
    this._status = s;
    this._onStatusChange(s);
  }

  _scheduleNext(delayMs) {
    if (!this._running) return;
    this._timer = setTimeout(() => this._poll(), delayMs);
  }

  async _poll() {
    if (!this._running) return;
    try {
      this._setStatus('polling');
      const task = await this._queue.claimTask();
      if (task) {
        this._failures = 0;
        await this._execute(task);
      } else {
        this._failures = 0;
        this._setStatus('idle');
      }
    } catch (err) {
      this._failures++;
      const backoff = Math.min(this._pollMs * Math.pow(2, this._failures), 60000);
      this._setStatus('error');
      // Back off on repeated failures to avoid hammering the Sheets API
      if (this._failures < MAX_RETRIES) {
        this._scheduleNext(backoff);
      } else {
        // After MAX_RETRIES, reset failure count and continue at normal interval
        this._failures = 0;
        this._scheduleNext(this._pollMs);
      }
      return;
    }
    this._scheduleNext(this._pollMs);
  }

  async _execute(task) {
    this._onTaskStart(task);
    this._setStatus(`running:${task.type}`);

    const handler = this._handlers.get(task.type);
    if (!handler) {
      const err = `No handler registered for task type "${task.type}"`;
      await this._queue.failTask(task.taskId, err);
      this._onTaskFail(task, new Error(err));
      return;
    }

    try {
      const output = await handler(task.input, task);
      await this._queue.completeTask(task.taskId, output);
      this._onTaskComplete(task, output);
    } catch (err) {
      await this._queue.failTask(task.taskId, err);
      this._onTaskFail(task, err);
    }
  }

  _registerBuiltins() {
    // echo — returns input as output (useful for testing the system end-to-end)
    this.register('echo', async (input) => {
      return { echoed: input, workerTime: new Date().toISOString() };
    });
  }
}
