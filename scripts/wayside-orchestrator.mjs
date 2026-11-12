#!/usr/bin/env node
/* ============================================================
   wayside-orchestrator.mjs — OpenClaw-Style Wayside Chat Orchestrator

   Participates as an autonomous collaborator peer in The Wayside
   social chat connection (#home-wayside).

   Features:
   - Real-time P2P WebRTC DataChannel messaging via SheetWebRtcPeer (werift)
   - Durable persistence & async polling via Google Sheets Chat tab
   - Automatic file linking to Shared_Docs tab in the Wayside ledger
   - Deterministic classification against 35 Waymark templates
   - Headless AGY CLI execution targeted at Gemini 3.8 Flash
   ============================================================ */

import { readFileSync, writeFileSync, existsSync, realpathSync, renameSync, chmodSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { SheetWebRtcPeer } from '../mcp/sheet-webrtc-peer.mjs';
import { runAgyTask, extractSpreadsheetId, perAccountTokenPath, identityForToken } from './agy-agent-runner.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

/* ---------- HTTP with timeout ---------- */

// Prevent any single stalled Google call from hanging request handling.
const HTTP_TIMEOUT_MS = Number(process.env.WAYMARK_HTTP_TIMEOUT_MS) || 45000;
async function fetchWithTimeout(url, opts = {}, ms = HTTP_TIMEOUT_MS) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ms);
  try {
    return await globalThis.fetch(url, { ...opts, signal: ac.signal });
  } finally {
    clearTimeout(timer);
  }
}

/* ---------- Configuration ---------- */

export const AGENT_NAME = process.env.WAYSIDE_AGENT_NAME || 'Waymark AI';
export const AGENT_EMAIL = process.env.WAYSIDE_AGENT_EMAIL || 'assistant@waymark.internal';
const CHAT_TAB = 'Chat';
const SHARED_DOCS_TAB = 'Shared_Docs';
const PRESENCE_TAB = 'Presence';
const SIGNALING_TAB = 'WebRTC_Signaling';
const POLL_INTERVAL_MS = parseInt(process.env.WAYSIDE_POLL_INTERVAL_MS || '4000', 10);
const PRESENCE_INTERVAL_MS = parseInt(process.env.WAYSIDE_PRESENCE_INTERVAL_MS || '30000', 10);
const MAX_CONV_TURNS = parseInt(process.env.WAYSIDE_MAX_CONV_TURNS || '20', 10);
const MAX_TURN_CHARS = parseInt(process.env.WAYSIDE_MAX_TURN_CHARS || '1200', 10);
const CONVERSATIONS_FILE = path.join(ROOT, '.waymark', 'orchestrator-conversations.json');

const CATALOG_PATH = path.join(ROOT, 'generated', 'waymark-agent-catalog.json');
let CATALOG = { templates: [], keywordRoutes: [], fallbackAgent: 'waymark-builder' };
try {
  if (existsSync(CATALOG_PATH)) {
    CATALOG = JSON.parse(readFileSync(CATALOG_PATH, 'utf8'));
  }
} catch { /* use empty */ }

/* ---------- Google Sheets Auth & API Helpers ---------- */

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

function base64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

let _cachedAuth = { token: null, expiry: 0, sourceKey: '' };

/**
 * Get an OAuth access token using Service Account credentials or OAuth token file.
 * @returns {Promise<string>}
 */
export async function getAuthToken() {
  const oauthPath = process.env.WAYMARK_OAUTH_TOKEN_PATH ||
    path.join(os.homedir(), '.config', 'gcloud', 'waymark-oauth-token.json');
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    path.join(os.homedir(), '.config', 'gcloud', 'waymark-service-account-key.json');
  const sourceKey = `${oauthPath}|${credPath}`;

  if (_cachedAuth.token && _cachedAuth.sourceKey === sourceKey && Date.now() < _cachedAuth.expiry - 60000) {
    return _cachedAuth.token;
  }

  // 1. Try OAuth token file if available
  if (existsSync(oauthPath)) {
    try {
      const data = JSON.parse(readFileSync(oauthPath, 'utf8'));
      const expiryMs = Number(data.expiry_date);
      if (data.access_token && Number.isFinite(expiryMs) && Date.now() < expiryMs - 60000) {
        _cachedAuth = { token: data.access_token, expiry: expiryMs, sourceKey };
        return data.access_token;
      }
      if (data.refresh_token && data.client_id && data.client_secret) {
        const res = await fetchWithTimeout(TOKEN_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: data.refresh_token,
            client_id: data.client_id,
            client_secret: data.client_secret,
          }),
        });
        const ref = await res.json();
        if (ref.access_token) {
          const expiry = Date.now() + ((Number(ref.expires_in) || 3600) * 1000);
          data.access_token = ref.access_token;
          if (ref.refresh_token) data.refresh_token = ref.refresh_token;
          data.expiry_date = expiry;
          try {
            const tmpPath = `${oauthPath}.${process.pid}.tmp`;
            writeFileSync(tmpPath, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
            if (process.platform !== 'win32') {
              try { chmodSync(tmpPath, 0o600); } catch {}
            }
            renameSync(tmpPath, oauthPath);
          } catch { /* read-only mount — ignore */ }
          _cachedAuth = { token: ref.access_token, expiry, sourceKey };
          return ref.access_token;
        }
      }
      if (data.access_token && !data.refresh_token) {
        _cachedAuth = { token: data.access_token, expiry: Date.now() + 300000, sourceKey };
        return data.access_token;
      }
    } catch { /* fallback to service account */ }
  }

  // 2. Service account key file
  if (existsSync(credPath)) {
    const creds = JSON.parse(readFileSync(credPath, 'utf8'));
    const now = Math.floor(Date.now() / 1000);
    const scope = 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive';
    const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claims = base64url(JSON.stringify({
      iss: creds.client_email,
      scope,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    }));
    const signingInput = `${header}.${claims}`;
    const signer = crypto.createSign('RSA-SHA256');
    signer.update(signingInput);
    const signature = signer.sign(creds.private_key);
    const jwt = `${signingInput}.${base64url(signature)}`;

    const response = await fetchWithTimeout(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: jwt,
      }),
    });
    const tokenData = await response.json();
    if (tokenData.access_token) {
      const expiry = Date.now() + ((tokenData.expires_in || 3600) * 1000);
      _cachedAuth = { token: tokenData.access_token, expiry, sourceKey };
      return tokenData.access_token;
    }
  }

  throw new Error('Unable to obtain Google Auth token. Check GOOGLE_APPLICATION_CREDENTIALS or WAYMARK_OAUTH_TOKEN_PATH.');
}

async function sheetsApi(pathUrl, { method = 'GET', body = null } = {}) {
  const token = await getAuthToken();
  const opts = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetchWithTimeout(`${SHEETS_BASE}${pathUrl}`, opts);
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Sheets API ${res.status}: ${txt}`);
  }
  return res.json();
}

function quoteTabTitle(tabName) {
  const raw = String(tabName || '');
  return /^[A-Za-z0-9_]+$/.test(raw) ? raw : `'${raw.replace(/'/g, "''")}'`;
}

/**
 * Append row(s) to a spreadsheet tab.
 */
export async function appendTabRows(sheetId, tabName, rows) {
  const safeTab = quoteTabTitle(tabName);
  return sheetsApi(`/${sheetId}/values/${encodeURIComponent(safeTab)}:append?valueInputOption=USER_ENTERED`, {
    method: 'POST',
    body: { values: rows },
  });
}

/**
 * Read all rows from a spreadsheet tab.
 */
export async function readTabRows(sheetId, tabName) {
  try {
    const safeTab = quoteTabTitle(tabName);
    const data = await sheetsApi(`/${sheetId}/values/${encodeURIComponent(safeTab)}`);
    return data.values || [];
  } catch (err) {
    return [];
  }
}

/**
 * Update a range in a spreadsheet tab.
 */
async function updateTabRange(sheetId, range, rows) {
  return sheetsApi(`/${sheetId}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`, {
    method: 'PUT',
    body: { range, majorDimension: 'ROWS', values: rows },
  });
}

/**
 * Ensure Shared_Docs, Presence, Chat, and WebRTC_Signaling tabs exist with headers
 * matching the 4-tab Share Ledger schema in public/js/collab.js.
 */
async function ensureLedgerStructure(sheetId) {
  try {
    const meta = await sheetsApi(`/${sheetId}?fields=sheets.properties`);
    const existingTitles = new Set((meta.sheets || []).map(s => s.properties?.title));

    const requests = [];
    for (const tab of [SHARED_DOCS_TAB, PRESENCE_TAB, CHAT_TAB, SIGNALING_TAB]) {
      if (!existingTitles.has(tab)) {
        requests.push({ addSheet: { properties: { title: tab } } });
      }
    }

    if (requests.length > 0) {
      await sheetsApi(`/${sheetId}:batchUpdate`, {
        method: 'POST',
        body: { requests },
      });
    }

    // Initialize headers if empty
    const docRows = await readTabRows(sheetId, SHARED_DOCS_TAB);
    if (docRows.length === 0) {
      await appendTabRows(sheetId, SHARED_DOCS_TAB, [[
        'Document_ID', 'Document_Title', 'Waymark_Type', 'Shared_With_Email', 'Group', 'Permission_Level', 'Shared_Timestamp', 'Status'
      ]]);
    }

    const presenceRows = await readTabRows(sheetId, PRESENCE_TAB);
    if (presenceRows.length === 0) {
      await appendTabRows(sheetId, PRESENCE_TAB, [[
        'User_Email', 'Display_Name', 'Group', 'Online_Status', 'Last_Heartbeat_UTC', 'Active_Waymark_ID'
      ]]);
    }

    const chatRows = await readTabRows(sheetId, CHAT_TAB);
    if (chatRows.length === 0) {
      await appendTabRows(sheetId, CHAT_TAB, [[
        'Message_ID', 'Timestamp_UTC', 'Sender_Email', 'Target_Group_Or_Contact', 'Message_Text', 'Attached_Waymark_Link'
      ]]);
    }

    const sigRows = await readTabRows(sheetId, SIGNALING_TAB);
    if (sigRows.length === 0) {
      await appendTabRows(sheetId, SIGNALING_TAB, [[
        'Session_ID', 'Caller_Email', 'Callee_Email', 'SDP_Offer_Answer_JSON', 'ICE_Candidates_JSON', 'Call_Status'
      ]]);
    }
  } catch (err) {
    console.warn(`[WaysideOrchestrator] Warning: Could not ensure ledger structure: ${err.message}`);
  }
}

function ledgerFileName(key) {
  return `.waymark-ledger-${String(key).replace(/[^a-z0-9@._:-]/g, '-')}`;
}

