/* ============================================================
   templates/worker.js — Worker Jobs: backend job runner/automation
   ============================================================ */

import { el, cell, editableCell, emitEdit, registerTemplate, buildDirSyncBtn, delegateEvent } from './shared.js';

/* ---------- Helpers ---------- */

export const JOB_STATUSES = ['pending', 'running', 'done', 'failed', 'scheduled'];

export function classifyJobStatus(raw) {
  const v = (raw || '').toLowerCase().trim();
  if (/^(done|complete|success|ok|finished)/.test(v)) return 'done';
  if (/^(run|active|in.?progress|working|busy)/.test(v)) return 'running';
  if (/^(fail|error|crash|broken|except)/.test(v)) return 'failed';
  if (/^(sched|queue|wait|next|cron)/.test(v)) return 'scheduled';
  return 'pending';
}

export function jobStatusLabel(cls) {
  return {
    pending:   'Pending',
    running:   'Running',
    done:      'Done',
    failed:    'Failed',
    scheduled: 'Scheduled',
  }[cls] || 'Pending';
}

export const HANDLER_COLORS = {
  poll:    '#0369a1',
  sync:    '#16a34a',
  notify:  '#7c3aed',
  webhook: '#d97706',
  script:  '#db2777',
  cron:    '#0d9488',
};

export function handlerColor(handler) {
  const key = (handler || '').toLowerCase().trim();
  for (const [k, color] of Object.entries(HANDLER_COLORS)) {
    if (key.startsWith(k)) return color;
  }
  return '#64748b';
}

export function formatLastRun(raw) {
  if (!raw) return '';
  const d = new Date(raw);
  if (isNaN(d.getTime())) return raw;
  const now = new Date();
  const diffMs = now - d;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1)  return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24)  return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

/* ---------- Template definition ---------- */

