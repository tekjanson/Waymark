/* ============================================================
   notification.js — Push Notification Rules template

   Renders the Push Notification Sheet AS the notification settings
   control center (the sheet view and the bell's settings panel are
   one and the same surface). The settings UI itself lives in
   notifications.js; this template bridges to it via a DOM event so
   it keeps to the templates-import-only-from-shared.js rule.
   Columns: Title | Message | Type | Status | Icon | Priority |
            Created | Expires | Source | Sheet
   ============================================================ */

import { el, registerTemplate, buildDirSyncBtn, delegateEvent } from './shared.js';

/* ---------- Helpers ---------- */

function getCurrentSheetId() {
  const m = (window.location.hash || '').match(/#\/sheet\/([^/?#]+)/);
  return m ? m[1] : '';
}

/* ---------- Template definition ---------- */

const definition = {
  name: 'Push Notification Rules',
  icon: '📲',
  color: '#7c3aed',
  priority: 22,
  hasDirectoryView: true,

  detect(lower) {
    const has = (re) => lower.some(h => re.test(h));
    const title    = has(/\btitle\b/);
    const message  = has(/\bmessage\b|\bbody\b/);
    const status   = has(/\bstatus\b/);
    const type     = has(/\btype\b/);
    const source   = has(/\bsource\b/);
    const icon     = has(/\bicon\b/);
    const created  = has(/\bcreated\b/);
    const expires  = has(/\bexpires?\b/);
    const sheetRef = has(/\bsheet\b/);

    // Canonical Waymark notification sheet: Title + Message + Status + Type.
    if (title && message && status && type) return true;
    // Push-history variants that are still unmistakably notification sheets —
    // the Source+Sheet reference pair and an Icon column are notification-specific,
    // so a sheet missing Status/Type but carrying these is still a notification sheet.
    if (title && message && source && sheetRef) return true;
    if (title && message && icon && (status || type || source || created || expires)) return true;
    return false;
  },

  columns(lower) {
    return {
      title:    lower.findIndex(h => /\btitle\b/.test(h)),
      message:  lower.findIndex(h => /\bmessage\b|\bbody\b/.test(h)),
      type:     lower.findIndex(h => /\btype\b/.test(h)),
      status:   lower.findIndex(h => /\bstatus\b/.test(h)),
      icon:     lower.findIndex(h => /\bicon\b/.test(h)),
      priority: lower.findIndex(h => /\bpriority\b/.test(h)),
      created:  lower.findIndex(h => /\bcreated\b/.test(h)),
      expires:  lower.findIndex(h => /\bexpires?\b/.test(h)),
      source:   lower.findIndex(h => /\bsource\b/.test(h)),
      sheet:    lower.findIndex(h => /\bsheet\b/.test(h)),
    };
  },

  render(container, rows, cols, template) {
    container.innerHTML = '';

    // The Push Notification Sheet view and the notification settings panel are
    // one and the same: render the full settings surface here. notifications.js
    // (initialized at app boot) owns that UI, so we bridge via an event rather
    // than importing it (templates import only from shared.js).
    const sheetId = (template && template._currentSheetId) || getCurrentSheetId();
    const detail = { container, sheetId, handled: false };
    document.dispatchEvent(new CustomEvent('waymark:render-notification-settings', { detail }));

    if (!detail.handled) {
      // Fallback only if the notification subsystem has not initialized yet.
      container.appendChild(el('div', { className: 'notification-view notification-settings-pending' }, [
        el('p', { className: 'notification-settings-pending-text' }, ['Loading notification settings…']),
      ]));
    }
  },

  directoryView(container, sheets, navigateFn) {
    const wrapper = el('div', { className: 'notification-directory tmpl-directory' });
    wrapper.append(el('div', { className: 'notification-dir-title-bar tmpl-dir-title-bar' }, [
      el('span', { className: 'tmpl-dir-icon' }, ['📲']),
      el('span', { className: 'tmpl-dir-title' }, ['Notification Sheets']),
      el('span', { className: 'tmpl-dir-count' }, [`${sheets.length} sheet${sheets.length !== 1 ? 's' : ''}`]),
      buildDirSyncBtn(wrapper),
    ]));

    const grid = el('div', { className: 'tmpl-dir-grid' });
    for (const sheet of sheets) {
      const rows = sheet.rows || [];
      grid.append(el('div', {
        className: 'tmpl-dir-card',
        dataset: { entryId: sheet.id, entryName: sheet.name },
      }, [
        el('div', { className: 'tmpl-dir-card-name' }, [sheet.name]),
        el('div', { className: 'tmpl-dir-card-stat' }, [`${rows.length} notification${rows.length !== 1 ? 's' : ''}`]),
      ]));
    }

    delegateEvent(grid, 'click', '.tmpl-dir-card', (_e, card) => {
      navigateFn('sheet', card.dataset.entryId, card.dataset.entryName);
    });

    wrapper.append(grid);
    container.append(wrapper);
  },
};

registerTemplate('notification', definition);
export default definition;
