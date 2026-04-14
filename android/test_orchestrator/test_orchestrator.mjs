#!/usr/bin/env node
/* ============================================================
   test_orchestrator.mjs — E2E test orchestrator for Waymark
   Android P2P notification system.

   This is a REAL orchestrator peer that:
     1. Authenticates with Google Sheets via service account
     2. Joins the signaling mesh on the SAME sheet as Android
     3. Establishes a REAL WebRTC DataChannel connection
     4. Sends REAL test notifications over the DataChannel
     5. Verifies Android received them (via adb logcat parsing)

   The ONLY thing mocked is AI credit usage — instead of calling
   an LLM, it sends predetermined test notification payloads.

   Usage:
     # Interactive mode: send notifications on keypress
     node test_orchestrator.mjs

     # E2E mode: send N notifications, verify receipt, exit with code
     node test_orchestrator.mjs --mode=e2e --count=3 --timeout=120

     # Phase 1 key exchange test: verify key delivery
     node test_orchestrator.mjs --mode=key-exchange

   Environment variables:
     GOOGLE_APPLICATION_CREDENTIALS — Path to service account JSON
     WAYMARK_SHEET_ID              — Public signaling sheet ID
     WAYMARK_PRIVATE_SHEET_ID      — Private signaling sheet ID (for key exchange tests)
     WAYMARK_SIGNAL_KEY            — 64-char hex AES-256 key
   ============================================================ */

import { SheetWebRtcPeer } from "../../mcp/sheet-webrtc-peer.mjs";
import { GoogleAuth } from "google-auth-library";
import { randomBytes } from "node:crypto";
import { execSync, spawn } from "node:child_process";
import { readFileSync } from "node:fs";

/* ---------- CLI args ---------- */

const args = Object.fromEntries(
    process.argv.slice(2)
        .filter(a => a.startsWith("--"))
        .map(a => {
            const [k, v] = a.slice(2).split("=");
            return [k, v ?? "true"];
        })
);

const MODE    = args.mode || "interactive";
const COUNT   = parseInt(args.count || "3", 10);
const TIMEOUT = parseInt(args.timeout || "120", 10) * 1000;

/* ---------- Config ---------- */

const SHEET_ID         = process.env.WAYMARK_SHEET_ID || "";
const PRIVATE_SHEET_ID = process.env.WAYMARK_PRIVATE_SHEET_ID || "";
const SIGNAL_KEY       = process.env.WAYMARK_SIGNAL_KEY || "";
const PEER_ID          = randomBytes(4).toString("hex");

if (!SHEET_ID && MODE !== "key-exchange") {
    console.error("ERROR: Set WAYMARK_SHEET_ID environment variable");
    process.exit(1);
}
if (MODE === "key-exchange" && !PRIVATE_SHEET_ID) {
    console.error("ERROR: Set WAYMARK_PRIVATE_SHEET_ID for key-exchange mode");
    process.exit(1);
}
if (!SIGNAL_KEY && MODE !== "key-exchange") {
    console.error("ERROR: Set WAYMARK_SIGNAL_KEY (64-char hex)");
    process.exit(1);
}

/* ---------- Auth ---------- */

const auth = new GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});

/* ---------- Test notification payloads ---------- */

function makeTestNotification(index) {
    const nonce = randomBytes(4).toString("hex");
    return {
        type: "waymark-notification",
        title: `Test Notification #${index}`,
        body: `E2E test payload [${nonce}] at ${new Date().toISOString()}`,
        _testNonce: nonce,  // used to verify receipt in logcat
    };
}

/* ---------- Logcat monitor (verifies Android received notifications) ---------- */

class LogcatMonitor {
    constructor() {
        this._receivedNonces = new Set();
        this._process = null;
        this._buffer = "";
    }

    start() {
        // Clear logcat buffer first
        try { execSync("adb logcat -c", { timeout: 5000 }); } catch { /* ignore */ }

        this._process = spawn("adb", ["logcat", "-s", "OrchestratorPeer:I", "NotificationHelper:I"], {
            stdio: ["ignore", "pipe", "ignore"],
        });
        this._process.stdout.setEncoding("utf8");
        this._process.stdout.on("data", (chunk) => {
            this._buffer += chunk;
            // Parse lines looking for notification receipts
            const lines = this._buffer.split("\n");
            this._buffer = lines.pop(); // keep incomplete last line
            for (const line of lines) {
                // OrchestratorPeer logs: Notification received — title="..." body="..."
                if (line.includes("Notification received")) {
                    const nonceMatch = line.match(/\[([0-9a-f]{8})\]/);
                    if (nonceMatch) {
                        this._receivedNonces.add(nonceMatch[1]);
                        console.log(`  ✓ Android received nonce ${nonceMatch[1]}`);
                    }
                }
            }
        });
    }

    hasNonce(nonce) { return this._receivedNonces.has(nonce); }
    get receivedCount() { return this._receivedNonces.size; }

    stop() {
        if (this._process) {
            this._process.kill();
            this._process = null;
        }
    }
}

/* ---------- Main ---------- */

