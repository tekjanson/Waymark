/* ============================================================
   lib/infra.mjs — E2E test infrastructure

   ╔══════════════════════════════════════════════════════════╗
   ║                   E2E TEST LAWS                         ║
   ║                                                         ║
   ║  These tests exercise the P2P notification pipeline.    ║
   ║  They are NOT testing login/auth.                       ║
   ║                                                         ║
   ║  CAN inject (not under test):                           ║
   ║    • OAuth access_token into SharedPreferences           ║
   ║                                                         ║
   ║  MUST use production code paths (under test):           ║
   ║    • Sheet discovery from Drive (.waymark-data.json)     ║
   ║    • Phase 1 key exchange via DataChannel                ║
   ║    • Phase 2 encrypted notifications                     ║
   ║    • State machine transitions (Idle→P1→P2, key cycle)   ║
   ║    • Reconnection & recovery after disruptions           ║
   ║    • Notification display via NotificationHelper         ║
   ║                                                         ║
   ║  MUST NOT inject or bypass:                              ║
   ║    • Sheet IDs (app discovers from Drive)                ║
   ║    • Signal key (app receives via Phase 1 DataChannel)   ║
   ║    • Peer ID (app generates locally on first run)        ║
   ║    • Phase transitions (app drives its own state)        ║
   ║                                                         ║
   ║  CAN build unique states to test (via adb/setPrefsState):║
   ║    • Wrong signal key → test key cycling detection       ║
   ║    • Corrupted prefs → test graceful recovery            ║
   ║    • Missing prefs → test cold-start behavior            ║
   ║                                                         ║
   ║  Test orchestrator uses production SheetWebRtcPeer       ║
   ║  with the same OAuth token and real signaling sheets.    ║
   ╚══════════════════════════════════════════════════════════╝

   Infrastructure mirrors the real orchestrator.mjs:
     - ensureSignalingInfra()  → OAuth → .waymark-data.json →
       validate/create signaling sheets
     - resolveSignalKey()      → reads ~/.config/gcloud/waymark-signal.key
     - SheetWebRtcPeer         → getToken: getUserOAuthToken
   ============================================================ */

import { randomBytes }  from "node:crypto";
import { execSync, spawn } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path              from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ANDROID_DIR = path.resolve(__dirname, "../..");
const APK_PATH = path.join(ANDROID_DIR, "app/build/outputs/apk/debug/app-debug.apk");

const APP_PACKAGE = "com.waymark.app";
const PREFS_NAME  = "waymark_prefs";
const SIG_COL     = "T";
const MAX_ROWS    = 41;

/* ---------- Same API URLs as orchestrator.mjs ---------- */
const SHEETS_BASE_URL   = "https://sheets.googleapis.com/v4/spreadsheets";
const DRIVE_FILES_URL   = "https://www.googleapis.com/drive/v3/files";
const DRIVE_UPLOAD_URL  = "https://www.googleapis.com/upload/drive/v3/files";
const OAUTH_TOKEN_URL   = "https://oauth2.googleapis.com/token";

/* ---------- User OAuth token (for sheet creation/deletion AND signaling) ----------
 * Identical flow to orchestrator.mjs getUserOAuthToken() —
 * reads the same token file, auto-refreshes if expired.
 */

async function getUserOAuthToken() {
    const tokenPath = process.env.WAYMARK_OAUTH_TOKEN_PATH
        || path.join(process.env.HOME || "/root", ".config/gcloud/waymark-oauth-token.json");
    let tokenData;
    try {
        tokenData = JSON.parse(readFileSync(tokenPath, "utf8"));
    } catch {
        throw new Error(
            `OAuth token not found at ${tokenPath} — ` +
            `set WAYMARK_OAUTH_TOKEN_PATH or sign in via the web app first`
        );
    }
    if (!tokenData.access_token || Date.now() > (tokenData.expiry_date - 60_000)) {
        if (!tokenData.refresh_token) {
            throw new Error("OAuth token expired and no refresh_token available");
        }
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
        if (refreshed.error || !refreshed.access_token) {
            throw new Error(`OAuth refresh failed: ${refreshed.error || "no access_token"}`);
        }
        tokenData.access_token = refreshed.access_token;
        tokenData.expiry_date  = Date.now() + (refreshed.expires_in * 1000);
        try { writeFileSync(tokenPath, JSON.stringify(tokenData, null, 2)); } catch { /* ok */ }
    }
    return tokenData.access_token;
}

