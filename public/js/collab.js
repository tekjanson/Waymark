/* ============================================================
   collab.js — Auto-provisioned Share Ledger + social pipeline
   ------------------------------------------------------------
   Each direct-contact pair or Waymarker Crew (Group) gets ONE dedicated
   "WayMark Share Ledger" Google Sheet with four tabs:
     • Shared_Docs       — ledger of every document shared + its permission.
     • Presence          — live online/away/offline presence per user.
     • Chat              — Wayside quick-chat stream.
     • WebRTC_Signaling  — consolidated P2P offers/answers/ICE/presence.
   The ledger ID is written back into the Contacts Waymark
   (Share_Data_Sheet + Social_Data_Location). The notification sync
   engine polls Shared_Docs and pushes collaborator shares to the bell.
   ============================================================ */

import { api } from './api-client.js';
import * as userData from './user-data.js';
import * as storage from './storage.js';
import { addNotification, refreshBell } from './notifications.js';

/* ---------- Schema ---------- */

export const SHARED_DOCS_TAB = 'Shared_Docs';
export const PRESENCE_TAB = 'Presence';
export const CHAT_TAB = 'Chat';
export const SIGNALING_TAB = 'WebRTC_Signaling';

const SHARED_DOCS_HEADERS = [
  'Document_ID', 'Document_Title', 'Waymark_Type', 'Shared_With_Email',
  'Group', 'Permission_Level', 'Shared_Timestamp', 'Status',
];
const PRESENCE_HEADERS = ['User_Email', 'Display_Name', 'Group', 'Online_Status', 'Last_Heartbeat_UTC', 'Active_Waymark_ID'];
const CHAT_HEADERS = ['Message_ID', 'Timestamp_UTC', 'Sender_Email', 'Target_Group_Or_Contact', 'Message_Text', 'Attached_Waymark_Link'];
const SIGNALING_HEADERS = ['Session_ID', 'Caller_Email', 'Callee_Email', 'SDP_Offer_Answer_JSON', 'ICE_Candidates_JSON', 'Call_Status'];

/* ---------- Helpers ---------- */

/** Current signed-in user's email (lowercased), or '' when unknown. */
export function currentEmail() {
  try {
    const user = api.auth.getUser();
    return (user && user.email ? user.email : '').trim().toLowerCase();
  } catch {
    return '';
  }
}

/**
 * Give both ends of a direct contact relationship the same ledger identity.
 * Older versions used `contact:<other person's email>`, which meant each
 * account created a different sheet for the same pair.
 */
function ledgerIdentity(target = {}) {
  const group = String(target.group || '').trim();
  if (group) return { key: `group:${group.toLowerCase()}`, legacyKeys: [] };

  const contactEmail = String(target.contactEmail || '').trim().toLowerCase();
  const me = currentEmail();
  if (contactEmail && me && contactEmail !== me) {
    const emails = [me, contactEmail].sort();
    return {
      key: `contact-pair:${emails.join('::')}`,
      legacyKeys: emails.map(email => `contact:${email}`),
    };
  }

  // Preserve the previous identity when the signed-in email is unavailable.
  return { key: `contact:${contactEmail}`, legacyKeys: [] };
}

/** Deterministic Drive file name for a ledger key. */
function ledgerFileName(key) {
  return `.waymark-ledger-${key.replace(/[^a-z0-9@._:-]/g, '-')}`;
}

/* ---------- Public API ---------- */

/**
 * Find or create the shared Share Ledger for a contact pair or group, provision
 * its four tabs, grant the contact access, write the ledger ID back into the
 * Contacts Waymark, and record a local mapping.
 * @param {{ contactEmail?: string, group?: string }} target
 * @returns {Promise<{ key: string, sheetId: string }>}
 */
