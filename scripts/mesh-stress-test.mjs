#!/usr/bin/env node
/* ============================================================
   mesh-stress-test.mjs — Multi-hour WebRTC mesh reliability test

   Catches degradation that only appears after 30–120+ minutes:
     • OAuth token expiry and silent refresh (at ~55 + ~75 + ~115 min)
     • DataChannel drop on ICE path change (NAT mapping timeout)
     • Android Doze / screen-off survival
     • latency histogram drift (p50/p95/p99 over time)
     • rapid disconnect/reconnect storm under load
     • notification delivery reliability under sustained traffic

   Usage:
     node scripts/mesh-stress-test.mjs [options]

   Options:
     --hours N       Total test duration (default: 2)
     --report FILE   Write JSON report to FILE (default: generated/stress-report.json)
     --adb DEVICE    ADB serial to use (overrides ADB_DEVICE env)

   Required env:
     WAYMARK_OAUTH_TOKEN_PATH
     GOOGLE_APPLICATION_CREDENTIALS

   Optional env:
     ADB_DEVICE
     SIGNAL_SHEET    Override public sheet ID
     PRIV_SHEET      Override private key sheet ID
     SIGNAL_KEY      Override AES-256 key hex

   Exit codes:
     0 — all phases passed
     1 — one or more phases failed / degraded
     2 — setup error
   ============================================================ */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { spawn, execSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { SheetWebRtcPeer, encryptCell, decryptCell } from "../mcp/sheet-webrtc-peer.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, "..");

/* ---------- CLI args ---------- */
function getArg(name, def) {
    const flag = process.argv.indexOf("--" + name);
    if (flag !== -1 && process.argv[flag + 1]) return process.argv[flag + 1];
    return def;
}

const TOTAL_HOURS   = parseFloat(getArg("hours", "2"));
const REPORT_FILE   = getArg("report", path.join(ROOT, "generated/stress-report.json"));
const TOTAL_MS      = TOTAL_HOURS * 60 * 60_000;

/* ---------- Constants ---------- */
const BLOCK_SIZE    = 5;
const BLOCK_START   = 1;
const MAX_SLOTS     = 8;
const ALIVE_TTL     = 50_000;
const POLL_MS       = 5_000;
const TAG_ANDROID   = "OrchestratorPeer";

const OAUTH_TOKEN_PATH = process.env.WAYMARK_OAUTH_TOKEN_PATH
    || path.join(process.env.HOME || "/root", ".config/gcloud/waymark-oauth-token.json");
const SHEETS_BASE = "https://sheets.googleapis.com/v4/spreadsheets";
const DRIVE_FILES  = "https://www.googleapis.com/drive/v3/files";

/* ---------- Helpers ---------- */

function die(msg)  { process.stderr.write("ERROR: " + msg + "\n"); process.exit(2); }
function log(...a) { process.stdout.write(`[${ts()}] ${a.join(" ")}\n`); }
function ts()      { return new Date().toISOString().slice(11, 23); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function getOAuthToken() {
    let tok;
    try { tok = JSON.parse(readFileSync(OAUTH_TOKEN_PATH, "utf8")); }
    catch { die("Cannot read OAuth token from " + OAUTH_TOKEN_PATH); }
    if (!tok.access_token || Date.now() > (tok.expiry_date - 60_000)) {
        if (!tok.refresh_token) die("Token expired and no refresh_token");
        const r = await (await fetch("https://oauth2.googleapis.com/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                grant_type:    "refresh_token",
                refresh_token: tok.refresh_token,
                client_id:     tok.client_id,
                client_secret: tok.client_secret,
            }),
        })).json();
        if (!r.access_token) die("OAuth refresh failed: " + JSON.stringify(r));
        tok.access_token = r.access_token;
        tok.expiry_date  = Date.now() + r.expires_in * 1000;
        try { writeFileSync(OAUTH_TOKEN_PATH, JSON.stringify(tok, null, 2)); } catch {}
    }
    return tok.access_token;
}

