/* ============================================================
   kanban/modal.js — Focus modal for kanban cards

   Opens a full-screen overlay with editable title, stage
   cycling, metadata badges, and the full detail panel.
   Integrates with browser history so the mobile back button
   closes the modal instead of navigating away.
   ============================================================ */

import { el, cell, editableCell, emitEdit, cycleStatus } from '../shared.js';
import { projectColor, dueBadgeClass, formatDue } from './helpers.js';
import { buildCardDetail } from './cards.js';

/* ---------- History-aware modal state ---------- */

/** Active popstate handler for the current modal (if any). */
let _activePopHandler = null;

/** Whether a history entry has been pushed for the current modal. */
let _hasModalHistoryEntry = false;

/* ---------- Focus modal ---------- */

/**
 * Open a focus-view modal for a kanban card.
 *
 * @param {Object} group — parsed group (row, idx, subtasks, notes)
 * @param {Object} ctx   — render context { cols, template, allProjects, allAssignees }
 */
export function openCardModal(group, ctx) {
  const { cols, template } = ctx;

  // Close any existing modal (preserve history entry if re-opening)
  const existing = document.querySelector('.kanban-modal-overlay');
  if (existing) {
    existing.remove();
    if (_activePopHandler) {
      window.removeEventListener('popstate', _activePopHandler);
      _activePopHandler = null;
    }
    // Keep _hasModalHistoryEntry — reuse the existing entry for the new modal
  }

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

  if (cols.priority >= 0) {
    const priDot = el('button', {
      className: `kanban-pri-dot kanban-pri-${(priority || '').toLowerCase().trim()}`,
      title: `Priority: ${priority || 'None'} (click to change)`,
    }, [priority || '']);
    const priStates = ['P0', 'P1', 'P2', 'P3'];
    const priClassify = v => (v || '').toLowerCase().trim();
    priDot.addEventListener('click', (e) => {
      e.stopPropagation();
      const next = cycleStatus(priDot, priStates, priClassify, 'kanban-pri-dot kanban-pri-');
      priDot.title = `Priority: ${next} (click to change)`;
      emitEdit(rowIdx, cols.priority, next);
    });
    headerMeta.append(priDot);
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

  /* -- Close helper: removes overlay + cleans up listeners -- */
  function closeModal() {
    if (overlay.parentNode) overlay.remove();
    document.removeEventListener('keydown', onKey);
    if (_activePopHandler) {
      window.removeEventListener('popstate', _activePopHandler);
      _activePopHandler = null;
    }
  }

  /* Close via UI action (X, backdrop, Escape) — also pops history entry */
  function closeFromUI() {
    closeModal();
    if (_hasModalHistoryEntry) {
      _hasModalHistoryEntry = false;
      history.back();
    }
  }

  closeBtn.addEventListener('click', () => closeFromUI());

  modal.append(el('div', { className: 'kanban-modal-header' }, [headerContent, closeBtn]));

  /* -- Body: full detail panel -- */
  const body = el('div', { className: 'kanban-modal-body' });
  body.append(buildCardDetail(group, ctx));
  modal.append(body);

  overlay.append(modal);

  // Close on backdrop click
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeFromUI();
  });

  // Close on Escape
  function onKey(e) {
    if (e.key === 'Escape') closeFromUI();
  }
  document.addEventListener('keydown', onKey);

  // Push history state so browser back button closes modal instead of navigating
  if (!_hasModalHistoryEntry) {
    history.pushState({ kanbanModal: true }, '');
    _hasModalHistoryEntry = true;
  }

  // Handle popstate (back button) — close modal without calling history.back()
  function onPopState() {
    _hasModalHistoryEntry = false;
    closeModal();
  }
  _activePopHandler = onPopState;
  window.addEventListener('popstate', onPopState);

  document.body.append(overlay);
}
