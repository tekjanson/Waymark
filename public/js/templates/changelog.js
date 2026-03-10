/* ============================================================
   templates/changelog.js — Changelog: all fields editable inline
   ============================================================ */

import { el, cell, editableCell, lazySection, delegateEvent, registerTemplate } from './shared.js';

/* ---------- Helpers ---------- */

/** Build entry DOM for a single changelog row */
function buildEntry(row, originalIndex, cols, template) {
  const rowIdx = originalIndex + 1;
  const type = cell(row, cols.type);
  const desc = cell(row, cols.description) || row[0] || '\u2014';
  const cls = template.changeClass(type);
  return el('div', { className: `changelog-entry changelog-${cls}` }, [
    cols.type >= 0
      ? editableCell('span', { className: `changelog-type-badge changelog-type-${cls}` }, type, rowIdx, cols.type)
      : null,
    editableCell('span', { className: 'changelog-desc' }, desc, rowIdx, cols.description),
  ]);
}

const definition = {
  name: 'Changelog',
  icon: '\uD83D\uDCCB',
  color: '#374151',
  priority: 18,
  itemNoun: 'Entry',

  detect(lower) {
    return lower.some(h => /^(version|release|v\d|build)/.test(h))
      && lower.some(h => /^(change|what.?changed|description|detail|summary|added|fixed|removed|breaking)/.test(h) || /^(type|kind|tag|label)/.test(h));
  },

  columns(lower) {
    const cols = { version: -1, date: -1, type: -1, description: -1 };
    cols.version     = lower.findIndex(h => /^(version|release|v\d|build|tag)/.test(h));
    cols.date        = lower.findIndex(h => /^(date|when|released|shipped)/.test(h));
    cols.type        = lower.findIndex((h, i) => i !== cols.version && i !== cols.date && /^(type|kind|tag|label|category|change.?type)/.test(h));
    cols.description = lower.findIndex((h, i) => i !== cols.version && i !== cols.date && i !== cols.type && /^(change|what.?changed|description|detail|summary|notes?|added|fixed|entry)/.test(h));
    if (cols.description === -1) cols.description = lower.findIndex((_, i) => i !== cols.version && i !== cols.date && i !== cols.type);
    return cols;
  },

  addRowFields(cols) {
    return [
      { role: 'version',     label: 'Version',     colIndex: cols.version,     type: 'text',   placeholder: 'e.g. 1.2.0', required: true },
      { role: 'date',        label: 'Date',        colIndex: cols.date,        type: 'date',   defaultValue: '__TODAY__' },
      { role: 'type',        label: 'Type',        colIndex: cols.type,        type: 'select', options: ['Added', 'Fixed', 'Changed', 'Removed', 'Deprecated', 'Breaking'], defaultValue: 'Added' },
      { role: 'description', label: 'Description', colIndex: cols.description, type: 'text',   placeholder: 'What changed?', required: true },
    ];
  },

  changeClass(val) {
    const v = (val || '').toLowerCase().trim();
    if (/^(add|added|new|feature|enhancement)/.test(v)) return 'added';
    if (/^(fix|fixed|bug|patch|hotfix)/.test(v)) return 'fixed';
    if (/^(change|changed|update|improve|refactor)/.test(v)) return 'changed';
    if (/^(break|breaking|removed|deprecated|removal)/.test(v)) return 'breaking';
    return 'other';
  },

  render(container, rows, cols, template) {
    /* --- group rows by version --- */
    const groups = new Map();
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const ver = cell(row, cols.version) || 'Unreleased';
      if (!groups.has(ver)) groups.set(ver, { date: '', entries: [] });
      const g = groups.get(ver);
      if (!g.date) g.date = cell(row, cols.date);
      g.entries.push({ row, originalIndex: i });
    }

    const versionKeys = [...groups.keys()];

    /* --- sidebar: version quick-nav --- */
    const sidebar = el('nav', { className: 'changelog-sidebar' });
    for (const ver of versionKeys) {
      sidebar.append(el('button', {
        className: 'changelog-nav-btn',
        dataset: { ver },
      }, [ver]));
    }
    delegateEvent(sidebar, 'click', '.changelog-nav-btn', (_e, btn) => {
      const target = container.querySelector(`[data-version="${btn.dataset.ver}"]`);
      if (target) {
        const body = target.querySelector('.changelog-body');
        if (body && body.classList.contains('hidden')) {
          target.querySelector('.changelog-version-header').click();
        }
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });

    /* --- main changelog area --- */
    const main = el('div', { className: 'changelog-main' });

    let first = true;
    for (const [ver, { date, entries }] of groups) {
      const section = el('div', { className: 'changelog-version', dataset: { version: ver } });

      const chevron = el('span', { className: 'changelog-chevron' }, ['\u25B6']);
      const header = el('div', { className: 'changelog-version-header changelog-collapsible' }, [
        chevron,
        el('span', { className: 'changelog-version-tag' }, [ver]),
        date ? el('span', { className: 'changelog-version-date' }, [date]) : null,
        el('span', { className: 'changelog-version-count' }, [`${entries.length}`]),
      ]);

      section.append(header);

      if (first) {
        /* Latest version starts expanded */
        const body = el('div', { className: 'changelog-body' });
        for (const { row, originalIndex } of entries) {
          body.append(buildEntry(row, originalIndex, cols, template));
        }
        section.append(body);
        chevron.classList.add('changelog-chevron-open');
        first = false;
      }

      header.addEventListener('click', () => {
        const existed = !!section.querySelector('.changelog-body');
        const body = lazySection(section, '.changelog-body', () => {
          const b = el('div', { className: 'changelog-body' });
          for (const { row, originalIndex } of entries) {
            b.append(buildEntry(row, originalIndex, cols, template));
          }
          return b;
        });
        if (!existed) {
          /* first expand via lazySection — body is now visible */
          chevron.classList.add('changelog-chevron-open');
          return;
        }
        const open = !body.classList.contains('hidden');
        if (open) {
          body.classList.add('hidden');
          chevron.classList.remove('changelog-chevron-open');
        } else {
          body.classList.remove('hidden');
          chevron.classList.add('changelog-chevron-open');
        }
      });

      main.append(section);
    }

    const layout = el('div', { className: 'changelog-layout' }, [sidebar, main]);
    container.append(layout);
  },
};

registerTemplate('changelog', definition);
export default definition;
