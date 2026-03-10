/* ============================================================
   templates/testcases.js — Test Cases: cycle, filter, bulk ops
   ============================================================ */

import { el, cell, editableCell, emitEdit, registerTemplate, delegateEvent, cycleStatus } from './shared.js';

/* ---------- Constants ---------- */

const STATES = ['Untested', 'Pass', 'Fail', 'Blocked', 'Skip'];
const STATUS_ICONS = { pass: '✓', fail: '✗', blocked: '⊘', skip: '—', untested: '?' };

/* ---------- Classifier ---------- */

/** Classify a result value into a normalized status key.
 * @param {string} val — raw result string
 * @returns {string} one of pass|fail|blocked|skip|untested
 */
function classify(val) {
  const v = (val || '').toLowerCase().trim();
  if (/^(pass|passed|ok|yes|✓|✔|success)/.test(v)) return 'pass';
  if (/^(fail|failed|no|✗|✘|error|bug)/.test(v)) return 'fail';
  if (/^(block|blocked|waiting|pending)/.test(v)) return 'blocked';
  if (/^(skip|skipped|n\/a|na|ignored)/.test(v)) return 'skip';
  return 'untested';
}

/* ---------- Summary bar ---------- */

/** Recount statuses from DOM rows and update the summary bar.
 * @param {HTMLElement} container
 */
function refreshSummary(container) {
  const counts = { pass: 0, fail: 0, blocked: 0, skip: 0, untested: 0 };
  container.querySelectorAll('.tc-row').forEach(r => { counts[r.dataset.status]++; });
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  for (const [key, icon] of Object.entries(STATUS_ICONS)) {
    const item = container.querySelector(`.tc-summary-item.tc-${key}`);
    if (item) item.textContent = `${icon} ${counts[key]}`;
  }
  const totalEl = container.querySelector('.tc-summary-total');
  if (totalEl) totalEl.textContent = `${total} total`;
}

/* ---------- Filter ---------- */

/** Apply status filter by toggling .hidden on rows.
 * @param {HTMLElement} container
 * @param {string} status — 'all' or a classify() key
 */
function applyFilter(container, status) {
  container.querySelectorAll('.tc-filter-pill').forEach(p =>
    p.classList.toggle('tc-filter-active', p.dataset.filter === status));
  container.querySelectorAll('.tc-row').forEach(r =>
    r.classList.toggle('hidden', status !== 'all' && r.dataset.status !== status));
}

/** Read the currently active filter key.
 * @param {HTMLElement} container
 * @returns {string}
 */
function activeFilter(container) {
  const active = container.querySelector('.tc-filter-pill.tc-filter-active');
  return active ? active.dataset.filter : 'all';
}

/* ---------- Bulk operations ---------- */

/** Set every matching row to a target status, emit edits, refresh summary.
 * @param {HTMLElement} container
 * @param {string} targetStatus — display label (e.g. 'Pass')
 * @param {boolean} onlyVisible — true = affect only non-hidden rows
 * @param {object} cols — column map from columns()
 */
function bulkSet(container, targetStatus, onlyVisible, cols) {
  const sel = onlyVisible ? '.tc-row:not(.hidden)' : '.tc-row';
  container.querySelectorAll(sel).forEach(r => {
    const btn = r.querySelector('.tc-status-btn');
    if (!btn) return;
    const cls = classify(targetStatus);
    btn.textContent = targetStatus;
    btn.className = `tc-status-btn tc-${cls}`;
    for (const s of ['pass', 'fail', 'blocked', 'skip', 'untested']) r.classList.remove(`tc-row-${s}`);
    r.classList.add(`tc-row-${cls}`);
    r.dataset.status = cls;
    emitEdit(Number(btn.dataset.rowIdx), cols.result, targetStatus);
  });
  refreshSummary(container);
  applyFilter(container, activeFilter(container));
}

/** Copy all Fail + Blocked test names to the clipboard.
 * @param {HTMLElement} container
 */
function copyFailures(container) {
  const rows = container.querySelectorAll('.tc-row[data-status="fail"], .tc-row[data-status="blocked"]');
  const lines = [];
  rows.forEach(r => {
    const label = r.querySelector('.tc-row-text')?.textContent || '';
    const status = r.querySelector('.tc-status-btn')?.textContent || '';
    if (label) lines.push(`[${status}] ${label}`);
  });
  if (!lines.length) return;
  navigator.clipboard.writeText(lines.join('\n')).catch(() => {});
}

