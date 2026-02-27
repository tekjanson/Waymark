/* templates/changelog.js — Changelog: all fields editable inline */

import { el, cell, editableCell, registerTemplate } from './shared.js';

const definition = {
  name: 'Changelog',
  icon: '📋',
  color: '#374151',
  priority: 18,

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

  changeClass(val) {
    const v = (val || '').toLowerCase().trim();
    if (/^(add|added|new|feature|enhancement)/.test(v)) return 'added';
    if (/^(fix|fixed|bug|patch|hotfix)/.test(v)) return 'fixed';
    if (/^(change|changed|update|improve|refactor)/.test(v)) return 'changed';
    if (/^(break|breaking|removed|deprecated|removal)/.test(v)) return 'breaking';
    return 'other';
  },

  render(container, rows, cols, template) {
    const groups = new Map();
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const ver = cell(row, cols.version) || 'Unreleased';
      if (!groups.has(ver)) groups.set(ver, { date: '', entries: [] });
      const g = groups.get(ver);
      if (!g.date) g.date = cell(row, cols.date);
      g.entries.push({ row, originalIndex: i });
    }

    for (const [ver, { date, entries }] of groups) {
      const section = el('div', { className: 'changelog-version' });
      section.append(el('div', { className: 'changelog-version-header' }, [
        el('span', { className: 'changelog-version-tag' }, [ver]),
        date ? el('span', { className: 'changelog-version-date' }, [date]) : null,
      ]));

      for (const { row, originalIndex } of entries) {
        const rowIdx = originalIndex + 1;
        const type = cell(row, cols.type);
        const desc = cell(row, cols.description) || row[0] || '—';
        const cls = template.changeClass(type);

        section.append(el('div', { className: `changelog-entry changelog-${cls}` }, [
          cols.type >= 0
            ? editableCell('span', { className: `changelog-type-badge changelog-type-${cls}` }, type, rowIdx, cols.type)
            : null,
          editableCell('span', { className: 'changelog-desc' }, desc, rowIdx, cols.description),
        ]));
      }

      container.append(section);
    }
  },
};

registerTemplate('changelog', definition);
export default definition;