async function resolveCurrentUserEmail(existingToken = null) {
  const envEmail = (process.env.WAYSIDE_USER_EMAIL || '').trim().toLowerCase();
  if (envEmail) return envEmail;
  try {
    const token = existingToken || await getAuthToken();
    const driveFilesBase = process.env.DRIVE_BASE || 'https://www.googleapis.com/drive/v3/files';
    const driveRoot = driveFilesBase.replace(/\/files\/?$/, '');
    const aboutRes = await fetchWithTimeout(`${driveRoot}/about?fields=user`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (aboutRes.ok) {
      const about = await aboutRes.json();
      const detected = (about?.user?.emailAddress || '').trim().toLowerCase();
      if (detected && !detected.endsWith('.gserviceaccount.com')) {
        return detected;
      }
    }
  } catch { /* best-effort user email detection */ }
  return '';
}

function parseEmailList(raw) {
  if (!raw) return [];
  const items = Array.isArray(raw) ? raw : String(raw).split(',');
  const out = [];
  const seen = new Set();
  for (const item of items) {
    const email = String(item || '').trim().toLowerCase();
    if (email && email.includes('@') && !email.endsWith('.internal') && !email.endsWith('.local') && !seen.has(email)) {
      seen.add(email);
      out.push(email);
    }
  }
  return out;
}

function parseGroupList(raw) {
  if (!raw) return [];
  const items = Array.isArray(raw) ? raw : String(raw).split(',');
  const out = [];
  const seen = new Set();
  for (const item of items) {
    const group = String(item || '').trim();
    const lower = group.toLowerCase();
    if (group && !seen.has(lower)) {
      seen.add(lower);
      out.push(group);
    }
  }
  return out;
}

/**
 * Grant Drive writer permissions on a spreadsheet or document to a list of emails.
 * Best-effort: logs a warning on failure and never throws.
 * @param {string} fileId
 * @param {string[]} emails
 * @param {string} [existingToken]
 * @returns {Promise<string[]>} emails successfully granted access
 */
async function shareFileWithEmails(fileId, emails = [], existingToken = null) {
  const targets = parseEmailList(emails);
  if (!fileId || targets.length === 0) return [];
  const granted = [];
  try {
    const token = existingToken || await getAuthToken();
    const ownerEmail = await resolveCurrentUserEmail(token);
    const driveFilesBase = process.env.DRIVE_BASE || 'https://www.googleapis.com/drive/v3/files';
    for (const email of targets) {
      if (ownerEmail && email === ownerEmail) continue;
      try {
        const res = await fetchWithTimeout(`${driveFilesBase}/${encodeURIComponent(fileId)}/permissions`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            type: 'user',
            role: 'writer',
            emailAddress: email,
          }),
        });
        if (res.ok) {
          granted.push(email);
        }
      } catch { /* best-effort per email */ }
    }
  } catch { /* best-effort */ }
  return granted;
}

/**
 * Auto-discover an existing Wayside Share Ledger in Google Drive or provision one
 * using the canonical `.waymark-ledger-contact-pair:` (or `.waymark-ledger-group:`)
 * naming from public/js/collab.js.
 * @param {{ userEmail?: string, group?: string, shareWithEmails?: string[] }} [opts]
 * @returns {Promise<string>} spreadsheetId
 */
export async function discoverOrCreateWaysideLedger(opts = {}) {
  const token = await getAuthToken();
  const driveFilesBase = process.env.DRIVE_BASE || 'https://www.googleapis.com/drive/v3/files';
  const agentEmailLower = AGENT_EMAIL.toLowerCase();
  const groupName = String(opts.group || '').trim();
  const explicitUserEmail = String(opts.userEmail || '').trim().toLowerCase();
  const userEmail = explicitUserEmail || await resolveCurrentUserEmail(token);

  const ledgerKey = groupName
    ? `group:${groupName.toLowerCase()}`
    : (userEmail && userEmail !== agentEmailLower
      ? `contact-pair:${[userEmail, agentEmailLower].sort().join('::')}`
      : `contact:${agentEmailLower}`);
  const canonicalTitle = ledgerFileName(ledgerKey);
  const dashTitle = `.waymark-ledger-${String(ledgerKey).toLowerCase().replace(/[^a-z0-9@._-]/g, '-')}`;
  const legacyTitle = !groupName && !explicitUserEmail ? ledgerFileName(`contact:${agentEmailLower}`) : '';

  const q = "name contains '.waymark-ledger-' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false";
  const url = `${driveFilesBase}?q=${encodeURIComponent(q)}&fields=files(id,name,createdTime,modifiedTime)&orderBy=createdTime&pageSize=100`;

  const shareTargets = parseEmailList([
    ...(opts.shareWithEmails || []),
    explicitUserEmail,
  ]);

  const res = await fetchWithTimeout(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.ok) {
    const data = await res.json();
    const files = data.files || [];
    // Sort oldest-first matching public/js/drive.js findFilesGlobal so browser and orchestrator always pick the same ledger
    const exactMatch = files.find(f => {
      const lower = (f.name || '').toLowerCase();
      return lower === canonicalTitle.toLowerCase() || lower === dashTitle.toLowerCase();
    });
    if (exactMatch?.id) {
      if (shareTargets.length > 0) {
        await shareFileWithEmails(exactMatch.id, shareTargets, token);
      }
      return exactMatch.id;
    }

    if (legacyTitle) {
      const legacyMatch = files.find(f => (f.name || '').toLowerCase() === legacyTitle.toLowerCase());
      if (legacyMatch?.id) {
        if (shareTargets.length > 0) {
          await shareFileWithEmails(legacyMatch.id, shareTargets, token);
        }
        return legacyMatch.id;
      }
    }
  }

  // Create a dedicated Wayside Share Ledger matching collab.js ledgerFileName
  const created = await sheetsApi('', {
    method: 'POST',
    body: {
      properties: { title: canonicalTitle },
      sheets: [
        { properties: { title: SHARED_DOCS_TAB } },
        { properties: { title: PRESENCE_TAB } },
        { properties: { title: CHAT_TAB } },
        { properties: { title: SIGNALING_TAB } },
      ],
    },
  });
  await ensureLedgerStructure(created.spreadsheetId);
  if (shareTargets.length > 0) {
    await shareFileWithEmails(created.spreadsheetId, shareTargets, token);
  }
  return created.spreadsheetId;
}

/* ---------- Intent & Template Routing ---------- */

/**
 * Match a keyword against text on word boundaries (singular/plural aware).
 * Prevents substring collisions like "wayboard" matching kanban's "board",
 * "ai-router" matching travel's "route", or "dialog" matching log's "log".
 * @param {string} text — lowercased haystack
 * @param {string} kw — lowercased keyword (may contain spaces)
 * @returns {boolean}
 */
function matchesKeyword(text, kw) {
  const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pluralOpt = kw.endsWith('s')
    ? `(?:${escaped}|${escaped.slice(0, -1)})`
    : `${escaped}s?`;
  const re = new RegExp(`(?:^|[^a-z0-9])${pluralOpt}(?:$|[^a-z0-9])`, 'i');
  return re.test(text);
}

/**
 * Classify a user message into a template or conversational intent.
 * @param {string} text
 * @returns {{ templateKey: string|null, templateName: string|null, isHelp: boolean, isConversation: boolean, isCodeTask: boolean, candidateTemplates: Array<{ key: string, name: string }> }}
 */
export function classifyMessage(text) {
  const clean = (text || '').toLowerCase().trim();

  // 1. Check explicit mentions first: @waymark-kanban or @kanban
  for (const tmpl of CATALOG.templates || []) {
    if (clean.includes(`@waymark-${tmpl.key}`) || clean.includes(`@${tmpl.key}`)) {
      return {
        templateKey: tmpl.key,
        templateName: tmpl.name,
        isHelp: false,
        isConversation: false,
        isCodeTask: false,
        candidateTemplates: [{ key: tmpl.key, name: tmpl.name }],
      };
    }
  }

  // 2. Check code/engineering intent. Require EXPLICIT repository / git / PR
  // intent so a Waymark sheet request ("add a card to my kanban to fix the
  // wayboard ui") is never hijacked into a 45-minute background Git PR task.
  const explicitCodeIntent = /\b(pull\s*request|pr)\b/i.test(clean) ||
    /\b(new\s+branch|waymark\s+branch|feature\s+branch|git\s+checkout|checkout\s+-b|commit|merge\s*request)\b/i.test(clean) ||
    /\b(in\s+the\s+(?:waymark\s+)?repo(?:sitory)?|in\s+the\s+codebase)\b/i.test(clean) ||
    /\b(put\s+up\s+(?:a\s+)?(?:new\s+)?(?:waymark\s+)?branch|put\s+up\s+for\s+pr|make\s+(?:a\s+)?pr|open\s+(?:a\s+)?pr)\b/i.test(clean) ||
    /(^|\s)(@waymark-builder|\/code)\b/i.test(clean);
  // Generic "change the code" style intent only counts when the user is clearly
  // talking about source code, NOT a spreadsheet/board/template.
  const sheetyContext = /\b(kanban|checklist|task|card|row|sheet|spreadsheet|board|backlog|bug\s*tracker|template|budget|recipe|meal|itinerary|roster|habit|tracker|inventory|crm|grade|timesheet)\b/i.test(clean);
  const genericCodeIntent = /\b(feature|bugfix|patch|refactor|implement)\b/i.test(clean) &&
    /\b(code|frontend|backend|component|server|script|wayboard|module|endpoint)\b/i.test(clean);
  const isCodeTask = explicitCodeIntent || (genericCodeIntent && !sheetyContext);

  if (isCodeTask) {
    return {
      templateKey: null,
      templateName: null,
      isHelp: false,
      isConversation: false,
      isCodeTask: true,
      candidateTemplates: [],
    };
  }

  // 3. Check conversational / greetings (only pure greetings or capability inquiries, never task messages)
  const greetingWords = ['hi', 'hello', 'hey', 'howdy', 'greetings', 'yo', 'sup'];
  const stripped = clean.replace(/[!?,.]/g, '').trim();
  const words = stripped.split(/\s+/).filter(Boolean);

  const isPureGreeting = greetingWords.includes(words[0]) && (
    words.length === 1 ||
    (words.length === 2 && ['there', 'waymark', 'ai', 'bot', 'friend', 'team', 'everyone'].includes(words[1])) ||
    (words.length === 3 && words[1] === 'waymark' && words[2] === 'ai') ||
    (words.length <= 4 && (clean.includes('how are you') || clean.includes('good morning') || clean.includes('good evening') || clean.includes('good afternoon')))
  );

  const isHelpQuery = clean === 'help' || clean === '?' ||
    clean.includes('what you can do') ||
    clean.includes('what can you do') ||
    clean.includes('who are you') ||
    clean.includes('how do you work') ||
    clean.includes('how does this work') ||
    clean.includes('help me understand') ||
    (clean.includes('help') && words.length <= 10 && !/\b(create|build|make|sheet|spreadsheet|doc|add|log|track)\b/i.test(clean));

  if (isPureGreeting || isHelpQuery) {
    return {
      templateKey: null,
      templateName: null,
      isHelp: Boolean(isHelpQuery),
      isConversation: true,
      isCodeTask: false,
      candidateTemplates: [],
    };
  }

  // 4. Score keywordRoutes (word-boundary, plural/singular aware) and keep the
  // top candidates so a multi-domain request can inform the agent prompt.
  const routeScores = [];
  for (const route of CATALOG.keywordRoutes || []) {
    let matches = 0;
    for (const rawKw of route.keywords || []) {
      if (matchesKeyword(clean, rawKw.toLowerCase())) matches += 2;
    }
    if (matches > 0) {
      const key = route.agent.replace(/^waymark-/, '');
      const tmpl = (CATALOG.templates || []).find(t => t.key === key);
      routeScores.push({ key, name: tmpl ? tmpl.name : key, score: matches });
    }
  }
  routeScores.sort((a, b) => b.score - a.score);

  if (routeScores.length > 0) {
    const candidateTemplates = routeScores.slice(0, 3).map(r => ({ key: r.key, name: r.name }));
    return {
      templateKey: routeScores[0].key,
      templateName: routeScores[0].name,
      isHelp: false,
      isConversation: false,
      isCodeTask: false,
      candidateTemplates,
    };
  }

  // 5. Score template detectSignals (word-boundary aware)
  const signalScores = [];
  for (const tmpl of CATALOG.templates || []) {
    let signals = 0;
    for (const sig of tmpl.detectSignals || []) {
      if (matchesKeyword(clean, sig.toLowerCase())) signals++;
    }
    if (signals > 0) signalScores.push({ key: tmpl.key, name: tmpl.name, score: signals });
  }
  signalScores.sort((a, b) => b.score - a.score);

  if (signalScores.length > 0 && signalScores[0].score >= 2) {
    const candidateTemplates = signalScores.slice(0, 3).map(s => ({ key: s.key, name: s.name }));
    return {
      templateKey: signalScores[0].key,
      templateName: signalScores[0].name,
      isHelp: false,
      isConversation: false,
      isCodeTask: false,
      candidateTemplates,
    };
  }

  return {
    templateKey: null,
    templateName: null,
    isHelp: false,
    isConversation: false,
    isCodeTask: false,
    candidateTemplates: [],
  };
}

