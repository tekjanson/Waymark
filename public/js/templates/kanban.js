/* templates/kanban.js — Kanban Board: cycle stage, all fields editable */

import { el, cell, editableCell, emitEdit, registerTemplate } from './shared.js';

const definition = {
  name: 'Kanban Board',
  icon: '📋',
  color: '#0284c7',
  priority: 23,

  detect(lower) {
    return lower.some(h => /^(stage|column|lane|board|swim)/.test(h) || /backlog|in.?progress|to.?do|doing/.test(h))
      && lower.some(h => /^(task|story|ticket|item|feature|issue|title|name|description)/.test(h));
  },

  columns(lower) {
    const cols = { text: -1, stage: -1, assignee: -1, priority: -1 };
    cols.stage    = lower.findIndex(h => /^(stage|column|lane|board|status|swim)/.test(h) || /backlog|in.?progress|to.?do|doing/.test(h));
    cols.text     = lower.findIndex((h, i) => i !== cols.stage && /^(task|story|ticket|item|feature|issue|title|name|description)/.test(h));
    if (cols.text === -1) cols.text = lower.findIndex((_, i) => i !== cols.stage);
    cols.assignee = lower.findIndex((h, i) => i !== cols.stage && i !== cols.text && /^(assign|owner|who|person|dev|member)/.test(h));
    cols.priority = lower.findIndex((h, i) => i !== cols.stage && i !== cols.text && i !== cols.assignee && /^(priority|urgency|importance|p[0-4])/.test(h));
    return cols;
  },

  stageStates: ['Backlog', 'To Do', 'In Progress', 'Done'],

  stageClass(val) {
    const v = (val || '').toLowerCase().trim();
    if (/^(done|complete|finished|closed|shipped)/.test(v)) return 'done';
    if (/^(in.?progress|doing|active|wip|started)/.test(v)) return 'inprogress';
    if (/^(to.?do|ready|planned|next|queued)/.test(v)) return 'todo';
    return 'backlog';
  },

  render(container, rows, cols, template) {
    const lanes = new Map();
    const laneOrder = ['backlog', 'todo', 'inprogress', 'done'];
    const laneLabels = { backlog: 'Backlog', todo: 'To Do', inprogress: 'In Progress', done: 'Done' };

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const stageCls = template.stageClass(cell(row, cols.stage));
      if (!lanes.has(stageCls)) lanes.set(stageCls, []);
      lanes.get(stageCls).push({ row, originalIndex: i });
    }

    const board = el('div', { className: 'kanban-board' });

    for (const laneKey of laneOrder) {
      const items = lanes.get(laneKey) || [];
      const lane = el('div', { className: `kanban-lane kanban-lane-${laneKey}` }, [
        el('div', { className: 'kanban-lane-header' }, [
          el('span', { className: 'kanban-lane-title' }, [laneLabels[laneKey] || laneKey]),
          el('span', { className: 'kanban-lane-count' }, [String(items.length)]),
        ]),
      ]);

      for (const { row, originalIndex } of items) {
        const rowIdx = originalIndex + 1;
        const text = cell(row, cols.text) || row[0] || '—';
        const stage = cell(row, cols.stage);
        const assignee = cell(row, cols.assignee);
        const priority = cell(row, cols.priority);

        const stageBadge = el('button', {
          className: `kanban-stage-btn kanban-stage-${template.stageClass(stage)}`,
          title: 'Click to cycle stage',
        }, [stage || 'Backlog']);

        stageBadge.addEventListener('click', () => {
          const states = template.stageStates;
          const current = stageBadge.textContent.trim();
          const idx = states.findIndex(s => s.toLowerCase() === current.toLowerCase());
          const next = states[(idx + 1) % states.length];
          stageBadge.textContent = next;
          stageBadge.className = `kanban-stage-btn kanban-stage-${template.stageClass(next)}`;
          emitEdit(rowIdx, cols.stage, next);
        });

        lane.append(el('div', { className: 'kanban-card' }, [
          editableCell('div', { className: 'kanban-card-title' }, text, rowIdx, cols.text),
          el('div', { className: 'kanban-card-meta' }, [
            stageBadge,
            cols.assignee >= 0 ? editableCell('span', { className: 'kanban-card-assignee' }, assignee, rowIdx, cols.assignee) : null,
            cols.priority >= 0 ? editableCell('span', { className: 'kanban-card-priority kanban-pri-' + (priority || '').toLowerCase().trim() }, priority, rowIdx, cols.priority) : null,
          ]),
        ]));
      }

      board.append(lane);
    }

    container.append(board);
  },
};

registerTemplate('kanban', definition);
export default definition;
