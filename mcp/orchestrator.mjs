#!/usr/bin/env node
/* ============================================================
   orchestrator.mjs — Deterministic Orchestrator MCP server

   Puts the orchestrator agent on rails. All polling, routing,
   and sleeping happens in CODE — the LLM only decides whether
   to call runSubagent with the result.

   Tools:
     orchestrator_boot   — Create log dir, return session ID
     orchestrator_cycle  — Sleep → poll workboard → route → return action
     orchestrator_log    — Append a message to the session log

   The routing table is a hard-coded keyword→agent lookup.
   No LLM is involved in routing decisions.
   ============================================================ */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
    ListToolsRequestSchema,
    CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS_DIR = path.join(__dirname, "..", "scripts");
const LOG_DIR = "/agent-logs";

/* ---------- Notification state ---------- */

let _notifRules = [];          // cached parsed rules
let _rulesSheetId = process.env.WAYMARK_RULES_SHEET_ID || null; // env default; overridable at boot
let _rulesLastFetched = 0;     // epoch ms
const RULES_TTL_MS = 5 * 60 * 1000; // re-fetch every 5 min

/* ---------- Session state (automatic RETURNED detection) ---------- */
const _sessions = new Map(); // sessionId → { lastAction, lastAgentName }

/* ---------- Cycle tracking state (QA/Done thresholds + cycle rate) ---------- */
const _cycleState = new Map(); // sessionId → { lastQaCount, lastDoneCount, cycleTimestamps }

/* ---------- Template registry (for sheetId-based detection) ---------- */

const REGISTRY = JSON.parse(
    readFileSync(path.join(__dirname, "../template-registry.json"), "utf8")
);

/* ---------- Keyword → agent routing table ---------- */
// Derived from waymark-router.agent.md §3 table. Pure lookup — no LLM.

const KEYWORD_ROUTES = [
    { keywords: ["trip", "vacation", "travel", "itinerary", "route", "hotel", "flight", "destination", "road trip"], agent: "waymark-travel" },
    { keywords: ["budget", "expenses", "spending", "income", "costs", "money", "finance", "invoice"], agent: "waymark-budget" },
    { keywords: ["recipe", "cooking", "ingredients", "servings", "cuisine"], agent: "waymark-recipe" },
    { keywords: ["meal plan", "meal prep", "weekly meals", "eating schedule"], agent: "waymark-meal" },
    { keywords: ["kanban", "board", "sprint", "backlog", "cards", "swim lanes"], agent: "waymark-kanban" },
    { keywords: ["crm", "leads", "pipeline", "deals", "customers", "sales contacts"], agent: "waymark-crm" },
    { keywords: ["contacts", "address book", "people", "phone book"], agent: "waymark-contacts" },
    { keywords: ["inventory", "stock", "assets", "warehouse"], agent: "waymark-inventory" },
    { keywords: ["tracker", "milestones", "progress bar", "goals progress"], agent: "waymark-tracker" },
    { keywords: ["schedule", "calendar", "appointments", "shifts", "time slots"], agent: "waymark-schedule" },
    { keywords: ["timesheet", "time tracking", "hours worked", "billing hours"], agent: "waymark-timesheet" },
    { keywords: ["activity log", "event log", "journal", "diary"], agent: "waymark-log" },
    { keywords: ["habits", "habit tracker", "daily routine", "streaks"], agent: "waymark-habit" },
    { keywords: ["poll", "survey", "vote", "questionnaire", "responses"], agent: "waymark-poll" },
    { keywords: ["changelog", "release notes", "version history"], agent: "waymark-changelog" },
    { keywords: ["gantt", "timeline", "project phases", "dependencies"], agent: "waymark-gantt" },
    { keywords: ["okr", "objectives", "key results", "goals", "targets"], agent: "waymark-okr" },
    { keywords: ["roster", "team members", "staff list", "employees", "crew"], agent: "waymark-roster" },
    { keywords: ["knowledge base", "faq", "documentation", "wiki", "articles"], agent: "waymark-knowledge" },
    { keywords: ["guide", "tutorial", "how-to", "step-by-step"], agent: "waymark-guide" },
    { keywords: ["flow diagram", "flowchart", "process map", "decision tree"], agent: "waymark-flow" },
    { keywords: ["automation", "triggers", "workflows"], agent: "waymark-automation" },
    { keywords: ["blog", "posts", "content calendar"], agent: "waymark-blog" },
    { keywords: ["social feed", "community", "shares"], agent: "waymark-social" },
    { keywords: ["marketing", "campaigns", "promotions"], agent: "waymark-marketing" },
    { keywords: ["arcade", "games", "social game", "score"], agent: "waymark-arcade" },
    { keywords: ["iot", "sensors", "readings", "telemetry", "device data"], agent: "waymark-iot" },
    { keywords: ["grading", "gradebook", "scores", "assignments", "students"], agent: "waymark-grading" },
    { keywords: ["passwords", "credentials", "logins", "vault"], agent: "waymark-passwords" },
    { keywords: ["photos", "gallery", "images", "album"], agent: "waymark-photos" },
    { keywords: ["community linker", "resource links", "curated links"], agent: "waymark-linker" },
    { keywords: ["test cases", "qa cases", "test plan", "acceptance criteria"], agent: "waymark-testcases" },
    { keywords: ["worker jobs", "tasks queue", "job management"], agent: "waymark-worker" },
    { keywords: ["checklist", "todo list", "to-do"], agent: "waymark-checklist" },
];

// Code-related keywords that indicate waymark-builder (codebase work, not content)
const CODE_KEYWORDS = [
    "fix", "bug", "implement", "refactor", "pr", "branch", "deploy", "test",
    "css", "javascript", "html", "api", "endpoint", "component", "function",
    "module", "script", "database", "e2e", "playwright", "server", "frontend",
    "backend", "node", "express", "docker", "ci", "lint", "typescript",
];

// templateKey → agent name
const TEMPLATE_KEY_TO_AGENT = {
    kanban: "waymark-kanban", budget: "waymark-budget", checklist: "waymark-checklist",
    recipe: "waymark-recipe", travel: "waymark-travel", crm: "waymark-crm",
    contacts: "waymark-contacts", inventory: "waymark-inventory", tracker: "waymark-tracker",
    schedule: "waymark-schedule", timesheet: "waymark-timesheet", log: "waymark-log",
    habit: "waymark-habit", poll: "waymark-poll", changelog: "waymark-changelog",
    gantt: "waymark-gantt", okr: "waymark-okr", roster: "waymark-roster",
    meal: "waymark-meal", knowledge: "waymark-knowledge", guide: "waymark-guide",
    flow: "waymark-flow", automation: "waymark-automation", blog: "waymark-blog",
    social: "waymark-social", marketing: "waymark-marketing",
    arcade: "waymark-arcade", iot: "waymark-iot", grading: "waymark-grading",
    passwords: "waymark-passwords", photos: "waymark-photos", linker: "waymark-linker",
    testcases: "waymark-testcases", worker: "waymark-worker",
};

