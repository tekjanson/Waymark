/* ============================================================
   kanban/cards.js — Card & detail-panel DOM builders

   Builds the lightweight card element (no per-card listeners)
   and the expandable detail panel with editable metadata,
   sub-tasks, and notes.
   ============================================================ */

import { el, cell, editableCell, emitEdit, comboCell, textareaCell, getUserName } from '../shared.js';
import { projectColor, dueBadgeClass, formatDue, isStatusNote, formatNoteDate, formatRelativeDate, nowTimestamp, STATUS_PREFIX } from './helpers.js';

/* ---------- Card builder (lightweight — no detail panel, no per-card listeners) ---------- */

/**
 * Build a single kanban card element.
 *
 * @param {Object} group           — parsed group (row, idx, subtasks, notes)
 * @param {Object} ctx             — render context { cols, template, allProjects, allAssignees, expandedCards }
 * @param {string} laneKey         — lane identifier (backlog, todo, inprogress, done, archived)
 * @returns {HTMLElement}
 */
export function buildCard(group, ctx, laneKey) {
  const { cols, template, expandedCards } = ctx;
  const { row, idx } = group;
  const rowIdx = idx + 1;
  const taskName = cell(row, cols.text) || '—';
  const desc = cols.description >= 0 ? cell(row, cols.description) : '';
  const stage = cell(row, cols.stage);
  const project = cols.project >= 0 ? cell(row, cols.project) : '';
  const assignee = cols.assignee >= 0 ? cell(row, cols.assignee) : '';
  const priority = cols.priority >= 0 ? cell(row, cols.priority) : '';
  const due = cols.due >= 0 ? cell(row, cols.due) : '';
  const labelVal = cols.label >= 0 ? cell(row, cols.label) : '';
  const reporter = cols.reporter >= 0 ? cell(row, cols.reporter) : '';

  const hasSubtasks = group.subtasks.length > 0;
  const hasNotes = group.notes.length > 0;
  const hasDetail = desc || hasSubtasks || hasNotes;

  const card = el('div', { className: 'kanban-card', draggable: 'true' });
  card.dataset.rowIdx = String(rowIdx);

  // Project color accent on left border
  if (project) {
    card.style.borderLeftColor = projectColor(project);
    card.classList.add('kanban-card-project');
  }

  // Expanded state (restore from module state)
  if (expandedCards.has(rowIdx)) card.classList.add('kanban-card-expanded');

  /* -- Card header: priority dot + title + open + expand toggle -- */
  const cardHeader = el('div', { className: 'kanban-card-header' });

  if (cols.priority >= 0) {
    cardHeader.append(el('button', {
      className: `kanban-pri-dot kanban-pri-${(priority || '').toLowerCase().trim()}`,
      title: `Priority: ${priority || 'None'} (click to change)`,
    }, [priority || '']));
  }

  cardHeader.append(editableCell('span', { className: 'kanban-card-title' }, taskName, rowIdx, cols.text));

  // Open in focus modal button (delegated click on lane)
  cardHeader.append(el('button', {
    className: 'kanban-card-open',
    title: 'Open in focus view',
  }, ['⛶']));

  if (hasDetail) {
    cardHeader.append(el('button', {
      className: 'kanban-card-expand',
      title: 'Expand details',
    }, [expandedCards.has(rowIdx) ? '▴' : '▾']));
  }

  card.append(cardHeader);

  /* -- Card preview: description snippet + badges -- */
  const preview = el('div', { className: 'kanban-card-preview' });

  if (desc) {
    preview.append(el('div', { className: 'kanban-card-desc' }, [desc]));
  }

  const meta = el('div', { className: 'kanban-card-meta' });

  // Stage badge (delegated click on lane)
  meta.append(el('button', {
    className: `kanban-stage-btn kanban-stage-${template.stageClass(stage)}`,
    title: 'Click to change stage',
  }, [stage || 'Backlog']));

  // Project badge
  if (project) {
    meta.append(el('span', {
      className: 'kanban-card-project-badge',
      style: `--project-color: ${projectColor(project)}`,
    }, [project]));
  }

  // Assignee
  if (assignee && cols.assignee >= 0) {
    const initial = assignee.charAt(0).toUpperCase();
    meta.append(el('span', { className: 'kanban-card-assignee', title: assignee }, [
      el('span', { className: 'kanban-avatar' }, [initial]),
      assignee,
    ]));
  }

  // Reporter / Reported By
  if (reporter && cols.reporter >= 0) {
    meta.append(el('span', { className: 'kanban-card-reporter', title: `Reported by ${reporter}` }, [
      '📝 ', reporter,
    ]));
  }

  // Due date chip
  if (due) {
    meta.append(el('span', {
      className: `kanban-card-due ${dueBadgeClass(due)}`,
      title: due,
    }, [formatDue(due)]));
  }

  // Label tag
  if (labelVal) {
    meta.append(el('span', {
      className: `kanban-card-label kanban-label-${labelVal.toLowerCase().trim()}`,
    }, [labelVal]));
  }

  // Sub-task progress indicator
  if (hasSubtasks) {
    const stDone = group.subtasks.filter(st => template.stageClass(cell(st.row, cols.stage)) === 'done').length;
    meta.append(el('span', { className: 'kanban-card-subtask-count' }, [`☑ ${stDone}/${group.subtasks.length}`]));
  }

  // Last moved timestamp — show when the card last changed stage
  if (cols.note >= 0) {
    const statusNotes = group.notes.filter(n => isStatusNote(cell(n.row, cols.note)));
    if (statusNotes.length > 0) {
      const lastNote = statusNotes[statusNotes.length - 1];
      const lastDate = cols.due >= 0 ? cell(lastNote.row, cols.due) : '';
      if (lastDate) {
        meta.append(el('span', {
          className: 'kanban-card-moved',
          title: `Last status change: ${lastDate}`,
        }, [`⟳ ${formatNoteDate(lastDate)}`]));
      }
    }
  }

  preview.append(meta);

  // Archive button (Done lane only) — delegated click handler on lane
  if (laneKey === 'done') {
    preview.append(el('button', { className: 'kanban-archive-btn', title: 'Archive this task' }, ['📦 Archive']));
  }

  // Reject button (any active lane) — delegated click handler on lane
  if (laneKey !== 'done' && laneKey !== 'archived' && laneKey !== 'rejected') {
    preview.append(el('button', { className: 'kanban-reject-btn', title: 'Reject this task' }, ['🚫 Reject']));
  }

  // Unarchive button (Archived lane only) — delegated click handler on lane
  if (laneKey === 'archived') {
    preview.append(el('button', { className: 'kanban-unarchive-btn', title: 'Restore to Done' }, ['♻️ Restore']));
  }

  // Restore from Rejected — delegated click handler on lane
  if (laneKey === 'rejected') {
    preview.append(el('button', { className: 'kanban-unarchive-btn', title: 'Restore to Backlog' }, ['♻️ Restore']));
    preview.append(el('button', { className: 'kanban-archive-btn', title: 'Archive this task' }, ['📦 Archive']));
  }

  card.append(preview);

  /* -- Lazy expandable detail: only built on first expand (delegated) -- */
  if (hasDetail && expandedCards.has(rowIdx)) {
    // Restore previously expanded detail
    card.append(buildCardDetail(group, ctx));
  }
  // Otherwise detail is built lazily by the delegated click handler

  return card;
}

