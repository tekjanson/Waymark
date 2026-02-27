/* templates/grading.js — Gradebook: all fields editable inline, shows averages */

import { el, cell, editableCell, registerTemplate } from './shared.js';

const definition = {
  name: 'Gradebook',
  icon: '🎓',
  color: '#7c2d12',
  priority: 21,

  detect(lower) {
    return lower.some(h => /^(student|pupil|name)/.test(h))
      && lower.some(h => /^(grade|assignment|homework|exam|quiz|midterm|final|score|test\b|hw)/.test(h));
  },

  columns(lower) {
    const cols = { student: -1, assignments: [], grade: -1 };
    cols.student = lower.findIndex(h => /^(student|pupil|name)/.test(h));
    if (cols.student === -1) cols.student = 0;
    cols.grade   = lower.findIndex(h => /^(grade|final.?grade|letter|overall|gpa)/.test(h));
    const assignPattern = /^(assignment|homework|exam|quiz|midterm|final|test\b|hw|project|lab|essay|paper|score)/;
    for (let i = 0; i < lower.length; i++) {
      if (i !== cols.student && i !== cols.grade && assignPattern.test(lower[i])) {
        cols.assignments.push(i);
      }
    }
    return cols;
  },

  render(container, rows, cols, _template) {
    // Header
    const hdr = el('div', { className: 'grading-row grading-header' });
    hdr.append(el('div', { className: 'grading-cell grading-student-cell' }, ['Student']));
    for (const aIdx of cols.assignments) {
      hdr.append(el('div', { className: 'grading-cell grading-score-cell' }, [`#${cols.assignments.indexOf(aIdx) + 1}`]));
    }
    hdr.append(el('div', { className: 'grading-cell grading-avg-cell' }, ['Avg']));
    if (cols.grade >= 0) hdr.append(el('div', { className: 'grading-cell grading-grade-cell' }, ['Grade']));
    container.append(hdr);

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowIdx = i + 1;
      const student = cell(row, cols.student) || row[0] || '—';
      const grade = cols.grade >= 0 ? cell(row, cols.grade) : '';

      const rowEl = el('div', { className: 'grading-row' });
      rowEl.append(editableCell('div', { className: 'grading-cell grading-student-cell' }, student, rowIdx, cols.student));

      let total = 0, count = 0;
      for (const aIdx of cols.assignments) {
        const score = cell(row, aIdx);
        const num = parseFloat(score);
        if (!isNaN(num)) { total += num; count++; }

        const scoreColor = num >= 90 ? 'grading-a' : num >= 80 ? 'grading-b' : num >= 70 ? 'grading-c' : num >= 60 ? 'grading-d' : 'grading-f';
        const scoreEl = editableCell('div', {
          className: `grading-cell grading-score-cell ${!isNaN(num) ? scoreColor : ''}`.trim(),
        }, score || '—', rowIdx, aIdx);

        rowEl.append(scoreEl);
      }

      const avg = count > 0 ? Math.round(total / count) : 0;
      rowEl.append(el('div', { className: 'grading-cell grading-avg-cell' }, [String(avg)]));
      if (cols.grade >= 0) {
        rowEl.append(editableCell('div', { className: 'grading-cell grading-grade-cell' }, grade || '—', rowIdx, cols.grade));
      }

      container.append(rowEl);
    }
  },
};

registerTemplate('grading', definition);
export default definition;
