/* ============================================================
   collab.js — Bilateral sharing sheets + notification sync
   ------------------------------------------------------------
   Each sharing contact gets ONE dedicated bilateral Google Sheet
   with two tabs:
     • Shared_Waymarks  — ledger of every Waymark shared/updated
                          between the two users.
     • WebRTC_Signaling — consolidated WebRTC handshake data
                          (offers / answers / ICE / presence).
   The notification sync engine polls Tab 1 of every bilateral
   sheet and pushes collaborator changes to the top-bar bell.
   ============================================================ */

import { api } from './api-client.js';
import * as userData from './user-data.js';
import * as storage from './storage.js';
import { addNotification, refreshBell } from './notifications.js';

/* ---------- Schema ---------- */

export const SHARED_TAB = 'Shared_Waymarks';
export const SIGNALING_TAB = 'WebRTC_Signaling';

const SHARED_HEADERS = [
  'sheet_id', 'title', 'shared_by', 'shared_at',
  'last_updated_at', 'last_updated_by', 'change_type', 'summary',
];
const SIGNALING_HEADERS = ['peer_id', 'type', 'payload', 'updated_at'];

/* ---------- Helpers ---------- */

/** Current signed-in user's email (lowercased), or '' when unknown. */
function currentEmail() {
  try {
    const user = api.auth.getUser();
    return (user && user.email ? user.email : '').trim().toLowerCase();
  } catch {
    return '';
  }
}

/** Deterministic, order-independent name for the pair's bilateral sheet. */
function bilateralName(me, contactEmail) {
  const pair = [me, contactEmail].filter(Boolean).sort();
  const key = pair.join('__').replace(/[^a-z0-9@._-]/g, '-');
  return `.waymark-share-${key}`;
}

/* ---------- Public API ---------- */

/**
 * Find or create the dedicated bilateral sharing sheet between the current
 * user and a contact. Creates the two-tab schema, grants the contact access,
 * records a local mapping, and references the contact in Contacts.
 * @param {string} contactEmail
 * @returns {Promise<{ contactEmail: string, sheetId: string }>}
 */
export async function ensureBilateralSheet(contactEmail) {
  const email = (contactEmail || '').trim().toLowerCase();
  if (!email) throw new Error('A contact email is required.');

  // 1. Local mapping — fastest path, already provisioned.
  const mapped = userData.getBilateralSheetFor(email);
  if (mapped) return { contactEmail: email, sheetId: mapped.sheetId };

  // 2. Drive search — a sheet may already exist (e.g. the other user made it).
  const me = currentEmail();
  const name = bilateralName(me, email);
  let sheetId = null;
  try {
    const found = await api.drive.findFileGlobal(name);
    if (found && found.id) sheetId = found.id;
  } catch {
    /* fall through to create */
  }

  // 3. Create the two-tab sheet and grant the contact access.
  if (!sheetId) {
    const created = await api.sheets.createSpreadsheet(name, [SHARED_HEADERS], null);
    sheetId = created.spreadsheetId || created.id;
    await api.sheets.writeTab(sheetId, SHARED_TAB, [SHARED_HEADERS]);
    await api.sheets.writeTab(sheetId, SIGNALING_TAB, [SIGNALING_HEADERS]);
    try {
      await api.drive.createDrivePermission(sheetId, email, 'writer');
    } catch {
      /* permission grant is best-effort — mapping still useful locally */
    }
  }

  await userData.addBilateralSheet({ contactEmail: email, sheetId });
  await referenceContact(email, sheetId);
  return { contactEmail: email, sheetId };
}

/**
 * Append a share/update entry to Tab 1 (Shared_Waymarks) of the bilateral
 * sheet for a contact, provisioning the sheet first if needed.
 * @param {string} contactEmail
 * @param {{ sheetId: string, title?: string, changeType?: string, summary?: string }} entry
 * @returns {Promise<string>} the bilateral sheet id
 */
export async function recordSharedWaymark(contactEmail, entry) {
  const { sheetId: bilateralId } = await ensureBilateralSheet(contactEmail);
  const me = currentEmail();
  const now = new Date().toISOString();
  const row = [
    entry.sheetId || '',
    entry.title || '',
    me,
    now,
    now,
    me,
    entry.changeType || 'shared',
    entry.summary || '',
  ];
  await api.sheets.appendRows(bilateralId, SHARED_TAB, [row]);
  // Advance our own cursor so we never notify ourselves about our own writes.
  const data = await _readShared(bilateralId);
  storage.setBilateralCursor(bilateralId, data.length);
  return bilateralId;
}