export async function ensureShareLedger(target) {
  const identity = ledgerIdentity(target);
  const { key } = identity;
  if (key === 'contact:') throw new Error('A contact email or group is required.');

  const existing = await findExistingShareLedger(target);
  let sheetId = existing?.sheetId || null;
  let createdHere = false;

  if (!sheetId) {
    const created = await api.sheets.createSpreadsheet(ledgerFileName(key), [SHARED_DOCS_HEADERS], null);
    sheetId = created.spreadsheetId || created.id;
    createdHere = true;
    await api.sheets.writeTab(sheetId, SHARED_DOCS_TAB, [SHARED_DOCS_HEADERS]);
    await api.sheets.writeTab(sheetId, PRESENCE_TAB, [PRESENCE_HEADERS]);
    await api.sheets.writeTab(sheetId, CHAT_TAB, [CHAT_HEADERS]);
    await api.sheets.writeTab(sheetId, SIGNALING_TAB, [SIGNALING_HEADERS]);
  }

  // Grant access when this account owns the ledger. The other end can already
  // read a discovered ledger, but may not have permission to share it onward.
  let permissionAttempted = existing?.permissionAttempted === true;
  const shouldGrantAccess = target.contactEmail && (createdHere ||
    (existing?.ownerEmail === currentEmail() && !permissionAttempted));
  if (shouldGrantAccess) {
    try {
      await api.drive.createDrivePermission(sheetId, target.contactEmail.trim().toLowerCase(), 'writer');
    } catch (err) {
      // A fresh ledger must actually be shared or the other account will be
      // left on its own sheet. Existing sheets may already grant access, or
      // may be owned by the other contact, so a repeated grant is best-effort.
      if (createdHere) throw err;
    }
    permissionAttempted = true;
  }
  if (createdHere || shouldGrantAccess) {
    await rememberShareLedger(
      target,
      identity,
      sheetId,
      existing?.ownerEmail || (createdHere ? currentEmail() : ''),
      permissionAttempted
    );
  }
  await linkLedgerToContacts(target, sheetId, existing?.mergedSheetIds || []);
  return { key, sheetId };
}

/**
 * Look up an already shared ledger without creating one. This lets a contact
 * discover the sheet the other person provisioned, even before they have a
 * local mapping of their own.
 * @param {{ contactEmail?: string, group?: string }} target
 * @returns {Promise<{key: string, sheetId: string}|null>}
 */
export async function findExistingShareLedger(target) {
  const identity = ledgerIdentity(target);
  const { key, legacyKeys } = identity;
  if (!key || key === 'contact:') return null;

  const mapped = userData.getShareLedgerFor(key);

  // Search the canonical pair name first, then both old per-contact names in
  // a stable email order. Finding every match also lets simultaneous first
  // use settle on one canonical file and merge older chat/share history.
  const candidateKeys = [key, ...legacyKeys];
  const candidates = [];
  for (const candidateKey of candidateKeys) {
    try {
      const files = await api.drive.findFilesGlobal(ledgerFileName(candidateKey));
      for (const file of files || []) if (file?.id) candidates.push(file);
    } catch {
      /* continue to other known names and local mappings */
    }
  }

  // Include a local legacy mapping that Drive search could not resolve, then
  // de-duplicate IDs. Candidate insertion order is deterministic: canonical
  // name, then old names ordered by participant email, then mapped fallbacks.
  for (const legacyKey of legacyKeys) {
    const legacy = userData.getShareLedgerFor(legacyKey);
    if (legacy?.sheetId && !candidates.some(file => file.id === legacy.sheetId)) {
      candidates.push({
        id: legacy.sheetId,
        name: ledgerFileName(legacyKey),
        owners: legacy.ownerEmail ? [{ emailAddress: legacy.ownerEmail }] : [],
      });
    }
  }
  const uniqueCandidates = candidates.filter((file, index, all) =>
    all.findIndex(candidate => candidate.id === file.id) === index
  );
  if (uniqueCandidates.length) {
    const primary = uniqueCandidates[0];
    const ownerEmail = (primary.owners || []).find(owner => owner.emailAddress)?.emailAddress?.trim().toLowerCase() || '';
    if (uniqueCandidates.length > 1) {
      await mergeLedgerHistory(primary.id, uniqueCandidates.slice(1).map(file => file.id));
    }
    const hasLegacyMapping = legacyKeys.some(legacyKey => userData.getShareLedgerFor(legacyKey));
    const permissionAttempted = mapped?.sheetId === primary.id && mapped.permissionAttempted === true;
    if (mapped?.sheetId !== primary.id || hasLegacyMapping || (ownerEmail && mapped?.ownerEmail !== ownerEmail)) {
      await rememberShareLedger(
        target,
        identity,
        primary.id,
        ownerEmail || mapped?.ownerEmail || '',
        permissionAttempted
      );
    }
    return {
      key,
      sheetId: primary.id,
      ownerEmail: ownerEmail || mapped?.ownerEmail || '',
      permissionAttempted,
      mergedSheetIds: uniqueCandidates.slice(1).map(file => file.id),
    };
  }

  // If Drive search is temporarily unavailable, keep using the already-known
  // pair mapping rather than creating another spreadsheet.
  if (mapped?.sheetId) return {
    key,
    sheetId: mapped.sheetId,
    ownerEmail: mapped.ownerEmail || '',
    permissionAttempted: mapped.permissionAttempted === true,
  };
  return null;
}