/* ---------- Orchestrator Daemon Core ---------- */

export class WaysideOrchestrator {
  /**
   * Determine whether the orchestrator should reply to an incoming message.
   * In 1-on-1 / shared AI ledgers (`isGroup: false`), all non-empty messages are answered.
   * In group / crew ledgers (`isGroup: true`), the agent only responds when explicitly
   * mentioned or addressed so human-to-human chats are not interrupted.
   * @param {string} text
   * @param {{ isGroup?: boolean, agentName?: string, agentEmail?: string }} [opts]
   * @returns {boolean}
   */
  static shouldRespondToMessage(text, opts = {}) {
    const clean = String(text || '').trim();
    if (!clean) return false;
    if (!opts.isGroup && !opts.isGroupLedger) return true;

    const lower = clean.toLowerCase();
    const agentNameLower = String(opts.agentName || AGENT_NAME).toLowerCase();
    const agentEmailLower = String(opts.agentEmail || AGENT_EMAIL).toLowerCase();
    if (
      lower.includes('@waymark') ||
      lower.includes('@agent') ||
      lower.includes('@assistant') ||
      lower.includes('@ai') ||
      lower.includes(agentNameLower) ||
      lower.includes(agentEmailLower) ||
      /^(?:hey\s+|hi\s+)?waymark\b/i.test(clean)
    ) {
      return true;
    }
    for (const tmpl of CATALOG.templates || []) {
      if (lower.includes(`@${tmpl.key}`)) return true;
    }
    return false;
  }