/* ---------- Google Sheets / Drive helpers (same as orchestrator.mjs) ---------- */

async function sheetExists(sheetId, token) {
    try {
        const res = await fetch(
            `${DRIVE_FILES_URL}/${sheetId}?fields=id,trashed`,
            { headers: { Authorization: `Bearer ${token}` } }
        );
        if (!res.ok) return false;
        const data = await res.json();
        return data.trashed !== true;
    } catch { return false; }
}

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

async function setPublicWritable(fileId, token) {
    const res = await fetch(`${DRIVE_FILES_URL}/${fileId}/permissions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ role: "writer", type: "anyone" }),
    });
    if (!res.ok) {
        console.warn(`setPublicWritable(${fileId}) → ${res.status}`);
    }
}

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
 * Mirrors orchestrator.mjs ensureSignalingInfra() exactly:
 *  1. Gets user OAuth token
 *  2. Finds .waymark-data.json on Drive
 *  3. Validates private + public signaling sheets (recreates if trashed/deleted)
 *  4. Sets public-write permission on the public sheet
 *  5. Persists changes back to .waymark-data.json
 *  Returns { privateSheetId, publicSheetId }
 */
async function ensureSignalingInfra() {
    const token = await getUserOAuthToken();

    // Find .waymark-data.json on Drive
    const q = encodeURIComponent(
        "name='.waymark-data.json' and mimeType='application/json' and trashed=false"
    );
    const searchRes = await fetch(
        `${DRIVE_FILES_URL}?q=${q}&fields=files(id)&pageSize=1&spaces=drive`,
        { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!searchRes.ok) throw new Error(`Drive search failed: ${searchRes.status}`);
    const { files } = await searchRes.json();
    if (!files?.length) {
        throw new Error(".waymark-data.json not found on Drive — user must open web app first");
    }
    const dataFileId = files[0].id;

    // Read current config
    const fileRes = await fetch(
        `${DRIVE_FILES_URL}/${dataFileId}?alt=media`,
        { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!fileRes.ok) throw new Error(`Failed to read .waymark-data.json: ${fileRes.status}`);
    const data = await fileRes.json();
    let dirty = false;

    // ── Private sheet — plaintext, OAuth-protected key exchange ──
    let privateId = data.signalingSheetId || null;
    if (privateId && !(await sheetExists(privateId, token))) {
        console.log(`  Private sheet ${privateId} deleted — recreating...`);
        privateId = null;
    }
    if (!privateId) {
        const found = await driveFindByName(".waymark-signaling", token);
        if (found && (await sheetExists(found, token))) {
            console.log(`  Found orphaned private sheet: ${found}`);
            privateId = found;
        } else {
            console.log("  Auto-provisioning private signaling sheet...");
            privateId = await createSpreadsheet(".waymark-signaling", token);
            console.log(`  Created private sheet: ${privateId}`);
        }
        data.signalingSheetId = privateId;
        dirty = true;
    }

    // ── Public sheet — AES-256-GCM encrypted, publicly writable ──
    let publicId = data.publicSignalingSheetId || null;
    if (publicId && !(await sheetExists(publicId, token))) {
        console.log(`  Public sheet ${publicId} deleted — recreating...`);
        publicId = null;
    }
    if (!publicId) {
        const found = await driveFindByName(".waymark-public-signaling", token);
        if (found && (await sheetExists(found, token))) {
            console.log(`  Found orphaned public sheet: ${found}`);
            publicId = found;
        } else {
            console.log("  Auto-provisioning public signaling sheet...");
            publicId = await createSpreadsheet(".waymark-public-signaling", token);
            console.log(`  Created public sheet: ${publicId}`);
        }
        data.publicSignalingSheetId = publicId;
        dirty = true;
    }

    // Always ensure public write permission (idempotent)
    await setPublicWritable(publicId, token);

    // Persist changes back to Drive
    if (dirty) {
        data.updatedAt = new Date().toISOString();
        await driveUpdateJson(dataFileId, data, token);
        console.log("  Saved updated sheet IDs to .waymark-data.json");
    }

    return { privateSheetId: privateId, publicSheetId: publicId };
}

/**
 * Reads the AES-256 signal key from the local key file.
 * Same path as orchestrator.mjs resolveSignalKey().
 */
function resolveSignalKey() {
    const keyFile = process.env.WAYMARK_KEY_FILE
        || path.join(process.env.HOME || "/root", ".config/gcloud/waymark-signal.key");
    try {
        const key = readFileSync(keyFile, "utf8").trim();
        if (key.length !== 64) throw new Error(`Invalid key length: ${key.length}`);
        return key;
    } catch (err) {
        return null; // key not yet provisioned — Phase 1 will create it
    }
}

async function clearSheetColumn(sheetId) {
    const token = await getUserOAuthToken();
    const range = `Sheet1!${SIG_COL}1:${SIG_COL}${MAX_ROWS}`;
    const resp = await fetch(
        `${SHEETS_BASE_URL}/${sheetId}/values/${encodeURIComponent(range)}:clear`,
        {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
        }
    );
    if (!resp.ok) console.warn(`clearSheetColumn: ${resp.status}`);
}

/* ---------- AES-256 key ---------- */

function generateKeyHex() {
    return randomBytes(32).toString("hex");
}

/* ---------- ADB helpers ---------- */

function adb(cmd, opts = {}) {
    return execSync(`adb ${cmd}`, {
        encoding: "utf8",
        timeout: opts.timeout ?? 30_000,
        ...opts,
    }).trim();
}

function adbShell(cmd, opts = {}) {
    return adb(`shell "${cmd.replace(/"/g, '\\"')}"`, opts);
}