async function _loadWaymarkData() {
    const token = await getOAuthToken();
    const q = encodeURIComponent("name='.waymark-data.json' and mimeType='application/json' and trashed=false");
    const res = await fetch(`${DRIVE_FILES}?q=${q}&fields=files(id)&pageSize=1`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) die("Drive search failed: " + res.status);
    const { files } = await res.json();
    if (!files?.length) die(".waymark-data.json not on Drive — run node scripts/provision-signaling.mjs first");
    return (await fetch(`${DRIVE_FILES}/${files[0].id}?alt=media`, {
        headers: { Authorization: `Bearer ${token}` },
    })).json();
}

async function resolveSignalingSheet() {
    if (process.env.SIGNAL_SHEET) return process.env.SIGNAL_SHEET;
    const d = await _loadWaymarkData();
    const id = d.publicSignalingSheetId || d.signalingSheetId;
    if (!id) die("No signaling sheet found — run node scripts/provision-signaling.mjs first");
    return id;
}

async function resolvePrivateSheetId() {
    if (process.env.PRIV_SHEET) return process.env.PRIV_SHEET;
    const d = await _loadWaymarkData();
    if (!d.signalingSheetId) die("signalingSheetId missing — run provision-signaling.mjs");
    return d.signalingSheetId;
}

async function resolveEncryptionKey(privateSheetId) {
    if (process.env.SIGNAL_KEY) return process.env.SIGNAL_KEY;
    const token = await getOAuthToken();
    const res = await fetch(
        `${SHEETS_BASE}/${privateSheetId}/values/${encodeURIComponent("Sheet1!A1:A2")}`,
        { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) throw new Error("Key sheet read failed: " + res.status);
    const d = await res.json();
    const key = d.values?.[0]?.[0]?.trim();
    if (!key || key.length !== 64) throw new Error("Signal key missing — run provision-signaling.mjs");
    return key;
}

/* ---------- ADB ---------- */

const ADB_DEVICE_RAW = process.env.ADB_DEVICE || getArg("adb", null);
let _adbSerial = null;

function resolveAdbSerial() {
    if (!ADB_DEVICE_RAW) return null;
    try {
        const out = execSync("adb devices -l 2>&1", { encoding: "utf8" });
        // Try mDNS transport first
        const mdns = out.split("\n")
            .filter(l => l.includes("_adb-tls-connect") || l.includes(ADB_DEVICE_RAW))
            .map(l => l.split(/\s+/)[0])[0];
        if (mdns) return mdns;
        // Try direct IP
        execSync(`adb connect ${ADB_DEVICE_RAW}`, { stdio: "pipe" });
        return ADB_DEVICE_RAW;
    } catch { return null; }
}

function adb(...args) {
    const full = _adbSerial ? ["-s", _adbSerial, ...args] : args;
    return execSync(`adb ${full.map(a => JSON.stringify(a)).join(" ")}`, {
        encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
    }).trim();
}

/** Spawn logcat and call onLine for each matching line. Returns { stop } */
function spawnLogcat(tag, onLine) {
    if (!_adbSerial) return { stop: () => {} };
    const args = _adbSerial
        ? ["-s", _adbSerial, "logcat", "-v", "brief", `${tag}:V`, "*:S"]
        : ["logcat", "-v", "brief", `${tag}:V`, "*:S"];
    const proc = spawn("adb", args, { stdio: ["ignore", "pipe", "ignore"] });
    proc.stdout.on("data", chunk => {
        for (const line of chunk.toString("utf8").split("\n")) {
            if (line.trim()) onLine(line.trim());
        }
    });
    return { stop: () => { try { proc.kill("SIGKILL"); } catch {} } };
}

/* ---------- Peer factory (mirrors mesh-test.mjs) ---------- */

let _encKey    = null;
let _sheetId   = null;

function makePeer(suffix, extraOpts = {}) {
    const rawId  = `stress-${suffix}-${Date.now()}`;
    const peerId = createHash("sha256").update(rawId).digest("hex").slice(0, 8);
    const messages = [];
    const connected = new Set();
    const disconnected = new Set();
    const latencies = [];

    const peer = new SheetWebRtcPeer({
        sheetId:       _sheetId,
        getToken:      getOAuthToken,
        encryptionKey: _encKey || undefined,
        peerId,
        displayName:   `Stress-${suffix}`,
        onMessage(rid, msg) {
            messages.push({ from: rid, msg, t: Date.now() });
            // If msg is a pong (stress protocol: "pong:<echoMs>"), record latency
            if (typeof msg === "string" && msg.startsWith("pong:")) {
                const sent = parseInt(msg.slice(5), 10);
                if (!isNaN(sent)) latencies.push(Date.now() - sent);
            }
        },
        onConnect(rid)    { connected.add(rid); disconnected.delete(rid); },
        onDisconnect(rid) { disconnected.add(rid); connected.delete(rid); },
        ...extraOpts,
    });

    return { peer, peerId, messages, connected, disconnected, latencies };
}

async function waitUntil(predicate, ms = 30_000, interval = 500) {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
        const r = predicate();
        if (r) return r;
        await sleep(interval);
    }
    return null;
}