  /**
   * Discover or provision all configured Wayside Share Ledgers:
   * 1. The primary host user's bilateral ledger
   * 2. Dedicated bilateral ledgers for each email in `WAYSIDE_ALLOWED_USERS` (shared with that user)
   * 3. Shared group ledgers for each group in `WAYSIDE_GROUPS` (shared with allowed users)
   * @param {{ allowedUsers?: string|string[], groups?: string|string[] }} [opts]
   * @returns {Promise<Array<{ sheetId: string, userEmail: string, isGroup: boolean, group: string }>>}
   */
  static async discoverAllLedgers(opts = {}) {
    const token = await getAuthToken();
    const hostEmail = await resolveCurrentUserEmail(token);
    const allowedUsers = parseEmailList(opts.allowedUsers ?? process.env.WAYSIDE_ALLOWED_USERS);
    const groups = parseGroupList(opts.groups ?? process.env.WAYSIDE_GROUPS);

    const results = [];
    const seenIds = new Set();

    // 1. Primary host ledger (also shared with allowedUsers if any are configured)
    const primaryId = await discoverOrCreateWaysideLedger({
      userEmail: hostEmail,
      shareWithEmails: allowedUsers,
    });
    if (primaryId) {
      seenIds.add(primaryId);
      results.push({ sheetId: primaryId, userEmail: hostEmail, isGroup: false, isGroupLedger: false, group: '' });
    }

    // 2. Per-user bilateral ledgers for each allowed guest/family member
    for (const guestEmail of allowedUsers) {
      if (hostEmail && guestEmail === hostEmail) continue;
      const guestLedgerId = await discoverOrCreateWaysideLedger({
        userEmail: guestEmail,
        shareWithEmails: [guestEmail],
      });
      if (guestLedgerId && !seenIds.has(guestLedgerId)) {
        seenIds.add(guestLedgerId);
        results.push({ sheetId: guestLedgerId, userEmail: guestEmail, isGroup: false, isGroupLedger: false, group: '' });
      }
    }

    // 3. Shared group / crew ledgers
    for (const group of groups) {
      const groupLedgerId = await discoverOrCreateWaysideLedger({
        group,
        shareWithEmails: allowedUsers,
      });
      if (groupLedgerId && !seenIds.has(groupLedgerId)) {
        seenIds.add(groupLedgerId);
        results.push({ sheetId: groupLedgerId, userEmail: hostEmail, isGroup: true, isGroupLedger: true, group });
      }
    }

    // 4. Auto-discover any existing collaborator / family AI ledgers in Drive
    // (e.g. `.waymark-ledger-contact-pair-assistant@waymark.internal--kailey.levine@gmail.com`)
    try {
      const driveFilesBase = process.env.DRIVE_BASE || 'https://www.googleapis.com/drive/v3/files';
      const q = "name contains '.waymark-ledger-' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false";
      const url = `${driveFilesBase}?q=${encodeURIComponent(q)}&fields=files(id,name)&orderBy=createdTime&pageSize=100`;
      const res = await fetchWithTimeout(url, { headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        const data = await res.json();
        const agentLower = AGENT_EMAIL.toLowerCase();
        for (const f of data.files || []) {
          if (!f?.id || seenIds.has(f.id)) continue;
          const lowerName = String(f.name || '').toLowerCase();
          if (!lowerName.includes(agentLower)) continue;
          let partnerEmail = hostEmail;
          if (lowerName.startsWith('.waymark-ledger-contact-pair:') || lowerName.startsWith('.waymark-ledger-contact-pair-')) {
            const rawRest = lowerName.slice('.waymark-ledger-contact-pair:'.length);
            const parts = (rawRest.includes('::') ? rawRest.split('::') : rawRest.split('--'))
              .map(s => s.trim())
              .filter(Boolean);
            const human = parts.find(p => p !== agentLower);
            if (human) partnerEmail = human;
          }
          seenIds.add(f.id);
          results.push({
            sheetId: f.id,
            userEmail: partnerEmail || hostEmail,
            isGroup: false,
            isGroupLedger: false,
            group: '',
          });
        }
      }
    } catch { /* best-effort Drive scan */ }

    return results;
  }

  /**
   * Expose Drive permission helper for tests and callers.
   */
  static async shareFileWithEmails(fileId, emails = [], existingToken = null) {
    return shareFileWithEmails(fileId, emails, existingToken);
  }

  /**
   * Apply an OAuth token bundle received over the Waymark Frontend ↔ AI P2P tunnel
   * (or CLI import), persisting it atomically to WAYMARK_OAUTH_TOKEN_PATH and
   * updating the in-memory token cache immediately.
   * @param {Object|string} rawBundle
   * @param {{ tokenPath?: string, dryRun?: boolean }} [opts]
   * @returns {{ ok: boolean, error?: string, tokenPath?: string, hasRefreshToken?: boolean }}
   */
  static applyOAuthTokenBundle(rawBundle, opts = {}) {
    try {
      const parsed = typeof rawBundle === 'string' ? JSON.parse(rawBundle) : rawBundle;
      if (!parsed || typeof parsed !== 'object') {
        return { ok: false, error: 'Invalid OAuth token payload' };
      }
      const accessToken = String(parsed.access_token || parsed.accessToken || '').trim();
      const refreshToken = String(parsed.refresh_token || parsed.refreshToken || '').trim();
      if (!accessToken && !refreshToken) {
        return { ok: false, error: 'Token bundle must include access_token or refresh_token' };
      }

      const oauthPath = opts.tokenPath || process.env.WAYMARK_OAUTH_TOKEN_PATH ||
        path.join(os.homedir(), '.config', 'gcloud', 'waymark-oauth-token.json');
      const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS ||
        path.join(os.homedir(), '.config', 'gcloud', 'waymark-service-account-key.json');

      let existing = {};
      if (!opts.dryRun && existsSync(oauthPath)) {
        try {
          existing = JSON.parse(readFileSync(oauthPath, 'utf8')) || {};
        } catch {
          existing = {};
        }
      }

      const expiryMs = Number(parsed.expiry_date || parsed.expiryDate) || (Date.now() + 3600 * 1000);
      const merged = {
        ...existing,
        ...(accessToken ? { access_token: accessToken } : {}),
        ...(refreshToken ? { refresh_token: refreshToken } : {}),
        ...(parsed.client_id ? { client_id: String(parsed.client_id).trim() } : {}),
        ...(parsed.client_secret ? { client_secret: String(parsed.client_secret).trim() } : {}),
        token_type: parsed.token_type || existing.token_type || 'Bearer',
        expiry_date: expiryMs,
        updated_via: 'wayside-p2p-tunnel',
        updated_at: new Date().toISOString(),
      };

      // Keep the REAL requester email (lowercased) — it is the identity we later
      // verify the agent is acting as, and it is stored as account_email so a
      // mismatch can never be masked by a mangled address.
      const senderEmail = String(opts.sender || '').trim().toLowerCase();
      const existingHost = String(existing.account_email || opts.hostEmail || '').trim().toLowerCase();
      const isCollaboratorPush = Boolean(
        senderEmail &&
        !opts.tokenPath &&
        !process.env.WAYMARK_OAUTH_TOKEN_PATH &&
        existsSync(oauthPath) &&
        ((existingHost && existingHost !== senderEmail) || (!refreshToken && existing.refresh_token))
      );

      if (!opts.dryRun) {
        mkdirSync(path.dirname(oauthPath), { recursive: true });
        if (!isCollaboratorPush) {
          const tmpPath = `${oauthPath}.${process.pid}.tmp`;
          writeFileSync(tmpPath, JSON.stringify(merged, null, 2) + '\n', { mode: 0o600 });
          if (process.platform !== 'win32') {
            try { chmodSync(tmpPath, 0o600); } catch {}
          }
          renameSync(tmpPath, oauthPath);
        }

        if (senderEmail.includes('@') && !opts.tokenPath && !process.env.WAYMARK_OAUTH_TOKEN_PATH) {
          // Canonical per-account path — the SAME helper every reader uses, so a
          // collaborator's token is always found again (no silent host fallback).
          const senderPath = perAccountTokenPath(senderEmail, path.dirname(oauthPath));
          const senderTmp = `${senderPath}.${process.pid}.tmp`;
          // Preserve any client credentials already on file for this account so a
          // refresh-only push never drops them.
          let priorSender = {};
          if (existsSync(senderPath)) {
            try { priorSender = JSON.parse(readFileSync(senderPath, 'utf8')) || {}; } catch { priorSender = {}; }
          }
          const senderClientId = parsed.client_id || priorSender.client_id || '';
          const senderClientSecret = parsed.client_secret || priorSender.client_secret || '';
          const senderBundle = {
            ...(accessToken ? { access_token: accessToken } : {}),
            // A refresh_token (+ client_id) is what makes a collaborator's token
            // durable — without it the agent can only act as them for ~1 hour,
            // then falls back to the owner and creates files in the wrong Drive.
            ...(refreshToken ? { refresh_token: refreshToken } : (priorSender.refresh_token ? { refresh_token: priorSender.refresh_token } : {})),
            ...(senderClientId ? { client_id: senderClientId } : {}),
            ...(senderClientSecret ? { client_secret: senderClientSecret } : {}),
            ...(parsed.scope ? { scope: parsed.scope } : (priorSender.scope ? { scope: priorSender.scope } : {})),
            token_type: parsed.token_type || 'Bearer',
            expiry_date: expiryMs,
            account_email: senderEmail,
            updated_via: 'wayside-p2p-tunnel',
            updated_at: new Date().toISOString(),
          };
          writeFileSync(senderTmp, JSON.stringify(senderBundle, null, 2) + '\n', { mode: 0o600 });
          if (process.platform !== 'win32') {
            try { chmodSync(senderTmp, 0o600); } catch {}
          }
          renameSync(senderTmp, senderPath);
          console.log(`[WaysideOrchestrator] 🔑 Saved per-account OAuth token for ${senderEmail} (${senderBundle.refresh_token ? 'durable: refresh_token' : 'access-only'}) -> ${senderPath}`);
        }
      }

      if (accessToken && !isCollaboratorPush) {
        _cachedAuth = {
          token: accessToken,
          expiry: expiryMs,
          sourceKey: `${oauthPath}|${credPath}`,
        };
      }
      return {
        ok: true,
        tokenPath: oauthPath,
        hasRefreshToken: Boolean(merged.refresh_token),
      };
    } catch (err) {
      return { ok: false, error: err.message || 'Could not apply OAuth token bundle' };
    }
  }

  /**
   * Parse thread metadata encoded in Chat tab's Target_Group_Or_Contact column.
   * Format when non-default: `thread:<threadId>|<threadTitle>`
   * @param {string} targetVal
   * @returns {{ threadId: string, threadTitle: string }}
   */
  static parseThreadMeta(targetVal) {
    const raw = String(targetVal || '').trim();
    if (raw.startsWith('thread:')) {
      const rest = raw.slice('thread:'.length);
      const pipeIdx = rest.indexOf('|');
      if (pipeIdx >= 0) {
        return {
          threadId: rest.slice(0, pipeIdx).trim() || 'default',
          threadTitle: rest.slice(pipeIdx + 1).trim(),
        };
      }
      return { threadId: rest.trim() || 'default', threadTitle: '' };
    }
    return { threadId: 'default', threadTitle: '' };
  }

  /**
   * Format Chat tab's Target_Group_Or_Contact column value for a conversation thread.
   * @param {string} defaultTarget
   * @param {string} [threadId]
   * @param {string} [threadTitle]
   * @returns {string}
   */
  static formatThreadTarget(defaultTarget = '', threadId = 'default', threadTitle = '') {
    const cleanId = String(threadId || 'default').trim();
    if (!cleanId || cleanId === 'default') return defaultTarget || '';
    const cleanTitle = String(threadTitle || '').replace(/\|/g, ' ').trim();
    return cleanTitle ? `thread:${cleanId}|${cleanTitle}` : `thread:${cleanId}`;
  }

  constructor(opts = {}) {
    this.sheetId = opts.sheetId;
    const stableHash = crypto.createHash('sha1').update(String(opts.sheetId || 'wayside')).digest('hex').slice(0, 6);
    this.peerId = opts.peerId || `ai-${stableHash}`;
    this.agentName = opts.agentName || AGENT_NAME;
    this.agentEmail = opts.agentEmail || AGENT_EMAIL;
    this.userEmail = (opts.userEmail || process.env.WAYSIDE_USER_EMAIL || '').trim().toLowerCase();
    this.isGroup = Boolean(opts.isGroup);
    this.group = String(opts.group || '').trim();
    this.allowedUsers = parseEmailList(opts.allowedUsers ?? process.env.WAYSIDE_ALLOWED_USERS);
    this.pollIntervalMs = opts.pollIntervalMs || POLL_INTERVAL_MS;
    this.presenceIntervalMs = opts.presenceIntervalMs || PRESENCE_INTERVAL_MS;

    this.peer = null;
    this.processedMessageIds = new Set();
    this.knownSharedDocIds = new Set();
    this.conversations = new Map();
    this._p2pSheetWaiters = new Map();
    this.pollTimer = null;
    this.presenceTimer = null;
    this.running = false;

    // Per-conversation serialization + a bounded global concurrency limiter so
    // two people (or two threads) messaging at once never block each other, yet
    // the host is not overwhelmed by unbounded parallel agy subprocesses.
    this._convQueues = new Map();
    this._inflight = new Set();
    this.maxConcurrentAgy = opts.maxConcurrentAgy || Number(process.env.WAYSIDE_MAX_CONCURRENT_AGY) || 2;
    this._agyActive = 0;
    this._agyWaiters = [];

    // Live agent tuning (personality / model) sourced from the browser P2P
    // 'agent-tuning-update' control message or the Agent Registry sheet.
    this.agentTuning = process.env.WAYSIDE_AGENT_TUNING || process.env.AGENT_TUNING || '';
    this.agentModelOverride = process.env.AGY_MODEL || '';
    this.agentsSheetId = opts.agentsSheetId || process.env.AGENTS_SHEET_ID || '';
    this._lastTuningFetchMs = 0;

    // Durable per-thread sheet/doc registry so the agent remembers which
    // Waymarks belong to a thread across daemon restarts.
    this._diskRegistry = new Map();
  }

  /* ---------- Concurrency: bounded agy slots ---------- */

  async _acquireAgySlot() {
    if (this._agyActive < this.maxConcurrentAgy) {
      this._agyActive += 1;
      return;
    }
    await new Promise((resolve) => this._agyWaiters.push(resolve));
  }

  _releaseAgySlot() {
    const next = this._agyWaiters.shift();
    if (next) {
      next();
    } else {
      this._agyActive = Math.max(0, this._agyActive - 1);
    }
  }

  /** Await every per-conversation queue to settle (cron / single-pass friendly). */
  async _drainQueues() {
    while (this._inflight.size > 0) {
      await Promise.allSettled([...this._inflight]);
    }
  }

  /* ---------- Conversation memory ---------- */

  /**
   * Append a turn to a conversation, bounded to MAX_CONV_TURNS turns and
   * MAX_TURN_CHARS characters each.
   * @param {object} conv
   * @param {string} role
   * @param {string} text
   */
  _recordTurn(conv, role, text) {
    conv.history.push({ role, text: String(text || '').slice(0, MAX_TURN_CHARS) });
    if (conv.history.length > MAX_CONV_TURNS) {
      conv.history.splice(0, conv.history.length - MAX_CONV_TURNS);
    }
  }

  /** Register a sheet/doc against the thread's durable registry. */
  _registerThreadFile(conv, { sheetId = '', sheetTitle = '', templateKey = '', docId = '', docTitle = '' } = {}) {
    if (!Array.isArray(conv.sheets)) conv.sheets = [];
    if (!Array.isArray(conv.docs)) conv.docs = [];
    if (sheetId && !conv.sheets.some(s => s.sheetId === sheetId)) {
      conv.sheets.push({ sheetId, title: sheetTitle || '', templateKey: templateKey || '' });
      if (conv.sheets.length > 30) conv.sheets.splice(0, conv.sheets.length - 30);
    }
    if (docId && !conv.docs.some(d => d.docId === docId)) {
      conv.docs.push({ docId, title: docTitle || '' });
      if (conv.docs.length > 30) conv.docs.splice(0, conv.docs.length - 30);
    }
  }

  /** Persist conversations to disk atomically so context survives restarts. */
  _persistConversations() {
    try {
      const dir = path.dirname(CONVERSATIONS_FILE);
      mkdirSync(dir, { recursive: true });
      const snapshot = {};
      for (const [key, conv] of this.conversations.entries()) {
        if (!key.includes('::')) continue; // only persist canonical conv keys
        snapshot[key] = {
          history: (conv.history || []).slice(-MAX_CONV_TURNS),
          lastSheetId: conv.lastSheetId || null,
          lastDocId: conv.lastDocId || null,
          lastTemplateKey: conv.lastTemplateKey || null,
          threadId: conv.threadId || 'default',
          threadTitle: conv.threadTitle || '',
          sheets: (conv.sheets || []).slice(-30),
          docs: (conv.docs || []).slice(-30),
        };
      }
      const tmp = `${CONVERSATIONS_FILE}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify(snapshot) + '\n', { mode: 0o600 });
      renameSync(tmp, CONVERSATIONS_FILE);
    } catch { /* non-fatal: Drive sheet remains the durable store */ }
  }

  /** Load the per-thread sheet/doc registry + pointers from disk. */
  _restoreConversationRegistry() {
    try {
      if (!existsSync(CONVERSATIONS_FILE)) return;
      const data = JSON.parse(readFileSync(CONVERSATIONS_FILE, 'utf8'));
      for (const [key, conv] of Object.entries(data || {})) {
        this._diskRegistry.set(key, {
          lastSheetId: conv.lastSheetId || null,
          lastDocId: conv.lastDocId || null,
          lastTemplateKey: conv.lastTemplateKey || null,
          sheets: Array.isArray(conv.sheets) ? conv.sheets : [],
          docs: Array.isArray(conv.docs) ? conv.docs : [],
        });
      }
    } catch { /* ignore corrupt cache */ }
  }

  /* ---------- Live agent tuning ---------- */

  /**
   * Refresh the agent tuning (personality / model) from the browser-provided
   * tuning file. Throttled to once per 60s unless forced.
   * @param {boolean} [force]
   */
  async refreshAgentTuning(force = false) {
    const now = Date.now();
    if (!force && now - this._lastTuningFetchMs < 60_000) return;
    this._lastTuningFetchMs = now;
    try {
      const tuningPath = path.join(os.homedir(), '.config', 'gcloud', 'waymark-agent-tuning.json');
      if (existsSync(tuningPath)) {
        const meta = JSON.parse(readFileSync(tuningPath, 'utf8'));
        if (typeof meta?.tuning === 'string') this.agentTuning = meta.tuning;
        if (meta?.model) this.agentModelOverride = meta.model;
      }
    } catch { /* keep current tuning */ }
  }

  /** Persist a tuning update (from the browser P2P control message). */
  _saveAgentTuning({ tuning = '', model = '', agentName = '', updatedBy = '' } = {}) {
    try {
      const gcloudDir = path.join(os.homedir(), '.config', 'gcloud');
      mkdirSync(gcloudDir, { recursive: true });
      writeFileSync(
        path.join(gcloudDir, 'waymark-agent-tuning.json'),
        JSON.stringify({ tuning, model, agentName, updatedBy, updatedAt: new Date().toISOString() }, null, 2) + '\n',
        { mode: 0o600 }
      );
      if (typeof tuning === 'string') this.agentTuning = tuning;
      if (model) this.agentModelOverride = model;
    } catch (err) {
      console.warn(`[WaysideOrchestrator] ⚠️ Could not persist agent tuning: ${err.message}`);
    }
  }

  /** Broadcast (or target) a live agent status pill to the chat UI. */
  sendAgentStatus({ state = 'working', text = '', threadId = 'default', previewText = '', targetPeerId = '' } = {}) {
    if (!this.peer) return;
    const payload = {
      type: 'typing',
      text: null,
      statusText: text || 'Working on your Waymark…',
      state,
      previewText: previewText || '',
      peerId: this.peerId,
      name: this.agentName,
      threadId,
      ts: Date.now(),
    };
    try {
      if (targetPeerId && typeof this.peer.sendDataToPeer === 'function') {
        if (this.peer.sendDataToPeer(targetPeerId, payload)) return;
      }
      this.peer.broadcast(payload);
    } catch { /* best-effort */ }
  }

  /**
   * Resolve the user email, ensure the 4-tab ledger structure, and seed the
   * processed-message cache — preserving any recent (< 10 min) unanswered
   * trailing user messages so they are still answered after a restart.
   * Shared by both the persistent daemon (start) and the single pass (runOnce).
   */
  async _seedLedgerState() {
    if (!this.sheetId) {
      throw new Error('WaysideOrchestrator requires a valid sheetId (Share Ledger).');
    }
    this.running = true;
    this._restoreConversationRegistry();
    await this.refreshAgentTuning(true).catch(() => {});
    if (!this.userEmail) {
      this.userEmail = await resolveCurrentUserEmail();
    }
    console.log(`[WaysideOrchestrator] Starting as '${this.agentName}' (${this.peerId}) on ledger ${this.sheetId}...`);

    // Ensure ledger has all 4 Share Ledger tabs
    await ensureLedgerStructure(this.sheetId);

    // Seed existing Shared_Docs IDs to avoid appending duplicate rows on follow-up edits
    const sharedRows = await readTabRows(this.sheetId, SHARED_DOCS_TAB);
    for (let i = 1; i < sharedRows.length; i++) {
      const docId = String(sharedRows[i]?.[0] || '').trim();
      if (docId) this.knownSharedDocIds.add(docId);
    }

    // Seed processedMessageIds from Chat tab while preserving any recent (< 10 min) unanswered trailing user messages
    const history = await readTabRows(this.sheetId, CHAT_TAB);
    if (history.length > 0 && history[0]?.[0]) {
      this.processedMessageIds.add(String(history[0][0]).trim());
    }
    let lastAiIdx = 0;
    for (let i = 1; i < history.length; i++) {
      const senderCol = String(history[i]?.[2] || '').trim().toLowerCase();
      if (senderCol === this.agentEmail.toLowerCase()) {
        lastAiIdx = i;
      }
    }
    const recentCutoffMs = Date.now() - (10 * 60 * 1000);
    for (let i = 1; i < history.length; i++) {
      const [rawId, rawTs, rawSender, rawTarget, rawText, rawLink] = history[i] || [];
      const msgId = String(rawId || '').trim();
      if (!msgId) continue;
      let isSeeded = false;
      if (i <= lastAiIdx) {
        this.processedMessageIds.add(msgId);
        isSeeded = true;
      } else {
        const msgTs = Date.parse(String(rawTs || ''));
        if (!Number.isFinite(msgTs) || msgTs < recentCutoffMs) {
          this.processedMessageIds.add(msgId);
          isSeeded = true;
        }
      }
      if (isSeeded && rawText) {
        const { threadId, threadTitle } = WaysideOrchestrator.parseThreadMeta(rawTarget);
        const senderLower = String(rawSender || '').trim().toLowerCase();
        const isAi = senderLower === this.agentEmail.toLowerCase();
        const ownerKey = (this.userEmail || (!isAi ? senderLower : '') || 'unknown').toLowerCase();
        const convKey = `${ownerKey}::${threadId}`;
        const conv = this.conversations.get(convKey) || {
          history: [],
          lastSheetId: null,
          lastDocId: null,
          lastTemplateKey: null,
          threadId,
          threadTitle: threadTitle || '',
          sheets: [],
          docs: [],
        };
        // Hydrate the durable sheet/doc registry + pointers once per thread so a
        // restart still knows which Waymarks belong here (incl. templateKey).
        if (!conv._hydrated) {
          const reg = this._diskRegistry.get(convKey);
          if (reg) {
            if (!conv.lastSheetId && reg.lastSheetId) conv.lastSheetId = reg.lastSheetId;
            if (!conv.lastDocId && reg.lastDocId) conv.lastDocId = reg.lastDocId;
            if (!conv.lastTemplateKey && reg.lastTemplateKey) conv.lastTemplateKey = reg.lastTemplateKey;
            if (Array.isArray(reg.sheets) && reg.sheets.length) conv.sheets = reg.sheets.slice(-30);
            if (Array.isArray(reg.docs) && reg.docs.length) conv.docs = reg.docs.slice(-30);
          }
          conv._hydrated = true;
        }
        if (threadTitle && !conv.threadTitle) conv.threadTitle = threadTitle;
        if (/^\/?(clear|reset)(\s+(context|history|chat|thread))?$/i.test(String(rawText).trim())) {
          conv.history = [];
          conv.lastSheetId = null;
          conv.lastDocId = null;
          conv.lastTemplateKey = null;
        } else {
          this._recordTurn(conv, isAi ? this.agentName : (rawSender || ownerKey), String(rawText));
          const foundSheet = extractSpreadsheetId(String(rawLink || '')) || extractSpreadsheetId(String(rawText || ''));
          if (foundSheet) conv.lastSheetId = foundSheet;
        }
        this.conversations.set(convKey, conv);
        if (threadId === 'default') {
          this.conversations.set(ownerKey, conv);
        }
      }
    }
    console.log(`[WaysideOrchestrator] Loaded ${this.processedMessageIds.size} historical chat messages into cache.`);
  }

  /**
   * Run a single catch-up pass: answer any pending trailing messages on the
   * Chat tab, drain the processing queue, publish offline presence, then return.
   * No WebRTC peer or polling timers are started — cron / systemd-timer friendly.
   */
  async runOnce() {
    await this._seedLedgerState();
    await this.pollChatTab();
    await this._drainQueues();
    await this.publishPresence('offline').catch(() => {});
    this.running = false;
    console.log('[WaysideOrchestrator] Single polling pass complete.');
  }

  async start() {
    await this._seedLedgerState();

    // Publish online presence on Presence tab
    await this.publishPresence('online').catch(() => {});
    this.presenceTimer = setInterval(() => this.publishPresence('online').catch(() => {}), this.presenceIntervalMs);

    // Initialize WebRTC P2P Mesh on WebRTC_Signaling tab (matching WaymarkConnect blockStart=2 & peerId election)
    this.peer = new SheetWebRtcPeer({
      sheetId: this.sheetId,
      peerId: this.peerId,
      displayName: this.agentName,
      getToken: getAuthToken,
      tabName: SIGNALING_TAB,
      blockStart: 2,
      initiatorRule: 'peerId',
      onConnect: (remotePeerId) => {
        console.log(`[WaysideOrchestrator] WebRTC Peer connected: ${remotePeerId}`);
      },
      onMessage: (remotePeerId, data) => {
        this.handleWebRtcMessage(remotePeerId, data);
      },
    });
    await this.peer.start().catch(err => {
      console.warn(`[WaysideOrchestrator] WebRTC signaling start warning: ${err.message}`);
    });

    // Catch up immediately on any unanswered pre-boot messages, then start periodic polling
    this.pollChatTab().catch(() => {});
    this.pollTimer = setInterval(() => this.pollChatTab().catch(() => {}), this.pollIntervalMs);
    console.log(`[WaysideOrchestrator] Online. Listening via WebRTC DataChannel + Sheet polling (${this.pollIntervalMs}ms).`);
  }

  async stop() {
    this.running = false;
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.presenceTimer) clearInterval(this.presenceTimer);
    await this.publishPresence('offline').catch(() => {});
    if (this.peer) {
      try {
        if (typeof this.peer.leave === 'function') await this.peer.leave();
        else this.peer.destroy();
      } catch {}
      this.peer = null;
    }
    console.log(`[WaysideOrchestrator] Stopped.`);
  }

  async publishPresence(status = 'online') {
    const row = [
      this.agentEmail,
      this.agentName,
      '',
      status,
      new Date().toISOString(),
      'home',
    ];
    const rows = await readTabRows(this.sheetId, PRESENCE_TAB);
    const existingIdx = rows.findIndex((r, i) => i > 0 && (r[0] || '').toLowerCase() === this.agentEmail.toLowerCase());
    if (existingIdx >= 1) {
      const sheetRow = existingIdx + 1;
      await updateTabRange(this.sheetId, `${PRESENCE_TAB}!A${sheetRow}:F${sheetRow}`, [row]);
    } else {
      await appendTabRows(this.sheetId, PRESENCE_TAB, [row]);
    }
  }

  handleWebRtcMessage(remotePeerId, data) {
    if (!data) return;

    // Live agent tuning (personality/model) pushed from the browser UI.
    if (data.type === 'agent-tuning-update') {
      const sender = String(data.sender || data.updatedBy || '').trim().toLowerCase();
      this._saveAgentTuning({
        tuning: typeof data.tuning === 'string' ? data.tuning : '',
        model: data.model || '',
        agentName: data.agentName || this.agentName,
        updatedBy: sender,
      });
      this._lastTuningFetchMs = Date.now();
      const ack = {
        type: 'agent-tuning-ack',
        ok: true,
        requestId: data.requestId || '',
        sender: this.agentEmail,
        ts: Date.now(),
      };
      const peer = this.peer || this.webrtcPeer;
      if (peer) {
        try {
          if (typeof peer.sendDataToPeer === 'function' && peer.sendDataToPeer(remotePeerId, ack)) return;
          peer.broadcast(ack);
        } catch {}
      }
      return;
    }

    // Handle P2P OAuth credential tunnel setup from the Waymark browser frontend
    if (data.type === 'agent-oauth-setup' && data.tokenBundle) {
      const peer = this.peer || this.webrtcPeer;
      const sender = String(data.sender || data.email || '').trim().toLowerCase();
      if (this.userEmail && sender && sender !== this.userEmail.toLowerCase() && !this.allowedUsers.includes(sender)) {
        if (peer) {
          try {
            peer.broadcast({
              type: 'agent-oauth-ack',
              ok: false,
              error: `Only the agent host (${this.userEmail}) or authorized collaborators can update OAuth credentials.`,
              requestId: data.requestId || '',
              sender: this.agentEmail,
              ts: Date.now(),
            });
          } catch {}
        }
        return;
      }

      const res = WaysideOrchestrator.applyOAuthTokenBundle(data.tokenBundle, {
        ...(this.oauthSetupOpts || {}),
        sender,
      });
      if (res.ok && sender && !this.userEmail) {
        this.userEmail = sender;
      }
      if (peer) {
        try {
          peer.broadcast({
            type: 'agent-oauth-ack',
            ok: res.ok,
            error: res.error || '',
            hasRefreshToken: Boolean(res.hasRefreshToken),
            requestId: data.requestId || '',
            sender: this.agentEmail,
            configuredBy: sender || remotePeerId,
            ts: Date.now(),
          });
        } catch {}
      }
      return;
    }

    if (data.type === 'agent-p2p-sheet-ready' && data.requestId) {
      const waiter = this._p2pSheetWaiters.get(data.requestId);
      if (waiter) {
        this._p2pSheetWaiters.delete(data.requestId);
        waiter(data);
      }
      return;
    }

    if (data.type !== 'message' || !data.text) return;
    const messageId = String(data.messageId || data.id || `${data.peerId}:${data.ts}`).trim();
    if (this.processedMessageIds.has(messageId)) return;

    // Ignore messages from self using peerId or agentEmail
    const rawSender = (data.sender || data.email || data.name || '').trim();
    if ((data.peerId && data.peerId === this.peerId) || rawSender.toLowerCase() === this.agentEmail.toLowerCase()) {
      return;
    }

    if (!WaysideOrchestrator.shouldRespondToMessage(data.text, {
      isGroup: this.isGroup,
      agentName: this.agentName,
      agentEmail: this.agentEmail,
    })) {
      this.processedMessageIds.add(messageId);
      return;
    }

    const senderEmail = rawSender.includes('@')
      ? rawSender.toLowerCase()
      : (String(data.email || '').includes('@') ? String(data.email).trim().toLowerCase() : (this.userEmail || rawSender || remotePeerId));
    if (data.tokenBundle && senderEmail && senderEmail.includes('@')) {
      WaysideOrchestrator.applyOAuthTokenBundle(data.tokenBundle, {
        ...(this.oauthSetupOpts || {}),
        sender: senderEmail,
      });
    }
    const threadMeta = data.threadId
      ? { threadId: String(data.threadId).trim() || 'default', threadTitle: String(data.threadTitle || '').trim() }
      : WaysideOrchestrator.parseThreadMeta(data.target || '');

    this.queueMessageProcessing({
      text: data.text,
      sender: senderEmail,
      displayName: (data.name || senderEmail.split('@')[0] || 'Waymarker').trim(),
      messageId,
      remotePeerId,
      fromWebRtc: true,
      threadId: threadMeta.threadId,
      threadTitle: threadMeta.threadTitle,
    });
  }

  async pollChatTab() {
    if (!this.running) return;
    try {
      const rows = await readTabRows(this.sheetId, CHAT_TAB);
      if (rows.length < 2) return;

      for (let i = 1; i < rows.length; i++) {
        const [id, ts, senderEmail, target, text, link] = rows[i];
        const msgId = String(id || '').trim();
        if (!msgId || this.processedMessageIds.has(msgId)) continue;

        // Skip our own messages
        if (senderEmail && senderEmail.toLowerCase() === this.agentEmail.toLowerCase()) {
          this.processedMessageIds.add(msgId);
          continue;
        }

        const cleanTarget = String(target || '').trim();
        if (cleanTarget === '__agent_oauth_setup__' && text) {
          this.processedMessageIds.add(msgId);
          try {
            const payload = JSON.parse(text);
            const tokenSender = String(payload.sender || senderEmail || this.userEmail || '').trim().toLowerCase();
            if (payload.tokenBundle) {
              const res = WaysideOrchestrator.applyOAuthTokenBundle(payload.tokenBundle, {
                ...(this.oauthSetupOpts || {}),
                sender: tokenSender,
              });
              // Scrub the raw token from the sheet immediately after ingesting
              const sheetRowNum = i + 1;
              await updateTabRange(this.sheetId, `${CHAT_TAB}!E${sheetRowNum}:E${sheetRowNum}`, [[
                `[🔑 OAuth credentials configured for ${tokenSender || 'Waymarker'}]`,
              ]]).catch(() => {});

              const peer = this.peer || this.webrtcPeer;
              if (peer) {
                try {
                  peer.broadcast({
                    type: 'agent-oauth-ack',
                    ok: res.ok,
                    error: res.error || '',
                    hasRefreshToken: Boolean(res.hasRefreshToken),
                    requestId: payload.requestId || msgId,
                    sender: this.agentEmail,
                    configuredBy: tokenSender,
                    ts: Date.now(),
                  });
                } catch {}
              }
            }
          } catch {}
          continue;
        }

        if (text && text.trim()) {
          if (!WaysideOrchestrator.shouldRespondToMessage(text, {
            isGroup: this.isGroup,
            agentName: this.agentName,
            agentEmail: this.agentEmail,
          })) {
            this.processedMessageIds.add(msgId);
            continue;
          }

          const normalizedSender = (senderEmail || this.userEmail || 'Waymarker').trim();
          if (!this.userEmail && normalizedSender.includes('@')) {
            this.userEmail = normalizedSender.toLowerCase();
          }
          const threadMeta = WaysideOrchestrator.parseThreadMeta(target);
          this.queueMessageProcessing({
            text: text.trim(),
            sender: normalizedSender,
            displayName: normalizedSender.split('@')[0] || 'Waymarker',
            messageId: msgId,
            fromWebRtc: false,
            threadId: threadMeta.threadId,
            threadTitle: threadMeta.threadTitle,
          });
        }
      }
    } catch (err) {
      // transient network error, keep running
    }
  }

  queueMessageProcessing(item) {
    if (this.processedMessageIds.has(item.messageId)) return;
    this.processedMessageIds.add(item.messageId);

    // Instant feedback: the sender sees a typing indicator + "Thinking…" pill
    // immediately, even while this task waits behind others on its own thread.
    const threadId = item.threadId || 'default';
    this.broadcastTyping(threadId);
    this.sendAgentStatus({ state: 'queued', text: 'Thinking…', threadId, targetPeerId: item.remotePeerId });

    // Per-conversation queue: the same sender+thread is serialized (no glare),
    // but different people / threads run concurrently (bounded by the agy slot).
    const senderKey = String(item.sender || this.userEmail || 'unknown').toLowerCase();
    const convKey = `${senderKey}::${threadId}`;
    const prev = this._convQueues.get(convKey) || Promise.resolve();
    const next = prev
      .then(() => this.processMessage(item))
      .catch(err => {
        console.error(`[WaysideOrchestrator] Error processing message ${item.messageId}:`, err);
      });
    this._convQueues.set(convKey, next);
    this._inflight.add(next);
    next.finally(() => {
      this._inflight.delete(next);
      if (this._convQueues.get(convKey) === next) this._convQueues.delete(convKey);
    });
  }

  /**
   * Decide which Google identity a request must run as — and whether we can run
   * it at all without landing files in the wrong Drive.
   *
   * Rules (bulletproof over permissive):
   * - Personal agent (no collaborators): the owner is the only user, so the
   *   default host token is always correct.
   * - The owner messaging their own shared agent: default host token.
   * - A collaborator: require their durable per-account token AND verify the
   *   token actually represents them. No token / wrong token / no email → we
   *   refuse rather than silently fall back to the host.
   * @param {string} senderKey — lowercased requester key (ideally an email)
   * @returns {{ tokenPath: string|null, actingAs: string, canActAsRequester: boolean, reason: string }}
   */
  resolveRequesterIdentity(senderKey) {
    const gcloudDir = path.join(os.homedir(), '.config', 'gcloud');
    const defaultOAuthPath = process.env.WAYMARK_OAUTH_TOKEN_PATH
      || path.join(gcloudDir, 'waymark-oauth-token.json');
    const hostEmail = (identityForToken(defaultOAuthPath) || this.userEmail || '').trim().toLowerCase();
    const isPersonalAgent = !this.isGroup && (!this.allowedUsers || this.allowedUsers.length === 0);
    const key = String(senderKey || '').trim().toLowerCase();

    if (isPersonalAgent) {
      return { tokenPath: existsSync(defaultOAuthPath) ? defaultOAuthPath : null, actingAs: hostEmail, canActAsRequester: existsSync(defaultOAuthPath), reason: 'personal-agent' };
    }

    if (key && hostEmail && key === hostEmail) {
      return { tokenPath: existsSync(defaultOAuthPath) ? defaultOAuthPath : null, actingAs: hostEmail, canActAsRequester: existsSync(defaultOAuthPath), reason: 'host-owner' };
    }

    if (key.includes('@')) {
      const perPath = perAccountTokenPath(key, gcloudDir);
      if (perPath && existsSync(perPath)) {
        const tokenEmail = identityForToken(perPath);
        if (tokenEmail && tokenEmail === key) {
          return { tokenPath: perPath, actingAs: tokenEmail, canActAsRequester: true, reason: 'collaborator-token' };
        }
        return { tokenPath: null, actingAs: '', canActAsRequester: false, reason: tokenEmail ? 'token-identity-mismatch' : 'token-unreadable' };
      }
      return { tokenPath: null, actingAs: '', canActAsRequester: false, reason: 'no-collaborator-token' };
    }

    return { tokenPath: null, actingAs: '', canActAsRequester: false, reason: 'no-sender-email' };
  }

  /**
   * Friendly, actionable reply when we won't act as the requester. We never
   * create in the wrong Drive — instead we tell them exactly how to connect.
   * @param {string} friendlyName
   * @param {string} reason — from resolveRequesterIdentity
   * @returns {string}
   */
  static buildConnectAccountReply(friendlyName, reason) {
    const who = friendlyName || 'there';
    if (reason === 'no-sender-email') {
      return `Hi ${who}! I couldn't tell which account this request is coming from, so I won't risk creating it in the wrong place. Please send again from the Waymark app while you're signed in, and I'll build it right in your Drive.`;
    }
    return `Hi ${who}! To build this **in your own Google Drive** — so you fully own it and it isn't buried in someone else's account — I need you to connect your Google account to me first. Open **Settings → Waymark AI Agent** in Waymark and connect your account (it's a one-time, one-tap step). Then resend your request and I'll create everything under your account. 🔐`;
  }

  async processMessage({ text, sender, displayName, messageId, remotePeerId, fromWebRtc, threadId = 'default', threadTitle = '' }) {
    let activeThreadId = String(threadId || 'default').trim() || 'default';
    let activeThreadTitle = String(threadTitle || '').trim();
    if (fromWebRtc && activeThreadId === 'default' && messageId && this.sheetId) {
      try {
        await new Promise((r) => setTimeout(r, 400));
        const rows = await readTabRows(this.sheetId, CHAT_TAB);
        const matchRow = rows.find((r, i) => i > 0 && String(r[0] || '').trim() === String(messageId).trim());
        if (matchRow?.[3]) {
          const parsed = WaysideOrchestrator.parseThreadMeta(matchRow[3]);
          if (parsed.threadId && parsed.threadId !== 'default') {
            activeThreadId = parsed.threadId;
            activeThreadTitle = parsed.threadTitle || activeThreadTitle;
          }
        }
      } catch {}
    }
    console.log(`[WaysideOrchestrator] 📨 Processing from ${sender} (thread: ${activeThreadId}): "${text}"`);

    // 1. Send immediate typing indicator
    this.broadcastTyping(activeThreadId);

    const senderKey = (sender || this.userEmail || 'unknown').toLowerCase();
    const convKey = `${senderKey}::${activeThreadId}`;
    const friendlyName = displayName || sender.split('@')[0] || 'Waymarker';
    const conv = this.conversations.get(convKey) || (activeThreadId === 'default' ? this.conversations.get(senderKey) : null) || {
      history: [],
      lastSheetId: null,
      lastDocId: null,
      lastTemplateKey: null,
      threadId: activeThreadId,
      threadTitle: activeThreadTitle || '',
    };
    if (activeThreadTitle && !conv.threadTitle) {
      conv.threadTitle = activeThreadTitle;
    }

    // Handle explicit /clear or reset context command without invoking AGY
    if (/^\/?(clear|reset)(\s+(context|history|chat|thread))?$/i.test(String(text || '').trim())) {
      conv.history = [];
      conv.lastSheetId = null;
      conv.lastDocId = null;
      conv.lastTemplateKey = null;
      this.conversations.set(convKey, conv);
      if (activeThreadId === 'default') this.conversations.set(senderKey, conv);

      const recipientEmail = sender.includes('@') ? sender : (this.userEmail || sender);
      await this.deliverReply({
        replyText: '🧹 Conversation context cleared for this thread! Your sheets and previous threads remain safely stored in Google Drive — what would you like to work on next?',
        targetUser: recipientEmail,
        shareTargets: [],
        threadId: activeThreadId,
        threadTitle: conv.threadTitle,
      });
      return;
    }

    // Compute household/collaborator share list so created sheets/docs are accessible to the requester
    const shareTargets = parseEmailList([
      sender,
      this.userEmail,
      ...this.allowedUsers,
    ]);

    // 2. Classify intent
    const classification = classifyMessage(text);
    const explicitSheetId = extractSpreadsheetId(text);
    // Reuse the thread's current sheet for edits/adjustments. Do NOT drop the
    // context just because the message contains "make"/"create"/"new" — "make
    // the budget $500" must still target the existing budget. Only a request for
    // a clearly DISTINCT new artifact forces a fresh sheet.
    const explicitNew = /\b(new|another|separate|different|fresh)\b[^.]*\b(sheet|spreadsheet|board|list|tracker|plan|itinerary|budget|doc|document|kanban|recipe|roster)\b/i.test(text)
      || /\bstart\s+over\b/i.test(text);
    const editOrReference = /\b(add|append|update|change|edit|remove|delete|mark|complete|move|set|rename|adjust|fix|put|make|increase|decrease|search|find|show|list)\b/i.test(text)
      || /\b(it|that|this|there|the\s+(sheet|board|list|budget|plan|itinerary|tracker|doc)|row\s*\d+)\b/i.test(text);
    const isFollowUp = Boolean(conv.lastSheetId) && !explicitNew && editOrReference;
    const targetSheetId = explicitSheetId || (isFollowUp ? conv.lastSheetId : null);
    const effectiveTemplateKey = classification.templateKey || (targetSheetId ? conv.lastTemplateKey : null);

    let replyText = '';
    let createdSheetId = null;
    let shouldLinkSheet = false;
    let createdSheetTitle = null;
    let createdDocId = null;
    let shouldLinkDoc = false;
    let createdDocTitle = null;

    const staticIntro = `Hello ${friendlyName}! 👋 I'm **${this.agentName}**, your autonomous assistant inside The Wayside.\n\n`
      + `I can create, inspect, search, and update sheets across all ${CATALOG.templates?.length || 41} Waymark templates — including Kanban, Budget, Travel, Meal, CRM, Recipes, Party, and Checklists.\n\n`
      + `Try asking me something like:\n`
      + `• *"Create a 4-day travel itinerary for Paris in spring"*\n`
      + `• *"Make a weekly meal plan for 2200 kcal high protein"*\n`
      + `• *"Build a sprint backlog for a new mobile app"*`;

    if (classification.isConversation || classification.isHelp) {
      // Route greetings/help through agy in a fast, no-MCP conversational mode so
      // the reply reflects the configured personality and thread context — fall
      // back to the friendly static intro only if agy is unavailable or errors.
      await this.refreshAgentTuning().catch(() => {});
      let typingTimer = null;
      try {
        if (fromWebRtc) this.sendAgentStatus({ state: 'thinking', text: 'Thinking…', threadId: activeThreadId, targetPeerId: remotePeerId });
        typingTimer = setInterval(() => this.broadcastTyping(activeThreadId), 3500);
        const convContext = conv.history.length > 0
          ? `Recent conversation:\n${conv.history.slice(-6).map(h => `- ${h.role}: ${h.text}`).join('\n')}`
          : '';
        await this._acquireAgySlot();
        let convResult;
        try {
          convResult = await runAgyTask({
            task: text,
            isConversation: true,
            tuning: this.agentTuning,
            context: convContext,
            expectedEmail: '',
            model: this.agentModelOverride || undefined,
          });
        } finally {
          this._releaseAgySlot();
        }
        replyText = convResult.ok && convResult.output ? convResult.output : staticIntro;
      } catch {
        replyText = staticIntro;
      } finally {
        if (typingTimer) clearInterval(typingTimer);
      }
    } else {
      if (fromWebRtc) {
        this.broadcastTyping(activeThreadId);
      }
      await this.refreshAgentTuning().catch(() => {});

      const contextLines = [`User '${sender}' requested this in Wayside social chat.`];
      if (conv.threadTitle) contextLines.push(`Active thread: ${conv.threadTitle}`);
      if (conv.lastSheetId) contextLines.push(`Most recent Waymark spreadsheet in this thread: ${conv.lastSheetId}`);
      if (conv.lastDocId) contextLines.push(`Most recent Google Doc in this thread: ${conv.lastDocId}`);
      const threadSheets = Array.isArray(conv.sheets) ? conv.sheets.slice(-10) : [];
      if (threadSheets.length > 0) {
        contextLines.push(`Sheets in this thread:\n${threadSheets.map(s => `- ${s.title || 'Untitled'}${s.templateKey ? ` [${s.templateKey}]` : ''}: ${s.sheetId}`).join('\n')}`);
      }
      if (conv.history.length > 0) {
        contextLines.push(`Recent conversation history:\n${conv.history.slice(-8).map(h => `- ${h.role}: ${h.text}`).join('\n')}`);
      }

      console.log(`[WaysideOrchestrator] 🚀 Dispatching to AGY (template: ${effectiveTemplateKey || 'auto'}, sheet: ${targetSheetId || 'none'}, codeTask: ${Boolean(classification.isCodeTask)})...`);

      // Resolve WHICH Google account this request must run as. For a shared /
      // group agent this MUST be the specific requester — never a silent fall
      // back to the host, which is exactly how Waymarks ended up created in the
      // wrong Drive and then merely shared back.
      const identity = this.resolveRequesterIdentity(senderKey);
      console.log(`[WaysideOrchestrator] 👤 Requester='${senderKey}' → actingAs='${identity.actingAs || '(none)'}' | canAct=${identity.canActAsRequester} | ${identity.reason} | token='${identity.tokenPath || 'none'}'`);

      if (classification.isCodeTask) {
        const recipientEmail = sender.includes('@') ? sender : (this.userEmail || sender);
        const ackText = `🛠️ **Starting work on your request:**\n> "${text}"\n\nI'm checking out a feature branch, implementing the code changes, and opening a Pull Request for review. I'll post the branch and PR link here as soon as it's up on GitHub! 🚀`;

        // Update conversation memory with user message and acknowledgment
        this._recordTurn(conv, sender, text);
        this._recordTurn(conv, this.agentName, ackText);
        this.conversations.set(convKey, conv);
        if (activeThreadId === 'default') this.conversations.set(senderKey, conv);
        this._persistConversations();

        // Immediate acknowledgment delivered into the Wayside chat
        await this.deliverReply({
          replyText: ackText,
          targetUser: recipientEmail,
          shareTargets,
          threadId: activeThreadId,
          threadTitle: conv.threadTitle,
        });

        // Run the agent task asynchronously in the background so it can spin as needed without timing out or blocking chat
        (async () => {
          let typingTimer = null;
          await this._acquireAgySlot();
          try {
            typingTimer = setInterval(() => {
              this.broadcastTyping(activeThreadId);
              this.sendAgentStatus({ state: 'coding', text: 'Implementing & opening a PR…', threadId: activeThreadId, targetPeerId: remotePeerId });
            }, 3500);
            console.log(`[WaysideOrchestrator] 🚀 Async background code task starting for '${senderKey}' in thread '${activeThreadId}'...`);
            const agyResult = await runAgyTask({
              task: text,
              templateKey: null,
              sheetId: null,
              context: contextLines.join('\n'),
              shareWith: shareTargets,
              tuning: this.agentTuning,
              tokenPath: identity.tokenPath,
              expectedEmail: '',
              isCodeTask: true,
              onProgress: ({ statusText }) => {
                if (statusText) this.sendAgentStatus({ state: 'coding', text: statusText, threadId: activeThreadId, targetPeerId: remotePeerId });
              },
            });

            let completionText = '';
            if (agyResult.ok) {
              completionText = agyResult.output;
            } else {
              const who = agyResult.actingAs ? ` (acting as ${agyResult.actingAs})` : '';
              completionText = `⚠️ I couldn't complete that PR request${who}.\n\n${agyResult.error}${agyResult.logFile ? `\n\nLog: \`${agyResult.logFile}\`` : ''}`;
            }

            this._recordTurn(conv, this.agentName, completionText);
            this.conversations.set(convKey, conv);
            this._persistConversations();

            await this.deliverReply({
              replyText: completionText,
              targetUser: recipientEmail,
              shareTargets,
              threadId: activeThreadId,
              threadTitle: conv.threadTitle,
            });
            console.log(`[WaysideOrchestrator] ✅ Background code task completed & delivered to '${recipientEmail}' in thread '${activeThreadId}'`);
          } catch (err) {
            console.error(`[WaysideOrchestrator] ❌ Error in background code task:`, err);
            await this.deliverReply({
              replyText: `⚠️ An unexpected error occurred while processing the code task: ${err.message}`,
              targetUser: recipientEmail,
              shareTargets,
              threadId: activeThreadId,
              threadTitle: conv.threadTitle,
            }).catch(() => {});
          } finally {
            this._releaseAgySlot();
            if (typingTimer) clearInterval(typingTimer);
          }
        })();
        return;
      }

      if (!identity.canActAsRequester) {
        // Refuse to create/modify under the wrong account. Tell the requester
        // exactly how to connect so their next request lands in THEIR Drive.
        console.warn(`[WaysideOrchestrator] ⛔ Not acting for '${senderKey}' (${identity.reason}) — refusing host fallback so nothing is created in the wrong account.`);
        replyText = WaysideOrchestrator.buildConnectAccountReply(friendlyName, identity.reason);
      } else {
        // Record the active requester so every MCP child is deterministic, then
        // dispatch with an explicit identity assertion (expectedEmail) as a final
        // safety net inside the runner.
        if (identity.actingAs && identity.tokenPath) {
          try {
            const gcloudDir = path.join(os.homedir(), '.config', 'gcloud');
            mkdirSync(gcloudDir, { recursive: true });
            writeFileSync(
              path.join(gcloudDir, 'waymark-active-requester.json'),
              JSON.stringify({
                sender: identity.actingAs || senderKey,
                tokenPath: identity.tokenPath,
                updatedAt: Date.now(),
              }, null, 2) + '\n',
              { mode: 0o600 }
            );
          } catch (err) {
            console.warn(`[WaysideOrchestrator] ⚠️ Could not persist active-requester pointer: ${err.message}`);
          }
        }

        let typingTimer = null;
        await this._acquireAgySlot();
        let agyResult;
        try {
          typingTimer = setInterval(() => {
            this.broadcastTyping(activeThreadId);
            this.sendAgentStatus({ state: 'working', text: 'Working on your Waymark…', threadId: activeThreadId, targetPeerId: remotePeerId });
          }, 3500);
          agyResult = await runAgyTask({
            task: text,
            templateKey: effectiveTemplateKey,
            candidateTemplates: classification.candidateTemplates || [],
            sheetId: targetSheetId,
            threadSheets,
            context: contextLines.join('\n'),
            shareWith: shareTargets,
            tuning: this.agentTuning,
            tokenPath: identity.tokenPath,
            expectedEmail: identity.actingAs,
            isCodeTask: false,
            model: this.agentModelOverride || undefined,
            onProgress: ({ statusText }) => {
              if (statusText) this.sendAgentStatus({ state: 'working', text: statusText, threadId: activeThreadId, targetPeerId: remotePeerId });
            },
          });
        } finally {
          this._releaseAgySlot();
          if (typingTimer) clearInterval(typingTimer);
        }

        if (agyResult.ok) {
          replyText = agyResult.output;
          createdSheetId = agyResult.sheetId;
          createdDocId = agyResult.docId;
          shouldLinkSheet = Boolean(createdSheetId && !this.knownSharedDocIds.has(createdSheetId));
          shouldLinkDoc = Boolean(createdDocId && !this.knownSharedDocIds.has(createdDocId));
          createdSheetTitle = agyResult.sheetTitle || (classification.templateName ? `${classification.templateName} Plan` : 'Shared Waymark');
          createdDocTitle = agyResult.docTitle || 'Waymark Document';
          // Register EVERY sheet/doc the task produced so multi-artifact requests
          // are all tracked against the thread and shared downstream.
          for (const s of (agyResult.allSheets || [])) {
            this._registerThreadFile(conv, { sheetId: s.sheetId, sheetTitle: s.title, templateKey: effectiveTemplateKey || '' });
          }
          for (const d of (agyResult.allDocs || [])) {
            this._registerThreadFile(conv, { docId: d.docId, docTitle: d.title });
          }
          if (createdSheetId) this._registerThreadFile(conv, { sheetId: createdSheetId, sheetTitle: createdSheetTitle, templateKey: effectiveTemplateKey || '' });
          if (createdDocId) this._registerThreadFile(conv, { docId: createdDocId, docTitle: createdDocTitle });
        } else if (agyResult.identityMismatch) {
          console.error(`[WaysideOrchestrator] ❌ Identity guard tripped for '${senderKey}': ${agyResult.error}`);
          replyText = WaysideOrchestrator.buildConnectAccountReply(friendlyName, 'identity-mismatch');
        } else {
          const who = agyResult.actingAs ? ` (acting as ${agyResult.actingAs})` : '';
          console.error(`[WaysideOrchestrator] ❌ Task failed${who}: ${agyResult.error}${agyResult.logFile ? ` | log: ${agyResult.logFile}` : ''}`);
          replyText = `⚠️ I couldn't finish that request${who}.\n\n${agyResult.error}\n\nI've logged the full details for debugging. Please try again or rephrase.`;
        }
      }
    }

    // Update per-sender & per-thread conversation memory
    this._recordTurn(conv, sender, text);
    this._recordTurn(conv, this.agentName, replyText);
    if (createdSheetId) conv.lastSheetId = createdSheetId;
    if (createdDocId) conv.lastDocId = createdDocId;
    if (effectiveTemplateKey) conv.lastTemplateKey = effectiveTemplateKey;
    this.conversations.set(convKey, conv);
    if (activeThreadId === 'default') {
      this.conversations.set(senderKey, conv);
    }
    this._persistConversations();

    // 3. Deliver reply
    const recipientEmail = sender.includes('@') ? sender : (this.userEmail || sender);
    await this.deliverReply({
      replyText,
      targetUser: recipientEmail,
      shareTargets,
      createdSheetId,
      shouldLinkSheet,
      createdSheetTitle,
      createdDocId,
      shouldLinkDoc,
      createdDocTitle,
      templateKey: effectiveTemplateKey,
      threadId: activeThreadId,
      threadTitle: conv.threadTitle,
    });
  }

  broadcastTyping(threadId = 'default') {
    if (this.peer) {
      try {
        this.peer.broadcast({ type: 'typing', text: null, peerId: this.peerId, name: this.agentName, threadId, ts: Date.now() });
      } catch {}
    }
  }

  async ensureSheetAccessibleToRequester(sheetId, { targetUser = '', title = 'Waymark Sheet', shareTargets = [] } = {}) {
    const cleanTarget = String(targetUser || '').trim().toLowerCase();
    if (!sheetId || !cleanTarget || !cleanTarget.includes('@')) return sheetId;
    try {
      const gcloudDir = path.join(os.homedir(), '.config', 'gcloud');
      const perAccountPath = perAccountTokenPath(cleanTarget, gcloudDir);
      let userAccessToken = null;
      if (perAccountPath && existsSync(perAccountPath)) {
        try {
          const tok = JSON.parse(readFileSync(perAccountPath, 'utf8'));
          if (tok?.access_token && (!tok.expiry_date || Date.now() < Number(tok.expiry_date) - 30_000)) {
            userAccessToken = tok.access_token;
          }
        } catch {}
      }

      if (userAccessToken) {
        const checkRes = await fetchWithTimeout(`https://www.googleapis.com/drive/v3/files/${sheetId}?fields=id`, {
          headers: { Authorization: `Bearer ${userAccessToken}` },
        });
        if (checkRes.ok) return sheetId;
      }

      // Sheet is not accessible under requester's drive.file scope — read rows using host token
      const hostToken = await getAuthToken();
      const valRes = await fetchWithTimeout(`${SHEETS_BASE}/${sheetId}/values/A1:Z200`, {
        headers: { Authorization: `Bearer ${hostToken}` },
      });
      if (!valRes.ok) return sheetId;
      const valData = await valRes.json();
      const rows = valData.values || [];
      if (!rows.length) return sheetId;

      // Option 1: Re-create using requester's per-account OAuth token
      if (userAccessToken) {
        const createRes = await fetchWithTimeout(SHEETS_BASE, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${userAccessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ properties: { title: title || 'Shared Waymark' } }),
        });
        if (createRes.ok) {
          const created = await createRes.json();
          const newId = created.spreadsheetId;
          if (newId) {
            await fetchWithTimeout(`${SHEETS_BASE}/${newId}/values/A1?valueInputOption=USER_ENTERED`, {
              method: 'PUT',
              headers: {
                Authorization: `Bearer ${userAccessToken}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ values: rows }),
            });
            for (const email of shareTargets) {
              if (email && email.toLowerCase() !== cleanTarget) {
                await fetchWithTimeout(`https://www.googleapis.com/drive/v3/files/${newId}/permissions?sendNotificationEmail=false`, {
                  method: 'POST',
                  headers: {
                    Authorization: `Bearer ${userAccessToken}`,
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({ type: 'user', role: 'writer', emailAddress: email }),
                }).catch(() => {});
              }
            }
            console.log(`[WaysideOrchestrator] 🔄 Re-hosted sheet ${sheetId} -> ${newId} under ${cleanTarget} drive.file token`);
            return newId;
          }
        }
      }

      // Option 2: Ask requester's connected browser frontend over P2P WebRTC DataChannel to create the sheet
      const peer = this.peer || this.webrtcPeer;
      if (peer) {
        const requestId = `p2p-sheet-${Date.now().toString(36)}`;
        const p2pResult = await new Promise((resolve) => {
          const timer = setTimeout(() => {
            this._p2pSheetWaiters.delete(requestId);
            resolve(null);
          }, 15000);
          this._p2pSheetWaiters.set(requestId, (res) => {
            clearTimeout(timer);
            resolve(res);
          });
          try {
            peer.broadcast({
              type: 'agent-p2p-ensure-sheet',
              requestId,
              targetEmail: cleanTarget,
              title: title || 'Shared Waymark',
              rows,
              shareWith: shareTargets,
            });
          } catch {
            clearTimeout(timer);
            this._p2pSheetWaiters.delete(requestId);
            resolve(null);
          }
        });
        if (p2pResult?.ok && p2pResult.sheetId) {
          console.log(`[WaysideOrchestrator] 🌐 Created sheet ${p2pResult.sheetId} via ${cleanTarget} browser P2P frontend`);
          return p2pResult.sheetId;
        }
      }
    } catch {}
    return sheetId;
  }

  async deliverReply({ replyText, targetUser, shareTargets = [], createdSheetId, shouldLinkSheet, createdSheetTitle, createdDocId, shouldLinkDoc, createdDocTitle, templateKey, threadId = 'default', threadTitle = '' }) {
    const replyId = `msg-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    this.processedMessageIds.add(replyId);

    if (createdSheetId && shouldLinkSheet && targetUser) {
      const accessibleId = await this.ensureSheetAccessibleToRequester(createdSheetId, {
        targetUser,
        title: createdSheetTitle,
        shareTargets,
      });
      if (accessibleId && accessibleId !== createdSheetId) {
        replyText = String(replyText || '').replaceAll(createdSheetId, accessibleId);
        createdSheetId = accessibleId;
      }
    }

    let attachedLink = '';
    if (createdSheetId) {
      attachedLink = `#/sheet/${createdSheetId}`;
    } else if (createdDocId) {
      attachedLink = `https://docs.google.com/document/d/${createdDocId}/edit`;
    }

    // Ensure the requester and any allowed household members have writer access on newly created/linked files
    const effectiveShares = parseEmailList([...shareTargets, targetUser]);
    if (createdSheetId && effectiveShares.length > 0) {
      await shareFileWithEmails(createdSheetId, effectiveShares);
    }
    if (createdDocId && effectiveShares.length > 0) {
      await shareFileWithEmails(createdDocId, effectiveShares);
    }

    // A. Link newly discovered/created sheet or doc into Shared_Docs FIRST (deduplicated)
    // so when the WebRTC DataChannel message triggers refreshWaysideSocial() in the browser,
    // the Shared_Docs row is already committed in Google Sheets.
    if (createdSheetId && shouldLinkSheet && !this.knownSharedDocIds.has(createdSheetId)) {
      try {
        await appendTabRows(this.sheetId, SHARED_DOCS_TAB, [[
          createdSheetId,
          createdSheetTitle || 'Shared Waymark',
          templateKey || 'Waymark',
          targetUser || '',
          this.group || '',
          'writer',
          new Date().toISOString(),
          'Shared',
        ]]);
        this.knownSharedDocIds.add(createdSheetId);
        console.log(`[WaysideOrchestrator] 📄 Added sheet ${createdSheetId} to Shared_Docs in ledger!`);
      } catch (err) {
        console.error('[WaysideOrchestrator] Error appending sheet to Shared_Docs:', err.message);
      }
    }

    if (createdDocId && shouldLinkDoc && !this.knownSharedDocIds.has(createdDocId)) {
      try {
        await appendTabRows(this.sheetId, SHARED_DOCS_TAB, [[
          createdDocId,
          createdDocTitle || 'Shared Document',
          'doc',
          targetUser || '',
          this.group || '',
          'writer',
          new Date().toISOString(),
          'Shared',
        ]]);
        this.knownSharedDocIds.add(createdDocId);
        console.log(`[WaysideOrchestrator] 📝 Added doc ${createdDocId} to Shared_Docs in ledger!`);
      } catch (err) {
        console.error('[WaysideOrchestrator] Error appending doc to Shared_Docs:', err.message);
      }
    }

    // B. Append reply to Chat tab for durability before broadcasting
    const targetColValue = WaysideOrchestrator.formatThreadTarget(
      this.group || targetUser || '',
      threadId,
      threadTitle
    );
    try {
      await appendTabRows(this.sheetId, CHAT_TAB, [[
        replyId,
        new Date().toISOString(),
        this.agentEmail,
        targetColValue,
        replyText,
        attachedLink,
      ]]);
    } catch (err) {
      console.error('[WaysideOrchestrator] Error appending reply to Chat tab:', err.message);
    }

    // C. Broadcast over WebRTC DataChannel (instant display + triggers browser Shared_Docs refresh)
    if (this.peer) {
      try {
        const payload = {
          type: 'message',
          messageId: replyId,
          id: replyId,
          peerId: this.peerId,
          name: this.agentName,
          sender: this.agentEmail,
          text: replyText,
          attachedLink,
          threadId: threadId || 'default',
          threadTitle: threadTitle || '',
          ts: Date.now(),
        };
        this.peer.broadcast(payload);
      } catch (err) {
        console.warn('[WaysideOrchestrator] WebRTC broadcast failed:', err.message);
      }
    }

    console.log(`[WaysideOrchestrator] ✅ Reply delivered (${replyId}).`);
  }
}

// ── CLI Launch ─────────────────────────────────────────────────────────

function isMainModule(metaUrl) {
  if (!process.argv[1]) return false;
  try {
    const a = realpathSync(fileURLToPath(metaUrl));
    const b = realpathSync(path.resolve(process.argv[1]));
    return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
  } catch {
    const a = path.resolve(fileURLToPath(metaUrl));
    const b = path.resolve(process.argv[1]);
    return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
  }
}

if (isMainModule(import.meta.url)) {
  const args = process.argv.slice(2);
  let sheetId = process.env.WAYSIDE_LEDGER_ID || process.env.WAYMARK_SHEET_ID || null;
  let allowedUsersArg = process.env.WAYSIDE_ALLOWED_USERS || '';
  let groupsArg = process.env.WAYSIDE_GROUPS || '';
  let once = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--sheet' && args[i + 1]) { sheetId = args[++i]; }
    else if (args[i] === '--allowed-users' && args[i + 1]) { allowedUsersArg = args[++i]; }
    else if (args[i] === '--groups' && args[i + 1]) { groupsArg = args[++i]; }
    else if (args[i] === '--once') { once = true; }
    else if (!sheetId && !args[i].startsWith('--')) { sheetId = args[i]; }
  }

