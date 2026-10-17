/* ============================================================
   organizer/index.js — WayMark Drive Organizer (barrel)

   A File-Triage control plane rendered from a Google Sheet. Each row is a
   Drive file: its current name/folder, a code-proposed clean destination
   folder + standardized name + confidence + disposition (Move / Rename /
   Archive / Skip). The template can:

     • Scan Drive   — inventory files into the sheet (api.drive.scanInventory)
     • AI Propose   — fill Proposed Folder/Name/Confidence/Action via the
                      deterministic taxonomy in helpers.js
     • Dry-Run      — show a before → after tree diff for approved rows
     • Run Batch    — move/rename files (api.drive.moveFile) + write an
                      Audit Log tab recording previous folder/name
     • Undo Batch   — reverse the last run from the Audit Log

   Every proposal edit persists back to the sheet via emitEdit so the user
   can review / tweak / bulk-approve before any file is touched.
   ============================================================ */

import {
  el, cell, showToast, registerTemplate, emitEdit, editableCell,
  appendSheetRows, writeSheetTab, readSheetTab,
  listDriveInventory, moveDriveFile,
} from '../shared.js';
import {
  ACTIONS, ACTIONABLE, AUDIT_TAB, AUDIT_HEADER, ARCHIVE_FOLDER,
  proposeFolder, proposeName, proposeDomain, proposeAction,
  scoreConfidence, nextAction, inventoryToFields, detectFlags,
  buildDiffTree, buildInsights, isProtectedFile,
} from './helpers.js';

/* ---------- Module state ---------- */

let _container = null;
let _cols = null;
let _template = null;
let _files = [];          // parsed file objects (see parseFiles)
let _diffOpen = false;
let _audit = [];          // in-memory audit entries from the last Run Batch

