/* ============================================================
   gantt/index.js — Gantt / Timeline Template (barrel)

   Features: SVG Gantt chart with time axis, task bars,
   progress fill, today marker, dependency arrows,
   critical-path highlighting, and mouse-drag to move bars.

   Layout: fixed 220px label column (left) + scrollable SVG
   chart (right) — labels stay sticky on horizontal scroll.
   ============================================================ */

import {
  el, cell, emitEdit, registerTemplate,
  buildDirSyncBtn, delegateEvent,
} from '../shared.js';
import {
  svg, parseDate, formatMonthLabel, formatISO,
  daysBetween, addDays, computeGanttRange, parseDependencies,
  progressClass, assigneeColor, resetAssigneeColors, findCriticalPath,
} from './helpers.js';

/* ---------- Layout constants ---------- */
const LABEL_W  = 220;  // px — fixed label column width
const HEADER_H = 40;   // px — time axis header height
const ROW_H    = 44;   // px — height per task row
const BAR_H    = 26;   // px — bar height within a row
const BAR_VPAD = (ROW_H - BAR_H) / 2;
const DAY_PX   = 5;    // px per calendar day
const MIN_SPAN = 60;   // minimum visible chart span in days

/* ---------- Module-level drag state ---------- */
let _dragTask      = null;
let _dragStartX    = 0;
let _dragOrigStart = null;
let _dragOrigEnd   = null;
let _dragRange     = null;
let _dragCols      = null;
let _dragBarEl     = null;
let _dragProgEl    = null;