function isDeviceConnected() {
    try {
        const out = adb("devices -l");
        return /\bdevice\b/.test(out.split("\n").slice(1).join("\n"));
    } catch {
        return false;
    }
}

function forceStopApp() {
    try { adbShell(`am force-stop ${APP_PACKAGE}`); } catch { /* ok */ }
}

function clearAppData() {
    try { adbShell(`pm clear ${APP_PACKAGE}`); } catch { /* ok */ }
}

function grantNotificationPermission() {
    try {
        adbShell(`pm grant ${APP_PACKAGE} android.permission.POST_NOTIFICATIONS`);
    } catch { /* pre-13 or already granted */ }
}

function installApk(apkPath) {
    adb(`install -r -g "${apkPath}"`, { timeout: 120_000 });
}

function isAppInstalled() {
    try {
        const out = adbShell(`pm list packages ${APP_PACKAGE}`);
        return out.includes(APP_PACKAGE);
    } catch {
        return false;
    }
}

function launchApp() {
    adbShell(`am start -n ${APP_PACKAGE}/.MainActivity -a android.intent.action.MAIN -c android.intent.category.LAUNCHER`);
}

function injectPrefs(prefs) {
    // Build XML
    let xml = `<?xml version='1.0' encoding='utf-8' standalone='yes' ?>\n<map>\n`;
    for (const [key, value] of Object.entries(prefs)) {
        if (typeof value === "number") {
            xml += `    <long name="${key}" value="${value}" />\n`;
        } else {
            xml += `    <string name="${key}">${value}</string>\n`;
        }
    }
    xml += `</map>\n`;

    // Write to temp file on device and copy to app's data dir
    const tmpPath = "/data/local/tmp/_e2e_prefs.xml";
    execSync(`echo '${xml.replace(/'/g, "'\\''")}' | adb shell "cat > ${tmpPath}"`, {
        timeout: 10_000,
    });
    // Create shared_prefs dir if it doesn't exist (cleared by pm clear)
    adbShell(`run-as ${APP_PACKAGE} sh -c 'mkdir -p shared_prefs && cp ${tmpPath} shared_prefs/${PREFS_NAME}.xml'`);
}

function readPrefs() {
    try {
        return adb(`shell run-as ${APP_PACKAGE} cat shared_prefs/${PREFS_NAME}.xml`, { stdio: ["ignore", "pipe", "ignore"] });
    } catch {
        return "";
    }
}

function parsePrefsXml(xml) {
    const prefs = {};
    for (const m of xml.matchAll(/<string name="([^"]+)">([^<]*)<\/string>/g)) {
        prefs[m[1]] = m[2];
    }
    for (const m of xml.matchAll(/<long name="([^"]+)" value="(-?\d+)" \/>/g)) {
        prefs[m[1]] = parseInt(m[2], 10);
    }
    return prefs;
}