/* ---------- Metrics ---------- */

class Metrics {
    constructor(name) {
        this.name         = name;
        this.samples      = [];
        this.failures     = 0;
        this.total        = 0;
        this.startMs      = Date.now();
    }
    record(ms) { this.samples.push(ms); this.total++; }
    fail()     { this.failures++; this.total++; }
    percentile(p) {
        const s = [...this.samples].sort((a, b) => a - b);
        if (!s.length) return null;
        return s[Math.floor((p / 100) * (s.length - 1))];
    }
    summary() {
        return {
            name:     this.name,
            total:    this.total,
            failures: this.failures,
            successRate: this.total
                ? (((this.total - this.failures) / this.total) * 100).toFixed(1) + "%"
                : "N/A",
            latency_p50:  this.percentile(50),
            latency_p95:  this.percentile(95),
            latency_p99:  this.percentile(99),
            latency_max:  this.samples.length ? Math.max(...this.samples) : null,
            durationMs:   Date.now() - this.startMs,
        };
    }
}

/* ============================================================
   Phase definitions
   Each phase runs for a configured slice of the total duration.
   A phase returns { pass: bool, detail: string }.
   ============================================================ */

/**
 * Phase 1 — Baseline: Two Node peers stay connected and exchange pings for
 * the first 5 minutes. Establishes that the sheet and encryption work.
 */
async function phaseBaseline(report) {
    log("─── Phase 1: Baseline connection (5 min) ───");
    const m = new Metrics("baseline-ping");
    const phaseDuration = 5 * 60_000;
    const deadline = Date.now() + phaseDuration;

    const { peer: A, peerId: aId, connected: aC, latencies: aLat } = makePeer("base-A");
    const { peer: B, peerId: bId, connected: bC } = makePeer("base-B", {
        onMessage(rid, msg) {
            // echo pings back as pongs
            if (typeof msg === "string" && msg.startsWith("ping:")) {
                const ts = msg.slice(5);
                try { B.broadcast("pong:" + ts); } catch {}
            }
        },
    });

    A.start();
    B.start();

    log("  Waiting for A–B DataChannel…");
    const dcOpen = await waitUntil(() => aC.has(bId) || aLat.length > 0, 90_000);
    if (!dcOpen) {
        A.stop(); B.stop();
        m.fail();
        report.phases.push({ ...m.summary(), error: "DataChannel never opened in 90s" });
        return { pass: false, detail: "DataChannel never opened in 90s" };
    }
    log("  DataChannel open ✓");

    // Ping loop
    let pingSent = 0;
    while (Date.now() < deadline) {
        await sleep(5_000);
        if (aC.has(bId)) {
            A.broadcast("ping:" + Date.now());
            pingSent++;
        }
        // Check for pong from most recent ping
        if (aLat.length > pingSent - 3) {
            m.record(aLat[aLat.length - 1]);
        } else if (pingSent > 3) {
            m.fail();
        }
        if (pingSent % 12 === 0) {
            const s = m.summary();
            log(`  [${Math.round((deadline - Date.now()) / 1000)}s left] p50=${s.latency_p50}ms p95=${s.latency_p95}ms failures=${m.failures}`);
        }
    }

    A.stop(); B.stop();
    const s = m.summary();
    report.phases.push(s);
    const pass = s.failures / Math.max(s.total, 1) < 0.05; // < 5 % failure rate
    log(`  Baseline: ${s.total} pings, p50=${s.latency_p50}ms, p95=${s.latency_p95}ms, failures=${s.failures}`);
    return { pass, detail: JSON.stringify({ p50: s.latency_p50, p95: s.latency_p95, failures: s.failures }) };
}

