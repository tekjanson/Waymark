#!/usr/bin/env node
/* ============================================================
   runner.mjs — Full E2E suite runner

   Executes all test suites sequentially with aggregate results.
   Supports:
     --suite=<name>      Run a specific suite
     --skip-soak         Skip the multi-hour soak test
     --soak-only         Only run the soak test
     --bail              Stop on first failure
     --timeout=<ms>      Override default mocha timeout
   ============================================================ */

import { execSync, spawn } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TESTS_DIR = resolve(__dirname, "tests");
const REPORTS_DIR = resolve(__dirname, "reports");

/* ---- Parse args ---- */
const args = process.argv.slice(2);
const flags = {
    suite:    args.find(a => a.startsWith("--suite="))?.split("=")[1],
    skipSoak: args.includes("--skip-soak"),
    soakOnly: args.includes("--soak-only"),
    bail:     args.includes("--bail"),
    timeout:  args.find(a => a.startsWith("--timeout="))?.split("=")[1],
};

const SUITES = [
    { name: "happy-path",          file: "01-happy-path.test.mjs",          soak: false },
    { name: "network-resilience",  file: "02-network-resilience.test.mjs",  soak: false },
    { name: "orchestrator-failure",file: "03-orchestrator-failure.test.mjs", soak: false },
    { name: "app-lifecycle",       file: "04-app-lifecycle.test.mjs",        soak: false },
    { name: "soak",                file: "05-soak.test.mjs",                 soak: true  },
];

function filterSuites() {
    if (flags.suite) return SUITES.filter(s => s.name === flags.suite);
    if (flags.soakOnly) return SUITES.filter(s => s.soak);
    if (flags.skipSoak) return SUITES.filter(s => !s.soak);
    return SUITES;
}

function runSuite(suite) {
    return new Promise((resolve) => {
        const startTime = Date.now();
        const args = [
            "npx", "mocha",
            `tests/${suite.file}`,
            "--timeout", flags.timeout || "0",
            "--exit",
            "--reporter", "spec",
        ];
        if (flags.bail) args.push("--bail");

        console.log(`\n  ▶ Running: ${suite.name}`);
        console.log(`    Command: ${args.join(" ")}`);

        const child = spawn(args[0], args.slice(1), {
            cwd: __dirname,
            stdio: "inherit",
            env: { ...process.env, FORCE_COLOR: "1" },
        });

        child.on("close", (code) => {
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            resolve({
                name: suite.name,
                passed: code === 0,
                exitCode: code,
                elapsed: `${elapsed}s`,
            });
        });

        child.on("error", (err) => {
            resolve({
                name: suite.name,
                passed: false,
                exitCode: -1,
                elapsed: "0s",
                error: err.message,
            });
        });
    });
}

/* ---- Main ---- */
async function main() {
    console.log("\n  ╔═══════════════════════════════════════════════╗");
    console.log("  ║              E2E Test Runner                  ║");
    console.log("  ╚═══════════════════════════════════════════════╝");

    // Verify environment
    try {
        execSync("node setup.mjs", { cwd: __dirname, stdio: "inherit" });
    } catch {
        console.error("\n  ❌ Environment check failed. Fix issues above before running.\n");
        process.exit(1);
    }

    const suites = filterSuites();
    console.log(`\n  Running ${suites.length} suite(s): ${suites.map(s => s.name).join(", ")}\n`);

    const results = [];
    const overallStart = Date.now();

    for (const suite of suites) {
        const result = await runSuite(suite);
        results.push(result);

        if (flags.bail && !result.passed) {
            console.log(`\n  ⛔ Bail: stopping after ${suite.name} failed\n`);
            break;
        }
    }

    /* ---- Report ---- */
    const overallElapsed = ((Date.now() - overallStart) / 1000).toFixed(1);
    const passed = results.filter(r => r.passed).length;
    const failed = results.filter(r => !r.passed).length;

    console.log("\n  ═══════════════ FINAL RESULTS ═══════════════");
    const maxName = Math.max(...results.map(r => r.name.length));
    for (const r of results) {
        const icon = r.passed ? "✅" : "❌";
        const pad = " ".repeat(maxName - r.name.length);
        console.log(`  ${icon}  ${r.name}${pad}  ${r.elapsed}${r.error ? `  (${r.error})` : ""}`);
    }
    console.log(`\n  Total: ${passed}/${results.length} passed, ${failed} failed — ${overallElapsed}s`);
    console.log("  ═══════════════════════════════════════════════\n");

    // Write JSON report
    if (!existsSync(REPORTS_DIR)) mkdirSync(REPORTS_DIR, { recursive: true });
    const reportPath = resolve(REPORTS_DIR, `run-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    writeFileSync(reportPath, JSON.stringify({
        timestamp: new Date().toISOString(),
        duration: overallElapsed,
        suites: results,
        flags,
    }, null, 2));
    console.log(`  Report saved: ${reportPath}\n`);

    process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
