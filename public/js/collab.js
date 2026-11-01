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
import { addNotification, refreshBell, flushNotificationSheetWrites, pollNotificationSheet, setShareActionDelegate } from './notifications.js';
import { discoverDirectory, isCandidateContactsBook, extractLedgerSheetId, normalizeContactEmail } from './contacts-picker.js';

/* ---------- Schema ---------- */
const SHARED_DOCS_TAB = 'Shared_Docs';
const PRESENCE_TAB = 'Presence';
const CHAT_TAB = 'Chat';
const SIGNALING_TAB = 'WebRTC_Signaling';

const SHARED_DOCS_HEADERS = [
  'Document_ID', 'Document_Title', 'Waymark_Type', 'Shared_With_Email',
  'Group', 'Permission_Level', 'Shared_Timestamp', 'Status',
];
const PRESENCE_HEADERS = ['User_Email', 'Display_Name', 'Group', 'Online_Status', 'Last_Heartbeat_UTC', 'Active_Waymark_ID'];
const CHAT_HEADERS = ['Message_ID', 'Timestamp_UTC', 'Sender_Email', 'Target_Group_Or_Contact', 'Message_Text', 'Attached_Waymark_Link'];
const SIGNALING_HEADERS = ['Session_ID', 'Caller_Email', 'Callee_Email', 'SDP_Offer_Answer_JSON', 'ICE_Candidates_JSON', 'Call_Status'];

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

/**
 * Give both ends of a direct contact relationship the same ledger identity.
 * Older versions used `contact:<other person's email>`, which meant each
 * account created a different sheet for the same pair.
 *
 * Legacy per-contact names split into two classes:
 *   • `contact:<other party>` uniquely identifies THIS pair, so it is safe to
 *     resolve by name in a global Drive search.
 *   • `selfLegacyKeys` — `contact:<me>` does NOT identify the other party (any
 *     Waymarker who added me created a sheet by that exact name), so a global
 *     match must be participant-verified before it is trusted. Skipping this
 *     check lets an unrelated contact's — or the AI's — chat load the wrong
 *     ledger (see findExistingShareLedger).
 */
function ledgerIdentity(target = {}) {
  const group = String(target.group || '').trim();
  if (group) {
    return { key: `group:${group.toLowerCase()}`, legacyKeys: [], selfLegacyKeys: [], contactEmail: '' };
  }

  const contactEmail = String(target.contactEmail || '').trim().toLowerCase();
  const me = currentEmail();
  if (contactEmail && me && contactEmail !== me) {
    const emails = [me, contactEmail].sort();
    return {
      key: `contact-pair:${emails.join('::')}`,
      legacyKeys: emails.map(email => `contact:${email}`),
      selfLegacyKeys: [`contact:${me}`],
      contactEmail,
    };
  }

  // Preserve the previous identity when the signed-in email is unavailable.
  return { key: `contact:${contactEmail}`, legacyKeys: [], selfLegacyKeys: [], contactEmail };
}

/**
 * Confirm a discovered ledger file actually belongs to a pair with `contactEmail`.
 * Used to vet `contact:<me>`-named legacy sheets, whose name alone cannot prove
 * which other participant they belong to.
 * @param {{ id: string, owners?: Array<{emailAddress?: string}> }} file
 * @param {string} contactEmail
 * @returns {Promise<boolean>}
 */
async function ledgerInvolvesContact(file, contactEmail) {
  const needle = String(contactEmail || '').trim().toLowerCase();
  if (!needle || !file?.id) return false;

  // Fast path: Drive owner metadata already returned by the search.
  const owners = Array.isArray(file.owners) ? file.owners : [];
  if (owners.some(o => String(o?.emailAddress || '').trim().toLowerCase() === needle)) return true;

  // Otherwise inspect the ledger's own participant columns.
  try {
    const data = await api.sheets.getSpreadsheet(file.id);
    const scan = [
      [CHAT_TAB, 'Sender_Email'],
      [PRESENCE_TAB, 'User_Email'],
      [SHARED_DOCS_TAB, 'Shared_With_Email'],
    ];
    for (const [tab, col] of scan) {
      for (const row of tabRowsFromData(data, tab)) {
        if (String(row[col] || '').trim().toLowerCase() === needle) return true;
      }
    }
  } catch {
    /* an unreadable ledger cannot be verified as this pair's */
  }
  return false;
}

/** Deterministic Drive file name for a ledger key. */
function ledgerFileName(key) {
  return `.waymark-ledger-${key.replace(/[^a-z0-9@._:-]/g, '-')}`;
}

/**
 * Resolve all recipient emails for a 1:1 contact or a Waymarker Crew (group).
 * Excludes the current signed-in user's own email.
 * @param {{ contactEmail?: string, group?: string, memberEmails?: string[] }} target
 * @returns {Promise<string[]>}
 */
async function resolveTargetEmails(target = {}) {
  const me = currentEmail();
  const out = new Set();

  if (target.contactEmail) {
    const e = String(target.contactEmail).trim().toLowerCase();
    if (e && e !== me) out.add(e);
  }
  if (Array.isArray(target.memberEmails)) {
    for (const raw of target.memberEmails) {
      const e = String(raw || '').trim().toLowerCase();
      if (e && e !== me) out.add(e);
    }
  }
  if (target.group) {
    try {
      const groupKey = String(target.group).trim().toLowerCase();
      const { crews } = await discoverDirectory();
      const match = crews.find(c => c.name.trim().toLowerCase() === groupKey);
      if (match) {
        for (const m of match.members || []) {
          const e = (m.email || '').trim().toLowerCase();
          if (e && e !== me) out.add(e);
        }
      }
    } catch {
      /* directory lookup is best-effort */
    }
  }
  return [...out].filter(e => !e.endsWith('.internal') && !e.endsWith('.local'));
}

/* ---------- Public API ---------- */

/**
 * Find or create the shared Share Ledger for a contact pair or group, provision
 * its four tabs, grant the contact access, write the ledger ID back into the
 * Contacts Waymark, and record a local mapping.
 * @param {{ contactEmail?: string, group?: string }} target
 * @returns {Promise<{ key: string, sheetId: string }>}
 */
async function ensureShareLedger(target) {
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

  // Always persist the ledger mapping and link back to Contacts immediately
  // so a subsequent permission error never strands an unmapped ledger sheet.
  const ownerEmail = existing?.ownerEmail || (createdHere ? currentEmail() : '');
  if (createdHere) {
    await rememberShareLedger(target, identity, sheetId, ownerEmail, false);
  }
  await linkLedgerToContacts(target, sheetId, existing?.mergedSheetIds || []);

  // Grant access when this account owns the ledger. The other end can already
  // read a discovered ledger, but may not have permission to share it onward.
  let permissionAttempted = existing?.permissionAttempted === true;
  const recipientEmails = await resolveTargetEmails(target);
  const shouldGrantAccess = recipientEmails.length > 0 && (createdHere ||
    (existing?.ownerEmail === currentEmail() && !permissionAttempted));
  if (shouldGrantAccess) {
    let firstErr = null;
    for (const email of recipientEmails) {
      try {
        await api.drive.createDrivePermission(sheetId, email, 'writer');
      } catch (err) {
        if (!firstErr) firstErr = err;
      }
    }
    permissionAttempted = !firstErr;
    await rememberShareLedger(target, identity, sheetId, ownerEmail, permissionAttempted);
    if (firstErr && createdHere && target.contactEmail) throw firstErr;
  }
  return { key, sheetId };
}

