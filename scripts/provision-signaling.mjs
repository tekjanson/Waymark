#!/usr/bin/env node
/* ============================================================
   provision-signaling.mjs — One-time setup: creates the two
   signaling sheets required for the encrypted P2P mesh and
   writes their IDs into .waymark-data.json on Drive.

   Architecture:
     Private sheet  (.waymark-signaling)        → signalingSheetId
       Sheet1!A1 = 64-char hex AES-256 key
       Sheet1!A2 = key version epoch ms

     Public sheet   (.waymark-public-signaling)  → publicSignalingSheetId
       Column T = WebRTC signaling cells (PRESENCE / OFFERS / ANSWERS)
       All cells AES-256-GCM encrypted with the key from the private sheet.

   This script is idempotent — if either sheet already exists it is
   left unchanged.  Run it whenever the web app has not yet created
   the public sheet (publicSignalingSheetId missing from .waymark-data.json).

   Usage:
     node scripts/provision-signaling.mjs [--force-key]

   Flags:
     --force-key   Rotate the AES key even if one already exists.

   Required env:
     WAYMARK_OAUTH_TOKEN_PATH   path to OAuth token JSON
                                (default: ~/.config/gcloud/waymark-oauth-token.json)
   ============================================================ */

import { readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const OAUTH_TOKEN_PATH = process.env.WAYMARK_OAUTH_TOKEN_PATH
    || path.join(process.env.HOME || "/root", ".config/gcloud/waymark-oauth-token.json");

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

/** Read Sheet1!A1:A2 from a spreadsheet. Returns [a1, a2] or [null, null]. */
async function readCell(sheetId, token) {
    const range = encodeURIComponent("Sheet1!A1:A2");
    const res = await fetch(`${SHEETS_BASE}/${sheetId}/values/${range}`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return [null, null];
    const d = await res.json();
    return [d.values?.[0]?.[0] ?? null, d.values?.[1]?.[0] ?? null];
}

/** Write keyHex + version to Sheet1!A1:A2. */
async function writeKey(sheetId, keyHex, token) {
    const range = "Sheet1!A1:A2";
    const url = `${SHEETS_BASE}/${sheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`;
    const res = await fetch(url, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
            range,
            majorDimension: "COLUMNS",
            values: [[keyHex, String(Date.now())]],
        }),
    });
    if (!res.ok) throw new Error(`Key write → ${res.status}: ${await res.text()}`);
}

/** Generate a fresh 64-char hex AES-256 key. */
function genKey() {
    return randomBytes(32).toString("hex");
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

    // ── Private sheet ─────────────────────────────────────────────────────
    let privateId = data.signalingSheetId;
    if (!privateId) {
        log("Creating private key sheet (.waymark-signaling)…");
        privateId = await createSpreadsheet(".waymark-signaling", token);
        updates.signalingSheetId = privateId;
        log(`  Created: ${privateId}`);
    } else {
        log(`Private sheet exists: ${privateId}`);
    }

    // ── AES-256 key ───────────────────────────────────────────────────────
    const [existingKey] = await readCell(privateId, token);
    if (!existingKey || existingKey.length !== 64 || FORCE_KEY) {
        const keyHex = genKey();
        log(`${!existingKey ? "Writing initial" : "Rotating"} AES-256 key → ${privateId}/Sheet1!A1…`);
        await writeKey(privateId, keyHex, token);
        log(`  Key: ${keyHex.slice(0, 16)}…`);
    } else {
        log(`Key already present: ${existingKey.slice(0, 16)}…`);
    }

    // ── Public sheet ──────────────────────────────────────────────────────
    let publicId = data.publicSignalingSheetId;
    if (!publicId) {
        log("Creating public signaling sheet (.waymark-public-signaling)…");
        publicId = await createSpreadsheet(".waymark-public-signaling", token);
        updates.publicSignalingSheetId = publicId;
        log(`  Created: ${publicId}`);
    } else {
        log(`Public sheet exists: ${publicId}`);
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
    log(`Private key sheet : ${privateId}`);
    log(`Public signal sheet: ${publicId}`);
    log("");
    log("Next step: open the Waymark web app and run  cycleSignalKey()  in the console");
    log("(or re-run this script with --force-key) to push a fresh key to the Android app.");
}

main().catch(e => { console.error(e); process.exit(1); });