function mergeIntoPrefs(updates) {
    const existing = readPrefs();
    const prefs = existing ? parsePrefsXml(existing) : {};
    Object.assign(prefs, updates);
    injectPrefs(prefs);
}

function clearLogcat() {
    try { adb("logcat -c"); } catch { /* ok */ }
}

function getLogcat(tags) {
    const tagFilter = tags.map(t => `${t}:*`).join(" ");
    try {
        return adb(`logcat -d -s ${tagFilter}`, { timeout: 10_000 });
    } catch {
        return "";
    }
}

function getActiveNotifications() {
    try {
        const out = adbShell("dumpsys notification --noredact");
        const matches = [];
        const regex = /android\.title=String \((.+?)\)[\s\S]*?android\.text=String \((.+?)\)/g;
        let m;
        while ((m = regex.exec(out)) !== null) {
            matches.push({ title: m[1], body: m[2] });
        }
        return matches;
    } catch {
        return [];
    }
}

function setAirplaneMode(on) {
    adbShell(`settings put global airplane_mode_on ${on ? 1 : 0}`);
    // The broadcast requires privileged shell on Android 12+.
    // Fall back to cmd connectivity on newer devices.
    try {
        adbShell(`cmd connectivity airplane-mode ${on ? "enable" : "disable"}`);
    } catch {
        try {
            adbShell(`am broadcast -a android.intent.action.AIRPLANE_MODE --ez state ${on}`);
        } catch { /* non-rooted device — settings write alone may suffice */ }
    }
}

function setWifi(on) {
    adbShell(`svc wifi ${on ? "enable" : "disable"}`);
}

function setMobileData(on) {
    adbShell(`svc data ${on ? "enable" : "disable"}`);
}

function rebootDevice() {
    adb("reboot", { timeout: 60_000 });
}

function waitForDevice(timeoutMs = 120_000) {
    adb(`wait-for-device`, { timeout: timeoutMs });
    // Wait for boot completion AND boot animation stop (stronger ready signal —
    // ensures the Activity Manager has finished loading the package registry).
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            const booted = adbShell("getprop sys.boot_completed").trim();
            if (booted !== "1") { execSync("sleep 2"); continue; }
            const anim = adbShell("getprop init.svc.bootanim").trim();
            if (anim === "stopped") return;
        } catch { /* not ready yet */ }
        execSync("sleep 2");
    }
    throw new Error("Device did not complete boot within timeout");
}

function dismissKeyguard() {
    try {
        adbShell("input keyevent 82");   // KEYCODE_MENU (wakes screen)
        adbShell("wm dismiss-keyguard"); // Dismiss lock screen
    } catch { /* ok */ }
}

/* ---------- Build helpers ---------- */

function buildApk() {
    console.log("  Building APK...");
    execSync("./gradlew assembleDebug", {
        cwd: ANDROID_DIR,
        timeout: 300_000,
        stdio: "pipe",
    });
}

/* ---------- Primary API ---------- */

/**
 * Resolve production signaling infrastructure and prepare the device.
 *
 * Uses the SAME ensureSignalingInfra() flow as the real orchestrator:
 *   OAuth → .waymark-data.json → validate/create sheets → return IDs
 *
 * Test-specific work is limited to device prep:
 *   - Wipe app data, install APK, grant permissions
 *
 * @param {object} [opts]
 * @param {boolean} [opts.skipBuild=false]  Skip APK build
 * @param {boolean} [opts.skipInstall=false] Skip APK install
 * @returns {TestInfra}
 */
