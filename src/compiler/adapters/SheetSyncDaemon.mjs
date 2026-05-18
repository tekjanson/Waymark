/**
 * @module SheetSyncDaemon
 *
 * Persistent bridge between the Zero-Trust compiler MQTT pipeline and the
 * Waymark Google Sheet (the definitive master interface and human command centre).
 *
 * Responsibilities:
 *   1. MQTT → Sheet  : subscribe to `waymark/compiler/stage/#`, find or append
 *      the matching row in the Waymark Kanban sheet, keep it current.
 *   2. Sheet → local : poll every 5 s for rows where a human toggled
 *      "Approval Toggle" to TRUE. Write `"approved": true` into the local
 *      `.waymark/stage/<jobId>.stage.json` and invoke DecomposeOrchestrator.
 *
 * ── Environment variables ──────────────────────────────────────────────────
 *   GOOGLE_APPLICATION_CREDENTIALS  path to service-account JSON  (required)
 *   COMPILER_SHEET_ID               spreadsheet ID                (required)
 *   WAYMARK_STAGE_DIR               overrides local stage dir     (optional)
 *
 * ── Waymark Kanban column schema (Sheet1) ─────────────────────────────────
 *   Col A  Task / Job ID
 *   Col B  Target Module
 *   Col C  Agent Status
 *   Col D  Compiler Logs
 *   Col E  Context / Notes
 *   Col F  Approval Toggle   (human writes TRUE here to release the gate)
 *
 * ── Auth ──────────────────────────────────────────────────────────────────
 *   Service-account via google-auth-library. Raw fetch REST calls.
 *   Same pattern as scripts/update-workboard.js in the rest of the codebase.
 *
 * ── Rate limiting ─────────────────────────────────────────────────────────
 *   A serial write queue flushes at most once per 600 ms to stay inside the
 *   Google Sheets 100 req/min quota. Events that arrive faster are queued.
 *
 * ── Usage ─────────────────────────────────────────────────────────────────
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json \
 *   COMPILER_SHEET_ID=1AbCdEfGhIjKlMnOpQrStUv \
 *   node src/compiler/adapters/SheetSyncDaemon.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import mqtt from 'mqtt';

const require = createRequire(import.meta.url);
const execFileAsync = promisify(execFile);

// ── Constants ─────────────────────────────────────────────────────────────────

const BROKER_URL        = 'mqtt://localhost:1883';
const MQTT_TOPIC        = 'waymark/compiler/stage/#';
const SHEETS_BASE       = 'https://sheets.googleapis.com/v4/spreadsheets';
const POLL_INTERVAL_MS  = 5_000;
const WRITE_THROTTLE_MS = 600;          // ~100 writes/min — within Sheets quota

/** Column layout (0-based). Changing these is the only thing needed to remap. */
const COL = {
    JOB_ID:   0,   // A — Task / Job ID
    TARGET:   1,   // B — Target Module
    STATUS:   2,   // C — Agent Status
    LOGS:     3,   // D — Compiler Logs
    NOTES:    4,   // E — Context / Notes
    APPROVED: 5,   // F — Approval Toggle (human writes TRUE to release gate)
};

const HEADER = ['Task / Job ID', 'Target Module', 'Agent Status',
                 'Compiler Logs', 'Context / Notes', 'Approval Toggle'];

const SHEET_RANGE = 'Sheet1!A:F';

// Status values used as string constants so the spec stays in one place.
const STATUS = {
    AWAITING_QA:    'AWAITING_QA',
    DONE_IN_REVIEW: 'DONE_IN_REVIEW',
};

// ── Sheets REST helpers ───────────────────────────────────────────────────────

async function sheetsGet(token, spreadsheetId, suffix) {
    const res = await fetch(`${SHEETS_BASE}/${spreadsheetId}${suffix}`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`Sheets GET ${res.status}: ${await res.text()}`);
    return res.json();
}

async function sheetsValues(token, spreadsheetId, range) {
    const data = await sheetsGet(
        token, spreadsheetId,
        `/values/${encodeURIComponent(range)}`
    );
    return data.values ?? [];
}

