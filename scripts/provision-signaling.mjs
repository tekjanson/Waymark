#!/usr/bin/env node
/* ============================================================
   provision-signaling.mjs — One-time setup: creates the two
   signaling sheets required for the encrypted P2P mesh and
   writes their IDs into .waymark-data.json on Drive.

   Architecture:
     Private sheet  (.waymark-signaling)        → signalingSheetId
       OAuth-protected — only accessible to authenticated peers.
       Plain text JSON config: { version, createdAt }
       NO encryption key is ever stored here.

     Public sheet   (.waymark-public-signaling)  → publicSignalingSheetId
       Publicly writable (anyone with the link can edit).
       Column T = WebRTC signaling cells (PRESENCE / OFFERS / ANSWERS)
       ALL cell values are AES-256-GCM encrypted with the key that lives
       ONLY in device-local storage.  Privacy is enforced by encryption,
       not by sheet-level auth.

   The AES-256 key is NEVER written to any Google Sheet.
   It lives only in:
     • This machine:   KEY_FILE (see below)
     • Android device: SharedPreferences (PREF_SIGNAL_KEY)
     • Browser:        localStorage['waymark_signal_key']
   Key distribution between peers happens ONLY over the WebRTC DataChannel.

   This script is idempotent — if either sheet already exists it is
   left unchanged.

   Usage:
     node scripts/provision-signaling.mjs [--force-key]

   Flags:
     --force-key   Rotate the AES key (regenerate and overwrite KEY_FILE).

   Required env:
     WAYMARK_OAUTH_TOKEN_PATH   path to OAuth token JSON
                                (default: ~/.config/gcloud/waymark-oauth-token.json)
   ============================================================ */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOME = process.env.HOME || "/root";

const OAUTH_TOKEN_PATH = process.env.WAYMARK_OAUTH_TOKEN_PATH
    || path.join(HOME, ".config/gcloud/waymark-oauth-token.json");

// The AES-256 key lives HERE on this machine — never in any Google Sheet.
const KEY_FILE = process.env.WAYMARK_KEY_FILE
    || path.join(HOME, ".config/gcloud/waymark-signal.key");

const DRIVE_BASE  = "https://www.googleapis.com/drive/v3";
const SHEETS_BASE = "https://sheets.googleapis.com/v4/spreadsheets";
const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3/files";

const FORCE_KEY = process.argv.includes("--force-key");

/* ---------- Helpers ---------- */

function die(msg) { console.error("FATAL:", msg); process.exit(1); }
function log(...args) { console.log(new Date().toISOString().slice(11, 23), ...args); }

async function getToken() {
    let tok;
    try { tok = JSON.parse(readFileSync(OAUTH_TOKEN_PATH, "utf8")); }
    catch { die("Cannot read OAuth token from " + OAUTH_TOKEN_PATH); }

    if (!tok.access_token || Date.now() > (tok.expiry_date - 60_000)) {
        if (!tok.refresh_token) die("OAuth token expired and no refresh_token");
        const res = await fetch("https://oauth2.googleapis.com/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                grant_type:    "refresh_token",
                refresh_token: tok.refresh_token,
                client_id:     tok.client_id,
                client_secret: tok.client_secret,
            }),
        });
        const r = await res.json();
        if (!r.access_token) die("OAuth refresh failed: " + JSON.stringify(r));
        tok.access_token = r.access_token;
        tok.expiry_date  = Date.now() + r.expires_in * 1000;
        try { writeFileSync(OAUTH_TOKEN_PATH, JSON.stringify(tok, null, 2)); } catch {}
    }
    return tok.access_token;
}

