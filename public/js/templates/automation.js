/* ============================================================
   templates/automation.js — Automation: browser workflow steps
   ============================================================ */

import { el, cell, editableCell, emitEdit, registerTemplate, parseGroups } from './shared.js';

/* ---------- Helpers ---------- */

const STATUS_STATES = ['pending', 'running', 'done', 'failed', 'skipped'];

function classifyStatus(raw) {
  const v = (raw || '').toLowerCase().trim();
  if (/^(done|complete|pass|success)/.test(v)) return 'done';
  if (/^(run|active|in.?progress)/.test(v)) return 'running';
  if (/^(fail|error|broken)/.test(v)) return 'failed';
  if (/^(skip|disabled|ignore)/.test(v)) return 'skipped';
  return 'pending';
}

function statusLabel(cls) {
  return { pending: 'Pending', running: 'Running', done: 'Done', failed: 'Failed', skipped: 'Skipped' }[cls] || 'Pending';
}

const ACTION_COLORS = {
  navigate: '#2563eb',
  click:    '#16a34a',
  type:     '#7c3aed',
  wait:     '#d97706',
  assert:   '#0d9488',
  screenshot: '#db2777',
};

function actionColor(action) {
  const key = (action || '').toLowerCase().trim();
  for (const [k, color] of Object.entries(ACTION_COLORS)) {
    if (key.startsWith(k)) return color;
  }
  return '#64748b'; // default gray
}

