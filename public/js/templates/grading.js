/* ============================================================
   templates/grading.js — Gradebook: all fields editable inline, shows averages
   ============================================================ */

import { el, cell, editableCell, registerTemplate, delegateEvent } from './shared.js';

const definition = {
  name: 'Gradebook',
  icon: '🎓',
  color: '#7c2d12',
  priority: 21,
  itemNoun: 'Student',

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

  addRowFields(cols) {
    return [
      { role: 'student', label: 'Student', colIndex: cols.student, type: 'text', placeholder: 'Student name', required: true },
    ];
  },

  render(container, rows, cols, _template) {
    /* ---------- Grade classification ---------- */
    function classify(num) {
      if (num >= 90) return 'A';
      if (num >= 80) return 'B';
      if (num >= 70) return 'C';
      if (num >= 60) return 'D';
      return 'F';
    }
    function scoreClass(num) {
      return num >= 90 ? 'grading-a' : num >= 80 ? 'grading-b' : num >= 70 ? 'grading-c' : num >= 60 ? 'grading-d' : 'grading-f';
    }

    /* ---------- Header row ---------- */
    const hdr = el('div', { className: 'grading-row grading-header' });
    hdr.append(el('div', { className: 'grading-cell grading-student-cell' }, ['Student']));
    for (const aIdx of cols.assignments) {
      hdr.append(el('div', { className: 'grading-cell grading-score-cell' }, [`#${cols.assignments.indexOf(aIdx) + 1}`]));
    }
    hdr.append(el('div', { className: 'grading-cell grading-avg-cell' }, ['Avg']));
    if (cols.grade >= 0) hdr.append(el('div', { className: 'grading-cell grading-grade-cell' }, ['Grade']));
    container.append(hdr);

    /* ---------- Student rows + collect stats ---------- */
    const colTotals = cols.assignments.map(() => ({ sum: 0, count: 0 }));
    const gradeDist = { A: 0, B: 0, C: 0, D: 0, F: 0 };
    let overallSum = 0, overallCount = 0;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowIdx = i + 1;
      const student = cell(row, cols.student) || row[0] || '\u2014';
      const grade = cols.grade >= 0 ? cell(row, cols.grade) : '';

      const rowEl = el('div', { className: 'grading-row' });
      rowEl.append(editableCell('div', { className: 'grading-cell grading-student-cell' }, student, rowIdx, cols.student));

      let total = 0, count = 0;
      cols.assignments.forEach((aIdx, ci) => {
        const score = cell(row, aIdx);
        const num = parseFloat(score);
        if (!isNaN(num)) {
          total += num; count++;
          colTotals[ci].sum += num; colTotals[ci].count++;
        }

        const scoreEl = editableCell('div', {
          className: `grading-cell grading-score-cell ${!isNaN(num) ? scoreClass(num) : ''}`.trim(),
        }, score || '\u2014', rowIdx, aIdx);
        rowEl.append(scoreEl);
      });

      const avg = count > 0 ? Math.round(total / count) : 0;
      if (count > 0) {
        overallSum += avg; overallCount++;
        gradeDist[classify(avg)]++;
      }

      rowEl.append(el('div', { className: 'grading-cell grading-avg-cell' }, [String(avg)]));
      if (cols.grade >= 0) {
        rowEl.append(editableCell('div', { className: 'grading-cell grading-grade-cell' }, grade || '\u2014', rowIdx, cols.grade));
      }
      container.append(rowEl);
    }

    /* ---------- Class average footer ---------- */
    const footerEl = el('div', { className: 'grading-row grading-footer' });
    footerEl.append(el('div', { className: 'grading-cell grading-student-cell' }, ['Class Average']));
    for (const ct of colTotals) {
      const avg = ct.count > 0 ? Math.round(ct.sum / ct.count) : 0;
      footerEl.append(el('div', { className: `grading-cell grading-score-cell ${ct.count > 0 ? scoreClass(avg) : ''}`.trim() }, [ct.count > 0 ? String(avg) : '\u2014']));
    }
    const classAvg = overallCount > 0 ? Math.round(overallSum / overallCount) : 0;
    footerEl.append(el('div', { className: 'grading-cell grading-avg-cell' }, [overallCount > 0 ? String(classAvg) : '\u2014']));
    if (cols.grade >= 0) footerEl.append(el('div', { className: 'grading-cell grading-grade-cell' }, [overallCount > 0 ? classify(classAvg) : '\u2014']));
    container.append(footerEl);

    /* ---------- Grade distribution chart ---------- */
    const maxCount = Math.max(...Object.values(gradeDist), 1);
    const chartBars = [];
    for (const [letter, cnt] of Object.entries(gradeDist)) {
      const pct = (cnt / maxCount) * 100;
      chartBars.push(el('div', { className: 'grading-dist-col' }, [
        el('div', { className: 'grading-dist-bar-wrap' }, [
          el('div', { className: `grading-dist-bar grading-dist-${letter.toLowerCase()}`, style: `height:${pct}%` }),
        ]),
        el('div', { className: 'grading-dist-label' }, [letter]),
        el('div', { className: 'grading-dist-count' }, [String(cnt)]),
      ]));
    }
    container.append(el('div', { className: 'grading-dist' }, [
      el('div', { className: 'grading-dist-title' }, ['Grade Distribution']),
      el('div', { className: 'grading-dist-chart' }, chartBars),
    ]));
  },

  /** Compute aggregate stats from full row data for directory roll-up caching.
   * @param {string[][]} rows — all data rows (no header)
   * @param {Object} cols — column index map
   * @returns {Object} { students, avg, sumAvg, count, dist }
   */
  computeDirStats(rows, cols) {
    function classify(num) {
      if (num >= 90) return 'A';
      if (num >= 80) return 'B';
      if (num >= 70) return 'C';
      if (num >= 60) return 'D';
      return 'F';
    }
    const dist = { A: 0, B: 0, C: 0, D: 0, F: 0 };
    let sSum = 0, sCount = 0;
    for (const row of rows) {
      let total = 0, cnt = 0;
      for (const aIdx of (cols.assignments || [])) {
        const num = parseFloat(cell(row, aIdx));
        if (!isNaN(num)) { total += num; cnt++; }
      }
      if (cnt > 0) {
        const avg = Math.round(total / cnt);
        sSum += avg; sCount++;
        dist[classify(avg)]++;
      }
    }
    return { students: rows.length, avg: sCount > 0 ? Math.round(sSum / sCount) : 0, sumAvg: sSum, count: sCount, dist };
  },

  /* ---------- Directory-level classroom overview ---------- */
  directoryView(container, sheets, navigateFn) {
    function classify(num) {
      if (num >= 90) return 'A';
      if (num >= 80) return 'B';
      if (num >= 70) return 'C';
      if (num >= 60) return 'D';
      return 'F';
    }
    function scoreClass(num) {
      return num >= 90 ? 'grading-a' : num >= 80 ? 'grading-b' : num >= 70 ? 'grading-c' : num >= 60 ? 'grading-d' : 'grading-f';
    }

    container.append(el('div', { className: 'grading-dir-title' }, ['\uD83C\uDF93 Classroom Overview']));

    /* Aggregate per-class stats — prefer pre-computed dirStats when available */
    const classStats = [];
    let grandStudents = 0, grandSum = 0, grandCount = 0;
    const grandDist = { A: 0, B: 0, C: 0, D: 0, F: 0 };

    for (const sheet of sheets) {
      if (sheet.dirStats) {
        const ds = sheet.dirStats;
        grandStudents += ds.students;
        grandSum += ds.sumAvg; grandCount += ds.count;
        for (const letter of Object.keys(grandDist)) {
          grandDist[letter] += (ds.dist[letter] || 0);
        }
        classStats.push({
          id: sheet.id, title: sheet.name,
          students: ds.students, avg: ds.avg, dist: ds.dist, count: ds.count,
        });
        continue;
      }
      const rows = sheet.rows || [];
      const cols = sheet.cols || { student: 0, assignments: [], grade: -1 };
      const dist = { A: 0, B: 0, C: 0, D: 0, F: 0 };
      let sSum = 0, sCount = 0;

      for (const row of rows) {
        let total = 0, cnt = 0;
        for (const aIdx of cols.assignments) {
          const num = parseFloat(cell(row, aIdx));
          if (!isNaN(num)) { total += num; cnt++; }
        }
        if (cnt > 0) {
          const avg = Math.round(total / cnt);
          sSum += avg; sCount++;
          const letter = classify(avg);
          dist[letter]++;
          grandDist[letter]++;
        }
      }

      const classAvg = sCount > 0 ? Math.round(sSum / sCount) : 0;
      grandStudents += rows.length;
      grandSum += sSum; grandCount += sCount;
      classStats.push({
        id: sheet.id, title: sheet.name,
        students: rows.length, avg: classAvg, dist, count: sCount,
      });
    }

    const grandAvg = grandCount > 0 ? Math.round(grandSum / grandCount) : 0;

    /* Grand totals bar */
    container.append(el('div', { className: 'grading-dir-totals' }, [
      el('span', {}, [`${grandStudents} students`]),
      el('span', { className: scoreClass(grandAvg) }, [`Avg: ${grandAvg}`]),
      el('span', {}, [`${sheets.length} classes`]),
    ]));

    /* Per-class cards */
    const grid = el('div', { className: 'grading-dir-grid' });
    for (const s of classStats) {
      /* Mini distribution bar */
      const maxCnt = Math.max(...Object.values(s.dist), 1);
      const miniChart = el('div', { className: 'grading-dir-mini-chart' });
      for (const [letter, cnt] of Object.entries(s.dist)) {
        const pct = (cnt / maxCnt) * 100;
        miniChart.append(el('div', { className: 'grading-dir-mini-col' }, [
          el('div', { className: `grading-dir-mini-bar grading-dist-${letter.toLowerCase()}`, style: `height:${pct}%` }),
          el('div', { className: 'grading-dir-mini-label' }, [letter]),
        ]));
      }

      grid.append(el('div', {
        className: 'grading-dir-card',
        dataset: { sheetId: s.id, sheetName: s.title },
      }, [
        el('div', { className: 'grading-dir-card-title' }, [s.title]),
        el('div', { className: 'grading-dir-card-stats' }, [
          el('span', {}, [`${s.students} students`]),
          el('span', { className: scoreClass(s.avg) }, [`Avg: ${s.avg}`]),
        ]),
        miniChart,
      ]));
    }
    container.append(grid);

    delegateEvent(grid, 'click', '.grading-dir-card', (e, card) => {
      navigateFn('sheet', card.dataset.sheetId, card.dataset.sheetName);
    });
  },
};

registerTemplate('grading', definition);
export default definition;