/**
 * Phase 2 — Reconnect storm: rapidly kill and restart the peer 10 times,
 * verify the DC reopens within 90 s each time.  Mimics screen-off/Doze cycles.
 */
async function phaseReconnectStorm(report) {
    log("─── Phase 2: Reconnect storm (10 cycles) ───");
    const m = new Metrics("reconnect-storm");
    let passes = 0;

    const { peer: anchor, peerId: anchorId, connected: anchorC } = makePeer("storm-anchor");
    anchor.start();

    for (let i = 1; i <= 10; i++) {
        const { peer: floater, peerId: fId, connected: fC } = makePeer(`storm-floater-${i}`);
        floater.start();
        const t0 = Date.now();
        const opened = await waitUntil(() => fC.has(anchorId) || anchorC.has(fId), 90_000);
        if (opened) {
            m.record(Date.now() - t0);
            passes++;
            log(`  Cycle ${i}: DC opened in ${Date.now() - t0}ms ✓`);
        } else {
            m.fail();
            log(`  Cycle ${i}: DC never opened ✗`);
        }
        floater.stop();
        await sleep(3_000); // brief pause between cycles
    }

    anchor.stop();
    const s = m.summary();
    report.phases.push(s);
    const pass = passes >= 9; // allow 1 flake
    log(`  Storm: ${passes}/10 reconnects successful, p50=${s.latency_p50}ms`);
    return { pass, detail: `${passes}/10` };
}

/**
 * Phase 3 — Sustained latency: Two peers exchange pings every 10 s for
 * `phaseDurationMs`.  Detects the "goes to shit after 30 min" pattern.
 * Records per-epoch (5-min buckets) p95 so degradation is visible.
 */