/**
 * Poll Tab 1 of every bilateral sheet, detect entries written by collaborators
 * since the last seen state, and push them to the top-bar notification bell.
 * @returns {Promise<number>} number of new notifications pushed
 */
export async function pollBilateralSheets() {
  const me = currentEmail();
  const sheets = userData.getBilateralSheets();
  let pushed = 0;

  for (const b of sheets) {
    try {
      const rows = await _readShared(b.sheetId);
      const cursor = storage.getBilateralCursor(b.sheetId);
      if (rows.length <= cursor) {
        // Keep the cursor in sync if the sheet shrank/reset.
        if (rows.length < cursor) storage.setBilateralCursor(b.sheetId, rows.length);
        continue;
      }
      for (let i = cursor; i < rows.length; i++) {
        const r = rows[i];
        const author = (r.last_updated_by || r.shared_by || '').trim().toLowerCase();
        // Only notify about changes the collaborator made, not our own.
        if (author && author === me) continue;
        const who = b.contactEmail;
        const verb = r.change_type === 'updated' ? 'updated' : 'shared';
        addNotification({
          id: `${b.sheetId}:${i}`,
          type: 'share',
          title: `${who} ${verb} "${r.title || 'a Waymark'}"`,
          body: r.summary || '',
          sheetId: r.sheet_id || '',
          from: who,
        });
        pushed++;
      }
      storage.setBilateralCursor(b.sheetId, rows.length);
    } catch {
      /* skip unreadable bilateral sheet */
    }
  }

  if (pushed) refreshBell();
  return pushed;
}

/**
 * Resolve the WebRTC signaling target (sheet + tab) for a contact, so social
 * WebRTC features exchange offers/answers/ICE/presence on the SAME bilateral
 * sheet rather than a separate signaling mechanism.
 * @param {string} contactEmail
 * @returns {Promise<{ sheetId: string, tab: string }>}
 */
export async function getSignalingTarget(contactEmail) {
  const { sheetId } = await ensureBilateralSheet(contactEmail);
  return { sheetId, tab: SIGNALING_TAB };
}

/* ---------- Internal ---------- */

/**
 * Read the Shared_Waymarks tab as an array of objects keyed by header.
 * @param {string} bilateralId
 * @returns {Promise<Array<Object>>}
 */
async function _readShared(bilateralId) {
  const data = await api.sheets.getSpreadsheet(bilateralId);
  const tab = (data.tabs || []).find(t => (t.title || '').toLowerCase() === SHARED_TAB.toLowerCase());
  const values = (tab && tab.values) || [];
  if (values.length < 2) return [];
  const headers = values[0].map(h => (h || '').trim());
  return values.slice(1)
    .filter(row => row.some(c => (c || '').trim()))
    .map(row => {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = row[i] || ''; });
      return obj;
    });
}

/**
 * Add/annotate the contact in the user's Contacts Waymark with a reference to
 * the bilateral sharing sheet id. Best-effort: only runs when a Contacts
 * Waymark is discoverable and the contact is not already listed.
 * @param {string} email
 * @param {string} bilateralId
 */
async function referenceContact(email, bilateralId) {
  try {
    const { TEMPLATES } = await import('./templates/index.js');
    const pool = [...userData.getPinnedSheets(), ...userData.getRecentSheets()];
    const book = pool.find(s => s && s.templateKey === 'contacts');
    if (!book) return;

    const data = await api.sheets.getSpreadsheet(book.id);
    const tab = (data.tabs && data.tabs[0]) || null;
    const tabTitle = (tab && tab.title) || data.sheetTitle || 'Sheet1';
    const values = (tab && tab.values) || data.values || [];
    const headers = values[0] && values[0].length
      ? values[0]
      : (TEMPLATES.contacts.defaultHeaders || ['Name', 'Phone', 'Email', 'Role']);
    const lower = headers.map(h => (h || '').toLowerCase().trim());
    const cols = TEMPLATES.contacts.columns(lower);
    const emailCol = cols.email >= 0 ? cols.email : -1;
    if (emailCol < 0) return;

    const already = values.slice(1).some(r => (r[emailCol] || '').trim().toLowerCase() === email);
    if (already) return;

    const width = headers.length;
    const row = new Array(width).fill('');
    if (cols.name >= 0) row[cols.name] = email.split('@')[0];
    row[emailCol] = email;
    if (cols.role >= 0) row[cols.role] = `Shared via ${bilateralId}`;
    await api.sheets.appendRows(book.id, tabTitle, [row]);
  } catch {
    /* non-fatal — contact referencing is a convenience */
  }
}