  (async () => {
    let ledgers = [];
    if (sheetId) {
      ledgers = [{ sheetId, userEmail: '', isGroup: false, group: '' }];
    } else {
      console.log('[WaysideOrchestrator] No --sheet specified; discovering or provisioning Wayside Share Ledger(s) in Drive...');
      ledgers = await WaysideOrchestrator.discoverAllLedgers({
        allowedUsers: allowedUsersArg,
        groups: groupsArg,
      });
      for (const l of ledgers) {
        const label = l.isGroup ? `group:${l.group}` : (l.userEmail || 'primary');
        console.log(`[WaysideOrchestrator] Using Wayside Share Ledger (${label}): ${l.sheetId}`);
      }
    }

    const orchestrators = ledgers.map(l => new WaysideOrchestrator({
      sheetId: l.sheetId,
      userEmail: l.userEmail,
      isGroup: l.isGroup,
      group: l.group,
      allowedUsers: allowedUsersArg,
    }));

    if (once) {
      await Promise.all(orchestrators.map(o => o.runOnce()));
      process.exit(0);
    }

    const activeBySheetId = new Map();
    for (const o of orchestrators) {
      activeBySheetId.set(o.sheetId, o);
    }
    await Promise.all(orchestrators.map(o => o.start()));

    // Periodically sweep Drive for any newly shared/created AI ledgers so collaborators
    // added via the browser UI are picked up automatically without restarting the service.
    let discoveryTimer = null;
    if (!sheetId) {
      discoveryTimer = setInterval(async () => {
        try {
          const current = await WaysideOrchestrator.discoverAllLedgers({
            allowedUsers: allowedUsersArg,
            groups: groupsArg,
          });
          for (const l of current) {
            if (!l?.sheetId || activeBySheetId.has(l.sheetId)) continue;
            const label = l.isGroup ? `group:${l.group}` : (l.userEmail || 'collaborator');
            console.log(`[WaysideOrchestrator] ✨ Auto-discovered new Wayside Share Ledger (${label}): ${l.sheetId}`);
            const orch = new WaysideOrchestrator({
              sheetId: l.sheetId,
              userEmail: l.userEmail,
              isGroup: l.isGroup,
              group: l.group,
              allowedUsers: allowedUsersArg,
            });
            activeBySheetId.set(l.sheetId, orch);
            orchestrators.push(orch);
            orch.start().catch(err => {
              console.warn(`[WaysideOrchestrator] Failed to start auto-discovered ledger ${l.sheetId}: ${err.message}`);
            });
          }
        } catch {}
      }, 15_000);
    }

    const shutdown = async () => {
      if (discoveryTimer) clearInterval(discoveryTimer);
      console.log('\nShutting down Wayside Orchestrator(s)...');
      await Promise.all(orchestrators.map(o => o.stop()));
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  })().catch(err => {
    console.error('[WaysideOrchestrator] Fatal error starting orchestrator:', err);
    process.exit(1);
  });
}