async function rememberShareLedger(target, identity, sheetId, ownerEmail = '', permissionAttempted = false) {
  await userData.addShareLedger({
    key: identity.key,
    contactEmail: target.contactEmail,
    group: target.group,
    sheetId,
    ownerEmail,
    permissionAttempted,
    aliases: identity.legacyKeys,
  });
}

/**
 * Share a document with a contact/group: provision the ledger if needed, grant
 * the contact access to the document, append the ledger record, and advance the
 * local cursor. Mirrors the task's shareDocumentWithContact(contact, doc, perms).
 * @param {{ contactEmail?: string, group?: string, docId: string, docTitle?: string, waymarkType?: string, permission?: string }} args
 * @returns {Promise<string>} the ledger sheet id
 */
export async function shareDocumentWithContact(args) {
  const { sheetId } = await ensureShareLedger(args);
  const permission = args.permission === 'writer' ? 'writer' : (args.permission || 'reader');
  const now = new Date().toISOString();
  const row = [
    args.docId || '',
    args.docTitle || '',
    args.waymarkType || '',
    (args.contactEmail || '').trim().toLowerCase(),
    args.group || '',
    permission,
    now,
    'Shared',
  ];
  await api.sheets.appendRows(sheetId, SHARED_DOCS_TAB, [row]);
  const rows = await readTab(sheetId, SHARED_DOCS_TAB);
  storage.setBilateralCursor(sheetId, rows.length);
  return sheetId;
}

/** Back-compat alias used by the share modal grant flow. */
export async function recordSharedWaymark(contactEmail, entry) {
  return shareDocumentWithContact({
    contactEmail,
    docId: entry.sheetId,
    docTitle: entry.title,
    waymarkType: entry.templateKey || entry.waymarkType || '',
    permission: entry.permission || 'reader',
  });
}

/**
 * Poll the Shared_Docs tab of every known ledger, detect documents shared with
 * the current user by a collaborator since the last seen cursor, and push them
 * to the top-bar notification bell.
 * @returns {Promise<number>} number of new notifications pushed
 */
export async function pollShareLedgers() {
  const me = currentEmail();
  const ledgers = userData.getShareLedgers();
  let pushed = 0;

  for (const l of ledgers) {
    try {
      const rows = await readTab(l.sheetId, SHARED_DOCS_TAB);
      const cursor = storage.getBilateralCursor(l.sheetId);
      if (rows.length <= cursor) {
        if (rows.length < cursor) storage.setBilateralCursor(l.sheetId, rows.length);
        continue;
      }
      for (let i = cursor; i < rows.length; i++) {
        const r = rows[i];
        const sharedWith = (r.Shared_With_Email || '').trim().toLowerCase();
        // Only notify when a collaborator shared a document WITH me.
        if (!me || sharedWith !== me) continue;
        const who = l.contactEmail || l.group || 'A collaborator';
        const notificationId = r.Shared_Timestamp
          ? `share:${r.Document_ID || ''}:${sharedWith}:${r.Shared_Timestamp}:${r.Group || ''}`
          : `${l.sheetId}:${i}`;
        addNotification({
          id: notificationId,
          type: 'share',
          title: `${who} shared "${r.Document_Title || 'a Waymark'}"`,
          body: `${r.Waymark_Type || ''} • ${r.Permission_Level || 'view'} access`.trim(),
          sheetId: r.Document_ID || '',
          from: who,
        });
        pushed++;
      }
      storage.setBilateralCursor(l.sheetId, rows.length);
    } catch {
      /* skip unreadable ledger */
    }
  }

  if (pushed) refreshBell();
  return pushed;
}

/** Back-compat alias retained for the app boot/poll cycle. */
export const pollBilateralSheets = pollShareLedgers;

/**
 * Resolve the social store (sheet + tabs) for a contact/group, provisioning the
 * ledger if needed. WS3 presence/chat/WebRTC all live in these tabs.
 * @param {{ contactEmail?: string, group?: string }} target
 * @returns {Promise<{ sheetId: string, presenceTab: string, chatTab: string, signalingTab: string }>}
 */