const definition = {
  name: 'Automation',
  icon: '🤖',
  color: '#7c3aed',
  priority: 21,
  itemNoun: 'Step',

  detect(lower) {
    const hasAction = lower.some(h => /^(action|command|operation|do)$/.test(h));
    const hasTarget = lower.some(h => /^(target|selector|element|locator)/.test(h));
    const hasWorkflow = lower.some(h => /^(workflow|automation|flow|script|scenario)/.test(h));
    const hasStep = lower.some(h => /^(step|instruction|task|description)/.test(h));
    // Must have action+target, or workflow+action
    return (hasAction && hasTarget) || (hasWorkflow && hasAction);
  },

  columns(lower) {
    const cols = { workflow: -1, step: -1, action: -1, target: -1, value: -1, status: -1 };
    cols.workflow = lower.findIndex(h => /^(workflow|automation|flow|script|scenario)/.test(h));
    cols.step     = lower.findIndex((h, i) => i !== cols.workflow && /^(step|instruction|description|task|label)/.test(h));
    cols.action   = lower.findIndex((h, i) => i !== cols.workflow && i !== cols.step && /^(action|command|operation|do)$/.test(h));
    cols.target   = lower.findIndex((h, i) => i !== cols.workflow && i !== cols.step && i !== cols.action && /^(target|selector|element|locator|url)/.test(h));
    cols.value    = lower.findIndex((h, i) => i !== cols.workflow && i !== cols.step && i !== cols.action && i !== cols.target && /^(value|input|data|text|param)/.test(h));
    cols.status   = lower.findIndex((h, i) => i !== cols.workflow && i !== cols.step && i !== cols.action && i !== cols.target && i !== cols.value && /^(status|state|result|outcome)/.test(h));
    // Fallback: if no workflow col, use first text-like col
    if (cols.workflow === -1) cols.workflow = lower.findIndex(h => /^(name|title)/.test(h));
    return cols;
  },

  addRowFields(cols) {
    return [
      { role: 'workflow', label: 'Workflow',   colIndex: cols.workflow, type: 'text', placeholder: 'Workflow name' },
      { role: 'step',     label: 'Step',       colIndex: cols.step,    type: 'text', placeholder: 'Step description', required: true },
      { role: 'action',   label: 'Action',     colIndex: cols.action,  type: 'text', placeholder: 'navigate, click, type…' },
      { role: 'target',   label: 'Target',     colIndex: cols.target,  type: 'text', placeholder: 'CSS selector or URL' },
      { role: 'value',    label: 'Value',      colIndex: cols.value,   type: 'text', placeholder: 'Input value' },
      { role: 'status',   label: 'Status',     colIndex: cols.status,  type: 'text', placeholder: 'pending', defaultValue: 'pending' },
    ];
  },

  render(container, rows, cols) {
    const primaryCol = cols.workflow >= 0 ? cols.workflow : 0;

    // Group rows by workflow name (row-per-item pattern §4.7)
    const groups = parseGroups(rows, primaryCol);

    for (const group of groups) {
      // Flatten group: first row + continuation children
      const allRows = [{ row: group.row, idx: group.idx }, ...group.children];
      const workflowName = cell(group.row, primaryCol) || 'Untitled Workflow';

      // Workflow card
      const card = el('div', { className: 'automation-card' });

      // Card header with workflow name
      const headerEl = el('div', { className: 'automation-card-header' }, [
        el('span', { className: 'automation-card-icon' }, ['🤖']),
        cols.workflow >= 0
          ? editableCell('span', { className: 'automation-card-title' }, workflowName, group.idx + 1, cols.workflow)
          : el('span', { className: 'automation-card-title' }, [workflowName]),
        el('span', { className: 'automation-step-count' }, [`${allRows.length} step${allRows.length === 1 ? '' : 's'}`]),
      ]);
      card.append(headerEl);

      // Steps list
      const stepsEl = el('div', { className: 'automation-steps' });

      for (let si = 0; si < allRows.length; si++) {
        const { row, idx } = allRows[si];
        const rowIdx = idx + 1;
        const stepText  = cell(row, cols.step)   || '';
        const action    = cell(row, cols.action)  || '';
        const target    = cell(row, cols.target)  || '';
        const value     = cell(row, cols.value)   || '';
        const rawStatus = cell(row, cols.status)  || 'pending';
        const statusCls = classifyStatus(rawStatus);

        const stepRow = el('div', { className: `automation-step automation-step-${statusCls}` });

        // Step number
        stepRow.append(el('span', { className: 'automation-step-num' }, [`${si + 1}`]));

        // Action badge
        if (cols.action >= 0) {
          const actionBadge = editableCell('span', {
            className: 'automation-action-badge',
            style: { background: actionColor(action) + '18', color: actionColor(action) },
          }, action || '—', rowIdx, cols.action, {
            onCommit(val) {
              actionBadge.style.background = actionColor(val) + '18';
              actionBadge.style.color = actionColor(val);
            },
          });
          stepRow.append(actionBadge);
        }

        // Step description
        if (cols.step >= 0) {
          stepRow.append(editableCell('span', { className: 'automation-step-text' }, stepText || '—', rowIdx, cols.step));
        }

        // Target
        if (cols.target >= 0) {
          stepRow.append(editableCell('span', { className: 'automation-target' }, target, rowIdx, cols.target));
        }

        // Value
        if (cols.value >= 0 && value) {
          stepRow.append(editableCell('span', { className: 'automation-value' }, value, rowIdx, cols.value));
        }

        // Status badge (click-to-cycle)
        if (cols.status >= 0) {
          const badge = el('span', {
            className: `automation-status automation-status-${statusCls}`,
          }, [statusLabel(statusCls)]);
          badge.addEventListener('click', () => {
            const curCls = [...badge.classList].find(c => c.startsWith('automation-status-') && c !== 'automation-status')?.replace('automation-status-', '') || 'pending';
            const curIdx = STATUS_STATES.indexOf(curCls);
            const nextIdx = (curIdx + 1) % STATUS_STATES.length;
            const next = STATUS_STATES[nextIdx];
            badge.className = `automation-status automation-status-${next}`;
            badge.textContent = statusLabel(next);
            emitEdit(rowIdx, cols.status, statusLabel(next));
          });
          stepRow.append(badge);
        }

        stepsEl.append(stepRow);
      }

      card.append(stepsEl);

      // Summary bar
      const total = allRows.length;
      const doneCount = allRows.filter(r => classifyStatus(cell(r.row, cols.status)) === 'done').length;
      const failedCount = allRows.filter(r => classifyStatus(cell(r.row, cols.status)) === 'failed').length;
      const pct = total > 0 ? Math.round((doneCount / total) * 100) : 0;

      const summaryParts = [`${pct}% complete`];
      if (failedCount > 0) summaryParts.push(`${failedCount} failed`);

      card.append(el('div', { className: 'automation-summary' }, [
        el('div', { className: 'automation-progress-bar' }, [
          el('div', { className: 'automation-progress-fill', style: { width: `${pct}%` } }),
        ]),
        el('span', { className: 'automation-summary-text' }, [summaryParts.join(' · ')]),
      ]));

      container.append(card);
    }
  },
};

registerTemplate('automation', definition);
export default definition;