/* ---------- Detail panel (description, sub-tasks, notes) ---------- */

/**
 * Build the expandable detail panel for a card.
 *
 * @param {Object} group — parsed group (row, idx, subtasks, notes)
 * @param {Object} ctx   — render context { cols, template, allProjects, allAssignees }
 * @returns {HTMLElement}
 */
export function buildCardDetail(group, ctx) {
  const { cols, template, allProjects, allAssignees, allReporters, allLabels } = ctx;
  const detail = el('div', { className: 'kanban-card-detail' });
  const { row, idx } = group;
  const rowIdx = idx + 1;

  // Full description (multiline textarea)
  const desc = cols.description >= 0 ? cell(row, cols.description) : '';
  if (cols.description >= 0) {
    detail.append(el('div', { className: 'kanban-detail-section' }, [
      el('div', { className: 'kanban-detail-label' }, ['Description']),
      textareaCell('div', { className: 'kanban-detail-desc' }, desc, rowIdx, cols.description),
    ]));
  }

  // Editable metadata row (due, label, assignee, priority)
  const metaGrid = el('div', { className: 'kanban-detail-meta' });
  if (cols.due >= 0) {
    metaGrid.append(el('div', { className: 'kanban-detail-field' }, [
      el('span', { className: 'kanban-detail-field-label' }, ['Due']),
      editableCell('span', { className: 'kanban-detail-field-value' }, cell(row, cols.due), rowIdx, cols.due),
    ]));
  }
  if (cols.label >= 0) {
    metaGrid.append(el('div', { className: 'kanban-detail-field' }, [
      el('span', { className: 'kanban-detail-field-label' }, ['Label']),
      comboCell('span', { className: 'kanban-detail-field-value' }, cell(row, cols.label), rowIdx, cols.label, allLabels || []),
    ]));
  }
  if (cols.project >= 0) {
    metaGrid.append(el('div', { className: 'kanban-detail-field' }, [
      el('span', { className: 'kanban-detail-field-label' }, ['Project']),
      comboCell('span', { className: 'kanban-detail-field-value' }, cell(row, cols.project), rowIdx, cols.project, allProjects),
    ]));
  }
  if (cols.assignee >= 0) {
    metaGrid.append(el('div', { className: 'kanban-detail-field' }, [
      el('span', { className: 'kanban-detail-field-label' }, ['Assignee']),
      comboCell('span', { className: 'kanban-detail-field-value' }, cell(row, cols.assignee), rowIdx, cols.assignee, allAssignees),
    ]));
  }
  if (cols.reporter >= 0) {
    metaGrid.append(el('div', { className: 'kanban-detail-field' }, [
      el('span', { className: 'kanban-detail-field-label' }, ['Reported By']),
      comboCell('span', { className: 'kanban-detail-field-value' }, cell(row, cols.reporter), rowIdx, cols.reporter, allReporters || []),
    ]));
  }
  if (cols.priority >= 0) {
    metaGrid.append(el('div', { className: 'kanban-detail-field' }, [
      el('span', { className: 'kanban-detail-field-label' }, ['Priority']),
      comboCell('span', { className: 'kanban-detail-field-value' }, cell(row, cols.priority), rowIdx, cols.priority, ['P0', 'P1', 'P2', 'P3']),
    ]));
  }
  if (metaGrid.children.length > 0) detail.append(metaGrid);

  // Sub-tasks section
  if (group.subtasks.length > 0 || cols.description >= 0) {
    const stDone = group.subtasks.filter(st => template.stageClass(cell(st.row, cols.stage)) === 'done').length;
    const stTotal = group.subtasks.length;

    const stHeader = el('div', { className: 'kanban-detail-label' }, ['Sub-tasks']);
    if (stTotal > 0) {
      stHeader.append(el('span', { className: 'kanban-subtask-progress-text' }, [` ${stDone}/${stTotal}`]));
    }

    const stSection = el('div', { className: 'kanban-detail-section' }, [stHeader]);

    // Progress bar
    if (stTotal > 0) {
      const pct = Math.round((stDone / stTotal) * 100);
      stSection.append(el('div', { className: 'kanban-subtask-progress' }, [
        el('div', { className: 'kanban-subtask-progress-bar', style: `width: ${pct}%` }),
      ]));
    }

    // Sub-task list
    const stList = el('div', { className: 'kanban-subtask-list' });
    for (const st of group.subtasks) {
      const stRowIdx = st.idx + 1;
      const stDesc = cell(st.row, cols.description);
      const stStage = cell(st.row, cols.stage);
      const stAssignee = cols.assignee >= 0 ? cell(st.row, cols.assignee) : '';
      const isDone = template.stageClass(stStage) === 'done';

      const check = el('button', {
        className: `kanban-subtask-check ${isDone ? 'checked' : ''}`,
      }, [isDone ? '✓' : '']);

      const stRow = el('div', { className: `kanban-subtask-row ${isDone ? 'completed' : ''}` }, [
        check,
        editableCell('span', { className: 'kanban-subtask-text' }, stDesc, stRowIdx, cols.description),
        stAssignee ? el('span', { className: 'kanban-subtask-assignee' }, [stAssignee]) : null,
      ]);

      check.addEventListener('click', () => {
        const newStage = isDone ? 'To Do' : 'Done';
        check.classList.toggle('checked');
        check.textContent = isDone ? '' : '✓';
        stRow.classList.toggle('completed');
        emitEdit(stRowIdx, cols.stage, newStage);
      });

      stList.append(stRow);
    }

    stSection.append(stList);

    // Add sub-task inline form
    if (cols.description >= 0 && typeof template._onInsertAfterRow === 'function') {
      const addTrigger = el('button', { className: 'kanban-add-inline-trigger' }, ['+ Sub-task']);
      const addForm = el('div', { className: 'kanban-add-inline hidden' });
      const addInput = el('input', {
        type: 'text', className: 'kanban-add-inline-input', placeholder: 'Sub-task description…',
      });
      const addBtn = el('button', { className: 'kanban-add-inline-btn' }, ['Add']);

      function submitSubtask() {
        const val = addInput.value.trim();
        if (!val) return;
        const lastIdx = Math.max(group.idx, ...group.subtasks.map(s => s.idx), ...group.notes.map(n => n.idx));
        const afterValuesIdx = lastIdx + 1;
        const newRow = new Array(template._totalColumns || 0).fill('');
        if (cols.description >= 0) newRow[cols.description] = val;
        if (cols.stage >= 0) newRow[cols.stage] = 'To Do';
        addInput.value = '';
        addForm.classList.add('hidden');
        addTrigger.classList.remove('hidden');
        template._onInsertAfterRow(afterValuesIdx, [newRow]);
      }

      addInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); submitSubtask(); }
        if (e.key === 'Escape') { addForm.classList.add('hidden'); addTrigger.classList.remove('hidden'); }
      });
      addBtn.addEventListener('click', submitSubtask);

      addTrigger.addEventListener('click', () => {
        addTrigger.classList.add('hidden');
        addForm.classList.remove('hidden');
        addInput.focus();
      });

      addForm.append(addInput, addBtn);
      stSection.append(addTrigger, addForm);
    }

    detail.append(stSection);
  }

  // Notes & Activity section
  if (group.notes.length > 0 || cols.note >= 0) {
    // Separate status-change notes from regular notes, sort by date
    const sortByDate = (a, b) => {
      const da = cols.due >= 0 ? cell(a.row, cols.due) : '';
      const db = cols.due >= 0 ? cell(b.row, cols.due) : '';
      if (!da && !db) return a.idx - b.idx;
      if (!da) return -1;
      if (!db) return 1;
      return da.localeCompare(db) || a.idx - b.idx;
    };
    const statusNotes = group.notes.filter(n => isStatusNote(cell(n.row, cols.note))).sort(sortByDate);
    const regularNotes = group.notes.filter(n => !isStatusNote(cell(n.row, cols.note))).sort(sortByDate);

    const noteSection = el('div', { className: 'kanban-detail-section' }, [
      el('div', { className: 'kanban-detail-label' }, ['Notes']),
    ]);

    const noteList = el('div', { className: 'kanban-note-list' });
    for (const n of regularNotes) {
      const nRowIdx = n.idx + 1;
      const noteText = cell(n.row, cols.note);
      const noteBy = cols.assignee >= 0 ? cell(n.row, cols.assignee) : '';
      const noteDate = cols.due >= 0 ? cell(n.row, cols.due) : '';

      noteList.append(el('div', { className: 'kanban-note' }, [
        el('div', { className: 'kanban-note-header' }, [
          el('span', { className: 'kanban-note-author' }, [noteBy || 'Anonymous']),
          noteDate ? el('span', { className: 'kanban-note-date', title: noteDate }, [formatNoteDate(noteDate)]) : null,
        ]),
        editableCell('div', { className: 'kanban-note-text' }, noteText, nRowIdx, cols.note),
      ]));
    }
    noteSection.append(noteList);

    // Add note inline form
    if (cols.note >= 0 && typeof template._onInsertAfterRow === 'function') {
      const addTrigger = el('button', { className: 'kanban-add-inline-trigger' }, ['+ Note']);
      const addForm = el('div', { className: 'kanban-add-note-form hidden' });
      const noteInput = el('input', {
        type: 'text', className: 'kanban-add-inline-input', placeholder: 'Add a note…',
      });
      const nameInput = el('input', {
        type: 'text', className: 'kanban-add-inline-input kanban-add-note-name',
        placeholder: 'Your name', value: getUserName(),
      });
      const addBtn = el('button', { className: 'kanban-add-inline-btn' }, ['Add']);

      function submitNote() {
        const noteVal = noteInput.value.trim();
        if (!noteVal) return;
        const lastIdx = Math.max(group.idx, ...group.subtasks.map(s => s.idx), ...group.notes.map(n => n.idx));
        const afterValuesIdx = lastIdx + 1;
        const newRow = new Array(template._totalColumns || 0).fill('');
        if (cols.note >= 0) newRow[cols.note] = noteVal;
        if (cols.assignee >= 0) newRow[cols.assignee] = nameInput.value.trim();
        if (cols.due >= 0) newRow[cols.due] = nowTimestamp();
        noteInput.value = '';
        nameInput.value = '';
        addForm.classList.add('hidden');
        addTrigger.classList.remove('hidden');
        template._onInsertAfterRow(afterValuesIdx, [newRow]);
      }

      noteInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); submitNote(); }
        if (e.key === 'Escape') { addForm.classList.add('hidden'); addTrigger.classList.remove('hidden'); }
      });
      nameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); submitNote(); }
        if (e.key === 'Escape') { addForm.classList.add('hidden'); addTrigger.classList.remove('hidden'); }
      });
      addBtn.addEventListener('click', submitNote);

      addTrigger.addEventListener('click', () => {
        addTrigger.classList.add('hidden');
        addForm.classList.remove('hidden');
        noteInput.focus();
      });

      addForm.append(noteInput, nameInput, addBtn);
      noteSection.append(addTrigger, addForm);
    }

    detail.append(noteSection);

    // Activity section — status-change history (timeline)
    if (statusNotes.length > 0) {
      const activitySection = el('div', { className: 'kanban-detail-section' }, [
        el('div', { className: 'kanban-detail-label' }, ['Activity']),
      ]);

      const activityList = el('div', { className: 'kanban-activity-list' });
      for (const n of statusNotes) {
        const noteText = cell(n.row, cols.note);
        const noteBy = cols.assignee >= 0 ? cell(n.row, cols.assignee) : '';
        const noteDate = cols.due >= 0 ? cell(n.row, cols.due) : '';
        // Strip the prefix for display
        const transitionText = noteText.replace(/^⟳\s*/, '');

        activityList.append(el('div', { className: 'kanban-activity-item' }, [
          el('span', { className: 'kanban-activity-icon' }, ['⟳']),
          el('div', { className: 'kanban-activity-content' }, [
            el('span', { className: 'kanban-activity-text' }, [transitionText]),
            el('div', { className: 'kanban-activity-meta' }, [
              el('span', { className: 'kanban-activity-author' }, [noteBy || 'System']),
              noteDate ? el('span', { className: 'kanban-activity-date', title: noteDate }, [formatNoteDate(noteDate)]) : null,
            ]),
          ]),
        ]));
      }
      activitySection.append(activityList);
      detail.append(activitySection);
    }
  }

  // "Open in Google Sheets" link — jumps to the exact row
  const sheetMatch = window.location.hash.match(/#\/sheet\/(.+)/);
  if (sheetMatch) {
    const sheetId = sheetMatch[1];
    const sheetRow = rowIdx + 1; // +1 for header row in sheet
    const sheetsUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/edit#gid=0&range=A${sheetRow}`;
    detail.append(el('div', { className: 'kanban-detail-section kanban-detail-sheets-link' }, [
      el('a', {
        href: sheetsUrl,
        target: '_blank',
        rel: 'noopener',
        className: 'kanban-open-sheets-btn',
      }, [`📄 Open in Google Sheets (row ${sheetRow})`]),
    ]));
  }

  return detail;
}
