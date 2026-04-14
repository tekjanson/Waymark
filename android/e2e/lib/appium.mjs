/* ============================================================
   lib/appium.mjs — Appium / WebdriverIO device automation

   Provides a higher-level API for Android device interaction
   via Appium UiAutomator2. Handles driver lifecycle, element
   queries, notification shade interaction, and app state checks.

   Usage:
     const driver = await createDriver();
     await driver.verifyNotificationInShade("Test Notification #1");
     await driver.closeDriver();
   ============================================================ */

import { remote } from "webdriverio";
import { execSync, spawn } from "node:child_process";

const APP_PACKAGE       = "com.waymark.app";
const APP_ACTIVITY      = ".MainActivity";
const APPIUM_PORT       = 4723;
const IMPLICIT_WAIT_MS  = 5_000;

let _appiumProcess = null;

/* ---------- Appium server lifecycle ---------- */

export async function startAppiumServer() {
    if (_appiumProcess) return;

    // Kill any stale Appium on this port from a previous run
    try {
        execSync(`lsof -ti :${APPIUM_PORT} | xargs -r kill -9`, { timeout: 5_000 });
    } catch { /* nothing on that port — fine */ }

    console.log("  Starting Appium server...");
    _appiumProcess = spawn("npx", ["appium", "--port", String(APPIUM_PORT), "--relaxed-security"], {
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, ANDROID_HOME: process.env.ANDROID_HOME || "/home/tekjanson/Android/Sdk" },
    });

    // Wait for Appium to be ready
    await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Appium server start timeout")), 30_000);
        let output = "";

        _appiumProcess.stdout.on("data", (chunk) => {
            output += chunk.toString();
            if (output.includes("could be opened") || output.includes("listener started")) {
                clearTimeout(timeout);
                resolve();
            }
        });
        _appiumProcess.stderr.on("data", (chunk) => {
            output += chunk.toString();
        });
        _appiumProcess.on("exit", (code) => {
            clearTimeout(timeout);
            reject(new Error(`Appium exited with code ${code}: ${output.slice(-500)}`));
        });
    });

    console.log(`  ✓ Appium server running on port ${APPIUM_PORT}`);
}

export function stopAppiumServer() {
    if (_appiumProcess) {
        _appiumProcess.kill("SIGTERM");
        _appiumProcess = null;
        console.log("  ✓ Appium server stopped");
    }
}

/* ---------- WebdriverIO driver ---------- */

/**
 * Create a WebdriverIO driver connected to Appium with UiAutomator2.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.noReset=true]  Don't clear app data on session start
 * @param {string}  [opts.app]           APK path (omit to attach to already-installed app)
 * @returns {WaymarkDriver}
 */
export async function createDriver(opts = {}) {
    const capabilities = {
        platformName: "Android",
        "appium:automationName": "UiAutomator2",
        "appium:deviceName": "Android",
        "appium:appPackage": APP_PACKAGE,
        "appium:appActivity": APP_ACTIVITY,
        "appium:noReset": opts.noReset ?? true,
        "appium:autoGrantPermissions": true,
        "appium:newCommandTimeout": 600,
        "appium:adbExecTimeout": 30_000,
        // Don't auto-launch the app — tests manage lifecycle explicitly
        "appium:dontStopAppOnReset": true,
        "appium:autoLaunch": false,
    };

    if (opts.app) {
        capabilities["appium:app"] = opts.app;
    }

    const driver = await remote({
        hostname: "127.0.0.1",
        port: APPIUM_PORT,
        path: "/",
        capabilities,
        logLevel: "warn",
    });

    await driver.setTimeout({ implicit: IMPLICIT_WAIT_MS });

    return new WaymarkDriver(driver);
}

/* ---------- High-level driver wrapper ---------- */

export class WaymarkDriver {
    constructor(driver) {
        this._d = driver;
    }

    get raw() { return this._d; }

    async close() {
        try { await this._d.deleteSession(); } catch { /* ok */ }
    }

    /* --- App state --- */

    async isAppRunning() {
        // QUERY_CURRENT_STATE: 4 = running in foreground
        const state = await this._d.queryAppState(APP_PACKAGE);
        return state >= 3; // 3 = background, 4 = foreground
    }