async function phaseSustained(report, phaseDurationMs) {
    const hours = (phaseDurationMs / 3_600_000).toFixed(2);
    log(`─── Phase 3: Sustained latency (${hours}h) ───`);
    const m = new Metrics("sustained-latency");
    const deadline = Date.now() + phaseDurationMs;
    const EPOCH_MS  = 5 * 60_000; // 5-minute buckets
    const epochs    = [];
    let epochStart  = Date.now();
    let epochSamples = [];
    let reconnects  = 0;
    let tokenRefreshes = 0;

    // Track token age so we can log when it would expire without refresh
    let tokenFetchedAt = Date.now();

    const { peer: A, peerId: aId, connected: aC, disconnected: aD, latencies: aLat }
        = makePeer("sustained-A");
    const { peer: B, peerId: bId }
        = makePeer("sustained-B", {
            onMessage(rid, msg) {
                if (typeof msg === "string" && msg.startsWith("ping:")) {
                    try { B.broadcast("pong:" + msg.slice(5)); } catch {}
                }
            },
        });

    A.start();
    B.start();

    log("  Waiting for initial DataChannel…");
    const init = await waitUntil(() => aC.has(bId), 120_000);
    if (!init) {
        A.stop(); B.stop();
        report.phases.push({ name: "sustained-latency", error: "Initial DC never opened" });
        return { pass: false, detail: "Initial DC never opened" };
    }
    log("  Initial DataChannel open ✓");

    let lastPingSent = Date.now();
    let totalPings   = 0;
    let pingsPonged  = 0;

    while (Date.now() < deadline) {
        await sleep(10_000);

        const nowMs = Date.now();

        // ── Send ping ──────────────────────────────────────────────────
        if (aC.has(bId)) {
            A.broadcast("ping:" + nowMs);
            totalPings++;
            lastPingSent = nowMs;
        } else {
            // Disconnected — count reconnect
            reconnects++;
            log(`  ⚠  A–B DataChannel dropped (total reconnects: ${reconnects})`);
            // Wait up to 90 s for it to come back (the peer's poll loop handles re-ICE)
            const recovered = await waitUntil(() => aC.has(bId), 90_000);
            if (recovered) {
                log(`  ✓ A–B reconnected after ~${reconnects}th drop`);
            } else {
                log(`  ✗ A–B did not recover within 90s`);
                m.fail();
            }
        }

        // ── Record pong latency ──────────────────────────────────────
        if (aLat.length > 0) {
            const lat = aLat.pop();
            m.record(lat);
            epochSamples.push(lat);
            pingsPonged++;
        }

        // ── Token age logging ─────────────────────────────────────────
        const tokenAgeMins = (nowMs - tokenFetchedAt) / 60_000;
        if (tokenAgeMins >= 54) {
            log(`  ℹ  OAuth token is ${tokenAgeMins.toFixed(0)} min old — testing auto-refresh`);
            try {
                await getOAuthToken();
                tokenRefreshes++;
                tokenFetchedAt = nowMs;
                log(`  ✓ Token refreshed (total refreshes: ${tokenRefreshes})`);
            } catch (e) {
                log(`  ✗ Token refresh failed: ${e.message}`);
                m.fail();
            }
        }

        // ── Epoch summary ─────────────────────────────────────────────
        if (nowMs - epochStart >= EPOCH_MS) {
            const eSorted = [...epochSamples].sort((a, b) => a - b);
            const ep95 = eSorted.length
                ? eSorted[Math.floor(0.95 * (eSorted.length - 1))]
                : null;
            const bucket = {
                elapsedMin: Math.round((nowMs - (deadline - phaseDurationMs)) / 60_000),
                samples:    epochSamples.length,
                p95:        ep95,
                reconnects,
            };
            epochs.push(bucket);
            log(`  [${bucket.elapsedMin}min] epoch p95=${ep95}ms samples=${epochSamples.length} reconnects=${reconnects}`);
            epochSamples = [];
            epochStart   = nowMs;
        }
    }

    A.stop(); B.stop();
    const s = m.summary();
    s.epochs         = epochs;
    s.totalReconnects = reconnects;
    s.tokenRefreshes  = tokenRefreshes;
    s.pingsPonged     = pingsPonged;
    s.totalPings      = totalPings;
    report.phases.push(s);

    // Detect sustained degradation: if p95 in the last epoch is > 3× p95 in first epoch
    let degraded = false;
    if (epochs.length >= 2) {
        const firstP95 = epochs[0].p95;
        const lastP95  = epochs[epochs.length - 1].p95;
        if (firstP95 && lastP95 && lastP95 > firstP95 * 3) {
            degraded = true;
            log(`  ⚠  DEGRADATION DETECTED: p95 drifted from ${firstP95}ms to ${lastP95}ms`);
        }
    }

    const pass = !degraded && (m.failures / Math.max(m.total, 1)) < 0.10;
    log(`  Sustained: ${pingsPonged}/${totalPings} pings ponged, reconnects=${reconnects}, tokenRefreshes=${tokenRefreshes}`);
    return { pass, detail: JSON.stringify({ degraded, reconnects, tokenRefreshes }) };
}