async function sheetsAppend(token, spreadsheetId, range, values) {
    const url =
        `${SHEETS_BASE}/${spreadsheetId}/values/${encodeURIComponent(range)}:append` +
        `?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
    const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ values }),
    });
    if (!res.ok) throw new Error(`Sheets append ${res.status}: ${await res.text()}`);
    return res.json();
}

async function sheetsWrite(token, spreadsheetId, range, values) {
    const url =
        `${SHEETS_BASE}/${spreadsheetId}/values/${encodeURIComponent(range)}` +
        `?valueInputOption=RAW`;
    const res = await fetch(url, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ values }),
    });
    if (!res.ok) throw new Error(`Sheets write ${res.status}: ${await res.text()}`);
    return res.json();
}

// ── Write queue (serial, rate-limited) ───────────────────────────────────────

class WriteQueue {
    #pending = [];
    #timer   = null;
    #busy    = false;

    enqueue(fn) {
        this.#pending.push(fn);
        if (!this.#timer && !this.#busy) {
            this.#timer = setTimeout(() => this.#drain(), WRITE_THROTTLE_MS);
        }
    }

    async #drain() {
        this.#timer = null;
        if (!this.#pending.length) return;
        this.#busy = true;
        const fn = this.#pending.shift();
        try { await fn(); } catch (err) {
            console.warn(`[SheetSyncDaemon] Write error: ${err.message}`);
        } finally {
            this.#busy = false;
            if (this.#pending.length) {
                this.#timer = setTimeout(() => this.#drain(), WRITE_THROTTLE_MS);
            }
        }
    }
}

// ── Daemon ────────────────────────────────────────────────────────────────────

export class SheetSyncDaemon {
    /**
     * @param {object} opts
     * @param {string}  opts.spreadsheetId  Google Sheets compiler board ID.
     * @param {string} [opts.stageDir]      Local stage manifest directory.
     */
    constructor({ spreadsheetId, stageDir }) {
        if (!spreadsheetId) {
            throw new Error(
                'SheetSyncDaemon requires spreadsheetId.\n' +
                'Set COMPILER_SHEET_ID env var.'
            );
        }
        this.spreadsheetId = spreadsheetId;
        this.stageDir = stageDir ?? path.join(process.cwd(), '.waymark', 'stage');

        this.#wq        = new WriteQueue();
        this.#rowCache  = new Map();   // jobId → 1-based row number
        this.#triggered = new Set();   // jobIds already sent to execute
        this.getToken   = this.#buildGetToken();
    }

    #wq;
    #rowCache;
    #triggered;
    /** @type {import('mqtt').MqttClient|null} */ #mqtt   = null;
    /** @type {ReturnType<typeof setInterval>|null} */ #poller = null;

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    async start() {
        console.log('[SheetSyncDaemon] Starting…');
        console.log(`  Sheet:     ${this.spreadsheetId}`);
        console.log(`  Stage dir: ${this.stageDir}`);

        await this.#ensureHeader().catch(e =>
            console.warn(`[SheetSyncDaemon] Header init: ${e.message}`)
        );
        await this.#refreshRowCache().catch(e =>
            console.warn(`[SheetSyncDaemon] Row cache init: ${e.message}`)
        );

        this.#connectMqtt();

        this.#poller = setInterval(() => {
            this.#pollApprovals().catch(e =>
                console.warn(`[SheetSyncDaemon] Poll error: ${e.message}`)
            );
        }, POLL_INTERVAL_MS);

        console.log('[SheetSyncDaemon] Ready — Waymark sheet is the command centre.');
    }

    async stop() {
        if (this.#poller) { clearInterval(this.#poller); this.#poller = null; }
        if (this.#mqtt) {
            await new Promise(r => this.#mqtt.end(false, {}, r));
            this.#mqtt = null;
        }
        console.log('[SheetSyncDaemon] Stopped.');
    }

    // ── MQTT ──────────────────────────────────────────────────────────────────

    #connectMqtt() {
        const client = mqtt.connect(BROKER_URL, {
            clientId: `waymark-sheet-sync-${process.pid}`,
            clean: true,
            connectTimeout: 8_000,
            reconnectPeriod: 5_000,
        });

        client.on('connect', () => {
            console.log('[SheetSyncDaemon] MQTT connected.');
            client.subscribe(MQTT_TOPIC, { qos: 1 }, err => {
                if (err) console.warn(`[SheetSyncDaemon] Subscribe error: ${err.message}`);
            });
        });

        client.on('message', (topic, msg) => {
            let payload;
            try { payload = JSON.parse(msg.toString()); } catch { return; }

            if (topic === 'waymark/compiler/stage/status') {
                this.#wq.enqueue(() => this.#onStageStatus(payload));
            } else if (topic === 'waymark/compiler/stage/execution') {
                this.#wq.enqueue(() => this.#onStageExecution(payload));
            }
        });

        client.on('error', err =>
            console.warn(`[SheetSyncDaemon] MQTT error: ${err.message}`)
        );

        this.#mqtt = client;
    }

    // ── MQTT event handlers ───────────────────────────────────────────────────

    /**
     * `waymark/compiler/stage/status` → AWAITING_QA row.
     *
     * Row:  A=jobId  B=targetFile  C=AWAITING_QA  D=''  E=criticalEdgeCases  F=FALSE
     */
    async #onStageStatus(p) {
        const { jobId, targetFile, criticalEdgeCases } = p;
        if (!jobId) return;

        const notes = (criticalEdgeCases ?? []).join(', ');
        const row   = [jobId, targetFile ?? '', STATUS.AWAITING_QA, '', notes, 'FALSE'];

        const token    = await this.getToken();
        const existing = this.#rowCache.get(jobId);

        if (existing) {
            await sheetsWrite(
                token, this.spreadsheetId,
                `Sheet1!A${existing}:F${existing}`,
                [row]
            );
        } else {
            const result = await sheetsAppend(token, this.spreadsheetId, SHEET_RANGE, [row]);
            const rowNum = this.#parseRow(result.updates?.updatedRange);
            if (rowNum) this.#rowCache.set(jobId, rowNum);
        }

        console.log(`[SheetSyncDaemon] ✅ Staged → sheet: ${jobId} (AWAITING_QA)`);
    }

    /**
     * `waymark/compiler/stage/execution` → live status update.
     *
     * Updates Col C (Agent Status) and Col D (Compiler Logs).
     */
    async #onStageExecution(p) {
        const { jobId, status, attempt, error, score } = p;
        if (!jobId) return;

        let rowNum = this.#rowCache.get(jobId);
        if (!rowNum) {
            await this.#refreshRowCache();
            rowNum = this.#rowCache.get(jobId);
        }
        if (!rowNum) {
            console.warn(`[SheetSyncDaemon] No sheet row for "${jobId}" — skipping execution update.`);
            return;
        }

        const token = await this.getToken();
        let statusText, logsText;

        if (status === 'COMPILING') {
            statusText = attempt != null
                ? `COMPILING (Attempt ${attempt})`
                : 'COMPILING';
            logsText   = '';

        } else if (status === 'RETRYING') {
            statusText = 'RETRYING';
            logsText   = String(error ?? '').slice(0, 400);

        } else if (status === 'SUCCESS') {
            statusText = STATUS.DONE_IN_REVIEW;
            logsText   = score != null ? `Score: ${score}/10` : '';
        } else {
            return;
        }

        // Write Status (C) + Logs (D) together — one API call.
        await sheetsWrite(
            token, this.spreadsheetId,
            `Sheet1!C${rowNum}:D${rowNum}`,
            [[statusText, logsText]]
        );

        const icons = { COMPILING: '🟡', RETRYING: '🟠', SUCCESS: '🟢' };
        console.log(`[SheetSyncDaemon] ${icons[status] ?? '•'} ${jobId} → ${statusText}`);
    }

    // ── Human approval poller (Reverse Gate) ──────────────────────────────────

    /**
     * Scan all rows with Agent Status = AWAITING_QA.
     * When Approval Toggle (F) = TRUE, write approved:true locally and execute.
     */
    async #pollApprovals() {
        const token = await this.getToken();
        const rows  = await sheetsValues(token, this.spreadsheetId, SHEET_RANGE);

        for (let i = 1; i < rows.length; i++) {          // row 0 = header
            const r        = rows[i] ?? [];
            const jobId    = (r[COL.JOB_ID]   ?? '').trim();
            const status   = (r[COL.STATUS]   ?? '').trim();
            const approved = (r[COL.APPROVED] ?? '').trim().toUpperCase();

            if (!jobId || status !== STATUS.AWAITING_QA || approved !== 'TRUE') continue;
            if (this.#triggered.has(jobId)) continue;

            this.#triggered.add(jobId);
            console.log(`[SheetSyncDaemon] 🚦 Human approved "${jobId}" — releasing compilation gate…`);

            const manifestPath = this.#findManifest(jobId);
            if (!manifestPath) {
                console.warn(`[SheetSyncDaemon] No manifest for "${jobId}" — cannot execute.`);
                continue;
            }

            try {
                this.#writeApproval(manifestPath);
            } catch (err) {
                console.error(`[SheetSyncDaemon] Manifest approval failed: ${err.message}`);
                continue;
            }

            // Execute is long-running — fire-and-forget, don't block the poll loop.
            this.#spawnExecute(manifestPath, jobId).catch(err =>
                console.error(`[SheetSyncDaemon] Execute error for "${jobId}": ${err.message}`)
            );
        }
    }

    // ── Local manifest helpers ────────────────────────────────────────────────

    /**
     * Locate the stage manifest for a given jobId.
     *
     * MqttReporter emits jobId as `${manifest.jobId}_${unitName}`.
     * Manifests are at `.waymark/stage/${manifest.jobId}.stage.json`.
     * We match when jobId equals OR starts with `${manifest.jobId}_`.
     */
    #findManifest(jobId) {
        let files;
        try { files = fs.readdirSync(this.stageDir); } catch { return null; }

        for (const f of files) {
            if (!f.endsWith('.stage.json')) continue;
            const p = path.join(this.stageDir, f);
            try {
                const m = JSON.parse(fs.readFileSync(p, 'utf-8'));
                if (jobId === m.jobId || jobId.startsWith(`${m.jobId}_`)) return p;
            } catch { /* skip malformed manifests */ }
        }
        return null;
    }

    /** Write `approved: true` into a stage manifest, idempotent. */
    #writeApproval(manifestPath) {
        const m = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
        if (m.approved) return;                     // already approved — nothing to do
        m.approved = true;
        fs.writeFileSync(manifestPath, JSON.stringify(m, null, 2), 'utf-8');
        console.log(`[SheetSyncDaemon] ✍️  approved:true → ${manifestPath}`);
    }

    /**
     * Spawn the execute command. stdout/stderr stream to the parent process so
     * MQTT execution events keep flowing and the sheet stays current.
     */
    async #spawnExecute(manifestPath, jobId) {
        const runScript = path.join(
            process.cwd(), 'src', 'compiler', 'decomposer', 'run.mjs'
        );
        console.log(`[SheetSyncDaemon] Spawning execute for "${jobId}"…`);

        try {
            const { stdout, stderr } = await execFileAsync(
                'node',
                [runScript, 'execute', manifestPath],
                { timeout: 600_000, maxBuffer: 10_485_760 }
            );
            if (stdout) process.stdout.write(stdout);
            if (stderr) process.stderr.write(stderr);
        } catch (err) {
            // Non-zero exit: the execute command already logged its failure.
            // The MQTT bridge will update the sheet row via emitExecutionUpdate().
            process.stderr.write(
                `[SheetSyncDaemon] execute exited non-zero for "${jobId}": ${err.message}\n`
            );
        }
    }

    // ── Sheet housekeeping ────────────────────────────────────────────────────

    async #ensureHeader() {
        const token = await this.getToken();
        const rows  = await sheetsValues(token, this.spreadsheetId, 'Sheet1!A1:F1');
        if (!rows.length || rows[0][0] !== HEADER[0]) {
            await sheetsWrite(token, this.spreadsheetId, 'Sheet1!A1:F1', [HEADER]);
            console.log('[SheetSyncDaemon] Header row written.');
        }
    }

    async #refreshRowCache() {
        const token = await this.getToken();
        const rows  = await sheetsValues(token, this.spreadsheetId, 'Sheet1!A:A');
        this.#rowCache.clear();
        for (let i = 1; i < rows.length; i++) {
            const jobId = rows[i]?.[0];
            if (jobId && jobId !== HEADER[0]) {
                this.#rowCache.set(jobId, i + 1);   // 1-based row number
            }
        }
    }

    // ── Auth ──────────────────────────────────────────────────────────────────

    /**
     * Build the getToken() function. Construction never throws — the error
     * surfaces on the first actual API call with a clear diagnostic.
     */
    #buildGetToken() {
        const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;

        if (!credPath) {
            return async () => { throw new Error(
                'GOOGLE_APPLICATION_CREDENTIALS env var is not set.\n' +
                'Point it to your service-account key JSON and restart the daemon.'
            ); };
        }

        let GoogleAuth;
        try { ({ GoogleAuth } = require('google-auth-library')); } catch {
            return async () => { throw new Error(
                'google-auth-library not found. Run: npm install google-auth-library'
            ); };
        }

        const auth = new GoogleAuth({
            keyFile: credPath,
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });

        return async function getToken() {
            const client = await auth.getClient();
            const { token } = await client.getAccessToken();
            return token;
        };
    }

    // ── Utility ───────────────────────────────────────────────────────────────

    /** Parse 1-based row number from a range string like "Sheet1!A42:F42". */
    #parseRow(range) {
        const m = /\$?[A-Z]+\$?(\d+)/.exec(range ?? '');
        return m ? parseInt(m[1], 10) : null;
    }
}

// ── CLI entry point ───────────────────────────────────────────────────────────

if (import.meta.url === `file://${process.argv[1]}`) {
    const spreadsheetId = process.env.COMPILER_SHEET_ID;
    if (!spreadsheetId) {
        process.stderr.write(
            'ERROR: COMPILER_SHEET_ID env var is required.\n\n' +
            'Usage:\n' +
            '  GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json \\\n' +
            '  COMPILER_SHEET_ID=1AbCdEfGhIjKlMnOpQrStUv \\\n' +
            '  node src/compiler/adapters/SheetSyncDaemon.mjs\n'
        );
        process.exit(1);
    }

    const daemon = new SheetSyncDaemon({
        spreadsheetId,
        stageDir: process.env.WAYMARK_STAGE_DIR,
    });

    process.on('SIGINT',  () => daemon.stop().then(() => process.exit(0)));
    process.on('SIGTERM', () => daemon.stop().then(() => process.exit(0)));

    daemon.start().catch(err => {
        process.stderr.write(`[SheetSyncDaemon] Fatal: ${err.message}\n`);
        process.exit(1);
    });
}