export async function getSocialTarget(target) {
  const { sheetId } = await ensureShareLedger(target);
  return { sheetId, presenceTab: PRESENCE_TAB, chatTab: CHAT_TAB, signalingTab: SIGNALING_TAB };
}

/** WebRTC signaling target (same bilateral ledger sheet). */
export async function getSignalingTarget(target) {
  const t = typeof target === 'string' ? { contactEmail: target } : target;
  const { sheetId } = await ensureShareLedger(t);
  return { sheetId, tab: SIGNALING_TAB };
}

/* ---------- Social: presence + chat ---------- */

/**
 * Publish the current user's presence into a ledger's Presence tab.
 * @param {{ contactEmail?: string, group?: string }} target
 * @param {{ status?: string, activeWaymarkId?: string, displayName?: string }} [opts]
 */
export async function publishPresence(target, opts = {}) {
  const { sheetId } = await ensureShareLedger(target);
  const me = currentEmail();
  const row = [
    me,
    opts.displayName || (me ? me.split('@')[0] : 'Anonymous'),
    target.group || '',
    opts.status || 'online',
    new Date().toISOString(),
    opts.activeWaymarkId || '',
  ];
  await api.sheets.appendRows(sheetId, PRESENCE_TAB, [row]);
}

/**
 * Read the latest presence per user from a ledger's Presence tab.
 * A user is "online" if their last heartbeat is within 90s, else "away".
 * @param {{ contactEmail?: string, group?: string }} target
 * @returns {Promise<Array<{ email: string, name: string, status: string }>>}
 */
export async function readPresence(target) {
  const mapped = await findExistingShareLedger(target);
  if (!mapped) return [];
  const rows = await readTab(mapped.sheetId, PRESENCE_TAB);
  const latest = new Map();
  for (const r of rows) {
    const email = (r.User_Email || '').trim().toLowerCase();
    if (!email) continue;
    const prev = latest.get(email);
    if (!prev || (r.Last_Heartbeat_UTC || '') > (prev.Last_Heartbeat_UTC || '')) latest.set(email, r);
  }
  const now = Date.now();
  return [...latest.values()].map(r => {
    const ts = Date.parse(r.Last_Heartbeat_UTC || '') || 0;
    const fresh = now - ts < 90_000;
    const declared = (r.Online_Status || '').toLowerCase();
    const status = declared === 'offline' ? 'offline' : (fresh ? (declared || 'online') : 'away');
    return { email: (r.User_Email || '').trim().toLowerCase(), name: r.Display_Name || '', status };
  });
}

/**
 * Append a chat message to a ledger's Chat tab.
 * @param {{ contactEmail?: string, group?: string }} target
 * @param {string} text
 * @param {string} [attachedLink]
 */
