/* ============================================================
   templates/mesh/index.js — Mesh Task Queue template

   Detects Google Sheets formatted as distributed task queues
   and renders them as an interactive dashboard:
     • Summary stats (counts by status)
     • In-line worker start/stop button for running tasks
     • Task table with click-to-cycle status badges
     • Expandable input/output/error detail panels
   ============================================================ */

import {
  el, cell, editableCell, emitEdit, registerTemplate,
} from '../shared.js';

import {
  classifyStatus, statusLabel, nextStatus,
  priorityRank, countByStatus, sortByPriority,
  parseJSON, formatJSON, formatDuration,
} from './helpers.js';

/* ---------- Status cycle for interactive badges ---------- */

/** Compute the current CSS class for a status badge. */
function statusClass(cls) { return `mesh-status mesh-status-${cls}`; }

/** Compute the CSS class for a priority badge. */
function priorityClass(raw) {
  const v = (raw || '').toLowerCase();
  if (v === 'high' || v === 'critical') return 'mesh-priority mesh-priority-high';
  if (v === 'low'  || v === 'defer')   return 'mesh-priority mesh-priority-low';
  return 'mesh-priority mesh-priority-normal';
}

/* ---------- Summary bar ---------- */

function renderSummary(counts, total) {
  const items = [
    { cls: 'pending',   count: counts.pending },
    { cls: 'running',   count: counts.running },
    { cls: 'done',      count: counts.done },
    { cls: 'failed',    count: counts.failed },
    { cls: 'cancelled', count: counts.cancelled },
  ].filter(item => item.count > 0);

  const badges = items.map(({ cls, count }) =>
    el('span', { className: `mesh-summary-badge mesh-summary-${cls}` }, [
      el('span', { className: 'mesh-summary-count' }, [String(count)]),
      el('span', { className: 'mesh-summary-label' }, [statusLabel(cls)]),
    ])
  );

  const doneRate = total > 0 ? Math.round((counts.done / total) * 100) : 0;

  return el('div', { className: 'mesh-summary' }, [
    el('div', { className: 'mesh-summary-badges' }, badges),
    el('div', { className: 'mesh-summary-progress' }, [
      el('div', { className: 'mesh-progress-bar' }, [
        el('div', { className: 'mesh-progress-fill', style: { width: `${doneRate}%` } }),
      ]),
      el('span', { className: 'mesh-progress-label' }, [`${doneRate}% done · ${total} task${total === 1 ? '' : 's'}`]),
    ]),
  ]);
}

/* ---------- Detail panel (input / output / error) ---------- */

function renderDetail(task) {
  const parts = [];

  if (task.input && Object.keys(task.input).length > 0) {
    parts.push(el('div', { className: 'mesh-detail-section' }, [
      el('span', { className: 'mesh-detail-label' }, ['Input']),
      el('pre', { className: 'mesh-detail-json' }, [formatJSON(task.input)]),
    ]));
  }

  if (task.output !== null && task.output !== undefined) {
    parts.push(el('div', { className: 'mesh-detail-section' }, [
      el('span', { className: 'mesh-detail-label' }, ['Output']),
      el('pre', { className: 'mesh-detail-json mesh-detail-output' }, [formatJSON(task.output)]),
    ]));
  }

  if (task.error) {
    parts.push(el('div', { className: 'mesh-detail-section' }, [
      el('span', { className: 'mesh-detail-label mesh-detail-error-label' }, ['Error']),
      el('pre', { className: 'mesh-detail-json mesh-detail-error' }, [task.error]),
    ]));
  }

  return parts.length > 0
    ? el('div', { className: 'mesh-detail hidden' }, parts)
    : null;
}

/* ---------- Task row ---------- */