export async function bootstrap(opts = {}) {
    console.log("\n=== E2E Infrastructure Bootstrap ===\n");

    // 0. Verify device and ensure network is enabled
    if (!isDeviceConnected()) throw new Error("No Android device connected via adb");
    console.log("  ✓ Device connected");

    // Safety: restore network in case a previous failed test left it off
    try { setAirplaneMode(false); } catch { /* ok */ }
    try { setWifi(true); } catch { /* ok */ }

    // 1. Resolve signaling infra using the REAL production flow
    console.log("  Resolving signaling infrastructure (same as orchestrator)...");
    const { privateSheetId, publicSheetId } = await ensureSignalingInfra();
    console.log(`  ✓ Private sheet: ${privateSheetId}`);
    console.log(`  ✓ Public sheet:  ${publicSheetId}`);

    // 2. Resolve the signal key from the local key file (may be null — Phase 1 sets it)
    const signalKey = resolveSignalKey();
    if (signalKey) {
        console.log(`  ✓ Signal key:    ${signalKey.slice(0, 8)}… (from key file)`);
    } else {
        console.log("  ⚠ No signal key yet — Phase 1 key exchange will provision it");
    }

    // 3. Clear stale signaling data from sheets
    console.log("  Clearing signaling columns...");
    await clearSheetColumn(publicSheetId);
    await clearSheetColumn(privateSheetId);
    console.log("  ✓ Signaling columns cleared");

    // 4. Generate fresh peer ID for the test orchestrator
    const orchPeerId = randomBytes(4).toString("hex");
    console.log(`  ✓ Orchestrator peer ID: ${orchPeerId}`);

    // 5. Build APK if needed
    if (!opts.skipBuild && !existsSync(APK_PATH)) {
        buildApk();
        console.log("  ✓ APK built");
    } else {
        console.log("  ✓ APK exists");
    }

    // 6. Stop app, clear all data, reinstall
    forceStopApp();
    clearAppData();
    console.log("  ✓ App data cleared");

    if (!opts.skipInstall) {
        installApk(APK_PATH);
        console.log("  ✓ APK installed");
    }

    // 7. Grant permissions + dismiss lock screen
    grantNotificationPermission();
    dismissKeyguard();
    console.log("  ✓ Permissions granted");

    console.log("\n=== Bootstrap Complete ===\n");

    return new TestInfra({
        publicSheetId,
        privateSheetId,
        signalKey,    // may be null if Phase 1 hasn't run yet
        orchPeerId,
    });
}

/**
 * Holds test infrastructure state and provides helpers.
 * Every test file receives this from bootstrap().
 */
export class TestInfra {
    constructor({ publicSheetId, privateSheetId, signalKey, orchPeerId }) {
        this.publicSheetId  = publicSheetId;
        this.privateSheetId = privateSheetId;
        this.signalKey      = signalKey;
        this.orchPeerId     = orchPeerId;
        this._phase1Done    = false;  // true after performPhase1KeyExchange() completes for this app install
        this._orchProcess   = null;
        this._logcatProcess = null;
        this._logBuffer     = "";
        this._receivedNonces = new Set();
    }

    /* --- Orchestrator lifecycle --- */

    /**
     * Start a SheetWebRtcPeer instance as the test orchestrator.
     * Uses the user OAuth token for sheet access — same as the
     * production orchestrator in orchestrator.mjs.
     * Returns the peer once it has joined the mesh.
     */
    async startOrchestrator(opts = {}) {
        const { SheetWebRtcPeer } = await import("../../../mcp/sheet-webrtc-peer.mjs");

        const sheetId = opts.phase === 1 ? this.privateSheetId : this.publicSheetId;
        const encryptionKey = opts.phase === 1 ? undefined : this.signalKey;
        // Fresh peer ID each start — avoids "dead peer" rejection after phase transitions
        const peerId = randomBytes(4).toString("hex");

        this._orchPeer = new SheetWebRtcPeer({
            sheetId,
            getToken: getUserOAuthToken,
            peerId,
            displayName: "E2E Test Orchestrator",
            encryptionKey,
            onMessage: (remotePeerId, msg) => {
                if (opts.onMessage) opts.onMessage(remotePeerId, msg);
            },
            onConnect: (remotePeerId) => {
                if (opts.onConnect) opts.onConnect(remotePeerId);
            },
            onKeyExchange: (remotePeerId, keyHex) => {
                if (opts.onKeyExchange) opts.onKeyExchange(remotePeerId, keyHex);
            },
        });

        await this._orchPeer.start();
        return this._orchPeer;
    }

    stopOrchestrator() {
        if (this._orchPeer) {
            this._orchPeer.stop();
            this._orchPeer = null;
        }
    }

    getOrchestrator() {
        return this._orchPeer;
    }

