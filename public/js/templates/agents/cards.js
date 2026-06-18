/* ============================================================
   templates/agents/cards.js — Agent card DOM builders
   ============================================================ */

import { el, cell, editableCell, textareaCell, emitEdit, showToast } from '../shared.js';
import { api } from '../../api-client.js';
import { STATUS_CYCLE, STATUS_COLORS, timeAgo } from './helpers.js';

/** Build an agent card element
 * @param {string[]} row - Agent row data
 * @param {number} rowIdx - 1-based row index
 * @param {Object} cols - Column mapping
 * @param {Object} template - Template instance reference
 * @param {Function} onDelete - Delete button click handler
 * @returns {Element}
 */
export function buildAgentCard(row, rowIdx, cols, template, onDelete) {
  const name      = cell(row, cols.name)      || `Agent ${rowIdx}`;
  const model     = cell(row, cols.model)      || '';
  const provider  = cell(row, cols.provider)   || 'auto';
  const statusVal = cell(row, cols.status)     || 'Offline';
  const tuning    = cell(row, cols.tuning)     || '';
  const taskVal   = cell(row, cols.task)       || '';
  const project   = cell(row, cols.project)    || '';
  const heartbeat = cell(row, cols.heartbeat)  || '';
  const workboard = cell(row, cols.workboard)  || '';
  const command   = cell(row, cols.command)    || '';
  const folder    = cell(row, cols.folder)     || '';

  const statusKey   = STATUS_CYCLE.includes(statusVal) ? statusVal : 'Offline';
  const statusColor = STATUS_COLORS[statusKey];

  /* -- Status badge (click to cycle) -- */
  const statusBadge = el('span', {
    className: 'agents-status-badge',
    style: `background:${statusColor.bg}; color:${statusColor.text}; cursor:pointer`,
    title: 'Click to change status',
    on: { click() {
      if (cols.status === -1) return;
      const next = STATUS_CYCLE[(STATUS_CYCLE.indexOf(statusVal) + 1) % STATUS_CYCLE.length];
      emitEdit(rowIdx, cols.status, next);
    }},
  }, [
    el('span', { className: 'agents-status-dot', style: `background:${statusColor.dot}` }),
    statusVal,
  ]);

  /* -- Provider badge (inline edit) -- */
  const providerCell = cols.provider !== -1
    ? editableCell('span', { className: `agents-provider-badge agents-provider-${provider.toLowerCase()}` }, provider, rowIdx, cols.provider)
    : el('span', { className: `agents-provider-badge agents-provider-${provider.toLowerCase()}` }, [provider]);

  /* -- Agent initials avatar -- */
  const initials = name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
  const hue      = [...name].reduce((h, c) => h + c.charCodeAt(0), 0) % 360;
  const avatar   = el('div', { className: 'agents-avatar', style: `background:hsl(${hue},60%,55%)` }, [initials]);

  /* -- Tuning textarea (the main control) -- */
  const tuningCell = textareaCell(
    'div', { className: 'agents-tuning-cell' },
    tuning, rowIdx, cols.tuning,
    { placeholder: 'Personality and behavior instructions. Injected at the start of every session.' }
  );

  /* -- Model (inline edit) -- */
  const modelCell = cols.model !== -1
    ? editableCell('span', { className: 'agents-model-cell' }, model || '—', rowIdx, cols.model, { placeholder: 'model' })
    : null;

  /* -- Task display (read-only, written by agent) -- */
  const taskDisplay = cols.task !== -1
    ? el('div', { className: 'agents-task' + (taskVal ? '' : ' agents-task-empty') }, [
        el('span', { className: 'agents-task-label' }, ['Current task: ']),
        taskVal || 'idle',
      ])
    : null;

  /* -- Heartbeat -- */
  const heartbeatEl = (cols.heartbeat !== -1 && heartbeat)
    ? el('div', { className: 'agents-heartbeat' }, ['⏱ Last seen: ', timeAgo(heartbeat)])
    : null;

  /* -- Workboard target: clickable link + inline edit -- */
  const wbEdit = cols.workboard !== -1
    ? editableCell('span', { className: 'agents-workboard-cell' }, workboard || '—', rowIdx, cols.workboard, { placeholder: 'Sheet ID' })
    : null;
  const workboardEl = cols.workboard !== -1
    ? el('div', { className: 'agents-workboard' }, [
        el('span', { className: 'agents-field-label' }, ['📋 Workboard: ']),
        el('span', { className: 'agents-workboard-value' }, [
          ...(workboard ? [el('a', {
            className: 'agents-workboard-open',
            href: `#/sheet/${workboard}`,
            title: `Open workboard in Waymark`,
            on: { click(e) { e.stopPropagation(); } },
          }, ['↗ Open'])] : []),
          wbEdit,
        ]),
      ])
    : null;

  /* -- Command override (inline edit) -- */
  const commandEl = cols.command !== -1
    ? el('div', { className: 'agents-command' }, [
        el('span', { className: 'agents-field-label' }, ['⌘ Command: ']),
        editableCell('span', { className: 'agents-command-cell' }, command || '—', rowIdx, cols.command, { placeholder: '@waymark-builder start' }),
      ])
    : null;

  /* -- Project (inline edit) -- */
  const projectEl = (cols.project !== -1 && project)
    ? el('div', { className: 'agents-project' }, [
        el('span', { className: 'agents-field-label' }, ['Project: ']),
        editableCell('span', { className: 'agents-project-cell' }, project, rowIdx, cols.project, { placeholder: 'project' }),
      ])
    : null;

  /* -- Folder (inline edit) -- */
  const folderEl = (cols.folder !== -1 && folder)
    ? el('div', { className: 'agents-folder' }, [
        el('span', { className: 'agents-field-label' }, ['📁 Folder: ']),
        editableCell('span', { className: 'agents-folder-cell' }, folder, rowIdx, cols.folder, { placeholder: 'Team/Group folder' }),
      ])
    : null;

  /* -- Delete agent button -- */
  const deleteBtn = el('button', {
    className: 'agents-delete-btn',
    title: `Delete agent "${name}"`,
    on: { click() { onDelete(name, rowIdx, template); }},
  }, ['🗑️ Delete']);

  /* -- Card assembly -- */
  const metaRow = el('div', { className: 'agents-meta-row' }, [
    statusBadge,
    providerCell,
    ...(modelCell ? [el('span', { className: 'agents-meta-sep' }, ['·']), modelCell] : []),
  ]);

  const cardActions = el('div', { className: 'agents-card-actions' }, [deleteBtn]);

  const card = el('div', {
    className: `agents-card agents-card-status-${statusKey.toLowerCase()}`,
    dataset: { agentName: name },
  }, [
    el('div', { className: 'agents-card-top' }, [
      avatar,
      el('div', { className: 'agents-card-identity' }, [
        editableCell('h3', { className: 'agents-name' }, name, rowIdx, cols.name, { placeholder: 'Agent name' }),
        metaRow,
      ]),
      cardActions,
    ]),
    el('div', { className: 'agents-tuning-section' }, [
      el('label', { className: 'agents-tuning-label' }, ['✏️ Tuning']),
      el('div', { className: 'agents-tuning-hint' }, [
        'Personality + behavior. Prepended to every session prompt.',
      ]),
      tuningCell,
    ]),
    ...(workboardEl ? [workboardEl] : []),
    ...(commandEl   ? [commandEl]   : []),
    ...(taskDisplay ? [taskDisplay] : []),
    ...(projectEl   ? [projectEl]   : []),
    ...(folderEl    ? [folderEl]    : []),
    ...(heartbeatEl ? [heartbeatEl] : []),
  ]);

  return card;
}