function renderTaskRow(task, rowIdx, cols, rows) {
  const cls   = classifyStatus(task.status);
  const pCls  = priorityClass(task.priority);
  const dur   = cls === 'running'
    ? formatDuration(task.started)
    : formatDuration(task.started, task.completed);

  const detail = renderDetail(task);

  // Status badge — click cycles through states (workers set 'running')
  const statusBadge = el('span', { className: statusClass(cls) }, [statusLabel(cls)]);
  if (cols.status >= 0) {
    statusBadge.style.cursor = 'pointer';
    statusBadge.addEventListener('click', () => {
      const cur   = [...statusBadge.classList].find(c => c.startsWith('mesh-status-') && c !== 'mesh-status')?.replace('mesh-status-', '') || 'pending';
      const next  = nextStatus(cur);
      statusBadge.className = statusClass(next);
      statusBadge.textContent = statusLabel(next);
      emitEdit(rowIdx, cols.status, statusLabel(next));
    });
  }

  // Toggle detail panel on row click
  const tr = el('div', { className: `mesh-task-row mesh-row-${cls}` });
  const mainRow = el('div', { className: 'mesh-task-main' });
  mainRow.addEventListener('click', (e) => {
    if (e.target.closest('.mesh-status')) return;  // let status badge handle its own clicks
    if (!detail) return;
    detail.classList.toggle('hidden');
  });

  // Type badge
  const typeBadge = cols.type >= 0
    ? editableCell('span', { className: 'mesh-task-type' }, task.type || '—', rowIdx, cols.type)
    : el('span', { className: 'mesh-task-type' }, [task.type || '—']);

  // Task ID (partial, for readability)
  const shortId = (task.taskId || '—').slice(0, 16);

  mainRow.append(
    el('span', { className: 'mesh-task-id', title: task.taskId || '' }, [shortId]),
    typeBadge,
    statusBadge,
    el('span', { className: pCls }, [task.priority || 'normal']),
    task.workerId
      ? el('span', { className: 'mesh-task-worker', title: task.workerId }, [task.workerId.slice(0, 10)])
      : el('span', { className: 'mesh-task-worker mesh-no-worker' }, ['—']),
    el('span', { className: 'mesh-task-duration' }, [dur]),
  );

  tr.append(mainRow);
  if (detail) tr.append(detail);
  return tr;
}

/* ---------- Template definition ---------- */

const definition = {
  name:     'Mesh Queue',
  icon:     '⚙️',
  color:    '#0369a1',
  priority: 22,
  defaultHeaders: ['Task ID', 'Type', 'Status', 'Priority', 'Worker ID', 'Created', 'Started', 'Completed', 'Input', 'Output', 'Error'],

  detect(lower) {
    const hasTaskId = lower.some(h => /^task.?id$/.test(h));
    const hasType   = lower.some(h => h === 'type');
    const hasStatus = lower.some(h => h === 'status');
    const hasMesh   = lower.some(h => /^(worker.?id|queue)/.test(h));
    return hasTaskId && hasType && hasStatus && hasMesh;
  },

  columns(lower) {
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
  },

  render(container, rows, cols) {
    container.innerHTML = '';

    // Parse all tasks into structured objects
    const tasks = rows.map((row, i) => {
      const get = key => {
        const c = cols[key];
        return (c >= 0 && c < row.length) ? (row[c] || '') : '';
      };
      return {
        taskId:    get('taskId'),
        type:      get('type'),
        status:    get('status').toLowerCase() || 'pending',
        priority:  get('priority').toLowerCase() || 'normal',
        workerId:  get('workerId'),
        created:   get('created'),
        started:   get('started'),
        completed: get('completed'),
        input:     parseJSON(get('input'), {}),
        output:    parseJSON(get('output'), null),
        error:     get('error'),
        _rowIdx:   i + 1,
      };
    });

    // Sort: high-priority pending first, then running, then done/failed/cancelled
    const sorted = sortByPriority(tasks);
    const counts = countByStatus(tasks);

    // Header + summary
    const header = el('div', { className: 'mesh-header' }, [
      el('div', { className: 'mesh-header-title' }, [
        el('span', { className: 'mesh-header-icon' }, ['⚙️']),
        el('span', {}, ['Task Queue']),
      ]),
    ]);
    container.append(header);

    if (tasks.length > 0) {
      container.append(renderSummary(counts, tasks.length));
    }

    // Column labels
    const colLabels = el('div', { className: 'mesh-col-labels' }, [
      el('span', { className: 'mesh-col-id' }, ['Task ID']),
      el('span', { className: 'mesh-col-type' }, ['Type']),
      el('span', { className: 'mesh-col-status' }, ['Status']),
      el('span', { className: 'mesh-col-priority' }, ['Priority']),
      el('span', { className: 'mesh-col-worker' }, ['Worker']),
      el('span', { className: 'mesh-col-duration' }, ['Duration']),
    ]);
    container.append(colLabels);

    // Task rows
    const taskList = el('div', { className: 'mesh-task-list' });
    if (sorted.length === 0) {
      taskList.append(el('div', { className: 'mesh-empty' }, ['No tasks in queue.']));
    } else {
      for (const task of sorted) {
        taskList.append(renderTaskRow(task, task._rowIdx, cols, rows));
      }
    }
    container.append(taskList);
  },
};

registerTemplate('mesh', definition);
export default definition;
