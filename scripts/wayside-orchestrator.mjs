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

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { SheetWebRtcPeer } from '../mcp/sheet-webrtc-peer.mjs';
import { runAgyTask, extractSpreadsheetId } from './agy-agent-runner.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

/* ---------- Configuration ---------- */

export const AGENT_NAME = process.env.WAYSIDE_AGENT_NAME || 'Waymark AI';
export const AGENT_EMAIL = process.env.WAYSIDE_AGENT_EMAIL || 'assistant@waymark.internal';
export const CHAT_TAB = 'Chat';
export const SHARED_DOCS_TAB = 'Shared_Docs';
export const PRESENCE_TAB = 'Presence';
export const SIGNALING_TAB = 'WebRTC_Signaling';
const POLL_INTERVAL_MS = parseInt(process.env.WAYSIDE_POLL_INTERVAL_MS || '4000', 10);
const PRESENCE_INTERVAL_MS = parseInt(process.env.WAYSIDE_PRESENCE_INTERVAL_MS || '30000', 10);

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

/**
 * Get an OAuth access token using Service Account credentials or OAuth token file.
 * @returns {Promise<string>}
 */
export async function getAuthToken() {
  // 1. Try OAuth token file if available
  const oauthPath = process.env.WAYMARK_OAUTH_TOKEN_PATH ||
    `${process.env.HOME || '/root'}/.config/gcloud/waymark-oauth-token.json`;
  if (existsSync(oauthPath)) {
    try {
      const data = JSON.parse(readFileSync(oauthPath, 'utf8'));
      if (data.access_token && (!data.expiry_date || Date.now() < data.expiry_date - 60000)) {
        return data.access_token;
      }
      if (data.refresh_token && data.client_id && data.client_secret) {
        const res = await fetch(TOKEN_URL, {
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
        if (ref.access_token) return ref.access_token;
      }
    } catch { /* fallback to service account */ }
  }

  // 2. Service account key file
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS ||
    `${process.env.HOME || '/root'}/.config/gcloud/waymark-service-account-key.json`;

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

    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: jwt,
      }),
    });
    const tokenData = await response.json();
    if (tokenData.access_token) return tokenData.access_token;
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
  const res = await fetch(`${SHEETS_BASE}${pathUrl}`, opts);
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Sheets API ${res.status}: ${txt}`);
  }
  return res.json();
}

/**
 * Append row(s) to a spreadsheet tab.
 */
export async function appendTabRows(sheetId, tabName, rows) {
  return sheetsApi(`/${sheetId}/values/${encodeURIComponent(tabName)}:append?valueInputOption=USER_ENTERED`, {
    method: 'POST',
    body: { values: rows },
  });
}

/**
 * Read all rows from a spreadsheet tab.
 */
export async function readTabRows(sheetId, tabName) {
  try {
    const data = await sheetsApi(`/${sheetId}/values/${encodeURIComponent(tabName)}`);
    return data.values || [];
  } catch (err) {
    return [];
  }
}

/**
 * Update a range in a spreadsheet tab.
 */
export async function updateTabRange(sheetId, range, rows) {
  return sheetsApi(`/${sheetId}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`, {
    method: 'PUT',
    body: { range, majorDimension: 'ROWS', values: rows },
  });
}

/**
 * Ensure Shared_Docs, Presence, Chat, and WebRTC_Signaling tabs exist with headers
 * matching the 4-tab Share Ledger schema in public/js/collab.js.
 */
export async function ensureLedgerStructure(sheetId) {
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

/**
 * Auto-discover an existing Wayside Share Ledger in Google Drive or provision one.
 * @returns {Promise<string>} spreadsheetId
 */
export async function discoverOrCreateWaysideLedger() {
  const token = await getAuthToken();
  const driveBase = process.env.DRIVE_BASE || 'https://www.googleapis.com/drive/v3/files';
  const q = "name contains '.waymark-ledger-' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false";
  const url = `${driveBase}?q=${encodeURIComponent(q)}&fields=files(id,name,modifiedTime)&orderBy=modifiedTime desc&pageSize=20`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.ok) {
    const data = await res.json();
    const files = data.files || [];
    const aiLedger = files.find(f => (f.name || '').includes(AGENT_EMAIL));
    if (aiLedger?.id) return aiLedger.id;
    if (files[0]?.id) return files[0].id;
  }

  // Create a dedicated Wayside Share Ledger
  const title = `.waymark-ledger-contact-${AGENT_EMAIL}`;
  const created = await sheetsApi('', {
    method: 'POST',
    body: {
      properties: { title },
      sheets: [
        { properties: { title: SHARED_DOCS_TAB } },
        { properties: { title: PRESENCE_TAB } },
        { properties: { title: CHAT_TAB } },
        { properties: { title: SIGNALING_TAB } },
      ],
    },
  });
  await ensureLedgerStructure(created.spreadsheetId);
  return created.spreadsheetId;
}

/* ---------- Intent & Template Routing ---------- */

/**
 * Classify a user message into a template or conversational intent.
 * @param {string} text
 * @returns {{ templateKey: string|null, templateName: string|null, isHelp: boolean, isConversation: boolean }}
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
      };
    }
  }

  // 2. Check conversational / greetings
  const greetingWords = ['hi', 'hello', 'hey', 'howdy', 'greetings', 'help', 'what can you do', 'who are you'];
  const isGreeting = greetingWords.some(g => clean === g || clean.startsWith(`${g} `) || clean.startsWith(`${g}!`) || clean.startsWith(`${g},`));
  const isHelpQuery = clean.includes('help') || clean.includes('what can you do') || clean.includes('who are you');

  if (isGreeting || isHelpQuery) {
    return {
      templateKey: null,
      templateName: null,
      isHelp: isHelpQuery,
      isConversation: true,
    };
  }

  // Check keywordRoutes (with fuzzy / plural / singular support)
  let bestRoute = null;
  let maxMatches = 0;
  for (const route of CATALOG.keywordRoutes || []) {
    let matches = 0;
    for (const rawKw of route.keywords || []) {
      const kw = rawKw.toLowerCase();
      // Match exact substring
      if (clean.includes(kw)) {
        matches += 2;
      } else if (kw.endsWith('s') && clean.includes(kw.slice(0, -1))) {
        // e.g. "expenses" -> match "expense"
        matches += 2;
      } else if (!kw.endsWith('s') && clean.includes(`${kw}s`)) {
        // e.g. "deal" -> match "deals"
        matches += 2;
      }
    }
    if (matches > maxMatches) {
      maxMatches = matches;
      bestRoute = route;
    }
  }

  if (bestRoute && maxMatches > 0) {
    const key = bestRoute.agent.replace(/^waymark-/, '');
    const tmpl = (CATALOG.templates || []).find(t => t.key === key);
    return {
      templateKey: key,
      templateName: tmpl ? tmpl.name : key,
      isHelp: false,
      isConversation: false,
    };
  }

  // Check template detectSignals
  let bestTmpl = null;
  let maxSignals = 0;
  for (const tmpl of CATALOG.templates || []) {
    let signals = 0;
    for (const sig of tmpl.detectSignals || []) {
      if (clean.includes(sig.toLowerCase())) signals++;
    }
    if (signals > maxSignals) {
      maxSignals = signals;
      bestTmpl = tmpl;
    }
  }

  if (bestTmpl && maxSignals >= 2) {
    return {
      templateKey: bestTmpl.key,
      templateName: bestTmpl.name,
      isHelp: false,
      isConversation: false,
    };
  }

  return {
    templateKey: null,
    templateName: null,
    isHelp: false,
    isConversation: false,
  };
}

/* ---------- Orchestrator Daemon Core ---------- */

export class WaysideOrchestrator {
  constructor(opts = {}) {
    this.sheetId = opts.sheetId;
    this.peerId = opts.peerId || `ai-${crypto.randomBytes(3).toString('hex')}`;
    this.agentName = opts.agentName || AGENT_NAME;
    this.agentEmail = opts.agentEmail || AGENT_EMAIL;
    this.pollIntervalMs = opts.pollIntervalMs || POLL_INTERVAL_MS;
    this.presenceIntervalMs = opts.presenceIntervalMs || PRESENCE_INTERVAL_MS;

    this.peer = null;
    this.processedMessageIds = new Set();
    this.conversations = new Map();
    this.pollTimer = null;
    this.presenceTimer = null;
    this.running = false;
    this._processingQueue = Promise.resolve();
  }

  async start() {
    if (!this.sheetId) {
      throw new Error('WaysideOrchestrator requires a valid sheetId (Share Ledger).');
    }
    this.running = true;
    console.log(`[WaysideOrchestrator] Starting as '${this.agentName}' (${this.peerId}) on ledger ${this.sheetId}...`);

    // Ensure ledger has all 4 Share Ledger tabs
    await ensureLedgerStructure(this.sheetId);

    // Seed existing message IDs from Chat tab to prevent processing historical messages on restart
    const history = await readTabRows(this.sheetId, CHAT_TAB);
    for (const row of history) {
      if (row[0]) this.processedMessageIds.add(String(row[0]).trim());
    }
    console.log(`[WaysideOrchestrator] Loaded ${this.processedMessageIds.size} existing chat messages into cache.`);

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

    // Start background poll loop for async catch-up
    this.pollTimer = setInterval(() => this.pollChatTab().catch(() => {}), this.pollIntervalMs);
    console.log(`[WaysideOrchestrator] Online. Listening via WebRTC DataChannel + Sheet polling (${this.pollIntervalMs}ms).`);
  }

  async stop() {
    this.running = false;
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.presenceTimer) clearInterval(this.presenceTimer);
    await this.publishPresence('offline').catch(() => {});
    if (this.peer) {
      try { this.peer.destroy(); } catch {}
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
    if (!data || data.type !== 'message' || !data.text) return;
    const messageId = String(data.messageId || data.id || `${data.peerId}:${data.ts}`).trim();
    if (this.processedMessageIds.has(messageId)) return;

    // Ignore messages from self
    const sender = (data.name || data.sender || '').trim();
    if (sender === this.agentName || (data.peerId && data.peerId === this.peerId)) return;

    this.queueMessageProcessing({
      text: data.text,
      sender: sender || remotePeerId,
      messageId,
      remotePeerId,
      fromWebRtc: true,
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

        if (text && text.trim()) {
          this.queueMessageProcessing({
            text: text.trim(),
            sender: senderEmail || 'Waymarker',
            messageId: msgId,
            fromWebRtc: false,
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

    this._processingQueue = this._processingQueue
      .then(() => this.processMessage(item))
      .catch(err => {
        console.error(`[WaysideOrchestrator] Error processing message ${item.messageId}:`, err);
      });
  }

  async processMessage({ text, sender, messageId, remotePeerId, fromWebRtc }) {
    console.log(`[WaysideOrchestrator] 📨 Processing from ${sender}: "${text}"`);

    // 1. Send immediate typing indicator
    this.broadcastTyping();

    const senderKey = (sender || 'unknown').toLowerCase();
    const conv = this.conversations.get(senderKey) || {
      history: [],
      lastSheetId: null,
      lastDocId: null,
      lastTemplateKey: null,
    };

    // 2. Classify intent
    const classification = classifyMessage(text);
    const explicitSheetId = extractSpreadsheetId(text);
    const isFollowUp = /\b(add|append|update|change|edit|remove|delete|mark|complete|move|set|search|find|show|list|what'?s\s+on|in\s+it|to\s+it|that\s+sheet)\b/i.test(text)
      && !/\b(create|build|make|start|new)\b/i.test(text);
    const targetSheetId = explicitSheetId || (isFollowUp ? conv.lastSheetId : null);
    const effectiveTemplateKey = classification.templateKey || (targetSheetId ? conv.lastTemplateKey : null);

    let replyText = '';
    let createdSheetId = null;
    let createdSheetTitle = null;
    let createdDocId = null;
    let createdDocTitle = null;

    if (classification.isConversation || classification.isHelp) {
      replyText = `Hello ${sender.split('@')[0]}! 👋 I'm **${this.agentName}**, your autonomous assistant inside The Wayside.\n\n`
        + `I can create, inspect, search, and update sheets across all ${CATALOG.templates?.length || 41} Waymark templates — including Kanban, Budget, Travel, Meal, CRM, Recipes, Party, and Checklists.\n\n`
        + `Try asking me something like:\n`
        + `• *"Create a 4-day travel itinerary for Paris in spring"*\n`
        + `• *"Make a weekly meal plan for 2200 kcal high protein"*\n`
        + `• *"Build a sprint backlog for a new mobile app"*`;
    } else {
      if (fromWebRtc) {
        this.broadcastTyping();
      }

      const contextLines = [`User '${sender}' requested this in Wayside social chat.`];
      if (conv.lastSheetId) contextLines.push(`Most recent Waymark spreadsheet in conversation: ${conv.lastSheetId}`);
      if (conv.lastDocId) contextLines.push(`Most recent Google Doc in conversation: ${conv.lastDocId}`);
      if (conv.history.length > 0) {
        contextLines.push(`Recent conversation history:\n${conv.history.slice(-4).map(h => `- ${h.role}: ${h.text}`).join('\n')}`);
      }

      console.log(`[WaysideOrchestrator] 🚀 Dispatching to AGY (template: ${effectiveTemplateKey || 'auto'}, sheet: ${targetSheetId || 'none'})...`);
      const agyResult = await runAgyTask({
        task: text,
        templateKey: effectiveTemplateKey,
        sheetId: targetSheetId,
        context: contextLines.join('\n'),
      });

      if (agyResult.ok) {
        replyText = agyResult.output;
        createdSheetId = agyResult.sheetId;
        createdDocId = agyResult.docId;
        createdSheetTitle = agyResult.sheetTitle || (classification.templateName ? `${classification.templateName} Plan` : 'New Waymark');
        createdDocTitle = agyResult.docTitle || 'Waymark Document';
      } else {
        replyText = `I encountered an issue executing your request: ${agyResult.error}\n\nPlease try again or clarify your prompt.`;
      }
    }

    // Update per-sender conversation memory
    conv.history.push({ role: sender, text: text.slice(0, 300) });
    conv.history.push({ role: this.agentName, text: replyText.slice(0, 300) });
    if (conv.history.length > 10) conv.history.splice(0, conv.history.length - 10);
    if (createdSheetId) conv.lastSheetId = createdSheetId;
    if (createdDocId) conv.lastDocId = createdDocId;
    if (effectiveTemplateKey) conv.lastTemplateKey = effectiveTemplateKey;
    this.conversations.set(senderKey, conv);

    // 3. Deliver reply
    await this.deliverReply({
      replyText,
      targetUser: sender,
      createdSheetId,
      createdSheetTitle,
      createdDocId,
      createdDocTitle,
      templateKey: effectiveTemplateKey,
    });
  }

  broadcastTyping() {
    if (this.peer) {
      try {
        this.peer.broadcast({ type: 'typing', name: this.agentName, ts: Date.now() });
      } catch {}
    }
  }

  async deliverReply({ replyText, targetUser, createdSheetId, createdSheetTitle, createdDocId, createdDocTitle, templateKey }) {
    const replyId = `msg-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
    this.processedMessageIds.add(replyId);

    let attachedLink = '';
    if (createdSheetId) {
      attachedLink = `#/sheet/${createdSheetId}`;
    } else if (createdDocId) {
      attachedLink = `https://docs.google.com/document/d/${createdDocId}/edit`;
    }

    // A. Broadcast over WebRTC DataChannel (instant display)
    if (this.peer) {
      try {
        const payload = {
          type: 'message',
          messageId: replyId,
          id: replyId,
          name: this.agentName,
          sender: this.agentEmail,
          text: replyText,
          attachedLink,
          ts: Date.now(),
        };
        this.peer.broadcast(payload);
      } catch (err) {
        console.warn('[WaysideOrchestrator] WebRTC broadcast failed:', err.message);
      }
    }

    // B. Append to Chat tab for durability
    try {
      await appendTabRows(this.sheetId, CHAT_TAB, [[
        replyId,
        new Date().toISOString(),
        this.agentEmail,
        targetUser || '',
        replyText,
        attachedLink,
      ]]);
    } catch (err) {
      console.error('[WaysideOrchestrator] Error appending reply to Chat tab:', err.message);
    }

    // C. If a sheet was created, link it into Shared_Docs (8-column Share Ledger schema)
    if (createdSheetId) {
      try {
        await appendTabRows(this.sheetId, SHARED_DOCS_TAB, [[
          createdSheetId,
          createdSheetTitle || 'Shared Waymark',
          templateKey || 'Waymark',
          targetUser || '',
          '',
          'writer',
          new Date().toISOString(),
          'Shared',
        ]]);
        console.log(`[WaysideOrchestrator] 📄 Added sheet ${createdSheetId} to Shared_Docs in ledger!`);
      } catch (err) {
        console.error('[WaysideOrchestrator] Error appending sheet to Shared_Docs:', err.message);
      }
    }

    // D. If a doc was created, link it into Shared_Docs (8-column Share Ledger schema)
    if (createdDocId) {
      try {
        await appendTabRows(this.sheetId, SHARED_DOCS_TAB, [[
          createdDocId,
          createdDocTitle || 'Shared Document',
          'doc',
          targetUser || '',
          '',
          'writer',
          new Date().toISOString(),
          'Shared',
        ]]);
        console.log(`[WaysideOrchestrator] 📝 Added doc ${createdDocId} to Shared_Docs in ledger!`);
      } catch (err) {
        console.error('[WaysideOrchestrator] Error appending doc to Shared_Docs:', err.message);
      }
    }

    console.log(`[WaysideOrchestrator] ✅ Reply delivered (${replyId}).`);
  }
}

// ── CLI Launch ─────────────────────────────────────────────────────────

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  let sheetId = process.env.WAYSIDE_LEDGER_ID || process.env.WAYMARK_SHEET_ID || null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--sheet' && args[i + 1]) { sheetId = args[++i]; }
    else if (!sheetId && !args[i].startsWith('--')) { sheetId = args[i]; }
  }

  (async () => {
    if (!sheetId) {
      console.log('[WaysideOrchestrator] No --sheet specified; discovering or provisioning Wayside Share Ledger in Drive...');
      sheetId = await discoverOrCreateWaysideLedger();
      console.log(`[WaysideOrchestrator] Using Wayside Share Ledger: ${sheetId}`);
    }

    const orchestrator = new WaysideOrchestrator({ sheetId });
    await orchestrator.start();

    process.on('SIGINT', async () => {
      console.log('\nShutting down Wayside Orchestrator...');
      await orchestrator.stop();
      process.exit(0);
    });
    process.on('SIGTERM', async () => {
      await orchestrator.stop();
      process.exit(0);
    });
  })().catch(err => {
    console.error('[WaysideOrchestrator] Fatal error starting orchestrator:', err);
    process.exit(1);
  });
}