    async bringToForeground() {
        await this._d.activateApp(APP_PACKAGE);
    }

    async sendToBackground(seconds = -1) {
        await this._d.background(seconds);
    }

    async terminateApp() {
        await this._d.terminateApp(APP_PACKAGE);
    }

    /* --- Notification shade --- */

    async openNotificationShade() {
        await this._d.openNotifications();
        await this._d.pause(1500); // animation settle time
    }

    async closeNotificationShade() {
        await this._d.pressKeyCode(4); // KEYCODE_BACK
        await this._d.pause(500);
    }

    /**
     * Check if a notification with the given text exists in the shade.
     * Pulls down the shade, searches, then closes it.
     *
     * @param {string} textFragment  Text to search for in notification title/body
     * @returns {boolean}
     */
    async isNotificationVisible(textFragment) {
        await this.openNotificationShade();
        try {
            const el = await this._d.$(`android=new UiSelector().textContains("${textFragment.replace(/"/g, '\\"')}")`);
            const exists = await el.isExisting();
            return exists;
        } catch {
            return false;
        } finally {
            await this.closeNotificationShade();
        }
    }

    /**
     * Assert a notification is visible in the shade.
     * Retries for up to timeoutMs.
     */
    async verifyNotificationInShade(textFragment, timeoutMs = 15_000) {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            if (await this.isNotificationVisible(textFragment)) return true;
            await this._d.pause(2000);
        }
        throw new Error(`Notification containing "${textFragment}" not found in shade within ${timeoutMs}ms`);
    }

    /**
     * Count notifications from our app currently in the shade.
     */
    async countAppNotifications() {
        await this.openNotificationShade();
        try {
            const elements = await this._d.$$(`android=new UiSelector().packageName("${APP_PACKAGE}")`);
            return elements.length;
        } catch {
            return 0;
        } finally {
            await this.closeNotificationShade();
        }
    }

    /**
     * Clear all notifications from the shade.
     */
    async clearAllNotifications() {
        await this.openNotificationShade();
        try {
            const clearBtn = await this._d.$(`android=new UiSelector().text("Clear all")`);
            if (await clearBtn.isExisting()) {
                await clearBtn.click();
            }
        } catch { /* no notifications to clear */ }
        await this._d.pause(500);
        await this.closeNotificationShade();
    }

    /* --- WebView interaction --- */

    /**
     * Wait for the WebView to finish loading.
     * Looks for the Waymark app's main content.
     */
    async waitForWebViewLoad(timeoutMs = 30_000) {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            try {
                // Check if any WebView context is available
                const contexts = await this._d.getContexts();
                if (contexts.some(c => c.includes("WEBVIEW"))) return true;
            } catch { /* not ready */ }
            await this._d.pause(2000);
        }
        return false;
    }

    /* --- Screen state --- */

    async isScreenOn() {
        try {
            const out = execSync('adb shell dumpsys power | grep "Display Power"', { encoding: "utf8" });
            return out.includes("state=ON");
        } catch {
            return false;
        }
    }

    async wakeScreen() {
        if (!(await this.isScreenOn())) {
            await this._d.pressKeyCode(26); // KEYCODE_POWER
            await this._d.pause(500);
        }
        // Dismiss keyguard
        try {
            execSync('adb shell wm dismiss-keyguard');
        } catch { /* ok */ }
    }

    /* --- Generic element helpers --- */

    async waitForText(text, timeoutMs = 15_000) {
        const el = await this._d.$(`android=new UiSelector().textContains("${text.replace(/"/g, '\\"')}")`);
        await el.waitForExist({ timeout: timeoutMs });
        return el;
    }

    async tapText(text) {
        const el = await this.waitForText(text);
        await el.click();
    }

    async screenshot(filename) {
        const base64 = await this._d.takeScreenshot();
        const { writeFileSync } = await import("node:fs");
        const { join } = await import("node:path");
        const outDir = join(__dirname, "..", "screenshots");
        try { execSync(`mkdir -p "${outDir}"`); } catch { /* ok */ }
        writeFileSync(join(outDir, filename), Buffer.from(base64, "base64"));
    }
}