async function main() {
    console.log(`\n=== Waymark Test Orchestrator ===`);
    console.log(`Mode:    ${MODE}`);
    console.log(`Peer ID: ${PEER_ID}`);
    console.log(`Sheet:   ${SHEET_ID || PRIVATE_SHEET_ID}`);
    console.log();

    const sheetId = MODE === "key-exchange" ? PRIVATE_SHEET_ID : SHEET_ID;
    const encryptionKey = MODE === "key-exchange" ? undefined : SIGNAL_KEY;

    const peer = new SheetWebRtcPeer({
        sheetId,
        auth,
        peerId: PEER_ID,
        displayName: "Test Orchestrator",
        encryptionKey,
        onMessage: (remotePeerId, msg) => {
            console.log(`  [msg from ${remotePeerId}] ${JSON.stringify(msg)}`);
        },
        onConnect: (remotePeerId) => {
            console.log(`  ✓ DataChannel OPEN with ${remotePeerId}`);

            // In key-exchange mode, send the key to the connecting peer
            if (MODE === "key-exchange" && SIGNAL_KEY) {
                console.log(`  → Sending key exchange to ${remotePeerId}`);
                peer.sendKeyExchangeTo(remotePeerId, SIGNAL_KEY);
            }
        },
    });

    await peer.start();
    console.log(`Joined mesh at block=${peer.block}\n`);

    if (MODE === "e2e") {
        await runE2ETest(peer);
    } else if (MODE === "key-exchange") {
        await runKeyExchangeTest(peer);
    } else {
        await runInteractive(peer);
    }

    peer.stop();
    process.exit(0);
}

/* ---------- E2E test mode ---------- */

async function runE2ETest(peer) {
    const monitor = new LogcatMonitor();
    monitor.start();

    console.log(`Waiting for Android peer to connect...`);
    const connectedPeers = await waitForPeer(peer, TIMEOUT);
    if (connectedPeers.length === 0) {
        console.error("\n✗ FAIL: No Android peer connected within timeout");
        monitor.stop();
        process.exit(1);
    }
    console.log(`\nConnected peers: ${connectedPeers.join(", ")}\n`);

    // Wait for connection to stabilise (Android peer may reclaim slots)
    console.log(`Waiting 10s for connection to stabilise...`);
    await sleep(10_000);

    // Send test notifications — wait for DataChannel before each send
    const sentNonces = [];
    for (let i = 1; i <= COUNT; i++) {
        // Wait for at least one connected peer with an open DataChannel
        const sendDeadline = Date.now() + 60_000;
        while (Date.now() < sendDeadline) {
            const sent = peer.connectedPeers();
            if (sent.length > 0) break;
            console.log(`  (waiting for open DataChannel before notification #${i}...)`);
            await sleep(3000);
        }

        const notif = makeTestNotification(i);
        sentNonces.push(notif._testNonce);
        const sent = peer.broadcast(notif);
        console.log(`Sending notification #${i} (nonce=${notif._testNonce}) → ${sent} peer(s)`);

        // Give the notification buffer a chance to flush if channel bounced
        await sleep(5000);
    }

    // Wait for Android to process — give plenty of time for reconnect + flush
    console.log(`\nWaiting for Android to receive ${COUNT} notification(s)...`);
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
        const allReceived = sentNonces.every(n => monitor.hasNonce(n));
        if (allReceived) break;
        // Log progress
        const received = sentNonces.filter(n => monitor.hasNonce(n)).length;
        console.log(`  (${received}/${COUNT} received so far...)`);
        await sleep(5000);
    }

    // Report
    const received = sentNonces.filter(n => monitor.hasNonce(n));
    const missed   = sentNonces.filter(n => !monitor.hasNonce(n));

    console.log(`\n=== E2E Results ===`);
    console.log(`Sent:     ${COUNT}`);
    console.log(`Received: ${received.length}`);
    console.log(`Missed:   ${missed.length}`);

    if (missed.length > 0) {
        console.log(`Missed nonces: ${missed.join(", ")}`);
    }

    monitor.stop();

    if (missed.length > 0) {
        console.error("\n✗ FAIL: Not all notifications were received");
        process.exit(1);
    } else {
        console.log("\n✓ PASS: All notifications received successfully");
        process.exit(0);
    }
}

/* ---------- Key exchange test mode ---------- */

async function runKeyExchangeTest(peer) {
    console.log(`Waiting for Android peer to connect on PRIVATE sheet...`);
    const connectedPeers = await waitForPeer(peer, TIMEOUT);
    if (connectedPeers.length === 0) {
        console.error("\n✗ FAIL: No Android peer connected on private sheet");
        process.exit(1);
    }

    console.log(`\nConnected to: ${connectedPeers.join(", ")}`);
    console.log(`Key exchange should have been sent automatically on connect.`);

    // Verify via adb that the key was stored
    await sleep(5000);
    try {
        const prefs = execSync(
            `adb shell "run-as com.waymark.app cat shared_prefs/waymark_prefs.xml"`,
            { encoding: "utf8", timeout: 10000 }
        );
        if (prefs.includes("signal_key")) {
            console.log("\n✓ PASS: Signal key stored in Android SharedPreferences");
            process.exit(0);
        } else {
            console.error("\n✗ FAIL: Signal key NOT found in SharedPreferences");
            process.exit(1);
        }
    } catch (e) {
        console.error(`\n✗ FAIL: Could not read SharedPreferences: ${e.message}`);
        process.exit(1);
    }
}

/* ---------- Interactive mode ---------- */

async function runInteractive(peer) {
    console.log("Press Enter to send a test notification, 'q' to quit\n");

    process.stdin.setEncoding("utf8");
    let index = 0;

    for await (const line of process.stdin) {
        if (line.trim() === "q") break;
        index++;
        const notif = makeTestNotification(index);
        const sent = peer.broadcast(notif);
        console.log(`Sent notification #${index} to ${sent} peer(s) — nonce=${notif._testNonce}`);
    }
}

/* ---------- Helpers ---------- */

function waitForPeer(peer, timeout) {
    return new Promise((resolve) => {
        const start = Date.now();
        const check = () => {
            const connected = peer.connectedPeers();
            if (connected.length > 0) {
                resolve(connected);
                return;
            }
            if (Date.now() - start > timeout) {
                resolve([]);
                return;
            }
            setTimeout(check, 2000);
        };
        check();
    });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

main().catch(e => {
    console.error("Fatal:", e);
    process.exit(1);
});