/* ---------- Template definition ---------- */

const definition = {
  name: 'Test Cases',
  icon: '🧪',
  color: '#7c3aed',
  priority: 25,
  itemNoun: 'Test Case',

  detect(lower) {
    return lower.some(h => /^(result|pass|fail|test.?status|outcome|verdict)/.test(h))
      && lower.some(h => /^(test|case|scenario|step|expected|actual|description)/.test(h));
  },

  columns(lower) {
    const cols = { text: -1, result: -1, expected: -1, actual: -1, priority: -1, notes: -1 };
    cols.result   = lower.findIndex(h => /^(result|pass|fail|test.?status|outcome|verdict|status)/.test(h));
    cols.text     = lower.findIndex((h, i) => i !== cols.result && /^(test|case|scenario|step|description|name|title|summary)/.test(h));
    if (cols.text === -1) cols.text = lower.findIndex((_, i) => i !== cols.result);
    cols.expected = lower.findIndex((h, i) => i !== cols.result && i !== cols.text && /^(expected|expect)/.test(h));
    cols.actual   = lower.findIndex((h, i) => i !== cols.result && i !== cols.text && /^(actual|got|output)/.test(h));
    cols.priority = lower.findIndex((h, i) => i !== cols.result && i !== cols.text && /^(priority|severity|importance|p[0-4])/.test(h));
    cols.notes    = lower.findIndex((h, i) => i !== cols.result && i !== cols.text && i !== cols.expected && i !== cols.actual && /^(notes?|comment|detail|bug)/.test(h));
    return cols;
  },

  addRowFields(cols) {
    return [
      { role: 'text',     label: 'Test Case', colIndex: cols.text,     type: 'text',   placeholder: 'Test case name', required: true },
      { role: 'result',   label: 'Result',    colIndex: cols.result,   type: 'select', options: ['Untested', 'Pass', 'Fail', 'Blocked', 'Skip'], defaultValue: 'Untested' },
      { role: 'expected', label: 'Expected',  colIndex: cols.expected, type: 'text',   placeholder: 'Expected outcome' },
      { role: 'actual',   label: 'Actual',    colIndex: cols.actual,   type: 'text',   placeholder: 'Actual outcome' },
      { role: 'priority', label: 'Priority',  colIndex: cols.priority, type: 'select', options: ['P0', 'P1', 'P2', 'P3', 'P4'] },
      { role: 'notes',    label: 'Notes',     colIndex: cols.notes,    type: 'text',   placeholder: 'Bug ID or notes' },
    ];
  },

  resultStates: STATES,
  resultClass: classify,

  render(container, rows, cols, template) {
    /* ---------- Summary bar ---------- */
    const counts = { pass: 0, fail: 0, blocked: 0, skip: 0, untested: 0 };
    for (const row of rows) counts[classify(cell(row, cols.result))]++;
    const total = rows.length;

    container.append(el('div', { className: 'tc-summary' }, [
      el('span', { className: 'tc-summary-item tc-pass' },    [`✓ ${counts.pass}`]),
      el('span', { className: 'tc-summary-item tc-fail' },    [`✗ ${counts.fail}`]),
      el('span', { className: 'tc-summary-item tc-blocked' }, [`⊘ ${counts.blocked}`]),
      el('span', { className: 'tc-summary-item tc-skip' },    [`— ${counts.skip}`]),
      el('span', { className: 'tc-summary-item tc-untested' },[`? ${counts.untested}`]),
      el('span', { className: 'tc-summary-total' },           [`${total} total`]),
    ]));

    /* ---------- Toolbar: filter pills + bulk actions ---------- */
    container.append(el('div', { className: 'tc-toolbar' }, [
      el('div', { className: 'tc-filters' }, [
        el('button', { className: 'tc-filter-pill tc-filter-active', dataset: { filter: 'all' } }, ['All']),
        el('button', { className: 'tc-filter-pill', dataset: { filter: 'pass' } },    ['Pass']),
        el('button', { className: 'tc-filter-pill', dataset: { filter: 'fail' } },    ['Fail']),
        el('button', { className: 'tc-filter-pill', dataset: { filter: 'blocked' } }, ['Blocked']),
        el('button', { className: 'tc-filter-pill', dataset: { filter: 'skip' } },    ['Skip']),
        el('button', { className: 'tc-filter-pill', dataset: { filter: 'untested' } },['Untested']),
      ]),
      el('div', { className: 'tc-bulk-actions' }, [
        el('button', { className: 'tc-bulk-btn tc-bulk-pass',  dataset: { bulk: 'pass' } },  ['✓ All Pass']),
        el('button', { className: 'tc-bulk-btn tc-bulk-reset', dataset: { bulk: 'reset' } }, ['↺ Reset All']),
        el('button', { className: 'tc-bulk-btn tc-bulk-skip',  dataset: { bulk: 'skip' } },  ['→ Skip Filtered']),
        el('button', { className: 'tc-bulk-btn tc-bulk-copy',  dataset: { bulk: 'copy' } },  ['📋 Copy Failures']),
      ]),
    ]));

    /* ---------- Delegated handlers ---------- */

    // Filter pills
    delegateEvent(container, 'click', '.tc-filter-pill', (e, pill) => {
      applyFilter(container, pill.dataset.filter);
    });

    // Bulk actions
    delegateEvent(container, 'click', '.tc-bulk-btn', (e, btn) => {
      const action = btn.dataset.bulk;
      if (action === 'pass')  bulkSet(container, 'Pass', false, cols);
      if (action === 'reset') bulkSet(container, 'Untested', false, cols);
      if (action === 'skip')  bulkSet(container, 'Skip', true, cols);
      if (action === 'copy')  copyFailures(container);
    });

    // Status cycling (single listener for all rows)
    delegateEvent(container, 'click', '.tc-status-btn', (e, btn) => {
      const next = cycleStatus(btn, STATES, classify, 'tc-status-btn tc-');
      const rowEl = btn.closest('.tc-row');
      if (rowEl) {
        for (const s of ['pass', 'fail', 'blocked', 'skip', 'untested']) rowEl.classList.remove(`tc-row-${s}`);
        rowEl.classList.add(`tc-row-${classify(next)}`);
        rowEl.dataset.status = classify(next);
      }
      emitEdit(Number(btn.dataset.rowIdx), cols.result, next);
      refreshSummary(container);
    });

    /* ---------- Test case rows ---------- */
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowIdx = i + 1;
      const text     = cell(row, cols.text) || row[0] || '—';
      const result   = cell(row, cols.result);
      const expected = cell(row, cols.expected);
      const actual   = cell(row, cols.actual);
      const priority = cell(row, cols.priority);
      const notes    = cell(row, cols.notes);
      const cls      = classify(result);

      const statusBadge = el('button', {
        className: `tc-status-btn tc-${cls}`,
        title: 'Click to cycle status',
        dataset: { rowIdx: String(rowIdx), colIdx: String(cols.result) },
      }, [result || 'Untested']);

      const children = [
        el('div', { className: 'tc-row-left' }, [
          statusBadge,
          el('div', { className: 'tc-row-info' }, [
            editableCell('span', { className: 'tc-row-text' }, text, rowIdx, cols.text),
            cols.priority >= 0 ? editableCell('span', { className: `tc-priority tc-priority-${(priority || '').toLowerCase().trim()}` }, priority, rowIdx, cols.priority) : null,
          ]),
        ]),
      ];

      if (cols.expected >= 0 || cols.actual >= 0) {
        children.push(el('div', { className: 'tc-row-details' }, [
          cols.expected >= 0 ? el('div', { className: 'tc-expected' }, [
            el('span', { className: 'tc-label' }, ['Expected: ']),
            editableCell('span', {}, expected, rowIdx, cols.expected),
          ]) : null,
          cols.actual >= 0 ? el('div', { className: 'tc-actual' }, [
            el('span', { className: 'tc-label' }, ['Actual: ']),
            editableCell('span', {}, actual, rowIdx, cols.actual),
          ]) : null,
        ]));
      }

      if (cols.notes >= 0) {
        children.push(editableCell('div', { className: 'tc-notes' }, notes, rowIdx, cols.notes));
      }

      container.append(el('div', {
        className: `tc-row tc-row-${cls}`,
        dataset: { rowIdx: String(rowIdx), status: cls },
      }, children));
    }
  },
};

registerTemplate('testcases', definition);
export default definition;
