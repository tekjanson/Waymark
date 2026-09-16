/* ============================================================
   party/modal.js — Party Planning Dashboard: add / edit dialogs

   Lightweight overlay modals built entirely with el() (no innerHTML with
   dynamic content). Each opener resolves via callbacks so the caller owns
   persistence.
   ============================================================ */

import { el } from '../shared.js';
import { META_FIELDS, LINK_TYPES } from './helpers.js';

/* ---------- Overlay scaffolding ---------- */

/**
 * Build and mount a modal overlay.
 * @param {string} title
 * @param {HTMLElement[]} bodyChildren
 * @param {{ label: string, onClick: function, danger?: boolean }[]} actions
 * @returns {{ close: function }}
 */
function mountModal(title, bodyChildren, actions) {
  const overlay = el('div', { className: 'party-modal-overlay' });
  const close = () => overlay.remove();

  const footer = el('div', { className: 'party-modal-footer' },
    actions.map(a =>
      el('button', {
        className: `party-modal-btn${a.primary ? ' party-modal-btn-primary' : ''}${a.danger ? ' party-modal-btn-danger' : ''}`,
        type: 'button',
        on: { click: () => a.onClick(close) },
      }, [a.label]),
    ),
  );

  const modal = el('div', { className: 'party-modal' }, [
    el('div', { className: 'party-modal-header' }, [
      el('h3', { className: 'party-modal-title' }, [title]),
      el('button', { className: 'party-modal-close', type: 'button', 'aria-label': 'Close', on: { click: close } }, ['×']),
    ]),
    el('div', { className: 'party-modal-body' }, bodyChildren),
    footer,
  ]);

  overlay.append(modal);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.body.append(overlay);
  const firstInput = modal.querySelector('input, select, textarea');
  if (firstInput) firstInput.focus();
  return { close };
}

/** Build a labeled form field wrapper. */
function field(labelText, control) {
  return el('label', { className: 'party-field' }, [
    el('span', { className: 'party-field-label' }, [labelText]),
    control,
  ]);
}

/* ---------- Item modal (category rows) ---------- */

/**
 * Open the add/edit modal for a category item.
 * @param {Object}   cat        category definition
 * @param {string[]} row        existing row values (or blank array for add)
 * @param {boolean}  isNew
 * @param {function(string[]):void} onSave    receives the edited row
 * @param {function():void}         [onDelete]
 */
export function openItemModal(cat, row, isNew, onSave, onDelete) {
  const values = cat.header.map((_, i) => (row && row[i]) || '');
  const controls = {};

  const body = cat.fields.map((f) => {
    let control;
    if (f.type === 'status') {
      control = el('select', { className: 'party-field-input' },
        [''].concat(f.options).map(opt =>
          el('option', opt === values[f.col] ? { value: opt, selected: 'selected' } : { value: opt }, [opt || '—']),
        ),
      );
    } else if (f.type === 'yesno') {
      control = el('select', { className: 'party-field-input' },
        ['No', 'Yes'].map(opt =>
          el('option', opt === (values[f.col] || 'No') ? { value: opt, selected: 'selected' } : { value: opt }, [opt]),
        ),
      );
    } else {
      control = el('input', {
        className: 'party-field-input',
        type: f.type === 'money' ? 'text' : 'text',
        value: values[f.col] || '',
        placeholder: f.placeholder || '',
      });
    }
    controls[f.col] = control;
    return field(f.label + (f.required ? ' *' : ''), control);
  });

  const actions = [
    { label: 'Cancel', onClick: (close) => close() },
  ];
  if (!isNew && typeof onDelete === 'function') {
    actions.push({ label: 'Delete', danger: true, onClick: (close) => { close(); onDelete(); } });
  }
  actions.push({
    label: isNew ? 'Add' : 'Save',
    primary: true,
    onClick: (close) => {
      const out = cat.header.map((_, i) => (controls[i] ? controls[i].value.trim() : values[i] || ''));
      const primary = cat.fields.find(f => f.primary);
      if (primary && !out[primary.col]) {
        controls[primary.col].classList.add('party-field-error');
        controls[primary.col].focus();
        return;
      }
      close();
      onSave(out);
    },
  });

  mountModal(`${isNew ? 'Add' : 'Edit'} ${cat.noun}`, body, actions);
}

/* ---------- Link modal (external tools) ---------- */

/**
 * Open the add/edit modal for an external tool link.
 * @param {{label:string,url:string,type:string}} link
 * @param {boolean} isNew
 * @param {function(Object):void} onSave
 * @param {function():void} [onDelete]
 */
export function openLinkModal(link, isNew, onSave, onDelete) {
  const labelInput = el('input', { className: 'party-field-input', type: 'text', value: link.label || '', placeholder: 'e.g. Amazon Registry' });
  const urlInput = el('input', { className: 'party-field-input', type: 'text', value: link.url || '', placeholder: 'https://…' });
  const typeSelect = el('select', { className: 'party-field-input' },
    LINK_TYPES.map(t =>
      el('option', t === (link.type || 'Registry') ? { value: t, selected: 'selected' } : { value: t }, [t]),
    ),
  );

  const actions = [{ label: 'Cancel', onClick: (close) => close() }];
  if (!isNew && typeof onDelete === 'function') {
    actions.push({ label: 'Delete', danger: true, onClick: (close) => { close(); onDelete(); } });
  }
  actions.push({
    label: isNew ? 'Add link' : 'Save',
    primary: true,
    onClick: (close) => {
      const url = urlInput.value.trim();
      if (!url) { urlInput.classList.add('party-field-error'); urlInput.focus(); return; }
      close();
      onSave({ label: labelInput.value.trim() || url, url, type: typeSelect.value });
    },
  });

  mountModal(isNew ? 'Add external tool' : 'Edit link', [
    field('Label', labelInput),
    field('URL *', urlInput),
    field('Type', typeSelect),
  ], actions);
}

/* ---------- Meta modal (party details) ---------- */

/**
 * Open the modal to edit the party's headline details.
 * @param {Object} meta
 * @param {function(Object):void} onSave
 */
export function openMetaModal(meta, onSave) {
  const inputs = {};
  const body = META_FIELDS.map((f) => {
    const input = el('input', {
      className: 'party-field-input',
      type: 'text',
      value: meta[f.key] || '',
      placeholder: f.key === 'date' ? 'YYYY-MM-DD' : '',
    });
    inputs[f.key] = input;
    return field(f.label, input);
  });

  mountModal('Edit party details', body, [
    { label: 'Cancel', onClick: (close) => close() },
    {
      label: 'Save',
      primary: true,
      onClick: (close) => {
        const out = {};
        for (const f of META_FIELDS) out[f.key] = inputs[f.key].value.trim();
        close();
        onSave(out);
      },
    },
  ]);
}
