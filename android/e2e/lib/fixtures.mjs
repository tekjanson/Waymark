/* ============================================================
   lib/fixtures.mjs — Shared Mocha hooks and test fixtures

   Provides before/after hooks that bootstrap infrastructure,
   start Appium, and tear everything down. Tests import the
   `infra` and `driver` singletons.
   ============================================================ */

import { bootstrap, TestInfra } from "./infra.mjs";
import { startAppiumServer, stopAppiumServer, createDriver } from "./appium.mjs";

/** @type {TestInfra} */
let _infra = null;
/** @type {import('./appium.mjs').WaymarkDriver} */
let _driver = null;

export function getInfra()  { return _infra; }
export function getDriver() { return _driver; }

/**
 * Root-level Mocha hooks. Call from the top describe() block.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.skipBuild]    Skip APK build
 * @param {boolean} [opts.skipInstall]  Skip APK install
 * @param {boolean} [opts.needsAppium]  Whether to start Appium (default true)
 */
export function setupSuite(opts = {}) {
    const needsAppium = opts.needsAppium ?? true;

    before(async function () {
        this.timeout(600_000); // 10 min for bootstrap

        // 1. Provision infrastructure
        _infra = await bootstrap({
            skipBuild: opts.skipBuild ?? false,
            skipInstall: opts.skipInstall ?? false,
        });

        // 2. Start Appium if needed
        if (needsAppium) {
            await startAppiumServer();
            _driver = await createDriver();
        }
    });

    after(async function () {
        this.timeout(120_000);

        // Close Appium driver
        if (_driver) {
            await _driver.close();
            _driver = null;
        }

        // Stop Appium server
        if (needsAppium) {
            stopAppiumServer();
        }

        // Tear down infrastructure
        if (_infra) {
            await _infra.teardown();
            _infra = null;
        }
    });

    beforeEach(async function () {
        // A test may have explicitly closed the Appium session (e.g. the device
        // reboot test calls driver.close() before rebooting then creates a local
        // replacement). Detect the dead session here and replace it so subsequent
        // tests always receive a live driver from getDriver().
        if (_driver && needsAppium) {
            try {
                await _driver.raw.getWindowSize();
            } catch {
                await _driver.close();
                _driver = await createDriver();
            }
        }
    });

    afterEach(async function () {
        // Always stop the orchestrator between tests so a failed test
        // doesn't leave a stale peer polluting the mesh for the next test.
        if (_infra) {
            _infra.stopOrchestrator();
        }

        // On test failure, take a screenshot
        if (this.currentTest?.state === "failed" && _driver) {
            const name = this.currentTest.fullTitle().replace(/[^a-z0-9]/gi, "_");
            try {
                await _driver.screenshot(`FAIL_${name}_${Date.now()}.png`);
            } catch { /* best effort */ }
        }
    });
}