/**
 * Phase 4 — Android background survival (requires ADB).
 * Turns the screen off, waits for the configured interval, then checks
 * the Android peer is still heartbeating in the signaling sheet.
 */
async function phaseAndroidBackground(report, survivalMinutes = 30) {
    if (!_adbSerial) {
        log(`─── Phase 4: Android background (SKIP — no ADB) ───`);
        report.phases.push({ name: "android-background", skipped: true });
        return { pass: true, detail: "SKIP — no ADB" };
    }

    log(`─── Phase 4: Android background survival (${survivalMinutes} min) ───`);
    const m = new Metrics("android-background");

    // Read initial Android presence
    const initialPresence = await findAndroidPeerInSheet();
    if (!initialPresence) {
        log("  Android not in signaling sheet — skipping background phase");
        report.phases.push({ name: "android-background", skipped: true, reason: "not in mesh" });
        return { pass: true, detail: "SKIP — Android not in mesh" };
    }
    log(`  Android peerId=${initialPresence.peerId}`);

    // Turn off screen
    try {
        adb("shell", "input", "keyevent", "KEYCODE_SLEEP");
        log("  Screen off");
    } catch (e) {
        log(`  Warning: could not turn screen off: ${e.message}`);
    }

    // Poll every 60 s during the background window
    const survivalMs = survivalMinutes * 60_000;
    const deadline   = Date.now() + survivalMs;
    let intervals    = 0;
    let present      = 0;

    while (Date.now() < deadline) {
        await sleep(60_000);
        intervals++;
        const p = await findAndroidPeerInSheet();
        if (p && p.peerId === initialPresence.peerId) {
            present++;
            const ageS = Math.round((Date.now() - (p.ts || 0)) / 1000);
            log(`  [${intervals}min] Android present (heartbeat ${ageS}s ago) ✓`);
            m.record(ageS * 1000);
        } else {
            log(`  [${intervals}min] Android NOT in signaling sheet ✗`);
            m.fail();
        }
    }

    // Wake screen
    try { adb("shell", "input", "keyevent", "KEYCODE_WAKEUP"); } catch {}

    const s = m.summary();
    report.phases.push(s);
    const pass = present >= Math.floor(intervals * 0.85); // allow 15 % misses
    log(`  Background: ${present}/${intervals} intervals still connected`);
    return { pass, detail: `${present}/${intervals}` };
}

/**
 * Phase 5 — Notification reliability: fire 20 notifications and confirm
 * each is acked (waits for DataChannel echo back or logcat confirmation).
 */
async function phaseNotifications(report) {
    log("─── Phase 5: Notification reliability (20 messages) ───");
    const m = new Metrics("notification-reliability");

    const received = new Set();
    const { peer: sender, peerId: senderId, connected: sC }
        = makePeer("notif-sender");
    const { peer: receiver, peerId: receiverId }
        = makePeer("notif-receiver", {
            onMessage(rid, msg) {
                if (typeof msg === "string" && msg.startsWith("notif-test:")) {
                    try { receiver.broadcast("notif-ack:" + msg.slice(11)); } catch {}
                }
            },
        });

    sender.start();
    receiver.start();

    const logcat = typeof _adbSerial === "string"
        ? spawnLogcat(TAG_ANDROID, line => {
            const m = line.match(/waymark-notification.*id[=:]\s*(notif-\d+)/i);
            if (m) received.add(m[1]);
        })
        : { stop: () => {} };

    log("  Waiting for sender–receiver DataChannel…");
    const opened = await waitUntil(() => sC.has(receiverId), 90_000);
    if (!opened) {
        sender.stop(); receiver.stop(); logcat.stop();
        report.phases.push({ name: "notification-reliability", error: "DC never opened" });
        return { pass: false, detail: "DC never opened" };
    }
    log("  DataChannel open ✓");

    for (let i = 1; i <= 20; i++) {
        const id = `notif-${i}`;
        const t0 = Date.now();
        try {
            sender.broadcast(JSON.stringify({
                type: "waymark-notification",
                title: "Stress test",
                body: `Message ${i}/20`,
                id,
            }));
        } catch (e) {
            log(`  Message ${i} send failed: ${e.message}`);
            m.fail();
            await sleep(2_000);
            continue;
        }

        // Wait for ack (receiver echoes back notif-ack:<id>)
        const acked = await waitUntil(
            () => [...(sender.messages || [])].some(x => x.msg === "notif-ack:" + i) || received.has(id),
            15_000
        );
        if (acked) {
            m.record(Date.now() - t0);
            log(`  Message ${i}: ✓ (${Date.now() - t0}ms)`);
        } else {
            m.fail();
            log(`  Message ${i}: ✗ no ack`);
        }
        await sleep(1_000);
    }

    sender.stop(); receiver.stop(); logcat.stop();
    const s = m.summary();
    report.phases.push(s);
    const pass = s.failures <= 2; // allow 2 out of 20
    log(`  Notifications: ${20 - s.failures}/20 delivered, p95=${s.latency_p95}ms`);
    return { pass, detail: `${20 - s.failures}/20` };
}

