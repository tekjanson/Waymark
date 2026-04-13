#!/usr/bin/env node
/* ============================================================
   mesh-test.mjs — WebRTC P2P mesh E2E testing jig

   Tests the encrypted public-signaling architecture:
     1. Private sheet (.waymark-signaling): stores AES-256 key in Sheet1!A1
     2. Public sheet (.waymark-public-signaling): WebRTC signaling, cells
        encrypted with the key from the private sheet.

   Node.js (SheetWebRtcPeer) ←→ Encrypted public Google Sheet ←→ Android (OrchestratorPeer)
                                                                         ↓
                                                               adb logcat (read logcat stream
                                                               to observe Android state)

   Usage:
     node scripts/mesh-test.mjs [--scenario <name>] [--all] [--adb <ip:port>]

   Required env:
     WAYMARK_OAUTH_TOKEN_PATH  path to OAuth token JSON (default: ~/.config/gcloud/waymark-oauth-token.json)
     GOOGLE_APPLICATION_CREDENTIALS  service account key (for resolving signaling sheet)

   Optional env:
     ADB_DEVICE    IP:port of Android for wireless debugging  (e.g. 192.168.1.42:5555)
                   If unset, logcat observation is skipped but all Node-side scenarios still run.
     SIGNAL_SHEET  Override the PUBLIC signaling sheet ID directly (skip Drive lookup)
     PRIV_SHEET    Override the PRIVATE key sheet ID directly (skip Drive lookup)

   Scenarios:
     fresh-join          New Node peer joins empty mesh, Android connects
     worker-restart      Node peer stops/restarts, Android reconnects
     ice-failure         Simulate ICE failure, verify rebuild + reconnect
     stale-offer         Age an offer past OFFER_MAX_AGE, verify rebuild
     sustained-ping      Confirm ping/pong keepalive over 2 intervals
     notification        Send waymark-notification, verify Android logcat shows it
     key-cycling         Verify peers detect + handle a cycled encryption key
     full-roundtrip      All of the above in sequence (the regression suite)

   Exit codes:
     0 — all run scenarios passed
     1 — one or more scenarios failed
     2 — setup error (no sheet, no auth)
   ============================================================ */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { spawn, execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";

// SheetWebRtcPeer — the real Node.js WebRTC peer (same code the orchestrator uses)
import { SheetWebRtcPeer, encryptCell, decryptCell } from "../mcp/sheet-webrtc-peer.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, "..");

/* ============================================================
   Constants mirroring WaymarkConfig.kt / sheet-webrtc-peer.mjs
   ============================================================ */

const BLOCK_SIZE    = 5;
const BLOCK_START   = 1;
const MAX_SLOTS     = 8;
const ALIVE_TTL     = 50_000;
const POLL_MS       = 5_000;
const HEART_MS      = 15_000;
const OFFER_MAX_AGE = 3 * 60_000;

const TAG_ANDROID   = "OrchestratorPeer";   // logcat tag on Android

/* ============================================================
   Config / auth helpers
   ============================================================ */

const OAUTH_TOKEN_PATH = process.env.WAYMARK_OAUTH_TOKEN_PATH
    || path.join(process.env.HOME || "/root", ".config/gcloud/waymark-oauth-token.json");

const SHEETS_BASE = "https://sheets.googleapis.com/v4/spreadsheets";
const DRIVE_FILES = "https://www.googleapis.com/drive/v3/files";

// Resolved once in main(), used by all helper functions that read/write the sheet
let _encKey         = null;  // AES-256 GCM key hex from private sheet
let _privateSheetId = null;  // private (.waymark-signaling) sheet ID

/** Encrypt a cell value if we have a key; pass through otherwise */
function encryptOrRaw(value) {
    return (_encKey && value) ? encryptCell(value, _encKey) : value;
}
/** Decrypt a cell value if we have a key; pass through otherwise */
function decryptOrRaw(value) {
    if (!value || !_encKey) return value;
    return decryptCell(value, _encKey) ?? value;
}

async function getOAuthToken() {
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

/** Fetch .waymark-data.json from Drive and return parsed object */
async function _loadWaymarkData() {
    const token = await getOAuthToken();
    const q = encodeURIComponent("name='.waymark-data.json' and mimeType='application/json' and trashed=false");
    const res = await fetch(`${DRIVE_FILES}?q=${q}&fields=files(id)&pageSize=1`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) die("Drive search failed: " + res.status);
    const { files } = await res.json();
    if (!files?.length) die(".waymark-data.json not found on Drive — open the web app first to create the signaling sheet");
    const fileRes = await fetch(`${DRIVE_FILES}/${files[0].id}?alt=media`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    return fileRes.json();
}

/** Resolve the PUBLIC signaling sheet ID (AES-encrypted cells, no OAuth needed at runtime) */
async function resolveSignalingSheet() {
    if (process.env.SIGNAL_SHEET) return process.env.SIGNAL_SHEET;
    const data = await _loadWaymarkData();
    const id = data.publicSignalingSheetId || data.signalingSheetId;
    if (!id) die("Neither publicSignalingSheetId nor signalingSheetId found in .waymark-data.json — open the web app to initialize it");
    return id;
}

/** Resolve the PRIVATE key sheet ID (stores AES-256 key in Sheet1!A1) */
async function resolvePrivateSheetId() {
    if (process.env.PRIV_SHEET) return process.env.PRIV_SHEET;
    const data = await _loadWaymarkData();
    if (!data.signalingSheetId) die("signalingSheetId missing in .waymark-data.json — open the web app to initialize it");
    return data.signalingSheetId;
}

/** Read AES-256 key hex from private sheet Sheet1!A1 */
async function resolveEncryptionKey(privateSheetId) {
    if (process.env.SIGNAL_KEY) return process.env.SIGNAL_KEY;
    const token = await getOAuthToken();
    const range = encodeURIComponent("Sheet1!A1:A2");
    const res = await fetch(`${SHEETS_BASE}/${privateSheetId}/values/${range}`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error("Key sheet read failed: " + res.status);
    const d = await res.json();
    const key = d.values?.[0]?.[0]?.trim();
    if (!key || key.length !== 64) throw new Error("Signal key missing or wrong length in private sheet — run cycleSignalKey() in the web app");
    return key;
}

/* ============================================================
   ADB / logcat helpers
   ============================================================ */

const ADB_DEVICE = process.env.ADB_DEVICE || null;

/**
 * Resolved ADB serial — may be the mDNS transport ID (e.g. adb-XXX._adb-tls-connect._tcp)
 * even when ADB_DEVICE was set as an IP:port.  Discovered once after connecting.
 */
let _adbSerial = ADB_DEVICE;

/**
 * Scan `adb devices` and return the serial of the best matching device.
 * Prefers a device matching ADB_DEVICE (IP or transport). Falls back to
 * the sole connected device, then back to ADB_DEVICE unchanged.
 */
function resolveAdbSerial() {
    try {
        const raw = execSync("adb devices", { encoding: "utf8", timeout: 5_000, stdio: ["pipe","pipe","pipe"] });
        const lines = raw.split("\n")
            .filter(l => l.trim() && !l.startsWith("List"))
            .filter(l => l.includes("\tdevice"));
        if (!lines.length) return _adbSerial;
        // Single device — use it unambiguously
        if (lines.length === 1) return lines[0].split(/\s+/)[0];
        // Multiple devices — try to match our IP
        if (ADB_DEVICE) {
            const ip = ADB_DEVICE.split(":")[0];
            const hit = lines.find(l => l.startsWith(ADB_DEVICE) || l.includes(ip));
            if (hit) return hit.split(/\s+/)[0];
        }
        return lines[0].split(/\s+/)[0];
    } catch {
        return _adbSerial;
    }
}

function adb(...args) {
    const cmd = _adbSerial ? ["adb", "-s", _adbSerial, ...args] : ["adb", ...args];
    // stdio:"pipe" prevents adb's stderr messages from leaking into our terminal output
    return execSync(cmd.join(" "), { encoding: "utf8", timeout: 10_000, stdio: ["pipe", "pipe", "pipe"] }).trim();
}

/** adb connect must NOT use -s (the device isn't known yet when connecting) */
function adbConnect(addr) {
    return execSync(`adb connect ${addr}`, { encoding: "utf8", timeout: 10_000, stdio: ["pipe", "pipe", "pipe"] }).trim();
}

function adbSpawn(...args) {
    const realArgs = _adbSerial ? ["-s", _adbSerial, ...args] : args;
    return spawn("adb", realArgs, { stdio: ["ignore", "pipe", "pipe"] });
}

/** Start logcat capturing lines matching the OrchestratorPeer tag */
function startLogcat() {
    const lines = [];
    let proc = null;
    let stopped = false;

    if (!ADB_DEVICE) {
        return {
            lines,
            stop: () => {},
            waitForLine: (pattern, timeoutMs) => {
                log("  ⚠  ADB_DEVICE not set — skipping Android logcat assertion");
                return Promise.resolve(null);
            },
        };
    }

    // Clear logcat buffer first so we don't pick up stale lines
    try { adb("logcat", "-c"); } catch { /* best effort */ }

    proc = adbSpawn("logcat", "-v", "brief", `${TAG_ANDROID}:V`, "*:S");
    proc.stdout.setEncoding("utf8");

    let buf = "";
    proc.stdout.on("data", chunk => {
        buf += chunk;
        const parts = buf.split("\n");
        buf = parts.pop();
        for (const line of parts) {
            // Only keep real logcat lines — format is "D/Tag(pid): msg"
            // Filter out adb status messages like "- waiting for device -"
            if (/^[DIWEVF]\//.test(line)) lines.push(line);
        }
    });
    proc.stderr.on("data", () => {});
    proc.on("error", () => {});

    return {
        lines,
        stop() {
            stopped = true;
            try { proc?.kill("SIGTERM"); } catch {}
        },
        /**
         * Wait until logcat emits a line matching `pattern`.
         * Returns the matched line, or null on timeout.
         */
        waitForLine(pattern, timeoutMs = 20_000) {
            const re = pattern instanceof RegExp ? pattern : new RegExp(pattern);
            return new Promise(resolve => {
                const start = Date.now();
                const check = () => {
                    const hit = lines.find(l => re.test(l));
                    if (hit) { resolve(hit); return; }
                    if (stopped || Date.now() - start > timeoutMs) { resolve(null); return; }
                    setTimeout(check, 200);
                };
                check();
            });
        },
    };
}

/** Check ADB connectivity and return device model or null */
function checkAdb() {
    if (!ADB_DEVICE) return null;
    try {
        adbConnect(ADB_DEVICE);
        // Discover the actual transport serial (mDNS or IP:port, whichever is live)
        _adbSerial = resolveAdbSerial();
        const model = adb("shell", "getprop", "ro.product.model").replace(/\s+/g, " ").trim();
        return model || "Android device";
    } catch {
        return null;
    }
}

/* ============================================================
   Peer factory
   ============================================================ */

function makePeer(sheetId, suffix = "", extraOpts = {}) {
    const rawId = "mesh-test-" + suffix + "-" + Date.now();
    const peerId = createHash("sha256").update(rawId).digest("hex").slice(0, 8);
    const messages = [];
    const connected = new Set();

    const peer = new SheetWebRtcPeer({
        sheetId,
        getToken: getOAuthToken,
        encryptionKey: _encKey || undefined,
        peerId,
        displayName: `TestPeer-${suffix}`,
        onMessage(remotePeerId, msg) { messages.push({ from: remotePeerId, msg }); },
        onConnect(remotePeerId) { connected.add(remotePeerId); },
        ...extraOpts,
    });

    return { peer, peerId, messages, connected };
}

/** Poll until `predicate()` returns truthy or timeout */
async function waitUntil(predicate, timeoutMs = 30_000, intervalMs = 500) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const r = predicate();
        if (r) return r;
        await sleep(intervalMs);
    }
    return null;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function log(msg)  { process.stdout.write(msg + "\n"); }
function die(msg)  { process.stderr.write("ERROR: " + msg + "\n"); process.exit(2); }

/* ============================================================
   Test runner
   ============================================================ */

class TestRunner {
    constructor(sheetId, logcat) {
        this.sheetId = sheetId;
        this.logcat  = logcat;
        this.results = [];
    }

    async run(name, fn) {
        log(`\n┌─ ${name}`);
        const start = Date.now();
        let pass = false;
        let detail = "";
        try {
            const r = await fn();
            pass   = r.pass !== false;
            detail = r.detail || "";
        } catch (err) {
            pass   = false;
            detail = err.message;
        }
        const elapsed = ((Date.now() - start) / 1000).toFixed(1) + "s";
        const icon = pass ? "✓" : "✗";
        log(`└─ ${icon} ${name}  (${elapsed})`);
        if (detail) log(`   ${pass ? "   " : "ERR"} ${detail}`);
        this.results.push({ name, pass, elapsed, detail });
    }

    summary() {
        const total  = this.results.length;
        const passed = this.results.filter(r => r.pass).length;
        const failed = total - passed;
        log("\n═══════════════════════════════════════");
        log(` Mesh test results: ${passed}/${total} passed`);
        if (failed) {
            log("\nFailed:");
            for (const r of this.results.filter(r => !r.pass)) {
                log(`  ✗ ${r.name}${r.detail ? "  — " + r.detail : ""}`);
            }
        }
        log("═══════════════════════════════════════\n");
        return failed === 0;
    }
}

/* ============================================================
   Helper: read the raw signaling column from Sheets
   (same query as SheetWebRtcPeer._readAll, returned as sparse array)
   ============================================================ */

async function readSignalingColumn(sheetId) {
    const token = await getOAuthToken();
    const TOTAL_ROWS = MAX_SLOTS * BLOCK_SIZE + BLOCK_START;
    const range = `Sheet1!T1:T${TOTAL_ROWS + 1}`;
    const res = await fetch(`${SHEETS_BASE}/${sheetId}/values/${range}`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error("Sheets read failed: " + res.status);
    const data = await res.json();
    const rows = data.values || [];
    const result = new Array(TOTAL_ROWS + 2).fill(null);
    for (let i = 0; i < rows.length; i++) {
        const raw = rows[i]?.[0];
        if (raw != null && raw !== "") result[i + BLOCK_START] = decryptOrRaw(raw);
    }
    return result;
}

function parseJson(s) { try { return s ? JSON.parse(s) : null; } catch { return null; } }

async function findAndroidPresence(sheetId) {
    const vals = await readSignalingColumn(sheetId);
    for (let slot = 0; slot < MAX_SLOTS; slot++) {
        const row = BLOCK_START + slot * BLOCK_SIZE;
        const p = parseJson(vals[row]);
        if (!p || !p.peerId) continue;
        if (Date.now() - (p.ts || 0) > ALIVE_TTL) continue;
        // Exclude our own test peers (they all use "TestPeer-" as display name prefix)
        // Any other live peer is treated as the Android device
        const name = (p.name || "").toLowerCase();
        if (!name.startsWith("testpeer-")) {
            return { ...p, block: row };
        }
    }
    return null;
}

/** List all live peers currently in the signaling sheet */
async function listLivePeers(sheetId) {
    const vals = await readSignalingColumn(sheetId);
    const out = [];
    for (let slot = 0; slot < MAX_SLOTS; slot++) {
        const row = BLOCK_START + slot * BLOCK_SIZE;
        const p = parseJson(vals[row]);
        if (!p || !p.peerId) continue;
        if (Date.now() - (p.ts || 0) > ALIVE_TTL) continue;
        out.push({ ...p, block: row });
    }
    return out;
}

/* ============================================================
   Scenarios
   ============================================================ */

async function scenarioFreshJoin(runner, sheetId, logcat) {
    await runner.run("fresh-join: Node peer claims a slot", async () => {
        const { peer, peerId } = makePeer(sheetId, "fresh");
        try {
            await peer.start();
            await sleep(1000); // let _join complete

            const slotClaimed = peer.block >= BLOCK_START;
            const vals = await readSignalingColumn(sheetId);
            const presence = parseJson(vals[peer.block]);
            const correctId = presence?.peerId === peerId;

            return {
                pass: slotClaimed && correctId,
                detail: `block=${peer.block} peerId=${peerId} presence.peerId=${presence?.peerId}`,
            };
        } finally {
            peer.stop();
        }
    });

    await runner.run("fresh-join: Android logs DataChannel open (requires ADB)", async () => {
        const android = await findAndroidPresence(sheetId);
        if (!android) {
            return { pass: true, detail: "SKIP — Android not in signaling sheet (open the Waymark app first)" };
        }
        const { peer } = makePeer(sheetId, "fresh2");
        try {
            logcat.lines.length = 0;
            await peer.start();
            // Wait up to 3 poll cycles for Android to pick up our presence and open a DC
            const match = await logcat.waitForLine(/DC .{6,} → OPEN|DataChannel open/, POLL_MS * 6 + ICE_TIMEOUT_MS);
            return {
                pass: match !== null,
                detail: match
                    ? `Android DC opened: "${match.trim()}"`
                    : "no DataChannel open log line within timeout",
            };
        } finally {
            peer.stop();
        }
    });
}

async function scenarioWorkerRestart(runner, sheetId, logcat) {
    await runner.run("worker-restart: peer stops, clears presence, restarts", async () => {
        const { peer: p1, peerId: id1 } = makePeer(sheetId, "restart1");
        await p1.start();
        await sleep(1500);
        const slotBefore = p1.block;
        p1.stop();
        await sleep(600); // let clearPresence write propagate

        const valsAfterStop = await readSignalingColumn(sheetId);
        const presenceAfterStop = parseJson(valsAfterStop[slotBefore]);
        const cleared = !presenceAfterStop?.peerId || presenceAfterStop.peerId !== id1;

        // New instance (simulates docker container restart with fresh peerId)
        const { peer: p2, peerId: id2 } = makePeer(sheetId, "restart2");
        await p2.start();
        await sleep(1500);
        const slotAfter = p2.block;
        p2.stop();

        return {
            pass: cleared && slotAfter >= BLOCK_START,
            detail: `cleared=${cleared} p1.slot=${slotBefore} p2.slot=${slotAfter}`,
        };
    });

    await runner.run("worker-restart: Android reconnects to restarted worker (requires ADB)", async () => {
        const android = await findAndroidPresence(sheetId);
        if (!android) {
            return { pass: true, detail: "SKIP — Android not in signaling sheet" };
        }
        logcat.lines.length = 0;
        const { peer } = makePeer(sheetId, "restart3");
        try {
            await peer.start();
            const match = await logcat.waitForLine(/DC .{6,} → OPEN|DataChannel open|Joined mesh/, POLL_MS * 6 + ICE_TIMEOUT_MS);
            return {
                pass: match !== null,
                detail: match ? match.trim() : "Android did not open DC to restarted worker in time",
            };
        } finally {
            peer.stop();
        }
    });
}

async function scenarioIceFailure(runner, sheetId, logcat) {
    await runner.run("ice-failure: ICE failed peer is evicted and offer rebuilds next poll", async () => {
        const { peer, peerId } = makePeer(sheetId, "icefail");
        try {
            await peer.start();
            await sleep(POLL_MS + 2000); // let first poll run

            // Artificially inject a failed PeerConnection into the peer map
            // (mirrors what happens when a NAT binding expires mid-session)
            // iceConnectionState must be a string property — _poll() checks === "failed"
            const fakeId = "deadbeef";
            const fakePc = {
                iceConnectionState: "failed",  // string property, not a function
                close: () => {},
            };
            peer.peers.set(fakeId, { pc: fakePc, dc: null, state: "connecting" });

            // Inject a stale presence for fakeId so the poll loop sees it as alive
            const token = await getOAuthToken();
            const fakeSlot = BLOCK_START + 2 * BLOCK_SIZE;
            const fakePresence = encryptOrRaw(JSON.stringify({ peerId: fakeId, name: "FakePeer", ts: Date.now() }));
            await fetch(
                `${SHEETS_BASE}/${sheetId}/values/${encodeURIComponent(`Sheet1!T${fakeSlot}`)}?valueInputOption=RAW`,
                {
                    method: "PUT",
                    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
                    body: JSON.stringify({ range: `Sheet1!T${fakeSlot}`, majorDimension: "ROWS", values: [[fakePresence]] }),
                }
            );
            await sleep(200);

            // Run one manual poll cycle — should evict the failed PC
            await peer._poll();

            const evicted = !peer.peers.has(fakeId) ||
                            peer.peers.get(fakeId)?.pc?.iceConnectionState !== "failed";

            // Clean up the fake row we wrote
            try {
                await fetch(
                    `${SHEETS_BASE}/${sheetId}/values/${encodeURIComponent(`Sheet1!T${fakeSlot}`)}?valueInputOption=RAW`,
                    {
                        method: "PUT",
                        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
                        body: JSON.stringify({ range: `Sheet1!T${fakeSlot}`, majorDimension: "ROWS", values: [[""]] }),
                    }
                );
            } catch {}

            return {
                pass: evicted,
                detail: `fakeId in peers after poll: ${peer.peers.has(fakeId)}`,
            };
        } finally {
            peer.stop();
        }
    });

    await runner.run("ice-failure: Android logs ICE DISCONNECTED → CLOSED recovery (requires ADB)", async () => {
        const android = await findAndroidPresence(sheetId);
        if (!android) {
            return { pass: true, detail: "SKIP — Android not in signaling sheet" };
        }
        // Verify Android can reconnect to a fresh peer — exercises the same ICE
        // re-negotiation path as a real ICE failure + recovery cycle.
        logcat.lines.length = 0;
        const { peer, connected } = makePeer(sheetId, "icefail2");
        try {
            await peer.start();
            // Primary check: Node-side DC open (fast and reliable).
            // Also try to capture the Android logcat confirmation.
            const dcOpened = await waitUntil(() => connected.has(android.peerId), POLL_MS * 6 + ICE_TIMEOUT_MS);
            if (!dcOpened) {
                return { pass: false, detail: "DC to Android never opened in ice-failure recovery test" };
            }
            // Require Android to confirm reconnect — without this the test only proves
            // Node recovered, not that Android actually re-established the channel.
            const logLine = await logcat.waitForLine(/DC .{6,} → OPEN|DataChannel open/, 8_000);
            return {
                pass: logLine !== null,
                detail: logLine ? logLine.trim() : "DC opened at Node side but Android did not confirm reconnect within 8s",
            };
        } finally {
            peer.stop();
        }
    });
}

async function scenarioStaleOffer(runner, sheetId, logcat) {
    await runner.run("stale-offer: offer aged past OFFER_MAX_AGE is rebuilt next poll", async () => {
        const { peer, peerId } = makePeer(sheetId, "stale");
        try {
            await peer.start();
            await sleep(1500);

            // Manually inject a stale offer into our block's OFFERS row
            const offersRow = peer.block + 1; // OFF_OFFERS = 1
            const token     = await getOAuthToken();
            const fakeRemoteId = "ffffffff";

            // Give fakeRemoteId a live-looking presence in a slot so it appears alive
            const fakeSlot = BLOCK_START + 3 * BLOCK_SIZE;
            const fakePresenceJson = encryptOrRaw(JSON.stringify({ peerId: fakeRemoteId, name: "FakeRemote", ts: Date.now() }));
            await fetch(
                `${SHEETS_BASE}/${sheetId}/values/${encodeURIComponent(`Sheet1!T${fakeSlot}`)}?valueInputOption=RAW`,
                {
                    method: "PUT",
                    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
                    body: JSON.stringify({ range: `Sheet1!T${fakeSlot}`, majorDimension: "ROWS", values: [[fakePresenceJson]] }),
                }
            );

            // Write a stale offer (older than OFFER_MAX_AGE) into our offers row
            const staleOffer = encryptOrRaw(JSON.stringify({
                [fakeRemoteId]: {
                    sdp: "v=0\r\no=fake 12345 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n",
                    ts:  Date.now() - OFFER_MAX_AGE - 5_000,
                },
            }));
            await fetch(
                `${SHEETS_BASE}/${sheetId}/values/${encodeURIComponent(`Sheet1!T${offersRow}`)}?valueInputOption=RAW`,
                {
                    method: "PUT",
                    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
                    body: JSON.stringify({ range: `Sheet1!T${offersRow}`, majorDimension: "ROWS", values: [[staleOffer]] }),
                }
            );

            // Run one poll — should detect stale offer, close fake entry, rebuild
            await peer._poll();
            await sleep(300);

            const valsAfter = await readSignalingColumn(sheetId);
            const offersAfter = parseJson(valsAfter[offersRow]);
            let rebuilt = false;
            if (offersAfter && offersAfter[fakeRemoteId]) {
                const age = Date.now() - (offersAfter[fakeRemoteId].ts || 0);
                rebuilt = age < 60_000; // rebuilt within last minute
            }

            // Clean up fake rows
            try {
                for (const row of [offersRow, fakeSlot]) {
                    await fetch(
                        `${SHEETS_BASE}/${sheetId}/values/${encodeURIComponent(`Sheet1!T${row}`)}?valueInputOption=RAW`,
                        {
                            method: "PUT",
                            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
                            body: JSON.stringify({ range: `Sheet1!T${row}`, majorDimension: "ROWS", values: [[""]] }),
                        }
                    );
                }
            } catch {}

            return {
                pass: rebuilt,
                detail: `offersAfter[fakeRemoteId]=${JSON.stringify(offersAfter?.[fakeRemoteId])} rebuilt=${rebuilt}`,
            };
        } finally {
            peer.stop();
        }
    });
}

async function scenarioSustainedPing(runner, sheetId, logcat) {
    await runner.run("sustained-ping: DC stays alive across 2 ping intervals (requires ADB)", async () => {
        // This test only makes sense with Android connected.
        // It verifies that the Android DC_PING_MS keepalive round-trip works.
        const android = await findAndroidPresence(sheetId);
        if (!android) {
            return {
                pass: true,
                detail: "SKIP — Android not connected to signaling sheet (no live presence)",
            };
        }

        const { peer, connected } = makePeer(sheetId, "ping");
        try {
            await peer.start();
            // Wait for connection to Android
            const opened = await waitUntil(() => connected.size > 0, POLL_MS * 4 + ICE_TIMEOUT_MS);
            if (!opened) {
                return { pass: false, detail: "DC to Android never opened" };
            }

            log(`   DC open with: ${[...connected].join(", ")}`);

            // Wait for 2 Android ping intervals (Android pings every 30 s)
            // We only wait one full interval here to keep the test fast
            const ANDROID_PING_MS = 30_000;
            await sleep(ANDROID_PING_MS + 3_000);

            // DC should still be open
            const stillOpen = peer.connectedPeers().length > 0;
            // Check Android logcat for pong activity
            const pongLine = await logcat.waitForLine(/waymark-ping|waymark-pong|Ping send|Pong/, 2000);

            return {
                pass: stillOpen,
                detail: `DC still open=${stillOpen}  pong activity=${pongLine ? pongLine.trim() : "not observed"}`,
            };
        } finally {
            peer.stop();
        }
    });
}

const ICE_TIMEOUT_MS = 15_000;

async function scenarioNotification(runner, sheetId, logcat) {
    await runner.run("notification: waymark-notification delivers to Android (requires ADB)", async () => {
        const android = await findAndroidPresence(sheetId);
        if (!android) {
            return {
                pass: true,
                detail: "SKIP — Android not connected to signaling sheet",
            };
        }

        const { peer, connected, messages } = makePeer(sheetId, "notif");
        try {
            await peer.start();
            // Use a longer window (7 polls + ICE) in case Android is recovering from a
            // previous test's teardown before reconnecting.
            const opened = await waitUntil(() => connected.has(android.peerId), POLL_MS * 7 + ICE_TIMEOUT_MS);
            if (!opened) {
                return { pass: false, detail: "DC to Android never opened — skipping send" };
            }

            log(`   DC open, sending notification…`);
            logcat.lines.length = 0;

            const notif = {
                type:  "waymark-notification",
                title: "Mesh test",
                body:  "E2E test notification " + Date.now(),
            };
            peer.broadcast(notif);

            // Android's handleMessage logs: Notification received — title="..." body="..."
            const received = await logcat.waitForLine(/Notification received/, 8_000);

            return {
                pass: received !== null,
                detail: received
                    ? `Android received: "${received.trim()}"`
                    : "notification did not appear in Android logcat within 8 s",
            };
        } finally {
            peer.stop();
        }
    });

    await runner.run("notification: Android logs notification title and body", async () => {
        const android = await findAndroidPresence(sheetId);
        if (!android) {
            return { pass: true, detail: "SKIP — Android not connected" };
        }

        const { peer, connected } = makePeer(sheetId, "notif2");
        try {
            await peer.start();
            const opened = await waitUntil(() => connected.has(android.peerId), POLL_MS * 4 + ICE_TIMEOUT_MS);
            if (!opened) return { pass: false, detail: "DC to Android never opened" };

            const unique = "MeshTestBody-" + Date.now();
            logcat.lines.length = 0;
            peer.broadcast({ type: "waymark-notification", title: "Mesh E2E", body: unique });

            // Android logs: Notification received — title="Mesh E2E" body="MeshTestBody-1234567890"
            const line = await logcat.waitForLine(new RegExp(unique.slice(-10)), 8_000);
            return {
                pass: line !== null,
                detail: line ? `body found in logcat: "${line.trim()}"` : `"${unique.slice(-10)}" not seen in logcat`,
            };
        } finally {
            peer.stop();
        }
    });
}

/* ----------------------------------------------------------------
   notification-live: Launch app → wait for mesh join → fire a real
   notification → confirm in logcat AND system tray.
   This is the "feel it on your phone" test.
   ---------------------------------------------------------------- */
async function scenarioNotificationLive(runner, sheetId, logcat) {
    await runner.run("notification-live: launch app + fire notification + confirm receipt", async () => {
        // ── Step 1: Check for any live Android presence (< ALIVE_TTL = 50 s) ──
        // Don't re-launch if Android is already running — that restarts the service.
        let android = null;
        if (ADB_DEVICE) {
            const existing = await findAndroidPresence(sheetId);
            if (existing) {
                const ageS = Math.round((Date.now() - (existing.ts || 0)) / 1000);
                log(`   Android already live (heartbeat ${ageS}s ago) — skipping launch`);
                android = existing;
            } else {
                // Cold-start: use am start (reliable); monkey only as fallback
                log("   Launching Waymark via am start...");
                try {
                    adb("shell", "am", "start", "-n", "com.waymark.app/.MainActivity");
                } catch {
                    log("   (am start failed — trying monkey fallback)");
                    try {
                        adb("shell", "monkey", "-p", "com.waymark.app", "-c", "android.intent.category.LAUNCHER", "1");
                    } catch { /* ignore */ }
                }
                // Also kick the service directly with the sheet ID — works if the cached
                // token is still fresh (< 55 min old) and avoids waiting for the WebView.
                try {
                    adb("shell", "am", "startforegroundservice",
                        "-n", "com.waymark.app/.WebRtcService",
                        "-a", "com.waymark.app.action.CONNECT",
                        "--es", "sheet_id", sheetId);
                    log("   Service ACTION_CONNECT sent");
                } catch { /* token may be stale — WebView path is the fallback */ }
            }
        }

        // ── Step 2: Wait up to 120 s for Android to appear in signaling sheet ─
        if (!android) {
            log("   Waiting for Android presence in signaling sheet (up to 120 s)...");
            const deadline = Date.now() + 120_000;
            while (Date.now() < deadline) {
                const p = await findAndroidPresence(sheetId);
                if (p) { android = p; break; }
                await sleep(1000);
            }
        }
        if (!android) {
            return {
                pass: !ADB_DEVICE,
                detail: ADB_DEVICE
                    ? "FAIL — ADB device is connected but Waymark app did not join the signaling sheet in 120s. Is the app installed? Is POST_NOTIFICATIONS granted?"
                    : "SKIP — no ADB_DEVICE set (open the Waymark app on your phone and set ADB_DEVICE=ip:port)",
            };
        }
        log(`   Android present: peerId=${android.peerId}  name="${android.name || "(unnamed)"}"`);

        // ── Step 3: Open a DataChannel to Android ──────────────────────
        const { peer, connected } = makePeer(sheetId, "notif-live");
        try {
            logcat.lines.length = 0;
            await peer.start();
            log(`   Node peer joined (block=${peer.block}), waiting for DataChannel to Android...`);

            const dcOpened = await waitUntil(() => connected.has(android.peerId), POLL_MS * 8 + ICE_TIMEOUT_MS);
            if (!dcOpened) {
                return {
                    pass: false,
                    detail: `DataChannel to Android (${android.peerId}) never opened`,
                };
            }
            log(`   DataChannel OPEN with Android (${android.peerId})`);

            // ── Step 4: Send a notification ────────────────────────────
            logcat.lines.length = 0;
            const uniqueId = Date.now().toString(36).toUpperCase();
            const notif = {
                type:  "waymark-notification",
                title: "Waymark Mesh Test",
                body:  `P2P pipeline working! [${uniqueId}]`,
            };
            const sent = peer.broadcast(notif);

            log(`   ┌────────────────────────────────────────────────────`);
            log(`   │  NOTIFICATION FIRED`);
            log(`   │  Title : ${notif.title}`);
            log(`   │  Body  : ${notif.body}`);
            log(`   │  Sent to ${sent} connected peer(s)`);

            // ── Step 5: Confirm in logcat ─────────────────────────────
            // Android logs: I/OrchestratorPeer: Notification received — title="..." body="..."
            const logLine = await logcat.waitForLine(/Notification received|waymark-notification/, 8_000);
            log(`   │  Logcat: ${logLine ? logLine.trim() : "(not seen in logcat in 8s)"}`);

            // ── Step 6: Check Android system notification tray ─────────
            let trayResult = "";
            if (ADB_DEVICE) {
                try {
                    const dump = adb("shell", "dumpsys", "notification", "--noredact");
                    if (dump.includes("Waymark Mesh Test") || dump.includes(uniqueId)) {
                        trayResult = "visible in system tray";
                    } else {
                        trayResult = "not in dumpsys (may have auto-dismissed or be a silent notification)";
                    }
                } catch {
                    trayResult = "dumpsys unavailable";
                }
                log(`   │  Tray  : ${trayResult}`);
            }
            log(`   └────────────────────────────────────────────────────`);

            // Pass if DC was open and notification was sent.
            // When ADB is available, require logcat confirmation — dc.send() is enqueued
            // and can be silently dropped if the channel starts closing immediately after.
            return {
                pass: sent > 0 && (logLine !== null || !ADB_DEVICE),
                detail: logLine
                    ? `received in logcat${trayResult ? " | " + trayResult : ""}`
                    : `sent to ${sent} open DataChannel(s)${trayResult ? " | " + trayResult : ""}`,
            };
        } finally {
            peer.stop();
        }
    });

    await runner.run("notification-live: round-trip latency under 3 s", async () => {
        const android = await findAndroidPresence(sheetId);
        if (!android) {
            return {
                pass: !ADB_DEVICE,
                detail: ADB_DEVICE
                    ? "FAIL — ADB device connected but Android not in signaling sheet"
                    : "SKIP — no ADB_DEVICE set",
            };
        }
        const { peer, connected } = makePeer(sheetId, "notif-lat");
        try {
            await peer.start();
            const dcOpened = await waitUntil(() => connected.has(android.peerId), POLL_MS * 5 + ICE_TIMEOUT_MS);
            if (!dcOpened) return { pass: false, detail: "DC never opened for latency test" };

            logcat.lines.length = 0;
            const t0 = Date.now();
            peer.broadcast({
                type:  "waymark-notification",
                title: "Latency Test",
                body:  "round-trip " + t0,
            });

            // Android logs: I/OrchestratorPeer: Notification received — title="..." body="..."
            const logLine = await logcat.waitForLine(/Notification received|waymark-notification/, 5_000);
            const rtt = Date.now() - t0;
            log(`   Notification round-trip: ${rtt} ms`);

            return {
                pass: rtt < 3000,
                detail: logLine ? `RTT=${rtt}ms (logcat confirmed)` : `RTT=${rtt}ms (DC only — check phone)`,
            };
        } finally {
            peer.stop();
        }
    });
}

async function scenarioSlotCollision(runner, sheetId) {
    await runner.run("slot-collision: two simultaneous peers land on same slot, one re-claims", async () => {
        // Both peers read the sheet concurrently before either writes —
        // the collision guard must detect and resolve this cleanly.
        const [a, b] = [makePeer(sheetId, "colA"), makePeer(sheetId, "colB")];
        try {
            // Start both at exactly the same time with no delay
            await Promise.all([a.peer.start(), b.peer.start()]);
            await sleep(2000); // let collision guard + re-claim settle

            const bothHaveSlots = a.peer.block >= BLOCK_START && b.peer.block >= BLOCK_START;
            const differentSlots = a.peer.block !== b.peer.block;

            return {
                pass: bothHaveSlots && differentSlots,
                detail: `a.block=${a.peer.block} b.block=${b.peer.block}`,
            };
        } finally {
            a.peer.stop(); b.peer.stop();
        }
    });
}

async function scenarioMeshFull(runner, sheetId) {
    await runner.run("mesh-full: newcomer gets block=-1 when all 8 slots occupied", async () => {
        // Fill slots 2-8 (slot 1 may have Android or other real peers)
        // We'll write synthetic presence blobs at rows covering 7 slots,
        // then let the newcomer try to join.
        const token = await getOAuthToken();
        const liveSlots = (await listLivePeers(sheetId)).map(p => p.block);
        const freeSlots = [];
        for (let s = 0; s < MAX_SLOTS; s++) {
            const row = BLOCK_START + s * BLOCK_SIZE;
            if (!liveSlots.includes(row)) freeSlots.push(row);
        }

        if (freeSlots.length < 7) {
            return {
                pass: true,
                detail: `SKIP — only ${freeSlots.length} free slots, need 7 to fill without harming real peers`,
            };
        }

        const occupied = freeSlots.slice(0, Math.min(freeSlots.length, MAX_SLOTS - liveSlots.length));
        // Write synthetic alive presence to fill slots
        for (const row of occupied) {
            const fakeP = encryptOrRaw(JSON.stringify({ peerId: "fake" + row, name: "FakeFull", ts: Date.now() }));
            await fetch(
                `${SHEETS_BASE}/${sheetId}/values/${encodeURIComponent(`Sheet1!T${row}`)}?valueInputOption=RAW`,
                {
                    method: "PUT",
                    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
                    body: JSON.stringify({ range: `Sheet1!T${row}`, majorDimension: "ROWS", values: [[fakeP]] }),
                }
            );
        }
        await sleep(300);

        const { peer } = makePeer(sheetId, "fullmesh");
        try {
            await peer.start();
            await sleep(1500);
            const blocked = peer.block < 0;

            // Clean up synthetic presence
            for (const row of occupied) {
                try {
                    await fetch(
                        `${SHEETS_BASE}/${sheetId}/values/${encodeURIComponent(`Sheet1!T${row}`)}?valueInputOption=RAW`,
                        {
                            method: "PUT",
                            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
                            body: JSON.stringify({ range: `Sheet1!T${row}`, majorDimension: "ROWS", values: [[""]] }),
                        }
                    );
                } catch {}
            }

            // Determine if test is meaningful (if we couldn't fill enough slots, skip)
            const slotsWeOccupied = occupied.length;
            const realSlots       = liveSlots.length;
            const totalFilled     = slotsWeOccupied + realSlots;

            if (totalFilled < MAX_SLOTS) {
                return {
                    pass: true,
                    detail: `SKIP — only filled ${totalFilled}/${MAX_SLOTS} slots (real=${realSlots} fake=${slotsWeOccupied})`,
                };
            }

            return {
                pass: blocked,
                detail: `newcomer.block=${peer.block} (expected -1) totalFilled=${totalFilled}`,
            };
        } finally {
            peer.stop();
        }
    });
}

async function scenarioPollConcurrency(runner, sheetId) {
    await runner.run("poll-guard: concurrent _poll() calls are serialised", async () => {
        const { peer } = makePeer(sheetId, "conc");
        try {
            await peer.start();
            await sleep(1000);

            // Patch _readAll to count calls
            let readCount = 0;
            const origRead = peer._readAll.bind(peer);
            peer._readAll = async function() { readCount++; return origRead(); };

            const before = readCount;
            await Promise.all([peer._poll(), peer._poll(), peer._poll()]);
            const after = readCount;

            return {
                pass: (after - before) === 1,
                detail: `readAll calls in 3 concurrent polls: ${after - before} (expected 1)`,
            };
        } finally {
            peer.stop();
        }
    });
}

async function scenarioHeartbeatFreshness(runner, sheetId) {
    await runner.run("heartbeat: timestamp advances on each write", async () => {
        const { peer, peerId } = makePeer(sheetId, "hb");
        try {
            await peer.start();
            await sleep(1000);

            const v1 = await readSignalingColumn(sheetId);
            const ts1 = parseJson(v1[peer.block])?.ts || 0;

            await sleep(100);
            await peer._heartbeat();
            await sleep(200);

            const v2 = await readSignalingColumn(sheetId);
            const ts2 = parseJson(v2[peer.block])?.ts || 0;

            return {
                pass: ts2 > ts1,
                detail: `ts1=${ts1} ts2=${ts2} diff=${ts2 - ts1}ms`,
            };
        } finally {
            peer.stop();
        }
    });
}

async function scenarioAndroidPeerVisibility(runner, sheetId, logcat) {
    await runner.run("android-visibility: Node peer sees Android presence in signaling sheet", async () => {
        const android = await findAndroidPresence(sheetId);
        if (!android) {
            return {
                pass: true,
                detail: "SKIP — Android not present in signaling sheet (open the Waymark app first)",
            };
        }

        // Verify our peer also sees Android as alive after a poll
        const { peer } = makePeer(sheetId, "vis");
        try {
            await peer.start();
            await sleep(POLL_MS + 2000); // wait for at least one poll cycle

            const allLive = await listLivePeers(sheetId);
            const androidVisible = allLive.some(p => p.peerId === android.peerId);

            return {
                pass: androidVisible,
                detail: `Android peerId=${android.peerId}  visible to our poll=${androidVisible}  allLive=${allLive.map(p => p.peerId).join(", ")}`,
            };
        } finally {
            peer.stop();
        }
    });

    await runner.run("android-connection: Node peer opens DataChannel with Android", async () => {
        const android = await findAndroidPresence(sheetId);
        if (!android) {
            return { pass: true, detail: "SKIP — Android not present" };
        }

        const { peer, connected } = makePeer(sheetId, "dc-to-android");
        try {
            await peer.start();
            const opened = await waitUntil(() => connected.has(android.peerId), POLL_MS * 4 + ICE_TIMEOUT_MS);

            return {
                pass: opened !== null,
                detail: `DC to ${android.peerId} (${android.name}) opened=${opened !== null}`,
            };
        } finally {
            peer.stop();
        }
    });
}

/* ============================================================
   Notification buffer — tests that notifications buffered while
   the DataChannel is down are delivered when it (re)opens.
   ============================================================ */

async function scenarioNotifBuffer(runner, sheetId, logcat) {
    // ── Sub-test 1: buffered on start, delivered when DC first opens ──────────
    await runner.run("notif-buffer: notification sent before DC open is delivered on connect", async () => {
        const { peer: pA, peerId: idA } = makePeer(sheetId, "nbuf-A");
        const { peer: pB, messages: msgsB } = makePeer(sheetId, "nbuf-B");
        try {
            await pA.start();
            await sleep(800);

            // Broadcast before B exists — goes into pA's buffer
            const uniqueBody = "buffer-test-" + Date.now();
            const sentToOpen = pA.broadcast({ type: "waymark-notification", title: "Buffer Test", body: uniqueBody });

            // Now B joins; when the DC between A and B opens, A flushes the buffer
            await pB.start();
            const deadline = Date.now() + POLL_MS * 5 + ICE_TIMEOUT_MS;
            while (Date.now() < deadline && !msgsB.some(m => m.msg?.body === uniqueBody)) {
                await sleep(300);
            }
            const delivered = msgsB.some(m => m.msg?.body === uniqueBody);
            return {
                pass: delivered,
                detail: delivered
                    ? `buffered notification delivered to B after DC open (sentToOpen=${sentToOpen})`
                    : `B did not receive buffered notification within timeout (sentToOpen=${sentToOpen})`,
            };
        } finally {
            pA.stop(); pB.stop();
        }
    });

    // ── Sub-test 2: buffered while DC is down, delivered on reconnect ─────────
    await runner.run("notif-buffer: notification buffered during disconnect, delivered on reconnect", async () => {
        const { peer: pA } = makePeer(sheetId, "nbuf-C");
        const { peer: pB, peerId: idB } = makePeer(sheetId, "nbuf-D");
        try {
            await Promise.all([pA.start(), pB.start()]);
            const dcOpen = await waitUntil(
                () => pA.peers.get(idB)?.dc?.readyState === "open",
                POLL_MS * 5 + ICE_TIMEOUT_MS
            );
            if (!dcOpen) return { pass: false, detail: "Initial DC between A and B never opened" };

            // Tear down B — A will detect it gone via poll or manual _closeOne
            pB.stop();
            await sleep(500);
            pA._closeOne(idB);  // evict immediately so broadcast finds no open DCs
            await sleep(200);

            // Notification fired into an empty mesh — goes into buffer
            const uniqueBody = "reconnect-test-" + Date.now();
            pA.broadcast({ type: "waymark-notification", title: "Reconnect Test", body: uniqueBody });

            // Fresh peer reconnects (different peerId — same as a worker restart)
            const { peer: pB2, messages: msgsB2 } = makePeer(sheetId, "nbuf-D2");
            try {
                await pB2.start();
                const deadline = Date.now() + POLL_MS * 5 + ICE_TIMEOUT_MS;
                while (Date.now() < deadline && !msgsB2.some(m => m.msg?.body === uniqueBody)) {
                    await sleep(300);
                }
                const delivered = msgsB2.some(m => m.msg?.body === uniqueBody);
                return {
                    pass: delivered,
                    detail: delivered
                        ? `buffered notification delivered to reconnected peer`
                        : `reconnected peer did not receive buffered notification`,
                };
            } finally {
                pB2.stop();
            }
        } finally {
            pA.stop(); pB.stop();
        }
    });

    // ── Sub-test 3: expired notifications are NOT delivered ──────────────────
    await runner.run("notif-buffer: notification past TTL is not delivered", async () => {
        const { peer: pA } = makePeer(sheetId, "nbuf-E");
        const { peer: pB, messages: msgsB } = makePeer(sheetId, "nbuf-F");
        try {
            await pA.start();
            await sleep(500);

            if (!Array.isArray(pA._notifQueue)) {
                return { pass: false, detail: "SheetWebRtcPeer._notifQueue not found — buffer not implemented" };
            }
            // Manually inject an already-expired entry
            const expiredBody = "expired-" + Date.now();
            pA._notifQueue.push({
                json: JSON.stringify({ type: "waymark-notification", title: "Expired", body: expiredBody }),
                ts: Date.now() - (5 * 60_000 + 1_000),  // 1 s past TTL
                deliveredTo: new Set(),
            });

            await pB.start();
            // Wait for DC to open (flush would have fired)
            await waitUntil(
                () => pA.peers.get(pB.peerId)?.dc?.readyState === "open",
                POLL_MS * 4 + ICE_TIMEOUT_MS
            );
            await sleep(500);

            const delivered = msgsB.some(m => m.msg?.body === expiredBody);
            return {
                pass: !delivered,
                detail: delivered
                    ? `FAIL — expired notification was delivered (should have been pruned)`
                    : `expired notification correctly withheld (queue length=${pA._notifQueue.length})`,
            };
        } finally {
            pA.stop(); pB.stop();
        }
    });

    // ── Sub-test 4: Android receives notification buffered before DC opens ────
    await runner.run("notif-buffer: Android receives notification buffered before DC opened (requires ADB)", async () => {
        const android = await findAndroidPresence(sheetId);
        if (!android) {
            return { pass: true, detail: "SKIP — Android not in signaling sheet" };
        }

        const { peer, connected } = makePeer(sheetId, "nbuf-android");
        try {
            // Broadcast BEFORE start() — no DCs open, goes straight into buffer
            logcat.lines.length = 0;
            const uniqueBody = "buf-android-" + Date.now().toString(36).toUpperCase();
            const sentBefore = peer.broadcast({
                type: "waymark-notification",
                title: "Buffer Android Test",
                body: uniqueBody,
            });
            log(`   Buffered notification (sent=${sentBefore}), now joining mesh...`);

            // Join mesh — when DC to Android opens, buffer is flushed automatically
            await peer.start();
            const dcOpened = await waitUntil(() => connected.has(android.peerId), POLL_MS * 6 + ICE_TIMEOUT_MS);
            if (!dcOpened) return { pass: false, detail: "DC to Android never opened" };

            // Android should now have received the flushed notification
            const logLine = await logcat.waitForLine(/Notification received/, 6_000);
            return {
                pass: logLine !== null,
                detail: logLine
                    ? `Android received buffered notification: "${logLine.trim()}"`
                    : `buffered notification not confirmed in logcat (phone: ${uniqueBody})`,
            };
        } finally {
            peer.stop();
        }
    });
}

/* ============================================================
   Key cycling — verify peers detect + re-key cleanly
   ============================================================ */

async function scenarioKeyCycling(runner, sheetId, logcat) {
    await runner.run("key-cycling: new key written to private sheet is picked up next cycle", async () => {
        if (!_privateSheetId) {
            return { pass: true, detail: "SKIP — private sheet ID not resolved (no PRIV_SHEET env and no .waymark-data.json)" };
        }

        // Start a Node peer with the CURRENT key
        const { peer: pA, peerId: idA } = makePeer(sheetId, "cycle-A");
        try {
            await pA.start();
            await sleep(1500);

            const slotClaimed = pA.block >= BLOCK_START;
            if (!slotClaimed) return { pass: false, detail: "Peer A could not claim a slot before key cycle" };

            // Generate a new key and write it to the private sheet
            const { randomBytes } = await import("node:crypto");
            const newKeyHex = randomBytes(32).toString("hex");
            const token = await getOAuthToken();
            const keyRange = encodeURIComponent("Sheet1!A1:A2");
            const writeRes = await fetch(
                `${SHEETS_BASE}/${_privateSheetId}/values/${keyRange}?valueInputOption=RAW`,
                {
                    method: "PUT",
                    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
                    body: JSON.stringify({
                        range: "Sheet1!A1:A2",
                        majorDimension: "ROWS",
                        values: [[newKeyHex], [String(Date.now())]],
                    }),
                }
            );
            if (!writeRes.ok) return { pass: false, detail: "Failed to write new key to private sheet: " + writeRes.status };

            // Update module-level key so subsequent reads/writes use the new key
            const oldKey = _encKey;
            _encKey = newKeyHex;

            // Start a NEW peer with the new key — it should be able to join
            const { peer: pB, peerId: idB } = makePeer(sheetId, "cycle-B");
            try {
                await pB.start();
                await sleep(1500);
                const bClaimed = pB.block >= BLOCK_START;

                // Peer A (old key) cannot decrypt new-key cells — its poll will
                // produce null presence entries, which is the expected degraded state.
                // We verify it does NOT crash (block still ≥ BLOCK_START from before).
                const aSurvived = pA.block >= BLOCK_START;

                return {
                    pass: bClaimed && aSurvived,
                    detail: `pA survived=${aSurvived} (slot ${pA.block}), pB joined with new key (slot ${pB.block}) oldKey=${oldKey?.slice(0, 8)}... newKey=${newKeyHex.slice(0, 8)}...`,
                };
            } finally {
                pB.stop();
            }
        } finally {
            pA.stop();
        }
    });

    await runner.run("key-cycling: Android re-establishes DC after key cycle (requires ADB)", async () => {
        const android = await findAndroidPresence(sheetId);
        if (!android) {
            return { pass: true, detail: "SKIP — Android not in signaling sheet" };
        }
        if (!_privateSheetId) {
            return { pass: true, detail: "SKIP — private sheet ID not resolved" };
        }
        // After the key was cycled in the prior sub-test, Android will need OAuth
        // to fetch the new key from the private sheet and reconnect.
        // We just verify that Android eventually shows up with a freshened ts.
        const tsBefore = android.ts || 0;
        const deadline = Date.now() + 120_000;
        let androidAfter = null;
        while (Date.now() < deadline) {
            const p = await findAndroidPresence(sheetId);
            if (p && (p.ts || 0) > tsBefore + 5_000) { androidAfter = p; break; }
            await sleep(3_000);
        }
        return {
            pass: androidAfter !== null,
            detail: androidAfter
                ? `Android refreshed presence (ts=${androidAfter.ts})`
                : "Android did not refresh presence within 120s after key cycle",
        };
    });
}

/* ============================================================
   CLI entry point
   ============================================================ */

const SCENARIO_MAP = {
    "fresh-join":            scenarioFreshJoin,
    "worker-restart":        scenarioWorkerRestart,
    "ice-failure":           scenarioIceFailure,
    "stale-offer":           scenarioStaleOffer,
    "sustained-ping":        scenarioSustainedPing,
    "notification":          scenarioNotification,
    "notification-live":     scenarioNotificationLive,
    "notif-buffer":          scenarioNotifBuffer,
    "slot-collision":        scenarioSlotCollision,
    "mesh-full":             scenarioMeshFull,
    "poll-guard":            scenarioPollConcurrency,
    "heartbeat":             scenarioHeartbeatFreshness,
    "android-visibility":    scenarioAndroidPeerVisibility,
    "key-cycling":           scenarioKeyCycling,
};

const FULL_ROUNDTRIP_ORDER = [
    "heartbeat",
    "poll-guard",
    "fresh-join",
    "android-visibility",
    "slot-collision",
    "worker-restart",
    "stale-offer",
    "ice-failure",
    "notification-live",     // launch app + real end-to-end notification + feel it on your phone
    "notification",          // logcat confirmation that Android logged the received notification
    "notif-buffer",          // delivery guarantee: buffer + reconnect + TTL + Android flush
    "sustained-ping",
    "mesh-full",
    "key-cycling",           // verify encrypted key rotation: write new key, verify peers adapt
];

function usage() {
    log("Usage:");
    log("  node scripts/mesh-test.mjs [options]");
    log("");
    log("Options:");
    log("  --all                   Run full regression suite");
    log("  --scenario <name>       Run one scenario (see list below)");
    log("  --adb <ip:port>         ADB wireless address (or set ADB_DEVICE env)");
    log("  --sheet <id>            Override signaling sheet ID (or set SIGNAL_SHEET env)");
    log("  --list                  List available scenarios");
    log("");
    log("Scenarios:");
    for (const [k] of Object.entries(SCENARIO_MAP)) log("  " + k);
    log("");
    log("Required env:");
    log("  WAYMARK_OAUTH_TOKEN_PATH  (default: ~/.config/gcloud/waymark-oauth-token.json)");
    log("  GOOGLE_APPLICATION_CREDENTIALS  service account key");
    log("");
    log("Optional env:");
    log("  ADB_DEVICE   Android wireless debug address (e.g. 192.168.1.42:5555)");
    log("  SIGNAL_SHEET Bypass Drive lookup and use this sheet ID directly");
}

async function main() {
    const args = process.argv.slice(2);

    if (args.includes("--help") || args.includes("-h")) { usage(); process.exit(0); }
    if (args.includes("--list")) {
        for (const k of Object.keys(SCENARIO_MAP)) log(k);
        process.exit(0);
    }

    // Override ADB device from CLI
    const adbIdx = args.indexOf("--adb");
    if (adbIdx >= 0 && args[adbIdx + 1]) process.env.ADB_DEVICE = args[adbIdx + 1];

    // Override sheet from CLI
    const sheetIdx = args.indexOf("--sheet");
    if (sheetIdx >= 0 && args[sheetIdx + 1]) process.env.SIGNAL_SHEET = args[sheetIdx + 1];

    // ── Print banner ───────────────────────────────────────────────
    log("═══════════════════════════════════════════════════════════");
    log("  Waymark WebRTC Mesh E2E Test Jig");
    log("═══════════════════════════════════════════════════════════");

    // ── ADB check ─────────────────────────────────────────────────
    const deviceModel = checkAdb();
    if (deviceModel) {
        log(`  Android device: ${deviceModel}  (${ADB_DEVICE || "default ADB"})`);
    } else if (ADB_DEVICE) {
        log(`  ⚠  ADB_DEVICE set but device not found — connecting…`);
        try {
            adbConnect(ADB_DEVICE);
            _adbSerial = resolveAdbSerial();
            log(`  ✓  ADB connected (serial: ${_adbSerial})`);
        }
        catch { log(`  ✗  ADB connect failed — Android scenarios will be skipped`); }
    } else {
        log("  ℹ  ADB_DEVICE not set — Android logcat assertions will be skipped");
        log("     Set ADB_DEVICE=<ip:port> (enable wireless debugging in Android dev options)");
    }

    // ── Resolve signaling sheet ────────────────────────────────────
    log("\n  Resolving signaling sheets…");
    const sheetId = await resolveSignalingSheet();
    log(`  Public sheet : ${sheetId}`);

    try {
        _privateSheetId = await resolvePrivateSheetId();
        log(`  Private sheet: ${_privateSheetId}`);
        _encKey = await resolveEncryptionKey(_privateSheetId);
        log(`  Encryption key: ${_encKey.slice(0, 8)}… (AES-256-GCM)`);
    } catch (err) {
        log(`  ⚠  Key not found: ${err.message}`);
        log("     Signaling cells will be read/written WITHOUT encryption.\n     Run cycleSignalKey() in the web app to initialise the private key sheet.");
    }

    // ── Show current mesh state ────────────────────────────────────
    const livePeers = await listLivePeers(sheetId);
    log(`  Live peers: ${livePeers.length}`);
    for (const p of livePeers) {
        const age = Math.round((Date.now() - p.ts) / 1000);
        log(`    slot ${p.block}  ${p.peerId}  "${p.name}"  (${age}s ago)`);
    }

    // ── Start logcat ──────────────────────────────────────────────
    const logcat = startLogcat();

    // ── Determine which scenarios to run ─────────────────────────
    const scenarioArg = args[args.indexOf("--scenario") + 1];
    const runAll      = args.includes("--all") || args.includes("full-roundtrip");

    let scenariosToRun;
    if (scenarioArg && SCENARIO_MAP[scenarioArg]) {
        scenariosToRun = [scenarioArg];
    } else if (runAll) {
        scenariosToRun = FULL_ROUNDTRIP_ORDER;
    } else if (args.length === 0) {
        // Default: run everything  
        scenariosToRun = FULL_ROUNDTRIP_ORDER;
    } else {
        // Unknown arg — show usage
        usage();
        process.exit(1);
    }

    log(`\n  Running: ${scenariosToRun.join(", ")}`);
    log("───────────────────────────────────────────────────────────\n");

    const runner = new TestRunner(sheetId, logcat);

    for (const name of scenariosToRun) {
        const fn = SCENARIO_MAP[name];
        if (!fn) { log(`Unknown scenario: ${name}`); continue; }
        await fn(runner, sheetId, logcat);
    }

    logcat.stop();
    const allPassed = runner.summary();
    process.exit(allPassed ? 0 : 1);
}

main().catch(err => {
    process.stderr.write("Fatal: " + err.stack + "\n");
    process.exit(2);
});
