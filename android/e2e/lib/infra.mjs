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
   ║    • Single-sheet signaling (OAuth-protected)            ║
   ║    • Notification delivery via DataChannel               ║
   ║    • State machine transitions (Idle→Connecting→Connected)║
   ║    • Reconnection & recovery after disruptions           ║
   ║    • Notification display via NotificationHelper         ║
   ║                                                         ║
   ║  MUST NOT inject or bypass:                              ║
   ║    • Sheet IDs (app discovers from Drive)                ║
   ║    • Peer ID (app generates locally on first run)        ║
   ║    • State transitions (app drives its own state)        ║
   ║                                                         ║
   ║  CAN build unique states to test (via adb/setPrefsState):║
   ║    • Corrupted prefs → test graceful recovery            ║
   ║    • Missing prefs → test cold-start behavior            ║
   ║                                                         ║
   ║  Test orchestrator uses production SheetWebRtcPeer       ║
   ║  with the same OAuth token and real signaling sheet.     ║
   ╚══════════════════════════════════════════════════════════╝

   Infrastructure mirrors the real orchestrator.mjs:
     - ensureSignalingInfra()  → OAuth → .waymark-data.json →
       validate/create signaling sheet
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
    const tokenData = await getOAuthTokenData();
    return tokenData.access_token;
}

/**
 * Read and auto-refresh the full OAuth token data including refresh credentials.
 * Returns: { access_token, expiry_date, refresh_token, client_id, client_secret }
 */
async function getOAuthTokenData() {
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
    return tokenData;
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
 *  3. Validates signaling sheet (recreates if trashed/deleted)
 *  4. Persists changes back to .waymark-data.json
 *  Returns { signalingSheetId }
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

    // ── Signaling sheet — OAuth-protected ──
    let sheetId = data.signalingSheetId || null;
    if (sheetId && !(await sheetExists(sheetId, token))) {
        console.log(`  Signaling sheet ${sheetId} deleted — recreating...`);
        sheetId = null;
    }
    if (!sheetId) {
        const found = await driveFindByName(".waymark-signaling", token);
        if (found && (await sheetExists(found, token))) {
            console.log(`  Found orphaned signaling sheet: ${found}`);
            sheetId = found;
        } else {
            console.log("  Auto-provisioning signaling sheet...");
            sheetId = await createSpreadsheet(".waymark-signaling", token);
            console.log(`  Created signaling sheet: ${sheetId}`);
        }
        data.signalingSheetId = sheetId;
        dirty = true;
    }

    // Persist changes back to Drive
    if (dirty) {
        data.updatedAt = new Date().toISOString();
        await driveUpdateJson(dataFileId, data, token);
        console.log("  Saved updated sheet IDs to .waymark-data.json");
    }

    return { signalingSheetId: sheetId };
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

/**
 * Re-install Appium dependency APKs (io.appium.settings + UiAutomator2 server).
 * After a device reboot the settings app often enters a broken state where the
 * activity class cannot be found, causing createDriver() to fail. Calling this
 * before createDriver() after a reboot fixes the issue.
 */
function reinstallAppiumDeps() {
    const e2eDir = path.resolve(__dirname, "..");
    const settingsApk = path.join(e2eDir,
        "node_modules/appium-uiautomator2-driver/node_modules/io.appium.settings/apks/settings_apk-debug.apk");
    const uia2Server = path.join(e2eDir,
        "node_modules/appium-uiautomator2-driver/node_modules/appium-uiautomator2-server/apks/appium-uiautomator2-server-v7.1.11.apk");
    const uia2Test = path.join(e2eDir,
        "node_modules/appium-uiautomator2-driver/node_modules/appium-uiautomator2-server/apks/appium-uiautomator2-server-debug-androidTest.apk");

    for (const apk of [settingsApk, uia2Server, uia2Test]) {
        try {
            adb(`install -r "${apk}"`, { timeout: 60_000 });
        } catch (e) {
            console.warn(`  ⚠ Failed to install ${path.basename(apk)}: ${e.message}`);
        }
    }
    // Launch settings once to verify it works
    try {
        adbShell("am start -n io.appium.settings/.Settings -a android.intent.action.MAIN -c android.intent.category.LAUNCHER");
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
    const { signalingSheetId } = await ensureSignalingInfra();
    console.log(`  ✓ Signaling sheet: ${signalingSheetId}`);

    // 2. Clear stale signaling data from sheet
    console.log("  Clearing signaling column...");
    await clearSheetColumn(signalingSheetId);
    console.log("  ✓ Signaling column cleared");

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
        signalingSheetId,
        orchPeerId,
    });
}

/**
 * Holds test infrastructure state and provides helpers.
 * Every test file receives this from bootstrap().
 */