    /**
     * Clear stale signaling data from both sheets.
     * Call this before restarting the orchestrator when heavy
     * network disruption may have left stale SDP offers/answers.
     */
    async clearSignaling() {
        await clearSheetColumn(this.publicSheetId).catch(() => {});
        await clearSheetColumn(this.privateSheetId).catch(() => {});
    }

    /**
     * Run the full Phase 1 key exchange protocol:
     *  1. Inject Phase 1 prefs (private sheet, no key)
     *  2. Launch the app
     *  3. Start Phase 1 orchestrator on the private sheet
     *  4. Wait for the Android peer to connect
     *  5. Generate AES-256 key and send via DataChannel
     *  6. Wait for Android to confirm receipt (via logcat)
     *  7. Stop Phase 1 orchestrator
     *  8. Store the negotiated key on this.signalKey
     *
     * @returns {string} The exchanged key (hex)
     */
    async performPhase1KeyExchange() {
        console.log("  Phase 1: Key exchange on private sheet...");

        // Inject only the OAuth token — app discovers sheets from Drive
        this.forceStopApp();
        await this.injectToken();
        this.startLogcatMonitor();
        this.launchApp();

        // Start Phase 1 orchestrator (private sheet, no encryption)
        let androidPeerId = null;
        const keyAcked = { value: false };

        const peer = await this.startOrchestrator({
            phase: 1,
            onConnect: (remotePeerId) => {
                androidPeerId = remotePeerId;
                console.log(`    Phase 1: Android peer connected: ${remotePeerId}`);
            },
        });

        // Wait for Android peer to connect over the private sheet
        const connected = await waitForPeerConnection(peer, 120_000);
        if (!connected) throw new Error("Phase 1: Android peer never connected");
        await sleep(5_000); // let DataChannel stabilize

        // Use the key from the key file (production path) or generate a fresh one
        const keyHex = this.signalKey || generateKeyHex();
        const target = androidPeerId || peer.connectedPeers()[0];
        if (!target) throw new Error("Phase 1: No peer to send key to");

        console.log(`    Phase 1: Sending key to ${target}...`);
        peer.sendKeyExchangeTo(target, keyHex);

        // Wait for Android to log receipt of the key
        // The Android app logs "key-exchange" or transitions to Phase 2
        const keyReceived = await waitFor(() => {
            const log = this.getFullLog();
            return log.includes("key") && log.includes("exchange") ||
                   log.includes("Phase2") ||
                   log.includes("signal_key");
        }, 30_000, 2_000);

        if (!keyReceived) {
            // Retry once — DataChannel might not have been fully ready
            console.log("    Phase 1: Retrying key exchange...");
            peer.sendKeyExchangeTo(target, keyHex);
            await sleep(10_000);
        }

        // Stop Phase 1 orchestrator
        this.stopOrchestrator();
        this.forceStopApp();

        // Store the negotiated key and mark Phase 1 complete
        this.signalKey = keyHex;
        this._phase1Done = true;
        console.log(`  ✓ Phase 1 complete — key: ${keyHex.slice(0, 8)}…`);

        return keyHex;
    }

    /* --- Logcat monitoring --- */

    startLogcatMonitor() {
        this.stopLogcatMonitor();
        try { adb("logcat -c"); } catch { /* ok */ }

        this._logBuffer = "";
        this._receivedNonces = new Set();

        this._logcatProcess = spawn("adb", [
            "logcat", "-s",
            "OrchestratorPeer:*",
            "ConnectionManager:*",
            "NotificationHelper:*",
            "WebRtcService:*",
        ], { stdio: ["ignore", "pipe", "ignore"] });

        this._logcatProcess.stdout.setEncoding("utf8");
        this._logcatProcess.stdout.on("data", (chunk) => {
            this._logBuffer += chunk;
            const lines = this._logBuffer.split("\n");
            this._logBuffer = lines.pop();
            for (const line of lines) {
                if (line.includes("Notification received")) {
                    const m = line.match(/\[([0-9a-f]{8})\]/);
                    if (m) this._receivedNonces.add(m[1]);
                }
            }
        });
    }

    stopLogcatMonitor() {
        if (this._logcatProcess) {
            this._logcatProcess.kill();
            this._logcatProcess = null;
        }
    }

    hasNonce(nonce) { return this._receivedNonces.has(nonce); }
    get receivedNonceCount() { return this._receivedNonces.size; }