/** Extract the active sheet id from the route hash. */
function currentSheetId() {
  const m = (window.location.hash || '').match(/#\/(?:sheet|public)\/([^/?#]+)/);
  return m ? m[1] : null;
}

/* ---------- Row parsing ---------- */

/**
 * Parse the sheet's data rows into file objects keyed by role.
 * @param {string[][]} rows  data rows (header excluded)
 * @param {Object} cols      role → column index
 */
function parseFiles(rows, cols) {
  return rows.map((row, i) => ({
    rowIdx: i + 1,                       // 1-based offset from header (emitEdit convention)
    fileId:         cell(row, cols.fileId),
    currentName:    cell(row, cols.currentName) || cell(row, 0),
    currentFolder:  cell(row, cols.currentFolder) || '/',
    fileType:       cell(row, cols.fileType),
    modified:       cell(row, cols.modified),
    flags:          cell(row, cols.flags),
    proposedFolder: cell(row, cols.proposedFolder),
    proposedName:   cell(row, cols.proposedName),
    confidence:     cell(row, cols.confidence),
    action:         cell(row, cols.action),
    protected:      isProtectedFile(cell(row, cols.currentName) || cell(row, 0), cell(row, cols.currentFolder)),
  }));
}

/* ---------- Persistence ---------- */

/** Persist a single role cell for a file and keep the model in sync. */
function persistCell(file, role, value) {
  const col = _cols[role];
  if (col === undefined || col < 0) return;
  file[role] = value;
  emitEdit(file.rowIdx, col, value);
}

/* ---------- Actions ---------- */

const handlers = {
  /** Scan Drive and append any new files to the control-plane sheet. */
  async scan() {
    let inventory = [];
    try {
      inventory = await listDriveInventory();
    } catch (err) {
      showToast(err.message || 'Drive scan failed', 'error');
      return;
    }
    const known = new Set(_files.map(f => f.fileId).filter(Boolean));
    const fresh = inventory.filter(it => it.id && !known.has(it.id));
    if (!fresh.length) { showToast('No new files found', 'info'); return; }

    const flags = detectFlags(fresh);
    const sid = currentSheetId();
    const newRows = fresh.map((it, i) => {
      const f = inventoryToFields(it);
      f.flags = flags.get(i) || '';
      return roleRow({ ...f, proposedFolder: '', proposedName: '', confidence: '', action: '' });
    });
    if (sid) {
      try { await appendSheetRows(sid, 'Sheet1', newRows); }
      catch (err) { showToast(err.message || 'Could not write files', 'error'); }
    }
    // Reflect optimistically in the model + re-render.
    const base = _files.length;
    fresh.forEach((it, i) => {
      const f = inventoryToFields(it);
      f.flags = flags.get(i) || '';
      _files.push({ rowIdx: base + i + 1, ...f, proposedFolder: '', proposedName: '', confidence: '', action: '', protected: isProtectedFile(f.currentName, f.currentFolder) });
    });
    showToast(`Scanned ${fresh.length} file${fresh.length > 1 ? 's' : ''} into triage`, 'success');
    rerender();
  },

  /** Fill proposals for every file via the deterministic taxonomy. */
  propose() {
    let n = 0;
    let protectedCount = 0;
    for (const f of _files) {
      if (f.protected) {
        // Waymark system files are left exactly where they are.
        if (!f.flags) persistCell(f, 'flags', 'Protected');
        persistCell(f, 'proposedFolder', '');
        persistCell(f, 'proposedName', '');
        persistCell(f, 'confidence', '');
        persistCell(f, 'action', 'Skip');
        protectedCount++;
        continue;
      }
      const folder = proposeFolder(f.currentName, f.fileType, f.currentFolder);
      const name = proposeName(f.currentName, f.fileType);
      const conf = String(scoreConfidence(f.currentName, f.fileType, f.currentFolder));
      const act = proposeAction(f.currentName, f.fileType, f.currentFolder);
      persistCell(f, 'proposedFolder', folder);
      persistCell(f, 'proposedName', name);
      persistCell(f, 'confidence', conf);
      if (!f.action || f.action === 'Skip') persistCell(f, 'action', act);
      n++;
    }
    const suffix = protectedCount ? ` · ${protectedCount} Waymark file${protectedCount > 1 ? 's' : ''} protected` : '';
    showToast(`Proposed a clean home for ${n} file${n > 1 ? 's' : ''}${suffix}`, 'success');
    rerender();
  },

  /** Approve every non-skip file (set its action to the proposed disposition). */
  approveAll() {
    for (const f of _files) {
      if (f.protected || f.action === 'Skip') continue;
      const act = f.action && ACTIONABLE.has(f.action)
        ? f.action
        : proposeAction(f.currentName, f.fileType, f.currentFolder);
      persistCell(f, 'action', act);
    }
    showToast('All files approved for the next batch run', 'success');
    rerender();
  },

  /** Cycle a single file's action through Move → Rename → Archive → Skip. */
  cycleAction(rowIdx) {
    const f = _files.find(x => x.rowIdx === rowIdx);
    if (!f) return;
    if (f.protected) {
      showToast('Protected Waymark file — left in place', 'info');
      return;
    }
    persistCell(f, 'action', nextAction(f.action));
    rerender();
  },

  /** Toggle the dry-run before → after diff preview. */
  toggleDiff() {
    _diffOpen = !_diffOpen;
    rerender();
  },

  /** Execute approved moves, create the Audit Log, and refresh the board. */
  async run() {
    const approved = _files.filter(f => ACTIONABLE.has(f.action) && !f.protected);
    if (!approved.length) { showToast('No approved files to move', 'info'); return; }

    const ts = new Date().toISOString();
    const audit = [];
    for (const f of approved) {
      const target = f.action === 'Archive' ? ARCHIVE_FOLDER : (f.proposedFolder || ARCHIVE_FOLDER);
      const newName = f.proposedName || f.currentName;
      try {
        await moveDriveFile(f.fileId, { toFolder: target, name: newName });
      } catch (err) {
        showToast(err.message || `Could not move ${f.currentName}`, 'error');
        continue;
      }
      audit.push([f.fileId, f.currentFolder || '/', f.currentName, target, newName, f.action, ts]);
      // Update the model + sheet so the file now shows its new home.
      persistCell(f, 'currentFolder', target);
      persistCell(f, 'currentName', newName);
      persistCell(f, 'action', 'Done');
    }

    _audit = audit;
    const sid = currentSheetId();
    if (sid && audit.length) {
      try { await writeSheetTab(sid, AUDIT_TAB, [AUDIT_HEADER, ...audit]); }
      catch (err) { showToast(err.message || 'Could not write audit log', 'error'); }
    }
    showToast(`Moved ${audit.length} file${audit.length > 1 ? 's' : ''} · undo available`, 'success');
    _diffOpen = false;
    rerender();
  },

  /** Reverse the most recent batch using the Audit Log. */
  async undo() {
    let entries = _audit;
    if (!entries.length) {
      const tab = readSheetTab(_template && _template._tabs, AUDIT_TAB);
      entries = tab ? tab.values.slice(1) : [];
    }
    if (!entries.length) { showToast('Nothing to undo', 'info'); return; }

    for (const e of entries) {
      const [fileId, prevFolder, prevName, , , ] = e;
      try {
        await moveDriveFile(fileId, { toFolder: prevFolder || '/', name: prevName });
      } catch (err) {
        showToast(err.message || 'Undo failed', 'error');
        continue;
      }
      const f = _files.find(x => x.fileId === fileId);
      if (f) {
        persistCell(f, 'currentFolder', prevFolder || '/');
        persistCell(f, 'currentName', prevName);
        persistCell(f, 'action', 'Move');
      }
    }
    const sid = currentSheetId();
    if (sid) { try { await writeSheetTab(sid, AUDIT_TAB, [AUDIT_HEADER]); } catch { /* best effort */ } }
    _audit = [];
    showToast('Batch move undone', 'success');
    rerender();
  },
};

/* ---------- DOM builders ---------- */

/** Build the sheet row (string[]) for a file object respecting column order. */
function roleRow(f) {
  const width = Math.max(
    ..._valuesOf(_cols),
    0,
  ) + 1;
  const row = new Array(width).fill('');
  const put = (role, val) => { const c = _cols[role]; if (c >= 0) row[c] = val || ''; };
  put('fileId', f.fileId); put('currentName', f.currentName); put('currentFolder', f.currentFolder);
  put('fileType', f.fileType); put('modified', f.modified); put('flags', f.flags);
  put('proposedFolder', f.proposedFolder); put('proposedName', f.proposedName);
  put('confidence', f.confidence); put('action', f.action);
  return row;
}

function _valuesOf(cols) {
  return Object.values(cols).filter(v => typeof v === 'number' && v >= 0);
}

/** Toolbar with the five control-plane actions. */
function buildToolbar() {
  const btn = (label, action, cls) => el('button', {
    className: `organizer-btn organizer-btn-${action.toLowerCase()} ${cls || ''}`.trim(),
    type: 'button',
    on: { click: () => handlers[action]() },
  }, [label]);

  return el('div', { className: 'organizer-toolbar' }, [
    btn('⟳ Scan Drive', 'scan', 'organizer-btn-primary'),
    btn('✦ AI Propose', 'propose'),
    btn('✓ Approve All', 'approveAll'),
    btn(_diffOpen ? 'Hide Dry-Run' : 'Dry-Run Preview', 'toggleDiff'),
    btn('▶ Run Batch', 'run', 'organizer-btn-run'),
    btn('↩ Undo Batch', 'undo', 'organizer-btn-undo'),
  ]);
}

/** Summary counts + AI insight chips. */
function buildSummary() {
  const total = _files.length;
  const approved = _files.filter(f => ACTIONABLE.has(f.action) && !f.protected).length;
  const flagged = _files.filter(f => (f.flags || '').trim()).length;

  const stat = (num, label, cls) => el('div', { className: `organizer-stat ${cls || ''}`.trim() }, [
    el('span', { className: 'organizer-stat-num' }, [String(num)]),
    el('span', { className: 'organizer-stat-label' }, [label]),
  ]);

  const chips = buildInsights(_files).map(text =>
    el('span', { className: 'organizer-insight-chip' }, [text]));

  return el('div', { className: 'organizer-summary' }, [
    el('div', { className: 'organizer-stats' }, [
      stat(total, 'files', ''),
      stat(approved, 'approved', 'organizer-stat-approved'),
      stat(flagged, 'flagged', 'organizer-stat-flagged'),
    ]),
    chips.length ? el('div', { className: 'organizer-insights' }, chips) : null,
  ]);
}

/** Before → after tree diff for approved rows. */
function buildDiff() {
  const tree = buildDiffTree(_files);
  if (!tree.length) {
    return el('div', { className: 'organizer-diff' }, [
      el('p', { className: 'organizer-diff-empty' }, ['No approved moves yet — set a file Action to Move, Rename, or Archive.']),
    ]);
  }
  return el('div', { className: 'organizer-diff' }, [
    el('div', { className: 'organizer-diff-head' }, ['Dry-Run · Before → After']),
    ...tree.map(group => el('div', { className: 'organizer-diff-group' }, [
      el('div', { className: 'organizer-diff-folder' }, [`📁 ${group.folder}`]),
      ...group.moves.map(m => el('div', { className: 'organizer-diff-move' }, [
        el('span', { className: 'organizer-diff-from' }, [`${m.from}`]),
        el('span', { className: 'organizer-diff-arrow' }, ['→']),
        el('span', { className: 'organizer-diff-to' }, [`${group.folder}/${m.name}`]),
      ])),
    ])),
  ]);
}

/** One file row in the triage board. */
function buildFileRow(f) {
  const conf = parseInt(f.confidence, 10);
  const confPct = Number.isNaN(conf) ? 0 : Math.max(0, Math.min(100, conf));
  const actionCls = f.action ? `organizer-action-${f.action.toLowerCase()}` : 'organizer-action-none';
  const flag = (f.flags || '').trim();
  const flagBadge = f.protected
    ? el('span', { className: 'organizer-flag organizer-flag-protected' }, ['Protected'])
    : (flag ? el('span', { className: `organizer-flag organizer-flag-${flag.toLowerCase()}` }, [flag]) : null);

  const actionControl = f.protected
    ? el('span', { className: 'organizer-action organizer-action-protected', title: 'Waymark system file — never moved or archived' }, ['🔒 Protected'])
    : el('button', {
        className: `organizer-action ${actionCls}`,
        type: 'button',
        on: { click: () => handlers.cycleAction(f.rowIdx) },
      }, [f.action || 'Set action']);

  return el('div', { className: `organizer-file${f.protected ? ' organizer-file-protected' : ''}` }, [
    el('div', { className: 'organizer-file-main' }, [
      el('div', { className: 'organizer-file-head' }, [
        el('span', { className: 'organizer-file-name' }, [f.currentName || '(unnamed)']),
        f.fileType ? el('span', { className: 'organizer-file-type' }, [f.fileType]) : null,
        flagBadge,
      ]),
      el('div', { className: 'organizer-file-path' }, [
        el('span', { className: 'organizer-file-from' }, [f.currentFolder || '/']),
        el('span', { className: 'organizer-file-arrow' }, ['→']),
        f.protected
          ? el('span', { className: 'organizer-file-keep' }, ['Keep in place'])
          : editableCell('span', { className: 'organizer-file-to' }, f.proposedFolder, f.rowIdx, _cols.proposedFolder),
      ]),
      f.protected ? null : el('div', { className: 'organizer-file-rename' }, [
        el('span', { className: 'organizer-file-rename-label' }, ['Rename:']),
        editableCell('span', { className: 'organizer-file-newname' }, f.proposedName, f.rowIdx, _cols.proposedName),
      ]),
    ]),
    el('div', { className: 'organizer-file-side' }, [
      f.protected ? null : el('div', { className: 'organizer-conf' }, [
        el('span', { className: 'organizer-conf-track' }, [
          el('span', { className: 'organizer-conf-fill', style: { width: `${confPct}%` } }),
        ]),
        el('span', { className: 'organizer-conf-num' }, [confPct ? `${confPct}%` : '—']),
      ]),
      actionControl,
    ]),
  ]);
}

/** Group files by proposed domain and render each cluster. */
function buildBoard() {
  const groups = new Map();
  for (const f of _files) {
    const domain = proposeDomain(f.currentName, f.fileType, f.currentFolder);
    if (!groups.has(domain)) groups.set(domain, []);
    groups.get(domain).push(f);
  }
  const sections = [...groups.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([domain, files]) => el('section', { className: 'organizer-cluster' }, [
      el('header', { className: 'organizer-cluster-head' }, [
        el('span', { className: 'organizer-cluster-name' }, [domain]),
        el('span', { className: 'organizer-cluster-count' }, [`${files.length} file${files.length > 1 ? 's' : ''}`]),
      ]),
      el('div', { className: 'organizer-cluster-body' }, files.map(buildFileRow)),
    ]));

  return el('div', { className: 'organizer-board' }, sections);
}

/* ---------- Render ---------- */

function rerender() {
  if (!_container) return;
  _container.innerHTML = '';
  _container.append(
    el('div', { className: 'organizer-root' }, [
      el('div', { className: 'organizer-topbar' }, [
        el('h2', { className: 'organizer-title' }, ['Drive Organizer']),
        el('p', { className: 'organizer-subtitle' }, ['Review proposed moves, then run a safe batch with 1-click undo.']),
      ]),
      buildToolbar(),
      buildSummary(),
      _diffOpen ? buildDiff() : null,
      _files.length ? buildBoard() : el('div', { className: 'organizer-empty' }, [
        el('p', {}, ['No files yet. Click ', el('strong', {}, ['Scan Drive']), ' to inventory your Drive into the triage board.']),
      ]),
    ]),
  );
}

/* ---------- Template Definition ---------- */

const definition = {
  name: 'Drive Organizer',
  icon: '🗂️',
  color: '#0d9488',
  priority: 24,
  itemNoun: 'File',
  defaultHeaders: [
    'File ID', 'Current Name', 'Current Folder', 'Type', 'Last Modified',
    'Flags', 'Proposed Folder', 'Proposed Name', 'Confidence', 'Action',
  ],

  detect(lower) {
    const hasCurrent = lower.some(h => /^(current\s*(name|folder|path)|file\s*(id|name)|filename)/.test(h));
    const hasProposed = lower.some(h => /^(proposed\s*(folder|name|path)|target\s*folder|suggested\s*(folder|name))/.test(h));
    const hasAction = lower.some(h => /^(action|disposition|triage)/.test(h));
    return (hasCurrent && hasProposed) || (hasProposed && hasAction);
  },

  columns(lower) {
    const cols = {
      fileId: -1, currentName: -1, currentFolder: -1, fileType: -1, modified: -1,
      flags: -1, proposedFolder: -1, proposedName: -1, confidence: -1, action: -1,
    };
    const used = () => Object.values(cols).filter(v => v >= 0);
    const free = (i) => !used().includes(i);

    cols.fileId         = lower.findIndex(h => /^(file\s*id|^id$)/.test(h) || /file.?id/.test(h));
    cols.proposedFolder = lower.findIndex((h, i) => free(i) && /^(proposed\s*(folder|path)|target\s*folder)/.test(h));
    cols.proposedName   = lower.findIndex((h, i) => free(i) && /^(proposed\s*name|new\s*name|suggested\s*name)/.test(h));
    cols.currentName    = lower.findIndex((h, i) => free(i) && /^(current\s*name|file\s*name|filename|^name$)/.test(h));
    cols.currentFolder  = lower.findIndex((h, i) => free(i) && /^(current\s*(folder|path)|^folder$|^path$|location)/.test(h));
    cols.fileType       = lower.findIndex((h, i) => free(i) && /^(type|mime|kind|template\s*type)/.test(h));
    cols.modified       = lower.findIndex((h, i) => free(i) && /^(last\s*modified|modified|updated|date)/.test(h));
    cols.flags          = lower.findIndex((h, i) => free(i) && /^(flags?|dupe|duplicate|stale|status)/.test(h));
    cols.confidence     = lower.findIndex((h, i) => free(i) && /^(ai\s*confidence|confidence|score)/.test(h));
    cols.action         = lower.findIndex((h, i) => free(i) && /^(action|disposition|triage)/.test(h));
    if (cols.currentName === -1) cols.currentName = 0;
    return cols;
  },

  addRowFields(cols) {
    return [
      { role: 'currentName',    label: 'Current Name',    colIndex: cols.currentName,    type: 'text', placeholder: 'messy file name', required: true },
      { role: 'currentFolder',  label: 'Current Folder',  colIndex: cols.currentFolder,  type: 'text', placeholder: '/Unsorted' },
      { role: 'fileType',       label: 'Type',            colIndex: cols.fileType,       type: 'text', placeholder: 'Sheet / Doc / Image' },
      { role: 'proposedFolder', label: 'Proposed Folder', colIndex: cols.proposedFolder, type: 'text', placeholder: '/Projects/...' },
      { role: 'proposedName',   label: 'Proposed Name',   colIndex: cols.proposedName,   type: 'text', placeholder: 'Clean Name' },
      { role: 'action',         label: 'Action',          colIndex: cols.action,         type: 'select', options: ACTIONS },
    ];
  },

  render(container, rows, cols, template) {
    _container = container;
    _cols = cols;
    _template = template;
    _diffOpen = false;
    _files = parseFiles(rows, cols);
    rerender();
  },
};

registerTemplate('organizer', definition);
export default definition;
