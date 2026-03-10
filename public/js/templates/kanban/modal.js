/* ============================================================
   kanban/modal.js — Focus modal for kanban cards

   Opens a full-screen overlay with editable title, stage
   cycling, metadata badges, and the full detail panel.
   ============================================================ */

import { el, cell, editableCell, emitEdit, cycleStatus } from '../shared.js';
import { projectColor, dueBadgeClass, formatDue } from './helpers.js';
import { buildCardDetail } from './cards.js';

/* ---------- Focus modal ---------- */

/**
 * Open a focus-view modal for a kanban card.
 *
 * @param {Object} group — parsed group (row, idx, subtasks, notes)
 * @param {Object} ctx   — render context { cols, template, allProjects, allAssignees }
 */
export function openCardModal(group, ctx) {
  const { cols, template } = ctx;

  // Close any existing modal
  const existing = document.querySelector('.kanban-modal-overlay');
  if (existing) existing.remove();

  const { row, idx } = group;
  const rowIdx = idx + 1;
  const taskName = cell(row, cols.text) || '—';
  const stage = cell(row, cols.stage);
  const project = cols.project >= 0 ? cell(row, cols.project) : '';
  const priority = cols.priority >= 0 ? cell(row, cols.priority) : '';
  const assignee = cols.assignee >= 0 ? cell(row, cols.assignee) : '';
  const reporter = cols.reporter >= 0 ? cell(row, cols.reporter) : '';
  const due = cols.due >= 0 ? cell(row, cols.due) : '';
  const labelVal = cols.label >= 0 ? cell(row, cols.label) : '';

  const overlay = el('div', { className: 'kanban-modal-overlay' });
  const modal = el('div', { className: 'kanban-modal' });

  /* -- Header with title and badges -- */
  const headerContent = el('div', { className: 'kanban-modal-header-content' });

  // Editable title
  headerContent.append(editableCell('div', { className: 'kanban-modal-title' }, taskName, rowIdx, cols.text));

  // Header meta: stage, project, priority, assignee, due, label
  const headerMeta = el('div', { className: 'kanban-modal-header-meta' });

  const stageBadge = el('button', {
    className: `kanban-stage-btn kanban-stage-${template.stageClass(stage)}`,
    title: 'Click to cycle stage',
  }, [stage || 'Backlog']);
  stageBadge.addEventListener('click', (e) => {
    e.stopPropagation();
    const next = cycleStatus(stageBadge, template.stageStates, template.stageClass, 'kanban-stage-btn kanban-stage-');
    emitEdit(rowIdx, cols.stage, next);
  });
  headerMeta.append(stageBadge);

  if (project) {
    headerMeta.append(el('span', {
      className: 'kanban-card-project-badge',
      style: `--project-color: ${projectColor(project)}`,
    }, [project]));
  }

  if (priority) {
    headerMeta.append(el('span', {
      className: `kanban-pri-dot kanban-pri-${priority.toLowerCase().trim()}`,
    }));
  }

  if (due) {
    headerMeta.append(el('span', {
      className: `kanban-card-due ${dueBadgeClass(due)}`,
      title: due,
    }, [formatDue(due)]));
  }

  if (labelVal) {
    headerMeta.append(el('span', {
      className: `kanban-card-label kanban-label-${labelVal.toLowerCase().trim()}`,
    }, [labelVal]));
  }

  if (assignee) {
    const initial = assignee.charAt(0).toUpperCase();
    headerMeta.append(el('span', { className: 'kanban-card-assignee', title: assignee }, [
      el('span', { className: 'kanban-avatar' }, [initial]),
      assignee,
    ]));
  }

  if (reporter) {
    headerMeta.append(el('span', { className: 'kanban-card-reporter', title: `Reported by ${reporter}` }, [
      '📝 ', reporter,
    ]));
  }

  headerContent.append(headerMeta);

  const closeBtn = el('button', { className: 'kanban-modal-close', title: 'Close' }, ['✕']);
  closeBtn.addEventListener('click', () => overlay.remove());

  modal.append(el('div', { className: 'kanban-modal-header' }, [headerContent, closeBtn]));

  /* -- Body: full detail panel -- */
  const body = el('div', { className: 'kanban-modal-body' });
  body.append(buildCardDetail(group, ctx));
  modal.append(body);

  overlay.append(modal);

  // Close on backdrop click
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  // Close on Escape
  function onKey(e) {
    if (e.key === 'Escape') {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
    }
  }
  document.addEventListener('keydown', onKey);

  document.body.append(overlay);
}