async function driveJson(method, url, body, token) {
    const res = await fetch(url, {
        method,
        headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Drive ${method} ${url} → ${res.status}: ${text}`);
    }
    return res.json();
}

/** Search Drive for a file by exact name (first match). */
async function driveFind(name, token) {
    const q = encodeURIComponent(`name='${name}' and trashed=false`);
    const d = await driveJson("GET", `${DRIVE_BASE}/files?q=${q}&fields=files(id,name)&pageSize=1`, null, token);
    return d.files?.[0] ?? null;
}

/** Read a file's JSON content from Drive. */
async function driveReadJson(fileId, token) {
    const res = await fetch(`${DRIVE_BASE}/files/${fileId}?alt=media`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`Drive read ${fileId} → ${res.status}`);
    return res.json();
}

/** Update a Drive file's JSON content. */
async function driveUpdateJson(fileId, data, token) {
    const body = JSON.stringify(data, null, 2);
    const res = await fetch(`${DRIVE_UPLOAD}/${fileId}?uploadType=media`, {
        method: "PATCH",
        headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(body),
        },
        body,
    });
    if (!res.ok) throw new Error(`Drive update ${fileId} → ${res.status}: ${await res.text()}`);
    return res.json();
}

/** Create a new, empty Google Spreadsheet with the given title.
 *  Returns { spreadsheetId }. */
async function createSpreadsheet(title, token) {
    const d = await driveJson("POST", SHEETS_BASE, { properties: { title } }, token);
    return d.spreadsheetId;
}

/** Grant "anyone with the link can edit" access to a Drive file. */
async function setPublicWritable(fileId, token) {
    const res = await fetch(`${DRIVE_BASE}/files/${fileId}/permissions`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ role: "writer", type: "anyone" }),
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`setPublicWritable ${fileId} → ${res.status}: ${text}`);
    }
}

/** Read Sheet1!A1 from a spreadsheet. Returns the cell value or null. */
async function readCell(sheetId, token) {
    const range = encodeURIComponent("Sheet1!A1");
    const res = await fetch(`${SHEETS_BASE}/${sheetId}/values/${range}`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const d = await res.json();
    return d.values?.[0]?.[0] ?? null;
}

/** Write plain-text JSON config to Sheet1!A1 of the private sheet. */
async function writePrivateConfig(sheetId, config, token) {
    const range = "Sheet1!A1";
    const url = `${SHEETS_BASE}/${sheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`;
    const res = await fetch(url, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
            range,
            majorDimension: "ROWS",
            values: [[JSON.stringify(config)]],
        }),
    });
    if (!res.ok) throw new Error(`Private config write → ${res.status}: ${await res.text()}`);
}

/** Read the local AES-256 key hex, or null if not yet generated. */
function readLocalKey() {
    try { return readFileSync(KEY_FILE, "utf8").trim(); } catch { return null; }
}

/** Generate and save a fresh 64-char hex AES-256 key to KEY_FILE. */
function generateAndSaveKey() {
    const keyHex = randomBytes(32).toString("hex");
    const dir = path.dirname(KEY_FILE);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(KEY_FILE, keyHex + "\n", { mode: 0o600 });
    return keyHex;
}

/* ---------- Main ---------- */

async function main() {
    log("=== Waymark Signaling Provisioner ===");
    const token = await getToken();
    log("OAuth token acquired");

    // ── Load .waymark-data.json ──────────────────────────────────────────
    const dataFile = await driveFind(".waymark-data.json", token);
    if (!dataFile) die(".waymark-data.json not found on Drive — open the Waymark web app first");
    log(`Found .waymark-data.json (id=${dataFile.id})`);

    const data = await driveReadJson(dataFile.id, token);
    const updates = {};

    log(`Current signalingSheetId    : ${data.signalingSheetId ?? "(none)"}`);
    log(`Current publicSignalingSheetId: ${data.publicSignalingSheetId ?? "(none)"}`);

    // ── Private sheet (plain text config only — NO key) ───────────────────
    let privateId = data.signalingSheetId;
    if (!privateId) {
        log("Creating private config sheet (.waymark-signaling)…");
        privateId = await createSpreadsheet(".waymark-signaling", token);
        updates.signalingSheetId = privateId;
        log(`  Created: ${privateId}`);
    } else {
        log(`Private sheet exists: ${privateId}`);
    }

    // Write / verify plain-text config in Sheet1!A1 (no key stored here)
    const existingConfig = await readCell(privateId, token);
    let configObj;
    try { configObj = existingConfig ? JSON.parse(existingConfig) : null; } catch { configObj = null; }
    const wantsPublicId = updates.publicSignalingSheetId || data.publicSignalingSheetId || "";
    if (!configObj || configObj.version !== 1) {
        log("Writing plain-text config to private sheet Sheet1!A1…");
        await writePrivateConfig(privateId, { version: 1, createdAt: new Date().toISOString(), publicSignalingSheetId: wantsPublicId }, token);
    }

    // ── AES-256 key — created at runtime by the orchestrator ───────────────
    // The key is generated automatically by the orchestrator on first boot
    // and distributed to peers over the WebRTC DataChannel.
    // No key file generation here — it's a runtime concern.
    const existingKey = readLocalKey();
    if (existingKey && existingKey.length === 64) {
        log(`Existing local key found at ${KEY_FILE}: ${existingKey.slice(0, 16)}…`);
        log(`  (Key is managed at runtime by the orchestrator — no action needed)`);
    } else {
        log(`No local key file — the orchestrator will generate one on first boot.`);
    }

    // ── Public sheet ──────────────────────────────────────────────────────
    let publicId = data.publicSignalingSheetId;
    if (!publicId) {
        log("Creating public signaling sheet (.waymark-public-signaling)…");
        publicId = await createSpreadsheet(".waymark-public-signaling", token);
        updates.publicSignalingSheetId = publicId;
        log(`  Created: ${publicId}`);
        // Back-fill the publicSignalingSheetId into the private config now that we have it
        await writePrivateConfig(privateId, { version: 1, createdAt: new Date().toISOString(), publicSignalingSheetId: publicId }, token);
    } else {
        log(`Public sheet exists: ${publicId}`);
    }

    // ── Set public write permission ───────────────────────────────────────
    // All cells are AES-256-GCM encrypted so granting public write access
    // is safe and required for cross-device P2P signaling without shared OAuth.
    log(`Setting 'anyone can edit' permission on public sheet…`);
    try {
        await setPublicWritable(publicId, token);
        log(`  ✓ Public sheet is now writable by anyone with the link`);
    } catch (e) {
        log(`  ⚠ setPublicWritable failed (may already be set): ${e.message}`);
    }

    // ── Persist to Drive ──────────────────────────────────────────────────
    if (Object.keys(updates).length > 0) {
        const merged = { ...data, ...updates, updatedAt: new Date().toISOString() };
        await driveUpdateJson(dataFile.id, merged, token);
        log("Saved updates to .waymark-data.json:");
        for (const [k, v] of Object.entries(updates)) log(`  ${k} = ${v}`);
    } else {
        log("No changes needed — signaling infrastructure is already complete.");
    }

    log("");
    log("=== Signaling setup complete ===");
    log(`Private config sheet : ${privateId}  (plaintext OAuth-protected — key exchange happens here)`);
    log(`Public signal sheet  : ${publicId}    (100% AES-256-GCM encrypted)`);
    log("");
    log("The AES key is generated at runtime by the orchestrator on first boot.");
    log("Key distribution between peers happens ONLY over the WebRTC DataChannel:");
    log("  1. Peers connect to the private sheet (plaintext, OAuth-protected)");
    log("  2. Orchestrator sends the key over the DataChannel");
    log("  3. Both peers switch to the public sheet with AES-256-GCM encryption");
}

main().catch(e => { console.error(e); process.exit(1); });