/* ---------- Template Definition ---------- */
const definition = {
  name: 'Gantt Timeline',
  icon: '📅',
  color: '#059669',
  priority: 21,
  itemNoun: 'Task',
  defaultHeaders: ['Task', 'Start Date', 'End Date', 'Progress', 'Dependencies', 'Assignee'],

  detect(lower) {
    const hasStartDate = lower.some(h => /^(start.?date?|begins?|from\.?date)$/.test(h) || h === 'start');
    const hasEndDate   = lower.some(h => /^(end.?date?|finish|deadline|until|to\.?date)$/.test(h) || h === 'end');
    const hasTask      = lower.some(h => /^(task|activity|milestone|deliverable)$/.test(h));
    return hasTask && hasStartDate && hasEndDate;
  },

  columns(lower) {
    const cols = { text: -1, start: -1, end: -1, progress: -1, dependencies: -1, assignee: -1 };
    const used = () => Object.values(cols).filter(v => v >= 0);
    cols.text         = lower.findIndex(h => /^(task|activity|milestone|deliverable|name|item|title)$/.test(h));
    if (cols.text === -1) cols.text = 0;
    cols.start        = lower.findIndex((h, i) => !used().includes(i) && /^(start|begins?|from)/.test(h));
    cols.end          = lower.findIndex((h, i) => !used().includes(i) && /^(end|finish|due|until|deadline|to\.?date|compl)/.test(h));
    cols.progress     = lower.findIndex((h, i) => !used().includes(i) && /^(progress|percent|%|done|complete|completion)/.test(h));
    cols.dependencies = lower.findIndex((h, i) => !used().includes(i) && /^(dep|requires|after|depends|predecessor)/.test(h));
    cols.assignee     = lower.findIndex((h, i) => !used().includes(i) && /^(assign|owner|who|person|responsible)/.test(h));
    return cols;
  },

  addRowFields(cols) {
    return [
      { role: 'text',         label: 'Task',         colIndex: cols.text,         type: 'text',   placeholder: 'Task name', required: true },
      { role: 'start',        label: 'Start Date',   colIndex: cols.start,        type: 'date',   placeholder: 'YYYY-MM-DD' },
      { role: 'end',          label: 'End Date',     colIndex: cols.end,          type: 'date',   placeholder: 'YYYY-MM-DD' },
      { role: 'progress',     label: 'Progress',     colIndex: cols.progress,     type: 'text',   placeholder: '0%', defaultValue: '0%' },
      { role: 'dependencies', label: 'Dependencies', colIndex: cols.dependencies, type: 'text',   placeholder: 'Task A, Task B' },
      { role: 'assignee',     label: 'Assignee',     colIndex: cols.assignee,     type: 'text',   placeholder: 'Name' },
    ];
  },

  render(container, rows, cols, template) {
    container.innerHTML = '';

    /* Build tasks array from rows */
    const tasks = rows.map((row, i) => {
      const name     = cell(row, cols.text) || `Task ${i + 1}`;
      const start    = parseDate(cell(row, cols.start));
      const end      = parseDate(cell(row, cols.end));
      const rawProg  = cell(row, cols.progress);
      const depStr   = cell(row, cols.dependencies);
      const assignee = cell(row, cols.assignee);

      let pct = 0;
      if (rawProg) {
        const n = parseFloat(rawProg.replace('%', '').trim());
        pct = isNaN(n) ? 0 : Math.max(0, Math.min(100, n));
      }
      const duration = (start && end) ? Math.max(daysBetween(start, end), 0) : 0;
      return { name, start, end, pct, rawProg, depStr, assignee, rowIdx: i + 1, duration };
    });

    resetAssigneeColors();
    const range = computeGanttRange(tasks);

    /* Empty state */
    if (!range) {
      container.append(
        el('div', { className: 'gantt-empty' }, [
          el('div', { className: 'gantt-empty-icon' }, ['📅']),
          el('p', {}, ['Add tasks with Start Date and End Date columns to render the Gantt chart.']),
        ])
      );
      return;
    }

    const { minDate, totalDays } = range;
    const chartSpan = Math.max(totalDays, MIN_SPAN);
    const chartW    = Math.max(chartSpan * DAY_PX, 600);
    const svgH      = HEADER_H + tasks.length * ROW_H;

    /* Critical-path computation */
    const critical = findCriticalPath(tasks);

    /* Name→index map for dependency arrows */
    const nameToIdx = {};
    tasks.forEach((t, i) => { nameToIdx[t.name.trim().toLowerCase()] = i; });

    /* ============================================================
       Build the outer wrapper
       ============================================================ */
    const wrapper = el('div', { className: 'gantt-wrapper' });

    /* ---- Label column ---- */
    const labelCol = el('div', { className: 'gantt-label-col' });

    /* Header cell in label column */
    labelCol.append(el('div', {
      className: 'gantt-label-header',
      style: `height:${HEADER_H}px`,
    }, ['Task']));

    /* One label row per task */
    tasks.forEach((task, i) => {
      const isCrit = critical.has(i);
      const labelEl = el('div', {
        className: `gantt-task-label${isCrit ? ' gantt-critical-label' : ''}`,
        style: `height:${ROW_H}px`,
        title: task.assignee ? `${task.name} — ${task.assignee}` : task.name,
      }, [
        el('span', { className: 'gantt-task-name' }, [task.name]),
        task.assignee
          ? el('span', { className: 'gantt-task-assignee' }, [task.assignee])
          : null,
      ].filter(Boolean));
      labelCol.append(labelEl);
    });

    /* ---- Chart column (scrollable) ---- */
    const chartScroll = el('div', { className: 'gantt-chart-scroll' });

    /* Single SVG for the full chart: header + bars */
    const chartSvg = svg('svg', {
      class: 'gantt-chart-svg',
      width: chartW,
      height: svgH,
      role: 'img',
      'aria-label': 'Gantt chart',
    });

    /* Arrow marker definition */
    const defs = svg('defs', {});
    const marker = svg('marker', {
      id: 'gantt-arrow-head',
      markerWidth: '6',
      markerHeight: '6',
      refX: '5',
      refY: '3',
      orient: 'auto',
    });
    const arrowPath = svg('path', { d: 'M 0 0 L 6 3 L 0 6 z', class: 'gantt-arrow-fill' });
    marker.appendChild(arrowPath);
    defs.appendChild(marker);
    chartSvg.appendChild(defs);

    /* Month grid lines + axis labels */
    const axisG    = svg('g', { class: 'gantt-axis' });
    const gridG    = svg('g', { class: 'gantt-grid' });
    chartSvg.appendChild(gridG);
    chartSvg.appendChild(axisG);

    let cursor = new Date(minDate.getFullYear(), minDate.getMonth(), 1);
    if (cursor < minDate) {
      cursor = new Date(minDate.getFullYear(), minDate.getMonth() + 1, 1);
    }
    while (cursor <= range.maxDate) {
      const x = Math.round(daysBetween(minDate, cursor) * DAY_PX);

      /* Grid line spanning full chart height */
      gridG.appendChild(svg('line', {
        class: 'gantt-grid-line',
        x1: x, y1: HEADER_H, x2: x, y2: svgH,
      }));

      /* Month separator in header area */
      axisG.appendChild(svg('line', {
        class: 'gantt-axis-tick',
        x1: x, y1: 0, x2: x, y2: HEADER_H,
      }));

      /* Month label text */
      const labelText = svg('text', {
        class: 'gantt-month-label',
        x: x + 4,
        y: HEADER_H - 10,
      });
      labelText.textContent = formatMonthLabel(cursor);
      axisG.appendChild(labelText);

      cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
    }

    /* Header background */
    chartSvg.insertBefore(svg('rect', {
      class: 'gantt-header-bg',
      x: 0, y: 0, width: chartW, height: HEADER_H,
    }), chartSvg.firstChild);

    /* Row backgrounds (alternating) */
    tasks.forEach((_, i) => {
      if (i % 2 === 1) {
        chartSvg.appendChild(svg('rect', {
          class: 'gantt-row-alt',
          x: 0,
          y: HEADER_H + i * ROW_H,
          width: chartW,
          height: ROW_H,
        }));
      }
    });

    /* Today marker */
    const today  = new Date();
    const todayX = Math.round(daysBetween(minDate, today) * DAY_PX);
    if (todayX > 0 && todayX < chartW) {
      chartSvg.appendChild(svg('line', {
        class: 'gantt-today-line',
        x1: todayX, y1: 0,
        x2: todayX, y2: svgH,
      }));
      const todayLabel = svg('text', {
        class: 'gantt-today-label',
        x: todayX + 3,
        y: HEADER_H - 2,
      });
      todayLabel.textContent = 'Today';
      chartSvg.appendChild(todayLabel);
    }

    /* Dependency arrows (drawn behind bars) */
    const depsG = svg('g', { class: 'gantt-deps' });
    chartSvg.appendChild(depsG);

    tasks.forEach((task, i) => {
      parseDependencies(task.depStr).forEach(depName => {
        const depIdx = nameToIdx[depName.trim().toLowerCase()];
        if (depIdx === undefined || depIdx === i) return;
        const dep = tasks[depIdx];
        if (!dep.end || !task.start) return;

        const x1 = Math.round(daysBetween(minDate, dep.end)   * DAY_PX);
        const y1 = HEADER_H + depIdx * ROW_H + ROW_H / 2;
        const x2 = Math.round(daysBetween(minDate, task.start) * DAY_PX);
        const y2 = HEADER_H + i * ROW_H + ROW_H / 2;
        const mx = x1 + Math.round((x2 - x1) / 2);

        depsG.appendChild(svg('polyline', {
          class: 'gantt-dep-arrow',
          points: `${x1},${y1} ${mx},${y1} ${mx},${y2} ${x2},${y2}`,
          'marker-end': 'url(#gantt-arrow-head)',
        }));
      });
    });

    /* Task bars */
    const barsG = svg('g', { class: 'gantt-bars' });
    chartSvg.appendChild(barsG);

    tasks.forEach((task, i) => {
      if (!task.start || !task.end) return;

      const x1   = Math.round(daysBetween(minDate, task.start) * DAY_PX);
      const x2   = Math.round(daysBetween(minDate, task.end)   * DAY_PX);
      const barW = Math.max(x2 - x1, 6);
      const barY = HEADER_H + i * ROW_H + BAR_VPAD;
      const progW = Math.round(barW * task.pct / 100);
      const color  = assigneeColor(task.assignee);
      const isCrit = critical.has(i);

      /* Bar background (full duration, semi-transparent) */
      const barBg = svg('rect', {
        class: `gantt-bar ${progressClass(task.pct)}${isCrit ? ' gantt-bar-critical' : ''}`,
        x: x1, y: barY,
        width: barW, height: BAR_H,
        rx: 4, ry: 4,
        fill: color,
        'fill-opacity': '0.25',
        'data-task-idx': i,
      });
      barsG.appendChild(barBg);

      /* Progress fill */
      const progEl = progW > 0 ? svg('rect', {
        class: 'gantt-bar-progress',
        x: x1, y: barY,
        width: progW, height: BAR_H,
        rx: 4, ry: 4,
        fill: color,
      }) : null;
      if (progEl) barsG.appendChild(progEl);

      /* Critical-path outline */
      if (isCrit) {
        barsG.appendChild(svg('rect', {
          class: 'gantt-bar-critical-outline',
          x: x1, y: barY,
          width: barW, height: BAR_H,
          rx: 4, ry: 4,
          fill: 'none',
        }));
      }

      /* Percentage label (only if bar is wide enough) */
      if (barW > 30) {
        const pctText = svg('text', {
          class: 'gantt-bar-label',
          x: x1 + barW / 2,
          y: barY + BAR_H / 2 + 4,
          'text-anchor': 'middle',
        });
        pctText.textContent = `${Math.round(task.pct)}%`;
        barsG.appendChild(pctText);
      }

      /* Invisible drag handle (full bar area, cursor: grab) */
      const handle = svg('rect', {
        class: 'gantt-drag-handle',
        x: x1, y: barY,
        width: barW, height: BAR_H,
        fill: 'transparent',
        cursor: 'grab',
        'data-task-idx': i,
      });
      barsG.appendChild(handle);

      /* Mouse-drag to move bar and emit new dates */
      handle.addEventListener('mousedown', e => {
        e.preventDefault();
        _dragTask      = task;
        _dragStartX    = e.clientX;
        _dragOrigStart = task.start;
        _dragOrigEnd   = task.end;
        _dragRange     = range;
        _dragCols      = cols;
        _dragBarEl     = barBg;
        _dragProgEl    = progEl;
        document.body.style.cursor = 'grabbing';

        const onMove = ev => {
          const dayShift = Math.round((ev.clientX - _dragStartX) / DAY_PX);
          if (dayShift === 0) return;
          const ns = addDays(_dragOrigStart, dayShift);
          const ne = addDays(_dragOrigEnd,   dayShift);
          const nx1 = Math.round(daysBetween(_dragRange.minDate, ns) * DAY_PX);
          _dragBarEl.setAttribute('x', nx1);
          if (_dragProgEl) _dragProgEl.setAttribute('x', nx1);
          handle.setAttribute('x', nx1);
          handle.setAttribute('data-pending-start', formatISO(ns));
          handle.setAttribute('data-pending-end',   formatISO(ne));
        };

        const onUp = () => {
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup',   onUp);
          document.body.style.cursor = '';
          const ps = handle.getAttribute('data-pending-start');
          const pe = handle.getAttribute('data-pending-end');
          if (ps && _dragCols.start >= 0) emitEdit(_dragTask.rowIdx, _dragCols.start, ps);
          if (pe && _dragCols.end   >= 0) emitEdit(_dragTask.rowIdx, _dragCols.end,   pe);
          _dragTask = null;
        };

        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup',   onUp);
      });
    });

    chartScroll.append(chartSvg);
    wrapper.append(labelCol, chartScroll);
    container.append(wrapper);
  },

  directoryView(container, sheets, navigateFn) {
    const wrapper = el('div', { className: 'gantt-directory tmpl-directory' });
    wrapper.append(el('div', { className: 'gantt-dir-title-bar tmpl-dir-title-bar' }, [
      el('span', { className: 'gantt-dir-icon tmpl-dir-icon' }, ['\uD83D\uDCC5']),
      el('span', { className: 'gantt-dir-title tmpl-dir-title' }, ['Gantt Timelines']),
      el('span', { className: 'gantt-dir-count tmpl-dir-count' }, [
        `${sheets.length} timeline${sheets.length !== 1 ? 's' : ''}`,
      ]),
      buildDirSyncBtn(wrapper),
    ]));

    const grid = el('div', { className: 'gantt-dir-grid tmpl-dir-grid' });
    for (const sheet of sheets) {
      const rows = sheet.rows || [];
      grid.append(el('div', {
        className: 'gantt-dir-card tmpl-dir-card',
        dataset: { entryId: sheet.id, entryName: sheet.name },
      }, [
        el('div', { className: 'gantt-dir-card-name tmpl-dir-card-name' }, [sheet.name]),
        el('div', { className: 'gantt-dir-card-stat tmpl-dir-card-stat' }, [
          `${rows.length} task${rows.length !== 1 ? 's' : ''}`,
        ]),
      ]));
    }

    delegateEvent(grid, 'click', '.gantt-dir-card', (_e, card) => {
      navigateFn('sheet', card.dataset.entryId, card.dataset.entryName);
    });

    wrapper.append(grid);
    container.append(wrapper);
  },
};

registerTemplate('gantt', definition);
export default definition;