export async function sendChat(target, text, attachedLink = '') {
  if (!text || !text.trim()) return;
  const { sheetId } = await ensureShareLedger(target);
  const me = currentEmail();
  const row = [
    `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    new Date().toISOString(),
    me,
    target.group || target.contactEmail || '',
    text.trim(),
    attachedLink || '',
  ];
  await api.sheets.appendRows(sheetId, CHAT_TAB, [row]);
}

/**
 * Read the chat stream for a contact/group.
 * @param {{ contactEmail?: string, group?: string }} target
 * @returns {Promise<Array<{ sender: string, text: string, ts: string }>>}
 */
export async function readChat(target) {
  const mapped = await findExistingShareLedger(target);
  if (!mapped) return [];
  const rows = await readTab(mapped.sheetId, CHAT_TAB);
  const seen = new Set();
  return rows.filter(row => {
    const key = row.Message_ID || `${row.Sender_Email || ''}:${row.Timestamp_UTC || ''}:${row.Message_Text || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map(r => ({ sender: r.Sender_Email || '', text: r.Message_Text || '', ts: r.Timestamp_UTC || '' }));
}

/* ---------- Internal ---------- */

/**
 * Read a named tab as an array of objects keyed by header.
 * @param {string} sheetId
 * @param {string} tabTitle
 * @returns {Promise<Array<Object>>}
 */
async function readTab(sheetId, tabTitle) {
  const data = await api.sheets.getSpreadsheet(sheetId);
  const tab = (data.tabs || []).find(t => (t.title || '').toLowerCase() === tabTitle.toLowerCase());
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

/** Merge retained chat and sharing history when old account-specific ledgers
 * are folded into the deterministic shared ledger. Append only unseen rows. */
async function mergeLedgerHistory(primaryId, otherIds) {
  for (const tabTitle of [SHARED_DOCS_TAB, CHAT_TAB]) {
    try {
      const primary = await readTabValues(primaryId, tabTitle);
      if (!primary.length) continue;
      const seen = new Set(primary.slice(1).map(row => rowKey(tabTitle, row)));
      const additions = [];
      for (const otherId of otherIds) {
        if (otherId === primaryId) continue;
        try {
          const source = await readTabValues(otherId, tabTitle);
          for (const row of source.slice(1)) {
            const rowId = rowKey(tabTitle, row);
            if (seen.has(rowId)) continue;
            seen.add(rowId);
            additions.push(row);
          }
        } catch {
          /* The contact may not have access to every historical ledger. */
        }
      }
      if (additions.length) await api.sheets.appendRows(primaryId, tabTitle, additions);
    } catch {
      /* Keep social usable if a legacy sheet cannot be migrated. */
    }
  }
}

function rowKey(tabTitle, row) {
  if (tabTitle === CHAT_TAB && row[0]) return `id:${row[0]}`;
  return JSON.stringify(row);
}

async function readTabValues(sheetId, tabTitle) {
  const data = await api.sheets.getSpreadsheet(sheetId);
  const tab = (data.tabs || []).find(t => (t.title || '').toLowerCase() === tabTitle.toLowerCase());
  return Array.isArray(tab?.values) ? tab.values : [];
}

/**
 * Write the ledger sheet id back into the user's Contacts Waymark
 * (Share_Data_Sheet + Social_Data_Location) for the matching contact rows.
 * Best-effort: only runs when a Contacts Waymark is discoverable.
 * @param {{ contactEmail?: string, group?: string }} target
 * @param {string} sheetId
 */
async function linkLedgerToContacts(target, sheetId, previousLedgerIds = []) {
  try {
    const { TEMPLATES } = await import('./templates/index.js');
    const pool = [...userData.getPinnedSheets(), ...userData.getRecentSheets()];
    const seen = new Set();
    const books = pool.filter(s => s && s.templateKey === 'contacts' && !seen.has(s.id) && seen.add(s.id));
    const email = (target.contactEmail || '').trim().toLowerCase();
    const group = (target.group || '').trim().toLowerCase();
    const previousIds = new Set(previousLedgerIds);

    for (const book of books) {
      const data = await api.sheets.getSpreadsheet(book.id);
      const tab = (data.tabs && data.tabs[0]) || null;
      const tabTitle = (tab && tab.title) || data.sheetTitle || 'Sheet1';
      const values = (tab && tab.values) || data.values || [];
      if (values.length < 2) continue;
      const lower = (values[0] || []).map(h => (h || '').toLowerCase().trim());
      const cols = TEMPLATES.contacts.columns(lower);
      if (cols.shareSheet < 0 && cols.socialLocation < 0) continue;

      let wroteBack = false;
      for (let i = 1; i < values.length; i++) {
        const row = values[i] || [];
        const rowEmail = (cols.email >= 0 ? row[cols.email] : '').trim().toLowerCase();
        const rowGroup = (cols.group >= 0 ? row[cols.group] : '').trim().toLowerCase();
        const match = (email && rowEmail === email) || (group && rowGroup === group);
        if (!match) continue;
        const shareValue = (cols.shareSheet >= 0 ? row[cols.shareSheet] : '') || '';
        const socialValue = (cols.socialLocation >= 0 ? row[cols.socialLocation] : '') || '';
        if (cols.shareSheet >= 0 && (!shareValue.trim() || previousIds.has(shareValue.trim()))) {
          await api.sheets.updateCell(book.id, tabTitle, i, cols.shareSheet, sheetId);
          wroteBack = true;
        }
        if (cols.socialLocation >= 0 && (!socialValue.trim() || previousIds.has(socialValue.trim()))) {
          await api.sheets.updateCell(book.id, tabTitle, i, cols.socialLocation, sheetId);
          wroteBack = true;
        }
      }
      if (wroteBack) break;
    }
  } catch {
    /* non-fatal — contact write-back is a convenience */
  }
}