/* ---------- Google Sheets API (for template detection from sheetId) ---------- */

import { GoogleAuth } from "google-auth-library";
import { SheetWebRtcPeer } from "./sheet-webrtc-peer.mjs";

const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
let sheetsAuth = null;
if (credPath) {
    sheetsAuth = new GoogleAuth({
        keyFile: credPath,
        scopes: [
            "https://www.googleapis.com/auth/spreadsheets",
        ],
    });
}

/* ---------- WebRTC signaling peer — user-owned sheet discovery ----------
 * The .waymark-signaling sheet is created client-side (user-data.js) on
 * the user's first web-app boot and stored in their .waymark-data.json.
 * The orchestrator reads that file via the user's OAuth token to discover
 * the sheet ID — no service-account ownership or sharing required.
 */

const DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files";
const DRIVE_UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files";
const SHEETS_BASE_URL = "https://sheets.googleapis.com/v4/spreadsheets";
const OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";

/** @type {string|null} resolved sheet ID, cached in memory once resolved */
let _resolvedSignalingSheetId = null;
/** @type {SheetWebRtcPeer|null} Public-sheet peer for encrypted notification traffic */
let _signalingPeer = null;
/** @type {SheetWebRtcPeer|null} Private-sheet peer for key distribution (plaintext, OAuth-protected) */
let _privateSignalingPeer = null;
/** @type {ReturnType<typeof setInterval>|null} Health check timer for signaling peers */
let _signalingHealthTimer = null;

/**
 * Get a fresh user OAuth access token, refreshing if expired.
 * Reads from WAYMARK_OAUTH_TOKEN_PATH (same as waymark.mjs).
 * Returns null if the token file is missing or unusable.
 */
async function getUserOAuthToken() {
    const tokenPath = process.env.WAYMARK_OAUTH_TOKEN_PATH ||
        `${process.env.HOME || "/root"}/.config/gcloud/waymark-oauth-token.json`;
    let tokenData;
    try {
        tokenData = JSON.parse(readFileSync(tokenPath, "utf8"));
    } catch {
        return null;
    }
    if (!tokenData.access_token || Date.now() > (tokenData.expiry_date - 60_000)) {
        if (!tokenData.refresh_token) return null;
        const res = await fetch(OAUTH_TOKEN_URL, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                grant_type:    "refresh_token",
                refresh_token: tokenData.refresh_token,
                client_id:     tokenData.client_id,
                client_secret: tokenData.client_secret,
            }),
        });
        const refreshed = await res.json();
        if (refreshed.error || !refreshed.access_token) return null;
        tokenData.access_token = refreshed.access_token;
        tokenData.expiry_date  = Date.now() + (refreshed.expires_in * 1000);
        try {
            writeFileSync(tokenPath, JSON.stringify(tokenData, null, 2));
        } catch { /* read-only mount — ignore, token still usable this session */ }
    }
    return tokenData.access_token;
}

/** Resolved public signaling sheet ID — separate from the private key sheet */
let _resolvedPublicSignalingSheetId = null;
/** Resolved AES-256 signal key hex from the local key file */
let _resolvedSignalKeyHex = null;
/** Cached Drive file ID for .waymark-data.json (avoids repeat searches) */
let _dataFileId = null;

/* ---------- Auto-provisioning helpers ---------- */

/** Check if a Google Sheet still exists AND is not in the Trash.
 *  Uses the Drive API instead of Sheets API because the Sheets API
 *  can still successfully access trashed spreadsheets (returns 200),
 *  which would make us skip recreation after the user deletes a sheet. */
async function sheetExists(sheetId, token) {
    try {
        const res = await fetch(
            `${DRIVE_FILES_URL}/${sheetId}?fields=id,trashed`,
            { headers: { Authorization: `Bearer ${token}` } }
        );
        if (!res.ok) return false;
        const data = await res.json();
        if (data.trashed) {
            process.stderr.write(`orchestrator: sheet ${sheetId} is in Trash — treating as deleted\n`);
        }
        return data.trashed !== true;
    } catch { return false; }
}

/** Create a new empty Google Spreadsheet. Returns the spreadsheetId. */
async function createSpreadsheet(title, token) {
    const res = await fetch(SHEETS_BASE_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ properties: { title } }),
    });
    if (!res.ok) throw new Error(`createSpreadsheet(${title}) → ${res.status}: ${await res.text()}`);
    const d = await res.json();
    return d.spreadsheetId;
}

