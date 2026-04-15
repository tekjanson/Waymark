#!/usr/bin/env node
/* ============================================================
   setup.mjs — One-time environment verification and setup

   Verifies all prerequisites before running E2E tests:
     - Node.js version
     - adb connected device
     - Google service account key
     - Appium installed
     - APK exists or can be built
   ============================================================ */

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const CHECKS = [];
let allOk = true;

function check(name, fn) {
    try {
        const result = fn();
        CHECKS.push({ name, ok: true, detail: result });
    } catch (err) {
        CHECKS.push({ name, ok: false, detail: err.message });
        allOk = false;
    }
}

function run(cmd, opts = {}) {
    return execSync(cmd, { encoding: "utf8", timeout: 30_000, ...opts }).trim();
}

/* ---- Checks ---- */

check("Node.js ≥ 18", () => {
    const v = process.versions.node.split(".").map(Number);
    if (v[0] < 18) throw new Error(`Node ${process.versions.node} < 18`);
    return `v${process.versions.node}`;
});

check("npm available", () => {
    return run("npm --version");
});

check("adb available", () => {
    return run("adb version").split("\n")[0];
});

check("adb device connected", () => {
    const devices = run("adb devices").split("\n").filter(l => l.includes("device") && !l.startsWith("List"));
    if (devices.length === 0) throw new Error("No adb device connected");
    return devices[0].split("\t")[0];
});

check("ANDROID_HOME set", () => {
    if (!process.env.ANDROID_HOME) throw new Error("ANDROID_HOME not set");
    return process.env.ANDROID_HOME;
});

check("User OAuth token", () => {
    const tokenPath = process.env.WAYMARK_OAUTH_TOKEN_PATH ||
        resolve(process.env.HOME, ".config/gcloud/waymark-oauth-token.json");
    if (!existsSync(tokenPath)) throw new Error(`Not found: ${tokenPath} — sign in via the web app first`);
    const data = JSON.parse(readFileSync(tokenPath, "utf8"));
    if (!data.access_token) throw new Error("No access_token in OAuth token file");
    if (!data.refresh_token) throw new Error("No refresh_token — token cannot be renewed");
    const expired = Date.now() > (data.expiry_date - 60_000);
    return `${expired ? "Expired (will auto-refresh)" : "Valid"}, has refresh_token`;
});

check("Signal key", () => {
    const keyPath = resolve(process.env.HOME, ".config/gcloud/waymark-signal.key");
    if (!existsSync(keyPath)) throw new Error(`Not found: ${keyPath}`);
    const hex = readFileSync(keyPath, "utf8").trim();
    if (hex.length !== 64) throw new Error(`Invalid key length: ${hex.length} (expected 64 hex chars)`);
    return `${hex.slice(0, 8)}...${hex.slice(-8)} (${hex.length / 2} bytes)`;
});

check("Appium installed", () => {
    try {
        return run("npx appium --version");
    } catch {
        throw new Error("Appium not found — run: npm install");
    }
});

check("UiAutomator2 driver", () => {
    try {
        const list = run("npx appium driver list --installed --json 2>/dev/null || echo '{}'");
        const parsed = JSON.parse(list);
        if (parsed.uiautomator2) return `v${parsed.uiautomator2.version || "installed"}`;
        throw new Error("not installed");
    } catch {
        throw new Error("UiAutomator2 not installed — run: npx appium driver install uiautomator2");
    }
});

check("APK available", () => {
    const apkPath = resolve(__dirname, "../app/build/outputs/apk/free/debug/app-free-debug.apk");
    const altPath = resolve(__dirname, "../app/build/outputs/apk/debug/app-debug.apk");
    if (existsSync(apkPath)) return apkPath;
    if (existsSync(altPath)) return altPath;
    throw new Error("No debug APK found — build the app first");
});

check("Device unlocked", () => {
    const dump = run("adb shell dumpsys window");
    if (dump.includes("mDreamingLockscreen=true") || dump.includes("isStatusBarKeyguard=true")) {
        throw new Error("Device is locked — unlock it first");
    }
    return "Unlocked";
});

check("Device WiFi connected", () => {
    const wifi = run("adb shell dumpsys wifi | grep 'Wi-Fi is' || echo 'unknown'");
    if (!wifi.includes("enabled")) throw new Error("WiFi is not enabled");
    return "Enabled";
});

/* ---- Report ---- */

console.log("\n  ╔═══════════════════════════════════════════════╗");
console.log("  ║         E2E Test Environment Setup            ║");
console.log("  ╚═══════════════════════════════════════════════╝\n");

const maxLen = Math.max(...CHECKS.map(c => c.name.length));

for (const c of CHECKS) {
    const icon = c.ok ? "✅" : "❌";
    const pad = " ".repeat(maxLen - c.name.length);
    console.log(`  ${icon}  ${c.name}${pad}  →  ${c.detail}`);
}

console.log("");

if (allOk) {
    console.log("  ✅  All checks passed — ready to run E2E tests!\n");
    console.log("  Run:  npm test            (quick smoke)");
    console.log("        npm run test:full   (full suite)");
    console.log("        npm run test:soak   (multi-hour stability)\n");
    process.exit(0);
} else {
    console.log("  ❌  Some checks failed — fix the issues above before running tests.\n");
    process.exit(1);
}