export class TestInfra {
    constructor({ signalingSheetId, orchPeerId }) {
        this.signalingSheetId = signalingSheetId;
        this.orchPeerId     = orchPeerId;
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

        // Fresh peer ID each start — avoids "dead peer" rejection after restarts
        const peerId = randomBytes(4).toString("hex");

        this._orchPeer = new SheetWebRtcPeer({
            sheetId: this.signalingSheetId,
            getToken: getUserOAuthToken,
            peerId,
            displayName: "E2E Test Orchestrator",
            onMessage: (remotePeerId, msg) => {
                if (opts.onMessage) opts.onMessage(remotePeerId, msg);
            },
            onConnect: (remotePeerId) => {
                if (opts.onConnect) opts.onConnect(remotePeerId);
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
     * Clear stale signaling data from the sheet.
     * Call this before restarting the orchestrator when heavy
     * network disruption may have left stale SDP offers/answers.
     */
    async clearSignaling() {
        await clearSheetColumn(this.signalingSheetId).catch(() => {});
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
     *
     * Also injects refresh_token + client credentials so the
     * native foreground service can refresh its own token when
     * it outlives the WebView session (production behavior).
     */
    async injectToken() {
        const td = await getOAuthTokenData();
        const prefs = {
            access_token: td.access_token,
            access_token_set_ms: Date.now(),
        };
        if (td.expiry_date)    prefs.token_expiry_ms = td.expiry_date;
        if (td.refresh_token)  prefs.refresh_token   = td.refresh_token;
        if (td.client_id)      prefs.client_id       = td.client_id;
        if (td.client_secret)  prefs.client_secret   = td.client_secret;
        injectPrefs(prefs);
    }

    /**
     * Refresh the OAuth token in existing SharedPreferences.
     * Used between tests when prefs already have cached
     * sheet IDs, signal key, and peer ID from prior runs.
     * Only the token + refresh credentials are updated; everything else persists.
     *
     * Also injects the known signaling_sheet_id so Android doesn't need a Drive
     * API round-trip on startup after clearAppData(). This is test scaffolding —
     * the drive-fetch path is exercised in production (cached from prior session).
     */
    async refreshToken() {
        const td = await getOAuthTokenData();
        const updates = {
            access_token: td.access_token,
            access_token_set_ms: Date.now(),
            signaling_sheet_id: this.signalingSheetId,
        };
        if (td.expiry_date)    updates.token_expiry_ms = td.expiry_date;
        if (td.refresh_token)  updates.refresh_token   = td.refresh_token;
        if (td.client_id)      updates.client_id       = td.client_id;
        if (td.client_secret)  updates.client_secret   = td.client_secret;
        mergeIntoPrefs(updates);
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
    reinstallAppiumDeps() { reinstallAppiumDeps(); }
    readPrefs()       { return readPrefs(); }
    getActiveNotifications() { return getActiveNotifications(); }

    /**
     * Write a single value to a specific row of the signaling column (T).
     * Used to inject or overwrite presence/offer/answer cells in test scenarios
     * (e.g., slot eviction simulation, mesh-full setup).
     *
     * @param {number} rowNumber  1-based row number in the sheet
     * @param {string} value      Cell value to write (JSON string or empty string to clear)
     */
    async writeSignalingRow(rowNumber, value) {
        const token = await getUserOAuthToken();
        const range = `Sheet1!T${rowNumber}`;
        const res = await fetch(
            `${SHEETS_BASE_URL}/${this.signalingSheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`,
            {
                method: "PUT",
                headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
                body: JSON.stringify({ range, majorDimension: "ROWS", values: [[value]] }),
            }
        );
        if (!res.ok) console.warn(`writeSignalingRow(${rowNumber}): ${res.status}`);
    }

    /**
     * Fill signaling slots with fake peer presences so the mesh appears full.
     * Slots whose current presence belongs to an excluded peer ID are skipped.
     *
     * @param {object} [opts]
     * @param {string[]} [opts.excludePeerIds=[]]  Peer IDs whose slots are not overwritten
     * @param {number}  [opts.tsOffset=0]  Applied to Date.now() for the ts field.
     *                  Use a negative value (e.g. -48000) to make presences near-expiry.
     */
    async fillSignalingSlots(opts = {}) {
        const { excludePeerIds = [], tsOffset = 0 } = opts;
        const token = await getUserOAuthToken();
        const slotRows = [1, 6, 11, 16, 21, 26, 31, 36]; // rows for 8 slots
        // Read current column to skip slots belonging to excluded peers
        const readRes = await fetch(
            `${SHEETS_BASE_URL}/${this.signalingSheetId}/values/${encodeURIComponent(`Sheet1!T1:T${MAX_ROWS}`)}`,
            { headers: { Authorization: `Bearer ${token}` } }
        );
        const rows = readRes.ok ? ((await readRes.json()).values || []) : [];
        for (let i = 0; i < slotRows.length; i++) {
            const slotRow = slotRows[i];
            const existing = rows[slotRow - 1]?.[0];
            if (existing) {
                try {
                    const obj = JSON.parse(existing);
                    if (excludePeerIds.includes(obj.peerId)) continue;
                } catch { /* overwrite unparseable cell */ }
            }
            await this.writeSignalingRow(slotRow, JSON.stringify({
                peerId: `faketest${String(i).padStart(6, "0")}`,
                name:   `Fake Test Peer ${i}`,
                ts:     Date.now() + tsOffset,
                nonce:  randomBytes(4).toString("hex"),
            }));
        }
    }

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

        // Clear signaling column (don't delete sheet — it's production infra)
        console.log("  Clearing signaling column...");
        await clearSheetColumn(this.signalingSheetId).catch(() => {});
        console.log("  ✓ Signaling column cleared");

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