/** Search Drive for a file by exact name (first match, any location). */
async function driveFindByName(name, token) {
    const q = encodeURIComponent(`name='${name}' and trashed=false`);
    const res = await fetch(
        `${DRIVE_FILES_URL}?q=${q}&fields=files(id)&pageSize=1&spaces=drive`,
        { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) return null;
    const { files } = await res.json();
    return files?.[0]?.id ?? null;
}

/** Grant "anyone with the link can edit" on a Drive file. */
async function setPublicWritable(fileId, token) {
    const res = await fetch(`${DRIVE_FILES_URL}/${fileId}/permissions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ role: "writer", type: "anyone" }),
    });
    if (!res.ok) {
        process.stderr.write(`orchestrator: setPublicWritable(${fileId}) → ${res.status}\n`);
    }
}

/** Update a Drive file's JSON content in-place. */
async function driveUpdateJson(fileId, data, token) {
    const body = JSON.stringify(data, null, 2);
    const res = await fetch(`${DRIVE_UPLOAD_URL}/${fileId}?uploadType=media`, {
        method: "PATCH",
        headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            "Content-Length": String(Buffer.byteLength(body)),
        },
        body,
    });
    if (!res.ok) throw new Error(`driveUpdateJson(${fileId}) → ${res.status}: ${await res.text()}`);
}

/**
 * Ensure all signaling infrastructure exists. Reads .waymark-data.json once,
 * validates both sheet IDs (checking the actual sheets still exist on Drive),
 * auto-creates any missing sheets, sets public write permission, and saves
 * changes back to .waymark-data.json.
 *
 * Returns { privateSheetId, publicSheetId } or null on failure.
 * Caches both IDs so subsequent calls are instant.
 */
async function ensureSignalingInfra() {
    // Fast path: both already validated and cached
    if (_resolvedSignalingSheetId && _resolvedPublicSignalingSheetId) {
        return {
            privateSheetId: _resolvedSignalingSheetId,
            publicSheetId:  _resolvedPublicSignalingSheetId,
        };
    }

    const token = await getUserOAuthToken();
    if (!token) {
        process.stderr.write("orchestrator: OAuth token unavailable — signaling disabled\n");
        return null;
    }

    // Find .waymark-data.json in Drive (cache the file ID)
    if (!_dataFileId) {
        const q = encodeURIComponent(
            "name='.waymark-data.json' and mimeType='application/json' and trashed=false"
        );
        const searchRes = await fetch(
            `${DRIVE_FILES_URL}?q=${q}&fields=files(id)&pageSize=1&spaces=drive`,
            { headers: { Authorization: `Bearer ${token}` } }
        );
        if (!searchRes.ok) {
            process.stderr.write(`orchestrator: Drive search failed: ${searchRes.status}\n`);
            return null;
        }
        const { files } = await searchRes.json();
        if (!files?.length) {
            process.stderr.write("orchestrator: .waymark-data.json not found — user must open web app first\n");
            return null;
        }
        _dataFileId = files[0].id;
    }

    // Read current config
    const fileRes = await fetch(
        `${DRIVE_FILES_URL}/${_dataFileId}?alt=media`,
        { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!fileRes.ok) {
        process.stderr.write(`orchestrator: Drive read .waymark-data.json failed: ${fileRes.status}\n`);
        _dataFileId = null; // invalidate — might have been deleted
        return null;
    }
    const data = await fileRes.json();
    let dirty = false;

    // ── Private sheet — plaintext, OAuth-protected key exchange ──
    let privateId = data.signalingSheetId || null;
    if (privateId && !(await sheetExists(privateId, token))) {
        process.stderr.write(`orchestrator: private sheet ${privateId} deleted from Drive — recreating\n`);
        privateId = null;
    }
    if (!privateId) {
        // Search Drive by name first to avoid creating duplicates
        const found = await driveFindByName(".waymark-signaling", token);
        if (found && (await sheetExists(found, token))) {
            process.stderr.write(`orchestrator: found orphaned private sheet on Drive: ${found}\n`);
            privateId = found;
        } else {
            process.stderr.write("orchestrator: auto-provisioning private signaling sheet (.waymark-signaling)\n");
            privateId = await createSpreadsheet(".waymark-signaling", token);
            process.stderr.write(`orchestrator: created private sheet: ${privateId}\n`);
        }
        data.signalingSheetId = privateId;
        dirty = true;
    }

    // ── Public sheet — AES-256-GCM encrypted, publicly writable ──
    let publicId = data.publicSignalingSheetId || null;
    if (publicId && !(await sheetExists(publicId, token))) {
        process.stderr.write(`orchestrator: public sheet ${publicId} deleted from Drive — recreating\n`);
        publicId = null;
    }
    if (!publicId) {
        // Search Drive by name first to avoid creating duplicates
        const found = await driveFindByName(".waymark-public-signaling", token);
        if (found && (await sheetExists(found, token))) {
            process.stderr.write(`orchestrator: found orphaned public sheet on Drive: ${found}\n`);
            publicId = found;
        } else {
            process.stderr.write("orchestrator: auto-provisioning public signaling sheet (.waymark-public-signaling)\n");
            publicId = await createSpreadsheet(".waymark-public-signaling", token);
            process.stderr.write(`orchestrator: created public sheet: ${publicId}\n`);
        }
        data.publicSignalingSheetId = publicId;
        dirty = true;
    }

    // Always ensure public write permission (idempotent — safe to call if already set)
    await setPublicWritable(publicId, token);

    // Persist any changes back to Drive
    if (dirty) {
        data.updatedAt = new Date().toISOString();
        await driveUpdateJson(_dataFileId, data, token);
        process.stderr.write("orchestrator: saved updated sheet IDs to .waymark-data.json on Drive\n");
    }

    // Cache resolved IDs
    _resolvedSignalingSheetId = privateId;
    _resolvedPublicSignalingSheetId = publicId;
    process.stderr.write(`orchestrator: signaling infra ready — private=${privateId} public=${publicId}\n`);
    return { privateSheetId: privateId, publicSheetId: publicId };
}

/**
 * Invalidate cached sheet IDs so the next ensureSignalingInfra() call
 * re-reads Drive and re-validates (or re-creates) the sheets.
 */
function invalidateSignalingCache() {
    _resolvedSignalingSheetId = null;
    _resolvedPublicSignalingSheetId = null;
    process.stderr.write("orchestrator: signaling sheet cache invalidated\n");
}

/**
 * Reads the AES-256 signal key from the local key file.
 *
 * The key is NEVER stored in any Google Sheet. It lives only in:
 *   - Browser: localStorage['waymark_signal_key']
 *   - Android: SharedPreferences PREF_SIGNAL_KEY
 *   - Node:    ~/.config/gcloud/waymark-signal.key (or WAYMARK_KEY_FILE env)
 *
 * Returns the 64-char hex key, or null if not yet provisioned.
 */
function resolveSignalKey() {
    if (_resolvedSignalKeyHex) return _resolvedSignalKeyHex;

    const keyFile = process.env.WAYMARK_KEY_FILE
        || path.join(process.env.HOME || "/root", ".config/gcloud/waymark-signal.key");
    try {
        const key = readFileSync(keyFile, "utf8").trim();
        if (key.length !== 64) return null;
        _resolvedSignalKeyHex = key;
        process.stderr.write(`orchestrator: signal key resolved from ${keyFile} (${key.length / 2} bytes)\n`);
        return key;
    } catch {
        return null;
    }
}

/**
 * Generate a new AES-256 signal key, save to the local key file, and cache in memory.
 * @returns {string} 64-char hex key
 */
async function generateAndSaveSignalKey() {
    const { randomBytes: rb } = await import("node:crypto");
    const keyHex = rb(32).toString("hex");
    const keyFile = process.env.WAYMARK_KEY_FILE
        || path.join(process.env.HOME || "/root", ".config/gcloud/waymark-signal.key");
    const dir = path.dirname(keyFile);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(keyFile, keyHex + "\n", { mode: 0o600 });
    _resolvedSignalKeyHex = keyHex;
    process.stderr.write(`orchestrator: generated new signal key → ${keyFile} (32 bytes)\n`);
    return keyHex;
}

/**
 * Two-phase WebRTC signaling startup.
 *
 * Phase 1 — Private sheet (plaintext, OAuth-protected):
 *   Connects to .waymark-signaling for key distribution. When any peer joins
 *   via DataChannel, the orchestrator sends them the AES key. This peer stays
 *   alive so late-joining or rekeyed peers can always fetch the current key.
 *
 * Phase 2 — Public sheet (AES-256-GCM encrypted):
 *   Connects to .waymark-public-signaling with the key. Normal notification
 *   traffic flows here. Also sends the key if a peer requests it over DC.
 *
 * Resilience:
 *   - The public peer uses getEncryptionKey() so key rotations take effect
 *     immediately without reconnecting.
 *   - The private peer always reads the CURRENT key from _resolvedSignalKeyHex
 *     when distributing, so a rotated key is distributed correctly.
 *   - A periodic health check restarts any peer that has lost its mesh slot.
 */
async function startSignalingPeer() {
    let infra;
    try {
        infra = await ensureSignalingInfra();
    } catch (err) {
        process.stderr.write(`orchestrator: signaling infra setup failed: ${err.message}\n`);
        return;
    }
    if (!infra) return;
    const { privateSheetId, publicSheetId } = infra;

    // Read or generate the AES-256 signal key
    let signalKey = resolveSignalKey();
    if (!signalKey) {
        signalKey = await generateAndSaveSignalKey();
    }

    // Stable 8-char hex peer ID for this MCP server instance
    const { createHash } = await import("node:crypto");
    const basePeerId = createHash("sha256")
        .update("orchestrator-mcp-" + publicSheetId)
        .digest("hex")
        .slice(0, 8);

    /** Always return the freshest key — reads from cached memory variable
     *  which is updated by resolveSignalKey() / generateAndSaveSignalKey(). */
    const currentKey = () => _resolvedSignalKeyHex;

    // ── Phase 1: Private sheet — key distribution (plaintext, OAuth-protected) ──
    if (privateSheetId) {
        // Use a distinct peerId for the private sheet so both peers can coexist
        const privatePeerId = createHash("sha256")
            .update("orchestrator-mcp-private-" + privateSheetId)
            .digest("hex")
            .slice(0, 8);

        _privateSignalingPeer = new SheetWebRtcPeer({
            sheetId:     privateSheetId,
            getToken:    getUserOAuthToken,
            peerId:      privatePeerId,
            displayName: "Orchestrator MCP (Key Exchange)",
            // NO encryptionKey — plaintext signaling on the OAuth-protected private sheet
            onConnect: (remotePeerId) => {
                const key = currentKey();
                process.stderr.write(`orchestrator: peer ${remotePeerId} connected on private sheet — sending key (${key?.slice(0, 8)}…)\n`);
                if (key) _privateSignalingPeer.broadcastKeyExchange(key);
            },
            onMessage: (remotePeerId, msg) => {
                // Peers may request a key re-send
                if (msg.type === "waymark-key-request") {
                    const key = currentKey();
                    process.stderr.write(`orchestrator: key-request from ${remotePeerId} on private sheet\n`);
                    if (key) _privateSignalingPeer.broadcastKeyExchange(key);
                }
            },
        });
        await _privateSignalingPeer.start();
        process.stderr.write(`orchestrator: Phase 1 — private sheet peer started (key distribution)\n`);
    } else {
        process.stderr.write("orchestrator: private sheet not found — skipping Phase 1 key distribution\n");
    }

    // ── Phase 2: Public sheet — encrypted notification traffic ──
    _signalingPeer = new SheetWebRtcPeer({
        sheetId:          publicSheetId,
        getToken:         getUserOAuthToken,
        peerId:           basePeerId,
        displayName:      "Orchestrator MCP",
        getEncryptionKey: currentKey,
        bufferFile:       `${LOG_DIR}/notif-buffer.json`,
        onConnect: (remotePeerId) => {
            process.stderr.write(`orchestrator: peer ${remotePeerId} connected on public sheet\n`);
            if (_wakeResolve) _wakeResolve("peer-connected");
        },
        onMessage: (remotePeerId, msg) => {
            process.stderr.write(`orchestrator: message from peer ${remotePeerId}: ${JSON.stringify(msg)}\n`);
        },
    });
    await _signalingPeer.start();
    process.stderr.write(`orchestrator: Phase 2 — public sheet peer started (encrypted)\n`);

    // ── Health check: restart peers that lost their slot ──
    // Also detects peers that have a slot but are stuck with no connections
    // for an extended period (e.g. after a network transition killed all ICE).
    let _publicPeerEmptySince  = 0; // epoch when public peer first had 0 connections
    let _privatePeerEmptySince = 0;
    const STALE_PEER_MS = 3 * 60_000; // restart if 0 connections for 3 min

    async function restartPeer(peer, label) {
        process.stderr.write(`orchestrator: ${label} — restarting\n`);
        peer.stop();
        peer.destroyed = false;
        peer.block = -1;
        try {
            await peer.start();
            process.stderr.write(`orchestrator: ${label} — restarted successfully\n`);
        } catch (e) {
            process.stderr.write(`orchestrator: ${label} restart failed: ${e.message}\n`);
            // Sheet may have been deleted — invalidate caches so the next
            // health tick re-provisions via ensureSignalingInfra() and
            // calls startSignalingPeer() from scratch.
            invalidateSignalingCache();
            process.stderr.write(`orchestrator: scheduling full signaling re-provision in 30s\n`);
            setTimeout(async () => {
                try {
                    // Stop both peers before re-provisioning
                    if (_signalingPeer) { _signalingPeer.stop(); _signalingPeer = null; }
                    if (_privateSignalingPeer) { _privateSignalingPeer.stop(); _privateSignalingPeer = null; }
                    if (_signalingHealthTimer) { clearInterval(_signalingHealthTimer); _signalingHealthTimer = null; }
                    await startSignalingPeer();
                } catch (e2) {
                    process.stderr.write(`orchestrator: re-provision failed: ${e2.message}\n`);
                }
            }, 30_000);
        }
    }

    _signalingHealthTimer = setInterval(() => {
        // Public peer health
        if (_signalingPeer && !_signalingPeer.destroyed) {
            if (_signalingPeer.block < 0) {
                restartPeer(_signalingPeer, "public peer lost slot");
                _publicPeerEmptySince = 0;
            } else if (_signalingPeer.connectedPeers().length === 0) {
                if (!_publicPeerEmptySince) _publicPeerEmptySince = Date.now();
                else if (Date.now() - _publicPeerEmptySince > STALE_PEER_MS) {
                    restartPeer(_signalingPeer, "public peer 0 connections for 3min");
                    _publicPeerEmptySince = 0;
                }
            } else {
                _publicPeerEmptySince = 0;
            }
        }
        // Private peer health
        if (_privateSignalingPeer && !_privateSignalingPeer.destroyed) {
            if (_privateSignalingPeer.block < 0) {
                restartPeer(_privateSignalingPeer, "private peer lost slot");
                _privatePeerEmptySince = 0;
            }
            // Private peer doesn't need the stale-empty check — it's only for key exchange
        }
    }, 60_000);
}

const SHEETS_BASE = SHEETS_BASE_URL;  // alias for getSheetHeaders below

async function getSheetHeaders(spreadsheetId) {
    if (!sheetsAuth) return null;
    try {
        const client = await sheetsAuth.getClient();
        const { token } = await client.getAccessToken();
        // Get first sheet title
        const metaRes = await fetch(
            `${SHEETS_BASE}/${spreadsheetId}?fields=sheets.properties`,
            { headers: { Authorization: `Bearer ${token}` } }
        );
        if (!metaRes.ok) return null;
        const meta = await metaRes.json();
        const title = meta.sheets?.[0]?.properties?.title || "Sheet1";
        // Get first row (headers)
        const valRes = await fetch(
            `${SHEETS_BASE}/${spreadsheetId}/values/${encodeURIComponent(title + "!A1:ZZ1")}`,
            { headers: { Authorization: `Bearer ${token}` } }
        );
        if (!valRes.ok) return null;
        const data = await valRes.json();
        return data.values?.[0] || null;
    } catch {
        return null;
    }
}

function detectTemplate(headers) {
    const lower = headers.map(h => h.toLowerCase().trim());
    const joined = lower.join(" ");
    let best = { templateKey: "checklist", score: 0 };
    for (const tmpl of REGISTRY.templates) {
        const signals = tmpl.detectSignals || [];
        let score = 0;
        for (const sig of signals) {
            const pattern = new RegExp(sig, "i");
            if (lower.some(h => pattern.test(h)) || pattern.test(joined)) score++;
        }
        const total = score + (tmpl.priority || 10) / 1000;
        if (total > best.score) {
            best = { templateKey: tmpl.key, score: total };
        }
    }
    return best;
}

/* ---------- Routing logic ---------- */

/**
 * Route a task to the correct agent. Pure deterministic logic.
 * @param {{ task: string, desc: string, sheetId?: string }} task
 * @returns {Promise<{ agent: string, method: string }>}
 */
// Known agent names — any label or assignee exactly matching one routes directly to it.
const KNOWN_AGENTS = new Set([
    "waymark-builder", "waymark-travel", "waymark-budget", "waymark-recipe",
    "waymark-meal", "waymark-kanban", "waymark-crm", "waymark-contacts",
    "waymark-inventory", "waymark-tracker", "waymark-schedule", "waymark-timesheet",
    "waymark-log", "waymark-habit", "waymark-poll", "waymark-changelog",
    "waymark-gantt", "waymark-okr", "waymark-roster", "waymark-knowledge",
    "waymark-guide", "waymark-flow", "waymark-automation", "waymark-blog",
    "waymark-social", "waymark-marketing", "waymark-arcade",
    "waymark-iot", "waymark-grading", "waymark-passwords", "waymark-photos",
    "waymark-linker", "waymark-testcases", "waymark-worker", "waymark-checklist",
]);

// Labels that always mean "this is a codebase task → waymark-builder"
const BUILDER_LABELS = new Set([
    "feature", "bug", "fix", "refactor", "chore", "infra", "test", "docs",
    "enhancement", "improvement", "architecture",
]);

async function routeTask(task) {
    const text = `${task.task} ${task.desc || ""}`.toLowerCase();
    const label    = (task.label    || "").trim().toLowerCase();
    const assignee = (task.assignee || "").trim().toLowerCase();

    // Step 0a: Explicit agent assignee → routes directly to that agent
    if (assignee && KNOWN_AGENTS.has(assignee)) {
        return { agent: assignee, method: "assignee" };
    }

    // Step 0b: Label is an exact agent name → route to that agent
    if (label && KNOWN_AGENTS.has(label)) {
        return { agent: label, method: "label-agent" };
    }

    // Step 0c: Label marks this as a builder (codebase) task → waymark-builder wins
    //          This fires BEFORE keyword matching so "feature" tasks with travel keywords
    //          (e.g. "update the itinerary template") go to the builder, not waymark-travel.
    if (label && BUILDER_LABELS.has(label)) {
        return { agent: "waymark-builder", method: "label-feature" };
    }

    // Step A: If sheetId present, detect template
    if (task.sheetId) {
        const headers = await getSheetHeaders(task.sheetId);
        if (headers) {
            const detection = detectTemplate(headers);
            const agent = TEMPLATE_KEY_TO_AGENT[detection.templateKey];
            if (agent) return { agent, method: "sheetId-detection" };
        }
    }

    // Step B: Keyword match on task text
    let bestMatch = null;
    let bestScore = 0;
    for (const route of KEYWORD_ROUTES) {
        let score = 0;
        for (const kw of route.keywords) {
            if (text.includes(kw.toLowerCase())) score++;
        }
        if (score > bestScore) {
            bestScore = score;
            bestMatch = route;
        }
    }
    if (bestMatch && bestScore > 0) {
        return { agent: bestMatch.agent, method: "keyword-match" };
    }

    // Step C: Is this a code task?
    const codeScore = CODE_KEYWORDS.filter(kw => text.includes(kw)).length;
    if (codeScore >= 2) {
        return { agent: "waymark-builder", method: "code-task" };
    }

    // Step D: Fallback
    return { agent: "waymark-builder", method: "fallback" };
}

/**
 * Build the prompt to pass to the dispatched agent.
 */
function buildPrompt(task, routeResult) {
    const parts = [];
    if (task.sheetId) parts.push(`Spreadsheet: ${task.sheetId}`);
    parts.push(`Task row: ${task.row}`);
    parts.push(`Task: ${task.task}`);
    if (task.desc) parts.push(`Details: ${task.desc}`);
    if (task.notes?.length) {
        const noteText = task.notes.map(n => `[${n.author}] ${n.text}`).join("; ");
        parts.push(`Notes: ${noteText}`);
    }
    if (!task.sheetId && routeResult.agent !== "waymark-builder") {
        const key = Object.entries(TEMPLATE_KEY_TO_AGENT).find(([, v]) => v === routeResult.agent)?.[0];
        if (key) {
            parts.push(`Note: No spreadsheet ID was found in the task. Create a new ${key} sheet, populate it with the requested content, and mark the workboard row QA.`);
        }
    }
    return parts.join(" | ");
}

/* ---------- Notification rules — fetch & cache ---------- */

/**
 * Read the rules sheet and parse into rule objects.
 * Sheet format (row 1 = headers, any casing):
 *   Event | Condition | Title | Body | Priority | Enabled
 * Event values: DISPATCH, RETURNED, BLOCKED, POLL_FAILED, WAKE, IDLE, WAIT,
 *               TASK_QA (task(s) moved to QA), TASK_DONE (task(s) completed),
 *               CYCLE_RATE_HIGH (10 cycles in 10 min — possible spin loop),
 *               * (wildcard)
 * Condition values: "always" or empty (always fires), or "key=value" against the event context.
 * Priority values: low, normal, high, urgent
 * Enabled: yes/no/true/false/1/0 (default yes if empty)
 */
async function fetchRulesSheet(sheetId) {
    if (!sheetsAuth || !sheetId) return;
    try {
        const client = await sheetsAuth.getClient();
        const { token } = await client.getAccessToken();
        const metaRes = await fetch(
            `${SHEETS_BASE}/${sheetId}?fields=sheets.properties`,
            { headers: { Authorization: `Bearer ${token}` } }
        );
        if (!metaRes.ok) throw new Error(`meta ${metaRes.status}`);
        const meta = await metaRes.json();
        const title = meta.sheets?.[0]?.properties?.title || "Sheet1";
        const valRes = await fetch(
            `${SHEETS_BASE}/${sheetId}/values/${encodeURIComponent(title + "!A1:F500")}`,
            { headers: { Authorization: `Bearer ${token}` } }
        );
        if (!valRes.ok) throw new Error(`values ${valRes.status}`);
        const data = await valRes.json();
        const rows = data.values || [];
        if (rows.length < 2) { _notifRules = []; return; }

        // Resolve column indices from header row (case-insensitive)
        const headers = rows[0].map(h => h.toLowerCase().trim());
        const col = (name) => headers.indexOf(name);
        const iEvent     = col("event");
        const iCondition = col("condition");
        const iTitle     = col("title");
        const iBody      = col("body");
        const iPriority  = col("priority");
        const iEnabled   = col("enabled");
        if (iEvent === -1) {
            process.stderr.write("orchestrator: rules sheet missing 'Event' column — skipping\n");
            return;
        }

        _notifRules = rows.slice(1)
            .filter(r => r[iEvent]?.trim())
            .map(r => ({
                event:     (r[iEvent]     || "").trim().toUpperCase(),
                condition: (r[iCondition] || "always").trim().toLowerCase(),
                title:     (r[iTitle]     || "").trim(),
                body:      (r[iBody]      || "").trim(),
                priority:  (r[iPriority]  || "normal").trim().toLowerCase(),
                enabled:   !["no", "false", "0"].includes((r[iEnabled] || "yes").trim().toLowerCase()),
            }));
        _rulesLastFetched = Date.now();
        process.stderr.write(`orchestrator: loaded ${_notifRules.length} notification rules from sheet\n`);
    } catch (err) {
        process.stderr.write(`orchestrator: failed to fetch rules sheet: ${err.message}\n`);
    }
}

async function refreshRulesIfStale() {
    if (!_rulesSheetId) return;
    if (Date.now() - _rulesLastFetched >= RULES_TTL_MS) {
        await fetchRulesSheet(_rulesSheetId);
    }
}

/* ---------- Condition evaluation (no eval — key=value only) ---------- */
// Supported formats:
//   (empty)   → always fire
//   "always"  → always fire
//   "key=value" → context[key] === value (string comparison)
//   "key!=value" → context[key] !== value
function matchesCondition(condition, ctx) {
    if (!condition || condition === "always") return true;
    const neq = condition.match(/^(\w+)!=(.+)$/);
    if (neq) return String(ctx[neq[1]] ?? "") !== neq[2].trim();
    const eq  = condition.match(/^(\w+)=(.+)$/);
    if (eq)  return String(ctx[eq[1]]  ?? "") === eq[2].trim();
    return true; // unknown format → fire
}

/* ---------- Template interpolation: {{variable}} or {variable} ---------- */
// Domain knowledge documents {{variable}} (double-brace) format.
// Single-brace {variable} is supported as a fallback for backward compat.
function interpolate(template, ctx) {
    return template
        .replace(/\{\{(\w+)\}\}/g, (_, k) => ctx[k] ?? "")
        .replace(/\{(\w+)\}/g,     (_, k) => ctx[k] ?? "");
}

/**
 * Check rules for a given event and push matching notifications to the
 * Android app via WebRTC DataChannel.  No third-party services (ntfy,
 * Pushover, etc.) — delivery is purely peer-to-peer through the signaling
 * sheet.
 * @param {string} event  - uppercase event name e.g. "DISPATCH"
 * @param {object} ctx    - context variables for condition matching and template interpolation
 */
async function fireNotifications(event, ctx) {
    if (!_notifRules.length) {
        process.stderr.write(`orchestrator: notification skipped for '${event}' — no rules loaded (rulesSheetId=${_rulesSheetId ?? 'not set'})\n`);
        return;
    }
    if (!_signalingPeer) {
        process.stderr.write(`orchestrator: notification skipped for '${event}' — signaling peer not started\n`);
        return;
    }
    const matching = _notifRules.filter(r =>
        r.enabled &&
        (r.event === event || r.event === "*") &&
        matchesCondition(r.condition, ctx)
    );
    for (const rule of matching) {
        const title = interpolate(rule.title || event, ctx);
        const body  = interpolate(rule.body, ctx);
        const sent = _signalingPeer.broadcast({
            type:     "orchestrator-alert",
            title,
            body,
            priority: rule.priority,
            event,
            ts:       Date.now(),
        });
        process.stderr.write(
            sent > 0
                ? `orchestrator: pushed '${title}' to ${sent} Android peer(s) via WebRTC\n`
                : `orchestrator: rule matched for '${event}' but no Android peers connected\n`
        );
    }
}

/* ---------- check-workboard.js runner ---------- */

function runCheckWorkboard() {
    return new Promise((resolve, reject) => {
        const env = { ...process.env };
        if (credPath) env.GOOGLE_APPLICATION_CREDENTIALS = credPath;
        execFile("node", [path.join(SCRIPTS_DIR, "check-workboard.js")], { env, timeout: 30000 }, (err, stdout, stderr) => {
            if (err) return reject(new Error(stderr || err.message));
            try {
                resolve(JSON.parse(stdout.trim()));
            } catch {
                reject(new Error(`Invalid JSON from check-workboard: ${stdout.slice(0, 200)}`));
            }
        });
    });
}

/* ---------- update-workboard.js runner — claim task In Progress ---------- */

function claimTask(row, agentName) {
    return new Promise((resolve) => {
        const env = { ...process.env };
        if (credPath) env.GOOGLE_APPLICATION_CREDENTIALS = credPath;
        execFile(
            "node",
            [path.join(SCRIPTS_DIR, "update-workboard.js"), "claim", String(row), "--agent", agentName],
            { env, timeout: 15000 },
            (err, stdout, stderr) => {
                if (err) {
                    process.stderr.write(`orchestrator: claim failed for row ${row}: ${stderr || err.message}\n`);
                }
                resolve(); // non-fatal — proceed with dispatch even if claim fails
            }
        );
    });
}

/* ---------- Interruptible sleep + HTTP wake endpoint ---------- */

const WAKE_PORT = parseInt(process.env.ORCHESTRATOR_WAKE_PORT || "9111", 10);
let _wakeResolve = null; // resolve fn for the currently-sleeping promise

/**
 * Sleep for `ms` milliseconds OR until POST /wake is received.
 * Returns { interrupted: boolean, reason?: string }.
 */
function sleep(ms) {
    return new Promise(resolve => {
        const timer = setTimeout(() => {
            _wakeResolve = null;
            resolve({ interrupted: false });
        }, ms);
        _wakeResolve = (reason) => {
            clearTimeout(timer);
            _wakeResolve = null;
            resolve({ interrupted: true, reason });
        };
    });
}

// Tiny HTTP server: POST /wake → interrupt the current sleep
const wakeServer = createServer((req, res) => {
    // Only allow POST /wake
    if (req.method === "POST" && req.url === "/wake") {
        let body = "";
        req.on("data", chunk => { body += chunk; });
        req.on("end", () => {
            const reason = body.trim() || "external interrupt";
            if (_wakeResolve) {
                _wakeResolve(reason);
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: true, status: "woke" }));
            } else {
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: true, status: "not-sleeping" }));
            }
        });
    } else if (req.method === "GET" && req.url === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, sleeping: !!_wakeResolve }));
    } else if (req.method === "GET" && req.url === "/status") {
        // Detailed signaling peer status
        const status = {
            ok: true,
            publicPeer: _signalingPeer ? {
                peerId: _signalingPeer.peerId,
                block: _signalingPeer.block,
                destroyed: _signalingPeer.destroyed,
                connectedPeers: _signalingPeer.connectedPeers(),
            } : null,
            privatePeer: _privateSignalingPeer ? {
                peerId: _privateSignalingPeer.peerId,
                block: _privateSignalingPeer.block,
                destroyed: _privateSignalingPeer.destroyed,
                connectedPeers: _privateSignalingPeer.connectedPeers(),
            } : null,
            keyPrefix: _resolvedSignalKeyHex?.slice(0, 8) ?? null,
        };
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(status));
    } else if (req.method === "POST" && req.url === "/rekey") {
        // Re-read the key file and push to all private-sheet peers.
        // Used after provision-signaling.mjs --force-key or manual key rotation.
        _resolvedSignalKeyHex = null; // clear cache
        const key = resolveSignalKey();
        if (key && _privateSignalingPeer) {
            const sent = _privateSignalingPeer.broadcastKeyExchange(key);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true, keyPrefix: key.slice(0, 8), sentTo: sent }));
        } else {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: false, reason: !key ? "no key file" : "no private peer" }));
        }
    } else {
        res.writeHead(404);
        res.end();
    }
});
wakeServer.listen(WAKE_PORT, "0.0.0.0", () => {
    process.stderr.write(`orchestrator: wake endpoint listening on :${WAKE_PORT}\n`);
});

/* ---------- ISO timestamp ---------- */

function iso() {
    return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

/* ---------- MCP Server ---------- */

const server = new Server(
    { name: "orchestrator", version: "1.0.0" },
    { capabilities: { tools: {} } }
);

const TOOLS = [
    {
        name: "orchestrator_boot",
        description: "Initialize the orchestrator session. Creates the log directory and returns a session ID and log path. Call this ONCE at the start. Pass rulesSheetId to enable phone notifications.",
        inputSchema: {
            type: "object",
            properties: {
                rulesSheetId: {
                    type: "string",
                    description: "Optional Google Sheets ID of a notification rules sheet. Columns: Event, Condition, Title, Body, Priority, Enabled. Omit to disable notifications.",
                },
                waitForPeerSeconds: {
                    type: "number",
                    description: "Optional seconds to wait for an Android peer to connect before dispatching the first task. Useful when the Android app is known to be opening shortly after the orchestrator starts. Default 0 (no wait). Recommended: 30–60.",
                },
            },
        },
    },
    {
        name: "orchestrator_cycle",
        description: "Run one orchestrator cycle: sleep → poll workboard → route task → return action. The sleep blocks for the specified duration. Returns a JSON action the agent MUST act on. If action is DISPATCH, the agent MUST call runSubagent with the returned agentName and prompt.",
        inputSchema: {
            type: "object",
            properties: {
                sessionId: {
                    type: "string",
                    description: "The session ID from orchestrator_boot.",
                },
                sleepSeconds: {
                    type: "number",
                    description: "Seconds to sleep before polling. Use 5 for the first cycle, 60 for subsequent cycles.",
                },
            },
            required: ["sessionId", "sleepSeconds"],
        },
    },

];

server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    if (name === "orchestrator_boot") {
        mkdirSync(LOG_DIR, { recursive: true });
        const ts = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
        const sessionId = `session-${ts}`;
        const logPath = `${LOG_DIR}/${sessionId}.log`;
        // Allow explicit arg to override env default; otherwise use whatever was set at startup
        if (args.rulesSheetId) {
            _rulesSheetId = args.rulesSheetId;
            _rulesLastFetched = 0;
        }
        // Fetch rules if we have a sheet ID and haven't loaded yet
        if (_rulesSheetId && _notifRules.length === 0) {
            await fetchRulesSheet(_rulesSheetId);
        }
        appendFileSync(logPath, `[${iso()}] ORCHESTRATOR STARTED${_rulesSheetId ? ` (rules: ${_rulesSheetId})` : ""}\n`);
        _sessions.set(sessionId, { lastAction: null, lastAgentName: null });
        _cycleState.set(sessionId, { lastQaCount: null, lastDoneCount: null, cycleTimestamps: [] });

        // peerWaitMs — how long to wait for Android before first dispatch
        const peerWaitMs = Math.max(0, (args.waitForPeerSeconds || 0)) * 1000;
        // Store alongside session; re-use sessions map with augmented object
        _sessions.set(sessionId, { lastAction: null, lastAgentName: null, peerWaitMs, peerWaitUsed: false });

        // (Re-)start signaling peers with fresh infrastructure validation.
        // Tear down any existing peers first — sheets may have been deleted
        // between boots while the MCP process stayed alive.
        if (_signalingPeer || _privateSignalingPeer) {
            process.stderr.write("orchestrator: tearing down existing signaling peers for clean re-provision\n");
            if (_signalingPeer) { _signalingPeer.stop(); _signalingPeer = null; }
            if (_privateSignalingPeer) { _privateSignalingPeer.stop(); _privateSignalingPeer = null; }
            if (_signalingHealthTimer) { clearInterval(_signalingHealthTimer); _signalingHealthTimer = null; }
            invalidateSignalingCache();
        }
        startSignalingPeer().catch(err =>
            process.stderr.write(`orchestrator: signaling peer start failed: ${err.message}\n`)
        );

        return {
            content: [{ type: "text", text: JSON.stringify({
                sessionId,
                logPath,
                rulesLoaded: _notifRules.length,
                signalingSheet: _resolvedSignalingSheetId ?? null,
                signalingPeerId: _signalingPeer?.peerId ?? null,
                peerWaitMs,
            }) }],
        };
    }

    if (name === "orchestrator_cycle") {
        const logPath = `${LOG_DIR}/${args.sessionId}.log`;
        const sleepMs = (args.sleepSeconds || 60) * 1000;

        // Automatically detect RETURNED: if previous cycle dispatched an agent,
        // calling cycle again means the agent returned from runSubagent.
        const sess = _sessions.get(args.sessionId) || {};
        if (sess.lastAction === "DISPATCH" && sess.lastAgentName) {
            appendFileSync(logPath, `[${iso()}] RETURNED: ${sess.lastAgentName}\n`);
            await fireNotifications("RETURNED", {
                agentName: sess.lastAgentName,
                sessionId: args.sessionId,
            });
            _sessions.set(args.sessionId, { ...sess, lastAction: "RETURNED", lastAgentName: null });
        }

        // Refresh notification rules if stale
        await refreshRulesIfStale();

        // Step 1: Sleep (interruptible via POST :9111/wake)
        const sleepResult = await sleep(sleepMs);
        if (sleepResult.interrupted) {
            appendFileSync(logPath, `[${iso()}] WAKE: interrupted — ${sleepResult.reason}\n`);
            await fireNotifications("WAKE", { reason: sleepResult.reason, sessionId: args.sessionId });
        }

        // Step 2: Poll workboard
        let board;
        try {
            board = await runCheckWorkboard();
        } catch (err) {
            const msg = `POLL_FAILED: ${err.message}`;
            appendFileSync(logPath, `[${iso()}] ${msg}\n`);
            await fireNotifications("POLL_FAILED", { reason: err.message, sessionId: args.sessionId });
            return {
                content: [{ type: "text", text: JSON.stringify({ action: "POLL_FAILED", reason: err.message }) }],
            };
        }
        appendFileSync(logPath, `[${iso()}] POLL: ${JSON.stringify(board)}\n`);

        // Step 2b: Cycle counter — alert if 10 cycles within 10 minutes
        const cs = _cycleState.get(args.sessionId) || { lastQaCount: null, lastDoneCount: null, cycleTimestamps: [] };
        const nowMs = Date.now();
        cs.cycleTimestamps.push(nowMs);
        const tenMinAgo = nowMs - 10 * 60 * 1000;
        cs.cycleTimestamps = cs.cycleTimestamps.filter(t => t >= tenMinAgo);
        if (cs.cycleTimestamps.length >= 10) {
            appendFileSync(logPath, `[${iso()}] CYCLE_RATE_HIGH: ${cs.cycleTimestamps.length} cycles in last 10 min\n`);
            await fireNotifications("CYCLE_RATE_HIGH", {
                cycleCount: cs.cycleTimestamps.length,
                windowMinutes: 10,
                sessionId: args.sessionId,
            });
            cs.cycleTimestamps = []; // reset window to avoid re-firing every cycle
        }

        // Step 2c: Detect tasks moving into QA or Done
        if (cs.lastQaCount !== null && board.qa > cs.lastQaCount) {
            const delta = board.qa - cs.lastQaCount;
            appendFileSync(logPath, `[${iso()}] TASK_QA: ${delta} new task(s) in QA (total ${board.qa})\n`);
            await fireNotifications("TASK_QA", {
                qaCount: board.qa,
                delta,
                sessionId: args.sessionId,
            });
        }
        cs.lastQaCount = board.qa;

        if (cs.lastDoneCount !== null && board.done > cs.lastDoneCount) {
            const delta = board.done - cs.lastDoneCount;
            appendFileSync(logPath, `[${iso()}] TASK_DONE: ${delta} new task(s) done (total ${board.done})\n`);
            await fireNotifications("TASK_DONE", {
                doneCount: board.done,
                delta,
                sessionId: args.sessionId,
            });
        }
        cs.lastDoneCount = board.done;

        _cycleState.set(args.sessionId, cs);

        // Step 3: Route
        // Check inProgress first
        if (board.inProgress && board.inProgress.length > 0) {
            const titles = board.inProgress.map(t => t.task).join(", ");
            const reason = `inProgress has ${board.inProgress.length} task(s) — "${titles}"`;
            appendFileSync(logPath, `[${iso()}] WAIT: ${reason}\n`);
            await fireNotifications("WAIT", { reason, sessionId: args.sessionId });
            return {
                content: [{ type: "text", text: JSON.stringify({ action: "WAIT", reason }) }],
            };
        }

        // Check todo
        if (board.todo && board.todo.length > 0) {
            const task = board.todo[0]; // Already sorted by priority from check-workboard.js

            // Check for BLOCKED
            if (task.notes?.some(n => n.text.includes("BLOCKED"))) {
                const reason = `${task.task} — task has BLOCKED note`;
                appendFileSync(logPath, `[${iso()}] BLOCKED: ${reason}\n`);
                await fireNotifications("BLOCKED", { task: task.task, reason, sessionId: args.sessionId });
                return {
                    content: [{ type: "text", text: JSON.stringify({ action: "BLOCKED", reason, task: task.task }) }],
                };
            }

            // Route deterministically
            const routeResult = await routeTask(task);
            const prompt = buildPrompt(task, routeResult);

            // If notifications are configured but no Android peer is connected yet,
            // wait up to peerWaitMs for one to connect (sleep is interrupted by onConnect).
            // Only applies once per session (peerWaitUsed flag) to avoid per-task delays.
            const sess2 = _sessions.get(args.sessionId) || {};
            if (
                _signalingPeer &&
                _notifRules.length > 0 &&
                !sess2.peerWaitUsed &&
                (sess2.peerWaitMs || 0) > 0 &&
                _signalingPeer.connectedPeers().length === 0
            ) {
                const waitMs = sess2.peerWaitMs;
                appendFileSync(logPath, `[${iso()}] PEER_WAIT: waiting up to ${waitMs / 1000}s for Android peer...\n`);
                process.stderr.write(`orchestrator: waiting up to ${waitMs / 1000}s for Android peer before dispatch\n`);
                _sessions.set(args.sessionId, { ...sess2, peerWaitUsed: true });
                const pw = await sleep(waitMs);
                if (pw.interrupted) {
                    appendFileSync(logPath, `[${iso()}] PEER_WAIT: woke early — ${pw.reason}\n`);
                }
            } else {
                _sessions.set(args.sessionId, { ...sess2, peerWaitUsed: true });
            }

            appendFileSync(logPath, `[${iso()}] ROUTE: ${routeResult.agent} (${routeResult.method}) | ${task.task}\n`);
            await fireNotifications("DISPATCH", {
                agentName:   routeResult.agent,
                taskTitle:   task.task,
                task:        task.task,          // alias: domain doc lists {{task}}
                desc:        task.desc || "",
                routeMethod: routeResult.method,
                sessionId:   args.sessionId,
            });
            // Claim "In Progress" on the workboard BEFORE returning — prevents re-dispatch
            await claimTask(task.row, routeResult.agent);
            appendFileSync(logPath, `[${iso()}] CLAIMED: row ${task.row} → In Progress (${routeResult.agent})\n`);
            const sessDisp = _sessions.get(args.sessionId) || {};
            _sessions.set(args.sessionId, { ...sessDisp, lastAction: "DISPATCH", lastAgentName: routeResult.agent });

            return {
                content: [{
                    type: "text",
                    text: JSON.stringify({
                        action: "DISPATCH",
                        agentName: routeResult.agent,
                        prompt,
                        taskTitle: task.task,
                        routeMethod: routeResult.method,
                    }),
                }],
            };
        }

        // Board is clear
        const reason = `board is clear — todo=0, qa=${board.qa ?? 0}, done=${board.done ?? 0}`;
        appendFileSync(logPath, `[${iso()}] IDLE: ${reason}\n`);
        await fireNotifications("IDLE", { reason, sessionId: args.sessionId });
        return {
            content: [{ type: "text", text: JSON.stringify({ action: "IDLE", reason }) }],
        };
    }

    throw new Error(`Unknown tool: ${name}`);
});

/* ---------- Start ---------- */

const transport = new StdioServerTransport();
await server.connect(transport);
