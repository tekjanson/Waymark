/* templates/testcases.js — Test Cases: cycle status, all fields editable */

import { el, cell, editableCell, emitEdit, registerTemplate } from './shared.js';

const definition = {
  name: 'Test Cases',
  icon: '🧪',
  color: '#7c3aed',
  priority: 25,

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

  resultStates: ['Untested', 'Pass', 'Fail', 'Blocked', 'Skip'],

  resultClass(val) {
    const v = (val || '').toLowerCase().trim();
    if (/^(pass|passed|ok|yes|✓|✔|success)/.test(v)) return 'pass';
    if (/^(fail|failed|no|✗|✘|error|bug)/.test(v)) return 'fail';
    if (/^(block|blocked|waiting|pending)/.test(v)) return 'blocked';
    if (/^(skip|skipped|n\/a|na|ignored)/.test(v)) return 'skip';
    return 'untested';
  },

  render(container, rows, cols, template) {
    // Summary bar
    const counts = { pass: 0, fail: 0, blocked: 0, skip: 0, untested: 0 };
    for (const row of rows) {
      const cls = template.resultClass(cell(row, cols.result));
      counts[cls]++;
    }
    const total = rows.length;

    const summaryBar = el('div', { className: 'tc-summary' }, [
      el('span', { className: 'tc-summary-item tc-pass' },    [`✓ ${counts.pass}`]),
      el('span', { className: 'tc-summary-item tc-fail' },    [`✗ ${counts.fail}`]),
      el('span', { className: 'tc-summary-item tc-blocked' }, [`⊘ ${counts.blocked}`]),
      el('span', { className: 'tc-summary-item tc-skip' },    [`— ${counts.skip}`]),
      el('span', { className: 'tc-summary-item tc-untested' },[`? ${counts.untested}`]),
      el('span', { className: 'tc-summary-total' },           [`${total} total`]),
    ]);
    container.append(summaryBar);

    // Test case rows
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowIdx = i + 1;
      const text     = cell(row, cols.text) || row[0] || '—';
      const result   = cell(row, cols.result);
      const expected = cell(row, cols.expected);
      const actual   = cell(row, cols.actual);
      const priority = cell(row, cols.priority);
      const notes    = cell(row, cols.notes);
      const cls      = template.resultClass(result);

      const statusBadge = el('button', {
        className: `tc-status-btn tc-${cls}`,
        title: 'Click to cycle status',
        dataset: { rowIdx: String(rowIdx), colIdx: String(cols.result) },
      }, [result || 'Untested']);

      statusBadge.addEventListener('click', () => {
        const states = template.resultStates;
        const current = statusBadge.textContent.trim();
        const idx = states.findIndex(s => s.toLowerCase() === current.toLowerCase());
        const next = states[(idx + 1) % states.length];
        statusBadge.textContent = next;
        statusBadge.className = `tc-status-btn tc-${template.resultClass(next)}`;
        const rowEl = statusBadge.closest('.tc-row');
        if (rowEl) {
          rowEl.className = `tc-row tc-row-${template.resultClass(next)}`;
        }
        emitEdit(rowIdx, cols.result, next);
      });

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
        dataset: { rowIdx: String(rowIdx) },
      }, children));
    }
  },
};

registerTemplate('testcases', definition);
export default definition;