const definition = {
  name: 'Worker Jobs',
  icon: '⚙️',
  color: '#0369a1',
  priority: 20,
  itemNoun: 'Job',
  defaultHeaders: ['Job', 'Handler', 'Config', 'Status', 'Schedule', 'Last Run', 'Result'],

  detect(lower) {
    const hasJob      = lower.some(h => /^(job|task|worker)$/.test(h));
    const hasHandler  = lower.some(h => /^(handler|runner|type|kind)$/.test(h));
    const hasSchedule = lower.some(h => /^(schedule|cron|interval|frequency|every)/.test(h));
    return hasJob && (hasHandler || hasSchedule);
  },

  columns(lower) {
    const cols = { job: -1, handler: -1, config: -1, status: -1, schedule: -1, lastRun: -1, result: -1 };
    cols.job      = lower.findIndex(h => /^(job|task|worker)$/.test(h));
    cols.handler  = lower.findIndex(h => /^(handler|runner|type|kind)$/.test(h));
    cols.config   = lower.findIndex(h => /^(config|params|args|options|settings?)$/.test(h));
    cols.status   = lower.findIndex(h => /^(status|state)$/.test(h));
    cols.schedule = lower.findIndex(h => /^(schedule|cron|interval|frequency|every)/.test(h));
    cols.lastRun  = lower.findIndex(h => /^(last.?run|ran.?at|updated|timestamp|executed)/.test(h));
    cols.result   = lower.findIndex(h => /^(result|output|log|message)$/.test(h));
    return cols;
  },

  addRowFields(cols) {
    return [
      { role: 'job',      label: 'Job Name',  colIndex: cols.job,      type: 'text', placeholder: 'e.g. Sync CRM data',    required: true },
      { role: 'handler',  label: 'Handler',   colIndex: cols.handler,  type: 'text', placeholder: 'poll, sync, webhook…'  },
      { role: 'config',   label: 'Config',    colIndex: cols.config,   type: 'text', placeholder: 'JSON config / URL / ID' },
      { role: 'status',   label: 'Status',    colIndex: cols.status,   type: 'text', placeholder: 'pending',               defaultValue: 'pending' },
      { role: 'schedule', label: 'Schedule',  colIndex: cols.schedule, type: 'text', placeholder: 'e.g. */5 * * * *'       },
      { role: 'result',   label: 'Result',    colIndex: cols.result,   type: 'text', placeholder: 'Last output message'    },
    ];
  },

  render(container, rows, cols) {
    // Stat summary bar
    const totals = { pending: 0, running: 0, done: 0, failed: 0, scheduled: 0 };
    for (const row of rows) {
      const cls = classifyJobStatus(cell(row, cols.status));
      totals[cls]++;
    }

    const statBar = el('div', { className: 'worker-stat-bar' }, [
      el('span', { className: 'worker-stat worker-stat-pending'   }, [`${totals.pending} pending`]),
      el('span', { className: 'worker-stat worker-stat-running'   }, [`${totals.running} running`]),
      el('span', { className: 'worker-stat worker-stat-scheduled' }, [`${totals.scheduled} scheduled`]),
      el('span', { className: 'worker-stat worker-stat-done'      }, [`${totals.done} done`]),
      el('span', { className: 'worker-stat worker-stat-failed'    }, [`${totals.failed} failed`]),
    ]);
    container.append(statBar);

    // Job grid
    const grid = el('div', { className: 'worker-grid' });

    for (let i = 0; i < rows.length; i++) {
      const row    = rows[i];
      const rowIdx = i + 1;
      const jobName    = cell(row, cols.job)      || `Job ${rowIdx}`;
      const handler    = cell(row, cols.handler)  || '';
      const config     = cell(row, cols.config)   || '';
      const rawStatus  = cell(row, cols.status)   || '';
      const schedule   = cell(row, cols.schedule) || '';
      const lastRun    = cell(row, cols.lastRun)  || '';
      const result     = cell(row, cols.result)   || '';

      const statusCls  = classifyJobStatus(rawStatus);
      const statusTxt  = jobStatusLabel(statusCls);
      const hColor     = handlerColor(handler);
      const lastRunTxt = formatLastRun(lastRun);

      // Build handler badge
      const handlerBadge = handler
        ? el('span', { className: 'worker-handler-badge', style: `background:${hColor}` }, [handler])
        : null;

      // Status cycle on click
      const statusBadge = el('span', {
        className: `worker-status-badge worker-status-${statusCls}`,
        title: 'Click to cycle status',
      }, [statusTxt]);

      statusBadge.addEventListener('click', () => {
        const order = ['pending', 'running', 'done', 'failed', 'scheduled'];
        const next  = order[(order.indexOf(statusCls) + 1) % order.length];
        emitEdit(rowIdx, cols.status, next);
      });

      // Build card
      const card = el('div', { className: `worker-card worker-card-${statusCls}` }, [
        el('div', { className: 'worker-card-header' }, [
          el('span', { className: 'worker-card-icon' }, ['⚙️']),
          cols.job >= 0
            ? editableCell('span', { className: 'worker-card-title' }, jobName, rowIdx, cols.job)
            : el('span', { className: 'worker-card-title' }, [jobName]),
          statusBadge,
        ]),
        el('div', { className: 'worker-card-meta' }, [
          ...(handlerBadge ? [handlerBadge] : []),
          ...(schedule ? [el('span', { className: 'worker-schedule' }, ['🕐 ' + schedule])] : []),
        ]),
        ...(config
          ? [el('div', { className: 'worker-config' }, [
              el('span', { className: 'worker-config-label' }, ['Config: ']),
              cols.config >= 0
                ? editableCell('span', { className: 'worker-config-value' }, config, rowIdx, cols.config)
                : el('span', { className: 'worker-config-value' }, [config]),
            ])]
          : []),
        el('div', { className: 'worker-card-footer' }, [
          ...(lastRunTxt ? [el('span', { className: 'worker-last-run' }, ['Last run: ' + lastRunTxt])] : []),
          ...(result
            ? [cols.result >= 0
                ? editableCell('span', { className: 'worker-result' }, result, rowIdx, cols.result)
                : el('span', { className: 'worker-result' }, [result])]
            : []),
        ]),
      ]);

      grid.append(card);
    }

    container.append(grid);
  },
};

registerTemplate('worker', definition);