    /**
     * Verify a notification was posted to the Android system via dumpsys.
     * More reliable than Appium UiSelector shade interaction.
     * Checks both active and recently-posted notifications.
     */
    async verifyNotificationPosted(textFragment, timeoutMs = 15_000) {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            try {
                const out = adbShell("dumpsys notification --noredact");
                // Check active notification list for our text in title or body
                if (out.includes(`title=String (${textFragment})`) ||
                    out.includes(`text=String (${textFragment})`)) {
                    return true;
                }
                // Also check android.title and android.text extras
                const notifs = getActiveNotifications();
                if (notifs.some(n =>
                    (n.title && n.title.includes(textFragment)) ||
                    (n.body && n.body.includes(textFragment))
                )) {
                    return true;
                }
            } catch { /* retry */ }
            await sleep(2_000);
        }
        // Non-fatal: notification may have been auto-grouped or dismissed
        console.log(`    ⚠ Notification "${textFragment}" not found in dumpsys (may be auto-grouped)`);
        return false;
    }

    getFullLog() {
        return getLogcat([
            "OrchestratorPeer", "ConnectionManager",
            "NotificationHelper", "WebRtcService",
        ]);
    }

    /* --- Device control shortcuts --- */

    /**
     * Inject ONLY the OAuth token into SharedPreferences.
     * Used after clearAppData() for a clean slate.
     * The app will discover sheet IDs from Drive and generate
     * its own peer ID — this is the production path.
     */
    async injectToken() {
        const token = await getUserOAuthToken();
        injectPrefs({
            access_token: token,
            access_token_set_ms: Date.now(),
        });
    }

    /**
     * Refresh the OAuth token in existing SharedPreferences.
     * Used between tests when prefs already have cached
     * sheet IDs, signal key, and peer ID from prior runs.
     * Only the token is updated; everything else persists.
     */
    async refreshToken() {
        const token = await getUserOAuthToken();
        mergeIntoPrefs({
            access_token: token,
            access_token_set_ms: Date.now(),
        });
    }

    /**
     * Merge arbitrary state into existing SharedPreferences.
     * Used for building specific test scenarios like wrong
     * signal key (to test key cycling) or corrupted state.
     */
    async setPrefsState(overrides) {
        mergeIntoPrefs(overrides);
    }

    forceStopApp()    { forceStopApp(); }
    clearAppData()    { clearAppData(); }
    launchApp()       { launchApp(); }
    clearLogcat()     { clearLogcat(); }
    setAirplaneMode(on) { setAirplaneMode(on); }
    setWifi(on)       { setWifi(on); }
    setMobileData(on) { setMobileData(on); }
    rebootDevice()    { rebootDevice(); }
    waitForDevice(t)  { waitForDevice(t); }
    dismissKeyguard() { dismissKeyguard(); }
    readPrefs()       { return readPrefs(); }
    getActiveNotifications() { return getActiveNotifications(); }

    /* --- Teardown --- */

    async teardown() {
        console.log("\n=== E2E Teardown ===\n");

        this.stopOrchestrator();
        this.stopLogcatMonitor();

        // Restore network
        try { setAirplaneMode(false); } catch { /* ok */ }
        try { setWifi(true); } catch { /* ok */ }

        // Stop app
        forceStopApp();

        // Clear signaling columns (don't delete sheets — they're production infra)
        console.log("  Clearing signaling columns...");
        await clearSheetColumn(this.publicSheetId).catch(() => {});
        await clearSheetColumn(this.privateSheetId).catch(() => {});
        console.log("  ✓ Signaling columns cleared");

        console.log("\n=== Teardown Complete ===\n");
    }
}

/* ---------- Wait helpers ---------- */

export function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

export async function waitFor(predicate, timeoutMs = 60_000, pollMs = 2_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (await predicate()) return true;
        await sleep(pollMs);
    }
    return false;
}

export async function waitForPeerConnection(peer, timeoutMs = 120_000) {
    return waitFor(() => peer.connectedPeers().length > 0, timeoutMs, 2_000);
}

export function makeTestNotification(index) {
    const nonce = randomBytes(4).toString("hex");
    return {
        type: "waymark-notification",
        title: `E2E Test #${index}`,
        body: `Test payload [${nonce}] at ${new Date().toISOString()}`,
        _testNonce: nonce,
    };
}