/* ---------- Sheet read helper for Android presence ---------- */

async function readSignalingColumn(sheetId) {
    const total = MAX_SLOTS * BLOCK_SIZE + BLOCK_START;
    const range = encodeURIComponent(`Sheet1!T1:T${total + 1}`);
    const token = await getOAuthToken();
    const res = await fetch(`${SHEETS_BASE}/${sheetId}/values/${range}`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return [];
    const { values } = await res.json();
    return (values || []).flat();
}

function parseJson(val) {
    if (!val) return null;
    if (_encKey) {
        const dec = decryptCell(val, _encKey);
        if (dec === null) return null;
        val = dec;
    }
    try { return JSON.parse(val); } catch { return null; }
}

async function findAndroidPeerInSheet() {
    const vals = await readSignalingColumn(_sheetId);
    for (let slot = 0; slot < MAX_SLOTS; slot++) {
        const row = BLOCK_START + slot * BLOCK_SIZE;
        const p = parseJson(vals[row]);
        if (!p || !p.peerId) continue;
        if (Date.now() - (p.ts || 0) > ALIVE_TTL) continue;
        const name = (p.name || "").toLowerCase();
        if (!name.startsWith("testpeer-") && !name.startsWith("stress-")) return p;
    }
    return null;
}

function spawnLogcatLocal(tag, onLine) {
    if (!_adbSerial) return { stop: () => {} };
    const args = ["-s", _adbSerial, "logcat", "-v", "brief", `${tag}:V`, "*:S"];
    const proc = spawn("adb", args, { stdio: ["ignore", "pipe", "ignore"] });
    proc.stdout.on("data", chunk => {
        for (const line of chunk.toString("utf8").split("\n")) {
            if (line.trim()) onLine(line.trim());
        }
    });
    return { stop: () => { try { proc.kill("SIGKILL"); } catch {} } };
}

/* ============================================================
   Main
   ============================================================ */

async function main() {
    const startMs = Date.now();
    const report = {
        startedAt:   new Date().toISOString(),
        totalHours:  TOTAL_HOURS,
        adbDevice:   ADB_DEVICE_RAW || null,
        phases:      [],
        phaseSummary: [],
    };

    log("╔════════════════════════════════════════════════════════╗");
    log(`║  Waymark WebRTC Mesh Stress Test  (${TOTAL_HOURS}h)               ║`);
    log("╚════════════════════════════════════════════════════════╝");

    // ── Setup ──────────────────────────────────────────────────────────────
    log("Setting up…");
    _adbSerial = resolveAdbSerial();
    if (_adbSerial) {
        log(`ADB device: ${_adbSerial}`);
        try { adb("logcat", "-c"); } catch {}
    } else {
        log("ADB not available — Android phases will be skipped");
    }

    _sheetId = await resolveSignalingSheet();
    log(`Public sheet: ${_sheetId}`);

    const privId = await resolvePrivateSheetId();
    log(`Private sheet: ${privId}`);

    try {
        _encKey = await resolveEncryptionKey(privId);
        log(`Encryption: AES-256-GCM key ${_encKey.slice(0, 16)}…`);
    } catch (e) {
        log(`⚠  No encryption key: ${e.message}`);
        log("   Continuing without encryption (run provision-signaling.mjs to fix)");
    }

    // Time budget allocation:
    //   Phase 1 baseline          :   5 min  (fixed)
    //   Phase 2 reconnect storm   :  ~3 min   (fixed, 10 cycles)
    //   Phase 4 android background: TOTAL_HOURS >= 1 ? 30 min : 0
    //   Phase 5 notifications     :  ~5 min  (fixed)
    //   Phase 3 sustained         : rest of the total time

    const FIXED_MIN = 5 + 3 + (TOTAL_HOURS >= 1 ? 30 : 0) + 5;
    const sustainedMs = Math.max(0, TOTAL_MS - FIXED_MIN * 60_000);

    const phaseSummary = [];

    // ── Phase 1: Baseline ───────────────────────────────────────────────
    const p1 = await phaseBaseline(report);
    phaseSummary.push({ phase: 1, name: "Baseline", ...p1 });
    log(`Phase 1 result: ${p1.pass ? "PASS ✓" : "FAIL ✗"}`);

    // ── Phase 2: Reconnect storm ────────────────────────────────────────
    const p2 = await phaseReconnectStorm(report);
    phaseSummary.push({ phase: 2, name: "Reconnect storm", ...p2 });
    log(`Phase 2 result: ${p2.pass ? "PASS ✓" : "FAIL ✗"}`);

    // ── Phase 3: Sustained (main long-running phase) ─────────────────
    const p3 = await phaseSustained(report, sustainedMs);
    phaseSummary.push({ phase: 3, name: "Sustained latency", ...p3 });
    log(`Phase 3 result: ${p3.pass ? "PASS ✓" : "FAIL ✗"}`);

    // ── Phase 4: Android background ─────────────────────────────────
    const p4 = await phaseAndroidBackground(report, TOTAL_HOURS >= 1 ? 30 : 0);
    phaseSummary.push({ phase: 4, name: "Android background", ...p4 });
    log(`Phase 4 result: ${p4.pass ? "PASS ✓" : "FAIL ✗"}`);

    // ── Phase 5: Notification reliability ───────────────────────────
    const p5 = await phaseNotifications(report);
    phaseSummary.push({ phase: 5, name: "Notification reliability", ...p5 });
    log(`Phase 5 result: ${p5.pass ? "PASS ✓" : "FAIL ✗"}`);

    // ── Final report ──────────────────────────────────────────────────
    report.phaseSummary  = phaseSummary;
    report.finishedAt    = new Date().toISOString();
    report.totalDuration = ((Date.now() - startMs) / 60_000).toFixed(1) + " min";

    mkdirSync(path.dirname(REPORT_FILE), { recursive: true });
    writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2));

    const allPass   = phaseSummary.every(p => p.pass);
    const failures  = phaseSummary.filter(p => !p.pass);

    log("\n╔════════════════════════════════════════════════════════╗");
    log(`║  Stress test ${allPass ? "PASSED ✓" : "FAILED ✗"}  (${report.totalDuration})              ║`);
    log("╚════════════════════════════════════════════════════════╝");

    for (const p of phaseSummary) {
        const icon = p.pass ? "✓" : "✗";
        log(`  ${icon} Phase ${p.phase}: ${p.name}  ${p.pass ? "" : "— " + p.detail}`);
    }

    log(`\nFull report: ${REPORT_FILE}`);
    process.exit(allPass ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