/**
 * Look up an already shared ledger without creating one. This lets a contact
 * discover the sheet the other person provisioned, even before they have a
 * local mapping of their own.
 * @param {{ contactEmail?: string, group?: string }} target
 * @returns {Promise<{key: string, sheetId: string}|null>}
 */
async function findExistingShareLedger(target) {
  const identity = ledgerIdentity(target);
  const { key, legacyKeys } = identity;
  if (!key || key === 'contact:') return null;

  const mapped = userData.getShareLedgerFor(key);

  // Search the canonical pair name first, then both old per-contact names in the
  // SAME stable email-sorted order both accounts compute, so simultaneous first
  // use settles on one canonical primary file and merges older chat/share history.
  const candidates = [];
  try {
    const files = await api.drive.findFilesGlobal(ledgerFileName(key));
    for (const file of files || []) if (file?.id) candidates.push(file);
  } catch {
    /* continue to other known names and local mappings */
  }

  // `contact:<other party>` uniquely identifies this pair, but `contact:<me>` is
  // ambiguous: every Waymarker who ever added me created a file by that exact
  // name, so a bare name match can surface a stranger's — or the AI companion's —
  // chat. Keep a self-named match only when its participants include the target.
  const selfLegacy = new Set(identity.selfLegacyKeys || []);
  for (const legacyKey of legacyKeys) {
    try {
      const files = await api.drive.findFilesGlobal(ledgerFileName(legacyKey));
      for (const file of files || []) {
        if (!file?.id || candidates.some(c => c.id === file.id)) continue;
        if (selfLegacy.has(legacyKey) && !(await ledgerInvolvesContact(file, identity.contactEmail))) continue;
        candidates.push(file);
      }
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

  // Fallback: check if the user's Contacts Waymark already has a Share_Data_Sheet
  // or Social_Data_Location ID recorded for this contact or group.
  try {
    const dir = await discoverDirectory();
    const targetEmail = String(target.contactEmail || '').trim().toLowerCase();
    const targetGroup = String(target.group || '').trim().toLowerCase();
    let fromContactsId = '';
    if (targetGroup) {
      const crewMatch = (dir.crews || []).find(c => (c.name || '').trim().toLowerCase() === targetGroup && c.ledgerSheetId);
      if (crewMatch?.ledgerSheetId) fromContactsId = crewMatch.ledgerSheetId;
    } else if (targetEmail) {
      const contactMatch = (dir.contacts || []).find(c => (c.email || '').trim().toLowerCase() === targetEmail && c.ledgerSheetId);
      if (contactMatch?.ledgerSheetId) fromContactsId = contactMatch.ledgerSheetId;
    }
    if (fromContactsId) {
      const checkData = await api.sheets.getSpreadsheet(fromContactsId);
      const hasSharedDocsTab = Array.isArray(checkData?.tabs) && checkData.tabs.some(
        t => (t.title || '').toLowerCase() === SHARED_DOCS_TAB.toLowerCase()
      );
      if (hasSharedDocsTab) {
        await rememberShareLedger(target, identity, fromContactsId, '', false);
        return {
          key,
          sheetId: fromContactsId,
          ownerEmail: '',
          permissionAttempted: false,
        };
      }
    }
  } catch {
    /* directory fallback is best-effort */
  }

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
 * Register a shared ledger discovered via an invite deep-link (`?ledger=...`) or
 * selected by the recipient in Google Picker (required under `drive.file` scope).
 * Infers contactEmail or group from the sheet metadata/contents when not supplied.
 * @param {{ sheetId: string, contactEmail?: string, group?: string, ownerEmail?: string, fileName?: string }} args
 * @returns {Promise<{ key: string, sheetId: string, target: { contactEmail?: string, group?: string } }>}
 */
async function registerSharedLedger(args = {}) {
  const sheetId = String(args.sheetId || '').trim();
  if (!sheetId) throw new Error('A ledger sheetId is required.');

  const me = currentEmail();
  let contactEmail = String(args.contactEmail || '').trim().toLowerCase();
  let group = String(args.group || '').trim();
  let title = String(args.fileName || '').trim();

  if (!contactEmail && !group) {
    try {
      const data = await api.sheets.getSpreadsheet(sheetId);
      title = title || String(data.title || '').trim();
      const lowerTitle = title.toLowerCase();
      if (lowerTitle.startsWith('.waymark-ledger-group:')) {
        group = title.slice('.waymark-ledger-group:'.length).replace(/-/g, ' ').trim();
      } else if (lowerTitle.startsWith('.waymark-ledger-contact-pair:')) {
        const pairPart = lowerTitle.slice('.waymark-ledger-contact-pair:'.length);
        const parts = pairPart.split('::').map(s => s.trim()).filter(Boolean);
        contactEmail = parts.find(e => e !== me) || parts[0] || '';
      } else if (lowerTitle.startsWith('.waymark-ledger-contact:')) {
        const single = lowerTitle.slice('.waymark-ledger-contact:'.length).trim();
        if (single && single !== me) contactEmail = single;
      }
      if (!contactEmail && !group) {
        const chatRows = await readTab(sheetId, CHAT_TAB);
        const otherChat = chatRows.find(r => r.Sender_Email && r.Sender_Email.trim().toLowerCase() !== me);
        if (otherChat) contactEmail = otherChat.Sender_Email.trim().toLowerCase();
      }
    } catch {
      /* best-effort metadata inspection */
    }
  }

  const target = group
    ? { group }
    : { contactEmail: contactEmail || 'collaborator@waymark.local' };
  const identity = ledgerIdentity(target);
  await rememberShareLedger(target, identity, sheetId, args.ownerEmail || contactEmail || '', false);
  await linkLedgerToContacts(target, sheetId);
  await pollShareLedgers();
  return { key: identity.key, sheetId, target };
}

/**
 * Open Google Picker so the user can select and authorize a `.waymark-ledger-*`
 * spreadsheet shared with them by a collaborator (`drive.file` scope flow).
 * @param {{ contactEmail?: string, group?: string }} [targetHint]
 * @returns {Promise<Array<{ key: string, sheetId: string }>>}
 */
async function connectSharedLedgerViaPicker(targetHint = {}) {
  const picked = await api.picker.pickSharedFiles({
    query: '.waymark-ledger-',
    title: 'Connect Shared Waymark Ledger',
    multiSelect: true,
  });
  if (!picked || !picked.length) return [];
  const registered = [];
  for (const file of picked) {
    if (!file?.id) continue;
    const res = await registerSharedLedger({
      sheetId: file.id,
      fileName: file.name || '',
      contactEmail: targetHint.contactEmail,
      group: targetHint.group,
    });
    registered.push(res);
  }
  return registered;
}

/**
 * Share a document with a contact/group: provision the ledger if needed, grant
 * the contact (or all crew members) access to the document, append the ledger
 * record(s), and advance the local cursor.
 * @param {{ contactEmail?: string, group?: string, memberEmails?: string[], docId: string, docTitle?: string, waymarkType?: string, permission?: string }} args
 * @returns {Promise<string>} the ledger sheet id
 */
async function shareDocumentWithContact(args) {
  const { sheetId } = await ensureShareLedger(args);
  const permission = args.permission === 'writer' ? 'writer' : (args.permission || 'reader');
  const now = new Date().toISOString();
  const recipientEmails = await resolveTargetEmails(args);

  // When sharing with a Waymarker Crew (group), grant Drive access to every
  // crew member on the shared document and log a row per member so each member's
  // bell notification fires when polling the crew ledger.
  if (args.group && recipientEmails.length > 0 && args.docId) {
    for (const email of recipientEmails) {
      try {
        await api.drive.createDrivePermission(args.docId, email, permission);
      } catch {
        /* best-effort per crew member */
      }
    }
    const rowsToAppend = recipientEmails.map(email => [
      args.docId || '',
      args.docTitle || '',
      args.waymarkType || '',
      email,
      args.group || '',
      permission,
      now,
      'Shared',
    ]);
    await api.sheets.appendRows(sheetId, SHARED_DOCS_TAB, rowsToAppend);
  } else {
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
  }

  const rows = await readTab(sheetId, SHARED_DOCS_TAB);
  const me = currentEmail();
  storage.setBilateralCursor(sheetId, rows.length);
  if (me) storage.setBilateralCursor(`${me}:${sheetId}`, rows.length);

  if (args.docId) {
    storage.recordSharedDocLedger(args.docId, {
      ledgerSheetId: sheetId,
      contactEmail: (args.contactEmail || '').trim().toLowerCase(),
      group: args.group || '',
      docTitle: args.docTitle || '',
      waymarkType: args.waymarkType || '',
    });
    try {
      const docData = await api.sheets.getSpreadsheet(args.docId);
      const vals = (docData.tabs && docData.tabs[0] && docData.tabs[0].values) || docData.values || [];
      if (vals.length) storage.setSheetDigest(args.docId, computeSheetDigest(vals));
    } catch {
      /* best-effort initial digest */
    }
  }
  return sheetId;
}

/** Back-compat alias used by the share modal grant flow. */
async function recordSharedWaymark(contactEmail, entry) {
  return shareDocumentWithContact({
    contactEmail,
    docId: entry.sheetId,
    docTitle: entry.title,
    waymarkType: entry.templateKey || entry.waymarkType || '',
    permission: entry.permission || 'reader',
  });
}

/**
 * Infer counterparty email or group for a ledger entry relative to current user.
 * @param {Object} ledger
 * @param {Array<Object>} [rows]
 * @returns {{ contactEmail: string, group: string }}
 */
function resolveLedgerCounterparty(ledger = {}, rows = []) {
  const me = currentEmail();
  const group = String(ledger.group || '').trim();
  if (group) return { contactEmail: '', group };

  let email = String(ledger.contactEmail || '').trim().toLowerCase();
  if (email && email !== me) return { contactEmail: email, group: '' };

  const key = String(ledger.key || '').trim().toLowerCase();
  if (key.startsWith('contact-pair:')) {
    const parts = key.slice('contact-pair:'.length).split('::').map(s => s.trim()).filter(Boolean);
    const other = parts.find(p => p !== me) || parts[0] || '';
    if (other) return { contactEmail: other, group: '' };
  } else if (key.startsWith('contact:')) {
    const single = key.slice('contact:'.length).trim();
    if (single && single !== me) return { contactEmail: single, group: '' };
  }

  if (ledger.ownerEmail && String(ledger.ownerEmail).trim().toLowerCase() !== me) {
    return { contactEmail: String(ledger.ownerEmail).trim().toLowerCase(), group: '' };
  }

  for (const r of rows) {
    const sharedWith = String(r.Shared_With_Email || '').trim().toLowerCase();
    if (sharedWith && sharedWith !== me) return { contactEmail: sharedWith, group: '' };
    const status = String(r.Status || '').trim();
    if (status.startsWith('Updated|')) {
      const actor = (status.split('|')[1] || '').trim().toLowerCase();
      if (actor && actor !== me) return { contactEmail: actor, group: '' };
    }
  }

  return { contactEmail: email, group: '' };
}

/**
 * Find all Share Ledgers associated with a shared Waymark document ID.
 * Checks local cache first and falls back to scanning known Share Ledgers.
 * @param {string} docId
 * @returns {Promise<Array<{ ledgerSheetId: string, contactEmail?: string, group?: string, docTitle?: string, waymarkType?: string }>>}
 */
async function findLedgersForDocument(docId) {
  if (!docId) return [];
  const cached = storage.getSharedDocLedgers(docId);
  const bySheetId = new Map();
  for (const c of cached) {
    if (c?.ledgerSheetId) bySheetId.set(c.ledgerSheetId, { ...c });
  }

  const ledgers = userData.getShareLedgers();
  for (const l of ledgers) {
    if (!l?.sheetId) continue;
    try {
      const rows = await readTab(l.sheetId, SHARED_DOCS_TAB);
      const match = rows.find(r => (r.Document_ID || '').trim() === docId);
      if (match) {
        const cp = resolveLedgerCounterparty(l, rows);
        const entry = {
          ledgerSheetId: l.sheetId,
          contactEmail: cp.contactEmail || '',
          group: cp.group || match.Group || '',
          docTitle: match.Document_Title || '',
          waymarkType: match.Waymark_Type || '',
        };
        bySheetId.set(l.sheetId, entry);
        storage.recordSharedDocLedger(docId, entry);
      }
    } catch {
      /* skip unreadable ledger */
    }
  }

  return [...bySheetId.values()];
}

/**
 * Compute a lightweight content digest for a sheet's 2D values array.
 * Used to detect external Google Sheets edits on shared Waymarks.
 * @param {string[][]} values
 * @returns {{ rowCount: number, hash: string, updatedAt: string }}
 */
function computeSheetDigest(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return { rowCount: 0, hash: '0:0', updatedAt: new Date().toISOString() };
  }
  const rows = values.slice(1);
  let hashNum = 5381;
  for (let r = 0; r < values.length; r++) {
    const row = values[r] || [];
    for (let c = 0; c < row.length; c++) {
      const cell = String(row[c] ?? '');
      for (let k = 0; k < cell.length; k++) {
        hashNum = ((hashNum << 5) + hashNum + cell.charCodeAt(k)) | 0;
      }
      hashNum = ((hashNum << 5) + hashNum + 31) | 0;
    }
  }
  return {
    rowCount: rows.length,
    hash: `${rows.length}:${hashNum >>> 0}`,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Record a Waymark change in all Share Ledgers where the document is shared,
 * advance the author's own bilateral cursor, and broadcast to live peers.
 * @param {{ docId: string, docTitle?: string, waymarkType?: string, summary: string, contactEmail?: string, group?: string, actorEmail?: string }} args
 * @returns {Promise<number>} number of ledgers updated
 */
async function recordWaymarkActivity(args = {}) {
  const docId = String(args.docId || '').trim();
  if (!docId) return 0;

  const actor = String(args.actorEmail || currentEmail() || 'collaborator').trim().toLowerCase();
  const cleanSummary = String(args.summary || 'Updated Waymark').replace(/\|/g, '/').trim();
  const now = new Date().toISOString();

  let targets = await findLedgersForDocument(docId);
  if ((args.contactEmail || args.group) && !targets.length) {
    const { sheetId } = await ensureShareLedger({ contactEmail: args.contactEmail, group: args.group });
    const entry = {
      ledgerSheetId: sheetId,
      contactEmail: (args.contactEmail || '').trim().toLowerCase(),
      group: args.group || '',
      docTitle: args.docTitle || '',
      waymarkType: args.waymarkType || '',
    };
    storage.recordSharedDocLedger(docId, entry);
    targets = [entry];
  }

  if (!targets.length) return 0;

  let updatedLedgers = 0;
  for (const t of targets) {
    if (!t?.ledgerSheetId) continue;
    try {
      const ledgerEntry = userData.getShareLedgers().find(l => l.sheetId === t.ledgerSheetId) || {};
      const cp = resolveLedgerCounterparty(
        { ...ledgerEntry, contactEmail: t.contactEmail || ledgerEntry.contactEmail, group: t.group || ledgerEntry.group },
        []
      );
      const groupName = cp.group || t.group || '';
      const recipientEmail = cp.contactEmail || t.contactEmail || '';
      const row = [
        docId,
        args.docTitle || t.docTitle || 'Shared Waymark',
        args.waymarkType || t.waymarkType || '',
        recipientEmail,
        groupName,
        'writer',
        now,
        `Updated|${actor}|${cleanSummary}`,
      ];
      await api.sheets.appendRows(t.ledgerSheetId, SHARED_DOCS_TAB, [row]);
      const rows = await readTab(t.ledgerSheetId, SHARED_DOCS_TAB);
      if (actor) storage.setBilateralCursor(`${actor}:${t.ledgerSheetId}`, rows.length);
      updatedLedgers++;
    } catch {
      /* best-effort per ledger */
    }
  }

  if (updatedLedgers > 0 && typeof BroadcastChannel !== 'undefined') {
    try {
      const bc = new BroadcastChannel('waymark-collab-updates');
      bc.postMessage({
        type: 'waymark-sheet-update',
        id: `update:${docId}:${now}:${actor}`,
        sheetId: docId,
        docTitle: args.docTitle || targets[0]?.docTitle || 'Shared Waymark',
        waymarkType: args.waymarkType || targets[0]?.waymarkType || '',
        summary: cleanSummary,
        from: actor,
        ts: now,
      });
      bc.close();
    } catch {
      /* ignore BroadcastChannel errors */
    }
  }

  return updatedLedgers;
}

/**
 * High-level helper invoked by checklist.js when cells are edited or rows are added
 * on a Waymark sheet. Formats a human-readable summary and pushes to shared ledgers.
 * @param {{ docId: string, docTitle?: string, waymarkType?: string, action?: 'edit'|'add', rowLabel?: string, columnHeader?: string, newValue?: string, summary?: string }} info
 * @returns {Promise<number>}
 */
async function notifySheetMutation(info = {}) {
  const docId = String(info.docId || '').trim();
  if (!docId) return 0;

  let summary = info.summary || '';
  if (!summary) {
    const label = String(info.rowLabel || '').trim();
    const col = String(info.columnHeader || '').trim();
    const val = String(info.newValue ?? '').trim();
    if (info.action === 'add') {
      summary = label ? `Added "${label}"` : 'Added a new item';
    } else if (label && col && val) {
      summary = `Updated "${label}" (${col} → ${val})`;
    } else if (label && col) {
      summary = `Updated "${label}" (${col})`;
    } else if (label && val) {
      summary = `Updated "${label}" → ${val}`;
    } else if (label) {
      summary = `Updated "${label}"`;
    } else if (col && val) {
      summary = `Updated ${col} to "${val}"`;
    } else {
      summary = 'Updated Waymark';
    }
  }

  return recordWaymarkActivity({
    docId,
    docTitle: info.docTitle || '',
    waymarkType: info.waymarkType || '',
    summary,
  });
}

/**
 * Accept an incoming shared Waymark:
 * - Marks the document as accepted in local storage (and removes from rejected/hidden).
 * - Adds the document to Recent Sheets so it appears on the Wayboard & Explorer.
 * - Updates the Shared_Docs row Status to "Accepted" in the Share Ledger.
 * - Updates the notification item state and connected Push Notification Sheet.
 * @param {{ docId: string, docTitle?: string, waymarkType?: string, ledgerSheetId?: string, from?: string }} args
 * @returns {Promise<boolean>}
 */
async function acceptSharedWaymark(args = {}) {
  const docId = String(args.docId || '').trim();
  if (!docId) return false;

  let docTitle = String(args.docTitle || '').trim();
  let waymarkType = String(args.waymarkType || '').trim();

  // Under the `drive.file` scope the recipient can only read a shared sheet once
  // they have authorised it through Google Picker. Try a plain read first; if it
  // fails, open the Picker pre-filtered to this file. Cancelling the Picker keeps
  // the share pending (nothing is marked accepted).
  let docData = null;
  try {
    docData = await api.sheets.getSpreadsheet(docId);
  } catch {
    if (args.authorizeViaPicker === false) {
      docData = null;
    } else {
      const picked = await api.picker.pickSpreadsheetForInvite({
        fileId: docId,
        fileName: docTitle,
      });
      if (!picked?.id) return false;
      if (!docTitle && picked.name) docTitle = picked.name;
      try {
        docData = await api.sheets.getSpreadsheet(docId);
      } catch {
        docData = null; // accepted, but contents still unreadable — digest skipped
      }
    }
  }

  storage.addAcceptedShare(docId);
  storage.removeRejectedShare(docId);
  await userData.removeHiddenItem(docId);

  try {
    if (!docTitle && docData?.title) docTitle = docData.title;
    const vals = (docData?.tabs?.[0]?.values) || docData?.values || [];
    if (vals.length) {
      storage.setSheetDigest(docId, computeSheetDigest(vals));
      if (!waymarkType) {
        const { detectTemplate } = await import('./templates/index.js');
        waymarkType = detectTemplate(vals[0] || []).key || '';
      }
    }
  } catch {
    /* best-effort sheet inspection */
  }

  await userData.addRecentSheet({
    id: docId,
    name: docTitle || 'Shared Waymark',
    templateKey: waymarkType || '',
  });

  const ledgerIds = new Set();
  if (args.ledgerSheetId) ledgerIds.add(args.ledgerSheetId);
  const discovered = await findLedgersForDocument(docId);
  for (const d of discovered) if (d.ledgerSheetId) ledgerIds.add(d.ledgerSheetId);

  for (const lId of ledgerIds) {
    try {
      const vals = await readTabValues(lId, SHARED_DOCS_TAB);
      for (let r = 1; r < vals.length; r++) {
        const row = vals[r] || [];
        const rowDocId = String(row[0] || '').trim();
        const rowStatus = String(row[7] || '').trim();
        if (rowDocId === docId && !rowStatus.startsWith('Updated|')) {
          await api.sheets.updateCell(lId, SHARED_DOCS_TAB, r, 7, 'Accepted');
        }
      }
    } catch {
      /* best-effort ledger update */
    }
  }

  // Update matching notifications in bell store
  const items = storage.getNotifications();
  let changed = false;
  for (const item of items) {
    if (item.sheetId === docId && item.type === 'share') {
      item.shareDecision = 'accepted';
      item.read = true;
      changed = true;
    }
  }
  if (changed) {
    storage.setNotifications(items);
    refreshBell();
  }

  // Sync status to Push Notification Sheet if connected
  const notifSheetId = storage.getNotifSheetId();
  if (notifSheetId) {
    try {
      const data = await api.sheets.getSpreadsheet(notifSheetId);
      const vals = (data?.tabs?.[0]?.values) || data?.values || [];
      if (vals.length > 1) {
        const lower = (vals[0] || []).map(h => (h || '').toLowerCase().trim());
        const statusCol = lower.findIndex(h => /\bstatus\b/.test(h));
        const sheetCol = lower.findIndex(h => /\bsheet\b/.test(h));
        const typeCol = lower.findIndex(h => /\btype\b/.test(h));
        if (statusCol >= 0 && sheetCol >= 0) {
          for (let r = 1; r < vals.length; r++) {
            const row = vals[r] || [];
            const rowSheet = String(row[sheetCol] || '').trim();
            const rowType = typeCol >= 0 ? String(row[typeCol] || '').trim().toLowerCase() : 'share';
            if (rowSheet === docId && rowType === 'share') {
              await api.sheets.updateCell(notifSheetId, data.sheetTitle || 'Sheet1', r, statusCol, 'Read');
            }
          }
        }
      }
    } catch {
      /* ignore */
    }
  }

  return true;
}

if (typeof window !== 'undefined') {
  window._waymarkShareActionDelegate = {
    acceptSharedWaymark,
    rejectSharedWaymark,
  };
}

/**
 * Reject an incoming shared Waymark:
 * - Marks the document as rejected in local storage and hides it in Explorer.
 * - Updates the Shared_Docs row Status to "Rejected" in the Share Ledger.
 * - Mutes future update notifications for that document unless re-accepted.
 * @param {{ docId: string, docTitle?: string, ledgerSheetId?: string }} args
 * @returns {Promise<boolean>}
 */
async function rejectSharedWaymark(args = {}) {
  const docId = String(args.docId || '').trim();
  if (!docId) return false;

  storage.addRejectedShare(docId);
  await userData.addHiddenItem({ id: docId, name: args.docTitle || docId });

  const ledgerIds = new Set();
  if (args.ledgerSheetId) ledgerIds.add(args.ledgerSheetId);
  const discovered = await findLedgersForDocument(docId);
  for (const d of discovered) if (d.ledgerSheetId) ledgerIds.add(d.ledgerSheetId);

  for (const lId of ledgerIds) {
    try {
      const vals = await readTabValues(lId, SHARED_DOCS_TAB);
      for (let r = 1; r < vals.length; r++) {
        const row = vals[r] || [];
        const rowDocId = String(row[0] || '').trim();
        const rowStatus = String(row[7] || '').trim();
        if (rowDocId === docId && !rowStatus.startsWith('Updated|')) {
          await api.sheets.updateCell(lId, SHARED_DOCS_TAB, r, 7, 'Rejected');
        }
      }
    } catch {
      /* best-effort ledger update */
    }
  }

  // Update matching notifications in bell store
  const items = storage.getNotifications();
  let changed = false;
  for (const item of items) {
    if (item.sheetId === docId && item.type === 'share') {
      item.shareDecision = 'rejected';
      item.read = true;
      changed = true;
    }
  }
  if (changed) {
    storage.setNotifications(items);
    refreshBell();
  }

  // Sync status to Push Notification Sheet if connected
  const notifSheetId = storage.getNotifSheetId();
  if (notifSheetId) {
    try {
      const data = await api.sheets.getSpreadsheet(notifSheetId);
      const vals = (data?.tabs?.[0]?.values) || data?.values || [];
      if (vals.length > 1) {
        const lower = (vals[0] || []).map(h => (h || '').toLowerCase().trim());
        const statusCol = lower.findIndex(h => /\bstatus\b/.test(h));
        const sheetCol = lower.findIndex(h => /\bsheet\b/.test(h));
        const typeCol = lower.findIndex(h => /\btype\b/.test(h));
        if (statusCol >= 0 && sheetCol >= 0) {
          for (let r = 1; r < vals.length; r++) {
            const row = vals[r] || [];
            const rowSheet = String(row[sheetCol] || '').trim();
            const rowType = typeCol >= 0 ? String(row[typeCol] || '').trim().toLowerCase() : 'share';
            if (rowSheet === docId && rowType === 'share') {
              await api.sheets.updateCell(notifSheetId, data.sheetTitle || 'Sheet1', r, statusCol, 'Dismissed');
            }
          }
        }
      }
    } catch {
      /* ignore */
    }
  }

  return true;
}

if (typeof window !== 'undefined') {
  window._waymarkShareActionDelegate = {
    acceptSharedWaymark,
    rejectSharedWaymark,
  };
}

/**
 * Discover all past collaborators (contacts and Waymarker Crews) from known
 * Share Ledgers, even when the user has not created a Contacts Waymark sheet.
 * @returns {{ contacts: Array<{ name: string, email: string, group?: string, book: string, ledgerSheetId: string }>, crews: Array<{ name: string, members: Array<{ name: string, email: string }>, ledgerSheetId: string }> }}
 */
function getKnownCollaborators() {
  const me = currentEmail();
  const ledgers = userData.getShareLedgers();
  const contacts = [];
  const seenEmails = new Set();
  const crews = [];
  const seenGroups = new Set();

  for (const l of ledgers) {
    if (!l?.sheetId) continue;
    const cp = resolveLedgerCounterparty(l, []);
    if (cp.group) {
      const gKey = cp.group.toLowerCase();
      if (!seenGroups.has(gKey)) {
        seenGroups.add(gKey);
        crews.push({ name: cp.group, members: [], ledgerSheetId: l.sheetId });
      }
    }
    if (cp.contactEmail && cp.contactEmail !== me) {
      const eKey = cp.contactEmail.toLowerCase();
      if (!seenEmails.has(eKey)) {
        seenEmails.add(eKey);
        const displayName = cp.contactEmail.split('@')[0];
        contacts.push({
          name: displayName.charAt(0).toUpperCase() + displayName.slice(1),
          email: cp.contactEmail,
          group: cp.group || undefined,
          book: 'Shared Waymarks',
          ledgerSheetId: l.sheetId,
        });
      }
    }
  }

  return { contacts, crews };
}

/**
 * Passively check accepted/known shared Waymarks for content digest changes
 * (e.g., edits made directly in Google Sheets outside the Waymark UI).
 * @returns {Promise<number>} number of diff notifications pushed
 */
async function checkSharedSheetDiffs() {
  const prefs = storage.getNotificationSettings();
  if (prefs.collabUpdates === false) return 0;

  const docMeta = new Map();
  for (const docId of storage.getAcceptedShares()) {
    if (docId) docMeta.set(docId, { docId, title: '', from: 'Collaborator' });
  }
  const mappedLedgers = storage.getAllSharedDocLedgers();
  for (const [docId, entries] of Object.entries(mappedLedgers)) {
    if (!docId || !Array.isArray(entries) || !entries.length) continue;
    const first = entries[0];
    docMeta.set(docId, {
      docId,
      title: first.docTitle || '',
      from: first.contactEmail || first.group || 'Collaborator',
    });
  }

  let pushed = 0;
  for (const [docId, meta] of docMeta.entries()) {
    if (storage.isShareRejected(docId)) continue;
    try {
      const previousDigest = storage.getSheetDigest(docId);
      let fileMeta = null;
      try {
        fileMeta = await api.drive.getFile(docId);
      } catch {
        /* Fall back to a sheet read when Drive metadata is unavailable. */
      }
      if (fileMeta?.modifiedTime && previousDigest?.modifiedTime === fileMeta.modifiedTime) continue;

      const data = await api.sheets.getSpreadsheet(docId);
      const vals = (data?.tabs?.[0]?.values) || data?.values || [];
      if (!vals.length) continue;
      const newDigest = computeSheetDigest(vals);
      storage.setSheetDigest(docId, {
        ...newDigest,
        modifiedTime: fileMeta?.modifiedTime || previousDigest?.modifiedTime || '',
      });

      if (previousDigest && previousDigest.hash && previousDigest.hash !== newDigest.hash) {
        const title = data.title || meta.title || 'Shared Waymark';
        const rowDelta = newDigest.rowCount - (previousDigest.rowCount || 0);
        const body = rowDelta > 0
          ? `${rowDelta} new row${rowDelta === 1 ? '' : 's'} added (${newDigest.rowCount} total)`
          : `Sheet cells updated (${newDigest.rowCount} rows)`;
        const entry = addNotification({
          id: `diff:${docId}:${newDigest.hash}`,
          type: 'update',
          icon: '✏️',
          title: `✏️ "${title}" was updated`,
          body,
          sheetId: docId,
          docTitle: title,
          from: meta.from || 'Collaborator',
        });
        if (entry) {
          pushed++;
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('waymark:remote-sheet-updated', {
              detail: { sheetId: docId, title, summary: body, from: meta.from || 'Collaborator' },
            }));
          }
        }
      }
    } catch {
      /* skip unreadable sheet */
    }
  }

  if (pushed) {
    await flushNotificationSheetWrites();
    refreshBell();
  }
  return pushed;
}

/**
 * Poll the Shared_Docs and Chat tabs of every known ledger, detect documents
 * shared with the current user or new chat messages from collaborators since
 * the last seen cursor, and push them to the top-bar notification bell.
 * @returns {Promise<number>} number of new notifications pushed
 */
async function pollShareLedgers() {
  const me = currentEmail();
  const ledgers = userData.getShareLedgers();
  const prefs = storage.getNotificationSettings();
  let pushed = 0;

  for (const l of ledgers) {
    const docCursorKey = me ? `${me}:${l.sheetId}` : l.sheetId;
    try {
      const rows = await readTab(l.sheetId, SHARED_DOCS_TAB);
      const cp = resolveLedgerCounterparty(l, rows);
      const cursor = storage.getBilateralCursor(docCursorKey);
      if (rows.length > cursor) {
        for (let i = cursor; i < rows.length; i++) {
          const r = rows[i];
          const docId = (r.Document_ID || '').trim();
          const statusVal = (r.Status || '').trim();
          const sharedWith = (r.Shared_With_Email || '').trim().toLowerCase();
          const rowGroup = (r.Group || '').trim().toLowerCase();
          const ledgerGroup = (l.group || '').trim().toLowerCase();

          if (docId) {
            storage.recordSharedDocLedger(docId, {
              ledgerSheetId: l.sheetId,
              contactEmail: cp.contactEmail || '',
              group: cp.group || r.Group || '',
              docTitle: r.Document_Title || '',
              waymarkType: r.Waymark_Type || '',
            });
          }

          if (docId && storage.isShareRejected(docId)) continue;

          if (!statusVal.startsWith('Updated|') && docId && storage.isShareAccepted(docId)) {
            // Already accepted on this device — never re-raise the share prompt
            // (this is what made accepted shares reappear on every page reload).
            continue;
          }

          if (statusVal.startsWith('Updated|')) {
            if (prefs.collabUpdates === false) continue;
            const parts = statusVal.split('|');
            const actorEmail = (parts[1] || '').trim().toLowerCase();
            const summary = parts.slice(2).join('|').trim() || 'Updated this Waymark';
            if (me && actorEmail === me) continue;
            const isForMeUpdate = me && (
              sharedWith === me ||
              !sharedWith ||
              (rowGroup && ledgerGroup && rowGroup === ledgerGroup) ||
              actorEmail !== me
            );
            if (!isForMeUpdate) continue;

            const who = actorEmail || cp.contactEmail || l.contactEmail || l.group || r.Group || 'A collaborator';
            const docTitle = r.Document_Title || 'a Waymark';
            const notificationId = r.Shared_Timestamp
              ? `update:${docId}:${actorEmail}:${r.Shared_Timestamp}:${i}`
              : `update:${l.sheetId}:${i}`;
            const entry = addNotification({
              id: notificationId,
              type: 'update',
              icon: '✏️',
              title: `${who} updated "${docTitle}"`,
              body: summary,
              sheetId: docId,
              ledgerSheetId: l.sheetId,
              docTitle,
              waymarkType: r.Waymark_Type || '',
              from: who,
              group: l.group || r.Group || '',
            });
            if (entry) {
              pushed++;
              if (typeof window !== 'undefined' && docId) {
                window.dispatchEvent(new CustomEvent('waymark:remote-sheet-updated', {
                  detail: { sheetId: docId, title: docTitle, summary, from: who },
                }));
              }
            }
            continue;
          }

          if (statusVal.toLowerCase() === 'rejected') continue;
          if (prefs.collabShares === false) continue;

          const isForMe = me && (
            sharedWith === me ||
            (!sharedWith && rowGroup && ledgerGroup && rowGroup === ledgerGroup)
          );
          if (!isForMe) continue;
          const who = cp.contactEmail || l.contactEmail || l.group || r.Group || 'A collaborator';
          const notificationId = r.Shared_Timestamp
            ? `share:${docId}:${sharedWith || rowGroup}:${r.Shared_Timestamp}:${r.Group || ''}`
            : `${l.sheetId}:${i}`;
          const isAccepted = statusVal.toLowerCase() === 'accepted' || (docId && storage.isShareAccepted(docId));
          const entry = addNotification({
            id: notificationId,
            type: 'share',
            title: `${who} shared "${r.Document_Title || 'a Waymark'}"`,
            body: `${r.Waymark_Type || ''} • ${r.Permission_Level || 'view'} access`.trim(),
            sheetId: docId,
            ledgerSheetId: l.sheetId,
            docTitle: r.Document_Title || '',
            waymarkType: r.Waymark_Type || '',
            from: who,
            group: l.group || r.Group || '',
            shareDecision: isAccepted ? 'accepted' : 'pending',
          });
          if (entry) pushed++;
        }
        storage.setBilateralCursor(docCursorKey, rows.length);
        storage.setBilateralCursor(l.sheetId, rows.length);
      } else if (rows.length < cursor) {
        storage.setBilateralCursor(docCursorKey, rows.length);
        storage.setBilateralCursor(l.sheetId, rows.length);
      }
    } catch {
      /* skip unreadable ledger */
    }

    const chatCursorKey = me ? `${me}:${l.sheetId}` : l.sheetId;
    try {
      const chatRows = await readTab(l.sheetId, CHAT_TAB);
      const chatCursor = storage.getChatCursor(chatCursorKey);
      if (chatRows.length > chatCursor) {
        for (let i = chatCursor; i < chatRows.length; i++) {
          if (prefs.collabChat === false) continue;
          const r = chatRows[i];
          const sender = (r.Sender_Email || '').trim().toLowerCase();
          if (!me || !sender || sender === me) continue;
          const who = l.group ? `${sender.split('@')[0]} (${l.group})` : (l.contactEmail || sender);
          const notifId = r.Message_ID ? `chat:${l.sheetId}:${r.Message_ID}` : `chat:${l.sheetId}:${i}`;
          const entry = addNotification({
            id: notifId,
            type: 'chat',
            title: `💬 ${who}`,
            body: r.Message_Text || 'Sent a message in The Wayside',
            sheetId: l.sheetId,
            ledgerSheetId: l.sheetId,
            from: sender,
            group: l.group || '',
          });
          if (entry) pushed++;
        }
        storage.setChatCursor(chatCursorKey, chatRows.length);
        storage.setChatCursor(l.sheetId, chatRows.length);
      } else if (chatRows.length < chatCursor) {
        storage.setChatCursor(chatCursorKey, chatRows.length);
        storage.setChatCursor(l.sheetId, chatRows.length);
      }
    } catch {
      /* skip unreadable chat tab */
    }

    // Check WebRTC_Signaling tab for incoming calls from collaborators
    try {
      const sigValues = await readTabValues(l.sheetId, SIGNALING_TAB);
      const cp = resolveLedgerCounterparty(l, []);
      const myName = (api.auth.getUser?.()?.name || (me ? me.split('@')[0] : '')).trim().toLowerCase();
      for (let r = 1; r < sigValues.length; r++) {
        const row = sigValues[r] || [];
        // 1) Structured SIGNALING_HEADERS row: [Session_ID, Caller_Email, Callee_Email, SDP, ICE, Call_Status]
        const sessionId = String(row[0] || '').trim();
        const callerEmail = String(row[1] || '').trim().toLowerCase();
        const calleeEmail = String(row[2] || '').trim().toLowerCase();
        const callStatus = String(row[5] || '').trim().toLowerCase();
        if (callerEmail && callerEmail !== me && (!calleeEmail || calleeEmail === me)) {
          if (['ringing', 'calling', 'active', 'offer'].includes(callStatus)) {
            const callerLabel = l.group ? `${callerEmail.split('@')[0]} (${l.group})` : callerEmail;
            const entry = addNotification({
              id: `call:${l.sheetId}:${sessionId || r}:${callerEmail}`,
              type: 'call',
              icon: '📞',
              priority: 'High',
              title: `📞 Incoming call from ${callerLabel}`,
              body: 'Click Call to join in The Wayside',
              sheetId: l.sheetId,
              ledgerSheetId: l.sheetId,
              from: callerEmail,
              group: l.group || '',
            });
            if (entry) pushed++;
          }
        }
        // 2) WaymarkConnect row-based block signaling in column 19 (SIG_COL)
        const sigCell = String(row[19] || '').trim();
        if (sigCell && sigCell.startsWith('{') && ((r - 1) % 5 === 0)) {
          try {
            const p = JSON.parse(sigCell);
            const peerName = String(p.name || '').trim();
            const fresh = p.ts && (Date.now() - p.ts < 50_000);
            const isOtherPeer = peerName && peerName.toLowerCase() !== myName && (!me || peerName.toLowerCase() !== me);
            const isAiPeer = Boolean(p.isAgent)
              || String(p.peerId || '').startsWith('ai-')
              || peerName.toLowerCase() === 'waymark ai';
            const nextRowOffer = String((sigValues[r + 1] && sigValues[r + 1][19]) || '').trim();
            const hasMediaOffer = Boolean(nextRowOffer) && /m=(audio|video)\b/.test(nextRowOffer);
            if (fresh && isOtherPeer && !isAiPeer && (p.inCall || hasMediaOffer)) {
              const callerFrom = cp.contactEmail || peerName;
              const entry = addNotification({
                id: `call:${l.sheetId}:${p.peerId || peerName}:${ p.nonce || Math.floor((p.ts || 0) / 60000) }`,
                type: 'call',
                icon: '📞',
                priority: 'High',
                title: `📞 ${peerName} started a call`,
                body: 'Click Call to join in The Wayside',
                sheetId: l.sheetId,
                ledgerSheetId: l.sheetId,
                from: callerFrom,
                group: l.group || '',
              });
              if (entry) pushed++;
            }
          } catch {
            /* ignore malformed signaling cell */
          }
        }
      }
    } catch {
      /* skip unreadable signaling tab */
    }
  }

  await flushNotificationSheetWrites();
  await pollNotificationSheet().catch(() => 0);
  if (pushed) refreshBell();
  return pushed;
}

/** Back-compat alias retained for the app boot/poll cycle. */
const pollBilateralSheets = pollShareLedgers;

/**
 * Resolve the social store (sheet + tabs) for a contact/group, provisioning the
 * ledger if needed. WS3 presence/chat/WebRTC all live in these tabs.
 * @param {{ contactEmail?: string, group?: string }} target
 * @returns {Promise<{ sheetId: string, presenceTab: string, chatTab: string, signalingTab: string }>}
 */
async function getSocialTarget(target) {
  const { sheetId } = await ensureShareLedger(target);
  return { sheetId, presenceTab: PRESENCE_TAB, chatTab: CHAT_TAB, signalingTab: SIGNALING_TAB };
}

/**
 * Create a WaymarkConnect-compatible signal adapter backed by the ledger's
 * WebRTC_Signaling tab.
 * @param {string} sheetId
 * @returns {{ readAll: () => Promise<string[][]>, writeCell: (row: number, col: number, val: string) => Promise<void> }}
 */
function createLedgerSignal(sheetId) {
  return {
    async readAll() {
      return readTabValues(sheetId, SIGNALING_TAB);
    },
    async writeCell(row, col, val) {
      await api.sheets.updateCell(sheetId, SIGNALING_TAB, row, col, val);
    },
  };
}

/** WebRTC signaling target (same bilateral ledger sheet). */
async function getSignalingTarget(target) {
  const t = typeof target === 'string' ? { contactEmail: target } : target;
  const { sheetId } = await ensureShareLedger(t);
  return { sheetId, tab: SIGNALING_TAB, signal: createLedgerSignal(sheetId) };
}

/* ---------- Social: presence + chat ---------- */

/**
 * Publish (upsert) the current user's presence into a ledger's Presence tab.
 * Updates the user's existing row in-place if present so heartbeats do not
 * append unbounded duplicate rows.
 * @param {{ contactEmail?: string, group?: string }} target
 * @param {{ status?: string, activeWaymarkId?: string, displayName?: string }} [opts]
 */
async function publishPresence(target, opts = {}) {
  const { sheetId } = await ensureShareLedger(target);
  await upsertPresenceRow(sheetId, target, opts);
}

/**
 * Refresh the current user's presence heartbeat across all known Share Ledgers
 * without creating any new sheets.
 * @param {{ status?: string, activeWaymarkId?: string, displayName?: string }} [opts]
 */
async function publishPresenceEverywhere(opts = {}) {
  const ledgers = userData.getShareLedgers();
  for (const l of ledgers) {
    if (!l?.sheetId) continue;
    try {
      await upsertPresenceRow(l.sheetId, { contactEmail: l.contactEmail, group: l.group }, opts);
    } catch {
      /* best-effort heartbeat */
    }
  }
}

async function upsertPresenceRow(sheetId, target = {}, opts = {}) {
  const me = currentEmail();
  const displayName = opts.displayName || (me ? me.split('@')[0] : 'Anonymous');
  const groupVal = target.group || '';
  const statusVal = opts.status || 'online';
  const nowIso = new Date().toISOString();
  const activeId = opts.activeWaymarkId || '';
  const row = [me, displayName, groupVal, statusVal, nowIso, activeId];

  const values = await readTabValues(sheetId, PRESENCE_TAB);
  let existingRowIdx = -1;
  for (let i = 1; i < values.length; i++) {
    const rowEmail = String((values[i] && values[i][0]) || '').trim().toLowerCase();
    if (me && rowEmail === me) {
      existingRowIdx = i;
      break;
    }
  }

  if (existingRowIdx >= 1) {
    await api.sheets.updateCells(sheetId, PRESENCE_TAB, existingRowIdx, [
      [1, displayName], [3, statusVal], [4, nowIso], [5, activeId],
    ]);
  } else {
    await api.sheets.appendRows(sheetId, PRESENCE_TAB, [row]);
  }
}

/** Parse tab rows (objects keyed by header) out of an already-fetched spreadsheet. */
function tabRowsFromData(data, tabTitle) {
  const tab = ((data && data.tabs) || []).find(t => (t.title || '').toLowerCase() === tabTitle.toLowerCase());
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

function chatFromRows(rows) {
  const seen = new Set();
  return rows.filter(row => {
    const key = row.Message_ID || `${row.Sender_Email || ''}:${row.Timestamp_UTC || ''}:${row.Message_Text || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map(r => ({
    id: r.Message_ID || '',
    sender: r.Sender_Email || '',
    text: r.Message_Text || '',
    ts: r.Timestamp_UTC || '',
  }));
}

function presenceFromRows(rows) {
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
 * Read chat, presence and shared-document rows for a known ledger with a SINGLE
 * spreadsheet fetch (the Wayside used to issue a Drive search plus a full fetch
 * for chat and again for presence on every poll).
 * @param {string} ledgerSheetId
 * @returns {Promise<{ chat: Array<{id:string,sender:string,text:string,ts:string}>, presence: Array<{email:string,name:string,status:string}>, files: Array<{docId:string,title:string,type:string,sharedWith:string,group:string,permission:string,ts:string,status:string}> }>}
 */
async function readSocialSnapshot(ledgerSheetId) {
  const data = await api.sheets.getSpreadsheet(ledgerSheetId);
  const files = tabRowsFromData(data, SHARED_DOCS_TAB)
    .filter(r => (r.Document_ID || '').trim() && !String(r.Status || '').startsWith('Updated|'))
    .map(r => ({
      docId: r.Document_ID.trim(),
      title: r.Document_Title || '',
      type: r.Waymark_Type || '',
      sharedWith: r.Shared_With_Email || '',
      group: r.Group || '',
      permission: r.Permission_Level || '',
      ts: r.Shared_Timestamp || '',
      status: r.Status || '',
    }));
  return {
    chat: chatFromRows(tabRowsFromData(data, CHAT_TAB)),
    presence: presenceFromRows(tabRowsFromData(data, PRESENCE_TAB)),
    files,
  };
}

/**
 * Read the latest presence per user from a ledger's Presence tab.
 * A user is "online" if their last heartbeat is within 90s, else "away".
 * @param {{ contactEmail?: string, group?: string }} target
 * @returns {Promise<Array<{ email: string, name: string, status: string }>>}
 */
async function readPresence(target) {
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
 * @param {string} [messageId] stable ID shared with the live WebRTC message
 * @returns {Promise<{id:string,sheetId:string}|null>}
 */
async function sendChat(target, text, attachedLink = '', messageId = '') {
  if (!text || !text.trim()) return null;
  const { sheetId } = await ensureShareLedger(target);
  const me = currentEmail();
  const id = messageId || `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const row = [
    id,
    new Date().toISOString(),
    me,
    target.group || target.contactEmail || '',
    text.trim(),
    attachedLink || '',
  ];
  await api.sheets.appendRows(sheetId, CHAT_TAB, [row]);
  try {
    const rows = await readTab(sheetId, CHAT_TAB);
    storage.setChatCursor(sheetId, rows.length);
    if (me) storage.setChatCursor(`${me}:${sheetId}`, rows.length);
  } catch {
    /* cursor update is best-effort */
  }
  return { id, sheetId };
}

/**
 * Read the chat stream for a contact/group.
 * @param {{ contactEmail?: string, group?: string }} target
 * @returns {Promise<Array<{ sender: string, text: string, ts: string }>>}
 */
async function readChat(target) {
  const mapped = await findExistingShareLedger(target);
  if (!mapped) return [];
  const rows = await readTab(mapped.sheetId, CHAT_TAB);
  const seen = new Set();
  return rows.filter(row => {
    const key = row.Message_ID || `${row.Sender_Email || ''}:${row.Timestamp_UTC || ''}:${row.Message_Text || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map(r => ({ id: r.Message_ID || '', sender: r.Sender_Email || '', text: r.Message_Text || '', ts: r.Timestamp_UTC || '' }));
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
    const books = pool.filter(s => isCandidateContactsBook(s) && !seen.has(s.id) && seen.add(s.id));
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
      if (book.templateKey !== 'contacts' && !TEMPLATES.contacts.detect(lower)) continue;
      book.templateKey = 'contacts';
      const cols = TEMPLATES.contacts.columns(lower);

      // Find matching contact/group rows first
      const matchingRows = [];
      for (let i = 1; i < values.length; i++) {
        const row = values[i] || [];
        const rowEmail = normalizeContactEmail(cols.email >= 0 ? row[cols.email] : '').toLowerCase();
        const rowGroup = (cols.group >= 0 ? row[cols.group] : '').trim().toLowerCase();
        if ((email && rowEmail === email) || (group && rowGroup === group)) {
          matchingRows.push(i);
        }
      }
      if (!matchingRows.length) continue;

      let shareCol = cols.shareSheet;
      let socialCol = cols.socialLocation;
      if (shareCol < 0 && socialCol < 0) {
        // Auto-upgrade Contacts sheets that lack Share_Data_Sheet / Social_Data_Location headers
        shareCol = (values[0] || []).length;
        socialCol = shareCol + 1;
        await api.sheets.updateCell(book.id, tabTitle, 0, shareCol, 'Share_Data_Sheet');
        await api.sheets.updateCell(book.id, tabTitle, 0, socialCol, 'Social_Data_Location');
      }

      let wroteBack = false;
      for (const i of matchingRows) {
        const row = values[i] || [];
        const shareValue = extractLedgerSheetId(shareCol >= 0 ? row[shareCol] : '');
        const socialValue = extractLedgerSheetId(socialCol >= 0 ? row[socialCol] : '');
        if (shareCol >= 0 && (!shareValue || previousIds.has(shareValue))) {
          await api.sheets.updateCell(book.id, tabTitle, i, shareCol, sheetId);
          wroteBack = true;
        }
        if (socialCol >= 0 && (!socialValue || previousIds.has(socialValue))) {
          await api.sheets.updateCell(book.id, tabTitle, i, socialCol, sheetId);
          wroteBack = true;
        }
      }
      if (wroteBack) break;
    }
  } catch {
    /* non-fatal — contact write-back is a convenience */
  }
}

setShareActionDelegate({ acceptSharedWaymark, rejectSharedWaymark });
if (typeof window !== 'undefined') {
  window.__WAYMARK_COLLAB = { acceptSharedWaymark, rejectSharedWaymark };
}

export {
  CHAT_TAB,
  PRESENCE_TAB,
  SHARED_DOCS_TAB,
  SIGNALING_TAB,
  acceptSharedWaymark,
  checkSharedSheetDiffs,
  computeSheetDigest,
  connectSharedLedgerViaPicker,
  createLedgerSignal,
  currentEmail,
  ensureShareLedger,
  findExistingShareLedger,
  findLedgersForDocument,
  getKnownCollaborators,
  getSignalingTarget,
  getSocialTarget,
  notifySheetMutation,
  pollBilateralSheets,
  pollShareLedgers,
  publishPresence,
  publishPresenceEverywhere,
  readChat,
  readPresence,
  readSocialSnapshot,
  recordSharedWaymark,
  recordWaymarkActivity,
  registerSharedLedger,
  rejectSharedWaymark,
  resolveTargetEmails,
  sendChat,
  shareDocumentWithContact,
};
