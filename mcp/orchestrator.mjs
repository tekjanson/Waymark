#!/usr/bin/env node
/* ============================================================
   orchestrator.mjs — Deterministic Orchestrator MCP server

   Puts the orchestrator agent on rails. All polling, routing,
   and sleeping happens in CODE — the LLM only decides whether
   to call runSubagent with the result.

   Tools:
     orchestrator_boot   — Create log dir, return session ID
     orchestrator_cycle  — Sleep → poll workboard → route → return action
     orchestrator_log    — Append a message to the session log

   The routing table is a hard-coded keyword→agent lookup.
   No LLM is involved in routing decisions.
   ============================================================ */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
    ListToolsRequestSchema,
    CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync, appendFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS_DIR = path.join(__dirname, "..", "scripts");
const LOG_DIR = "/agent-logs";

/* ---------- Notification state ---------- */

let _notifRules = [];          // cached parsed rules
let _rulesSheetId = null;      // set by orchestrator_boot
let _rulesLastFetched = 0;     // epoch ms
const RULES_TTL_MS = 5 * 60 * 1000; // re-fetch every 5 min

/* ---------- Session state (automatic RETURNED detection) ---------- */
const _sessions = new Map(); // sessionId → { lastAction, lastAgentName }

/* ---------- Template registry (for sheetId-based detection) ---------- */

const REGISTRY = JSON.parse(
    readFileSync(path.join(__dirname, "../template-registry.json"), "utf8")
);

/* ---------- Keyword → agent routing table ---------- */
// Derived from waymark-router.agent.md §3 table. Pure lookup — no LLM.

const KEYWORD_ROUTES = [
    { keywords: ["trip", "vacation", "travel", "itinerary", "route", "hotel", "flight", "destination", "road trip"], agent: "waymark-travel" },
    { keywords: ["budget", "expenses", "spending", "income", "costs", "money", "finance", "invoice"], agent: "waymark-budget" },
    { keywords: ["recipe", "cooking", "ingredients", "servings", "cuisine"], agent: "waymark-recipe" },
    { keywords: ["meal plan", "meal prep", "weekly meals", "eating schedule"], agent: "waymark-meal" },
    { keywords: ["kanban", "board", "sprint", "backlog", "cards", "swim lanes"], agent: "waymark-kanban" },
    { keywords: ["crm", "leads", "pipeline", "deals", "customers", "sales contacts"], agent: "waymark-crm" },
    { keywords: ["contacts", "address book", "people", "phone book"], agent: "waymark-contacts" },
    { keywords: ["inventory", "stock", "assets", "warehouse"], agent: "waymark-inventory" },
    { keywords: ["tracker", "milestones", "progress bar", "goals progress"], agent: "waymark-tracker" },
    { keywords: ["schedule", "calendar", "appointments", "shifts", "time slots"], agent: "waymark-schedule" },
    { keywords: ["timesheet", "time tracking", "hours worked", "billing hours"], agent: "waymark-timesheet" },
    { keywords: ["activity log", "event log", "journal", "diary"], agent: "waymark-log" },
    { keywords: ["habits", "habit tracker", "daily routine", "streaks"], agent: "waymark-habit" },
    { keywords: ["poll", "survey", "vote", "questionnaire", "responses"], agent: "waymark-poll" },
    { keywords: ["changelog", "release notes", "version history"], agent: "waymark-changelog" },
    { keywords: ["gantt", "timeline", "project phases", "dependencies"], agent: "waymark-gantt" },
    { keywords: ["okr", "objectives", "key results", "goals", "targets"], agent: "waymark-okr" },
    { keywords: ["roster", "team members", "staff list", "employees", "crew"], agent: "waymark-roster" },
    { keywords: ["knowledge base", "faq", "documentation", "wiki", "articles"], agent: "waymark-knowledge" },
    { keywords: ["guide", "tutorial", "how-to", "step-by-step"], agent: "waymark-guide" },
    { keywords: ["flow diagram", "flowchart", "process map", "decision tree"], agent: "waymark-flow" },
    { keywords: ["automation", "triggers", "workflows"], agent: "waymark-automation" },
    { keywords: ["blog", "posts", "content calendar"], agent: "waymark-blog" },
    { keywords: ["social feed", "community", "shares"], agent: "waymark-social" },
    { keywords: ["marketing", "campaigns", "promotions"], agent: "waymark-marketing" },
    { keywords: ["notifications", "alerts", "announcements"], agent: "waymark-notification" },
    { keywords: ["arcade", "games", "social game", "score"], agent: "waymark-arcade" },
    { keywords: ["iot", "sensors", "readings", "telemetry", "device data"], agent: "waymark-iot" },
    { keywords: ["grading", "gradebook", "scores", "assignments", "students"], agent: "waymark-grading" },
    { keywords: ["passwords", "credentials", "logins", "vault"], agent: "waymark-passwords" },
    { keywords: ["photos", "gallery", "images", "album"], agent: "waymark-photos" },
    { keywords: ["community linker", "resource links", "curated links"], agent: "waymark-linker" },
    { keywords: ["test cases", "qa cases", "test plan", "acceptance criteria"], agent: "waymark-testcases" },
    { keywords: ["worker jobs", "tasks queue", "job management"], agent: "waymark-worker" },
    { keywords: ["checklist", "todo list", "to-do"], agent: "waymark-checklist" },
];

// Code-related keywords that indicate waymark-builder (codebase work, not content)
const CODE_KEYWORDS = [
    "fix", "bug", "implement", "refactor", "pr", "branch", "deploy", "test",
    "css", "javascript", "html", "api", "endpoint", "component", "function",
    "module", "script", "database", "e2e", "playwright", "server", "frontend",
    "backend", "node", "express", "docker", "ci", "lint", "typescript",
];

// templateKey → agent name
const TEMPLATE_KEY_TO_AGENT = {
    kanban: "waymark-kanban", budget: "waymark-budget", checklist: "waymark-checklist",
    recipe: "waymark-recipe", travel: "waymark-travel", crm: "waymark-crm",
    contacts: "waymark-contacts", inventory: "waymark-inventory", tracker: "waymark-tracker",
    schedule: "waymark-schedule", timesheet: "waymark-timesheet", log: "waymark-log",
    habit: "waymark-habit", poll: "waymark-poll", changelog: "waymark-changelog",
    gantt: "waymark-gantt", okr: "waymark-okr", roster: "waymark-roster",
    meal: "waymark-meal", knowledge: "waymark-knowledge", guide: "waymark-guide",
    flow: "waymark-flow", automation: "waymark-automation", blog: "waymark-blog",
    social: "waymark-social", marketing: "waymark-marketing", notification: "waymark-notification",
    arcade: "waymark-arcade", iot: "waymark-iot", grading: "waymark-grading",
    passwords: "waymark-passwords", photos: "waymark-photos", linker: "waymark-linker",
    testcases: "waymark-testcases", worker: "waymark-worker",
};

/* ---------- Google Sheets API (for template detection from sheetId) ---------- */

import { GoogleAuth } from "google-auth-library";

const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
let sheetsAuth = null;
if (credPath) {
    sheetsAuth = new GoogleAuth({
        keyFile: credPath,
        scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    });
}

const SHEETS_BASE = "https://sheets.googleapis.com/v4/spreadsheets";

async function getSheetHeaders(spreadsheetId) {
    if (!sheetsAuth) return null;
    try {
        const client = await sheetsAuth.getClient();
        const { token } = await client.getAccessToken();
        // Get first sheet title
        const metaRes = await fetch(
            `${SHEETS_BASE}/${spreadsheetId}?fields=sheets.properties`,
            { headers: { Authorization: `Bearer ${token}` } }
        );
        if (!metaRes.ok) return null;
        const meta = await metaRes.json();
        const title = meta.sheets?.[0]?.properties?.title || "Sheet1";
        // Get first row (headers)
        const valRes = await fetch(
            `${SHEETS_BASE}/${spreadsheetId}/values/${encodeURIComponent(title + "!A1:ZZ1")}`,
            { headers: { Authorization: `Bearer ${token}` } }
        );
        if (!valRes.ok) return null;
        const data = await valRes.json();
        return data.values?.[0] || null;
    } catch {
        return null;
    }
}

function detectTemplate(headers) {
    const lower = headers.map(h => h.toLowerCase().trim());
    const joined = lower.join(" ");
    let best = { templateKey: "checklist", score: 0 };
    for (const tmpl of REGISTRY.templates) {
        const signals = tmpl.detectSignals || [];
        let score = 0;
        for (const sig of signals) {
            const pattern = new RegExp(sig, "i");
            if (lower.some(h => pattern.test(h)) || pattern.test(joined)) score++;
        }
        const total = score + (tmpl.priority || 10) / 1000;
        if (total > best.score) {
            best = { templateKey: tmpl.key, score: total };
        }
    }
    return best;
}

/* ---------- Routing logic ---------- */

/**
 * Route a task to the correct agent. Pure deterministic logic.
 * @param {{ task: string, desc: string, sheetId?: string }} task
 * @returns {Promise<{ agent: string, method: string }>}
 */
// Known agent names — any label or assignee exactly matching one routes directly to it.
const KNOWN_AGENTS = new Set([
    "waymark-builder", "waymark-travel", "waymark-budget", "waymark-recipe",
    "waymark-meal", "waymark-kanban", "waymark-crm", "waymark-contacts",
    "waymark-inventory", "waymark-tracker", "waymark-schedule", "waymark-timesheet",
    "waymark-log", "waymark-habit", "waymark-poll", "waymark-changelog",
    "waymark-gantt", "waymark-okr", "waymark-roster", "waymark-knowledge",
    "waymark-guide", "waymark-flow", "waymark-automation", "waymark-blog",
    "waymark-social", "waymark-marketing", "waymark-notification", "waymark-arcade",
    "waymark-iot", "waymark-grading", "waymark-passwords", "waymark-photos",
    "waymark-linker", "waymark-testcases", "waymark-worker", "waymark-checklist",
]);

// Labels that always mean "this is a codebase task → waymark-builder"
const BUILDER_LABELS = new Set([
    "feature", "bug", "fix", "refactor", "chore", "infra", "test", "docs",
    "enhancement", "improvement", "architecture",
]);

async function routeTask(task) {
    const text = `${task.task} ${task.desc || ""}`.toLowerCase();
    const label    = (task.label    || "").trim().toLowerCase();
    const assignee = (task.assignee || "").trim().toLowerCase();

    // Step 0a: Explicit agent assignee → routes directly to that agent
    if (assignee && KNOWN_AGENTS.has(assignee)) {
        return { agent: assignee, method: "assignee" };
    }

    // Step 0b: Label is an exact agent name → route to that agent
    if (label && KNOWN_AGENTS.has(label)) {
        return { agent: label, method: "label-agent" };
    }

    // Step 0c: Label marks this as a builder (codebase) task → waymark-builder wins
    //          This fires BEFORE keyword matching so "feature" tasks with travel keywords
    //          (e.g. "update the itinerary template") go to the builder, not waymark-travel.
    if (label && BUILDER_LABELS.has(label)) {
        return { agent: "waymark-builder", method: "label-feature" };
    }

    // Step A: If sheetId present, detect template
    if (task.sheetId) {
        const headers = await getSheetHeaders(task.sheetId);
        if (headers) {
            const detection = detectTemplate(headers);
            const agent = TEMPLATE_KEY_TO_AGENT[detection.templateKey];
            if (agent) return { agent, method: "sheetId-detection" };
        }
    }

    // Step B: Keyword match on task text
    let bestMatch = null;
    let bestScore = 0;
    for (const route of KEYWORD_ROUTES) {
        let score = 0;
        for (const kw of route.keywords) {
            if (text.includes(kw.toLowerCase())) score++;
        }
        if (score > bestScore) {
            bestScore = score;
            bestMatch = route;
        }
    }
    if (bestMatch && bestScore > 0) {
        return { agent: bestMatch.agent, method: "keyword-match" };
    }

    // Step C: Is this a code task?
    const codeScore = CODE_KEYWORDS.filter(kw => text.includes(kw)).length;
    if (codeScore >= 2) {
        return { agent: "waymark-builder", method: "code-task" };
    }

    // Step D: Fallback
    return { agent: "waymark-builder", method: "fallback" };
}

/**
 * Build the prompt to pass to the dispatched agent.
 */
function buildPrompt(task, routeResult) {
    const parts = [];
    if (task.sheetId) parts.push(`Spreadsheet: ${task.sheetId}`);
    parts.push(`Task row: ${task.row}`);
    parts.push(`Task: ${task.task}`);
    if (task.desc) parts.push(`Details: ${task.desc}`);
    if (task.notes?.length) {
        const noteText = task.notes.map(n => `[${n.author}] ${n.text}`).join("; ");
        parts.push(`Notes: ${noteText}`);
    }
    if (!task.sheetId && routeResult.agent !== "waymark-builder") {
        const key = Object.entries(TEMPLATE_KEY_TO_AGENT).find(([, v]) => v === routeResult.agent)?.[0];
        if (key) {
            parts.push(`Note: No spreadsheet ID was found in the task. Create a new ${key} sheet, populate it with the requested content, and mark the workboard row QA.`);
        }
    }
    return parts.join(" | ");
}

/* ---------- Notification rules — fetch & cache ---------- */

/**
 * Read the rules sheet and parse into rule objects.
 * Sheet format (row 1 = headers, any casing):
 *   Event | Condition | Title | Body | Priority | Enabled
 * Event values: DISPATCH, RETURNED, BLOCKED, POLL_FAILED, WAKE, IDLE, WAIT, * (wildcard)
 * Condition values: "always" or empty (always fires), or "key=value" against the event context.
 * Priority values: low, normal, high, urgent
 * Enabled: yes/no/true/false/1/0 (default yes if empty)
 */
async function fetchRulesSheet(sheetId) {
    if (!sheetsAuth || !sheetId) return;
    try {
        const client = await sheetsAuth.getClient();
        const { token } = await client.getAccessToken();
        const metaRes = await fetch(
            `${SHEETS_BASE}/${sheetId}?fields=sheets.properties`,
            { headers: { Authorization: `Bearer ${token}` } }
        );
        if (!metaRes.ok) throw new Error(`meta ${metaRes.status}`);
        const meta = await metaRes.json();
        const title = meta.sheets?.[0]?.properties?.title || "Sheet1";
        const valRes = await fetch(
            `${SHEETS_BASE}/${sheetId}/values/${encodeURIComponent(title + "!A1:F500")}`,
            { headers: { Authorization: `Bearer ${token}` } }
        );
        if (!valRes.ok) throw new Error(`values ${valRes.status}`);
        const data = await valRes.json();
        const rows = data.values || [];
        if (rows.length < 2) { _notifRules = []; return; }

        // Resolve column indices from header row (case-insensitive)
        const headers = rows[0].map(h => h.toLowerCase().trim());
        const col = (name) => headers.indexOf(name);
        const iEvent     = col("event");
        const iCondition = col("condition");
        const iTitle     = col("title");
        const iBody      = col("body");
        const iPriority  = col("priority");
        const iEnabled   = col("enabled");
        if (iEvent === -1) {
            process.stderr.write("orchestrator: rules sheet missing 'Event' column — skipping\n");
            return;
        }

        _notifRules = rows.slice(1)
            .filter(r => r[iEvent]?.trim())
            .map(r => ({
                event:     (r[iEvent]     || "").trim().toUpperCase(),
                condition: (r[iCondition] || "always").trim().toLowerCase(),
                title:     (r[iTitle]     || "").trim(),
                body:      (r[iBody]      || "").trim(),
                priority:  (r[iPriority]  || "normal").trim().toLowerCase(),
                enabled:   !["no", "false", "0"].includes((r[iEnabled] || "yes").trim().toLowerCase()),
            }));
        _rulesLastFetched = Date.now();
        process.stderr.write(`orchestrator: loaded ${_notifRules.length} notification rules from sheet\n`);
    } catch (err) {
        process.stderr.write(`orchestrator: failed to fetch rules sheet: ${err.message}\n`);
    }
}

async function refreshRulesIfStale() {
    if (!_rulesSheetId) return;
    if (Date.now() - _rulesLastFetched >= RULES_TTL_MS) {
        await fetchRulesSheet(_rulesSheetId);
    }
}

/* ---------- Condition evaluation (no eval — key=value only) ---------- */
// Supported formats:
//   (empty)   → always fire
//   "always"  → always fire
//   "key=value" → context[key] === value (string comparison)
//   "key!=value" → context[key] !== value
function matchesCondition(condition, ctx) {
    if (!condition || condition === "always") return true;
    const neq = condition.match(/^(\w+)!=(.+)$/);
    if (neq) return String(ctx[neq[1]] ?? "") !== neq[2].trim();
    const eq  = condition.match(/^(\w+)=(.+)$/);
    if (eq)  return String(ctx[eq[1]]  ?? "") === eq[2].trim();
    return true; // unknown format → fire
}

/* ---------- Template interpolation: {variable} ---------- */
function interpolate(template, ctx) {
    return template.replace(/\{(\w+)\}/g, (_, k) => ctx[k] ?? "");
}

/* ---------- Send notification via ntfy / Pushover ---------- */

async function sendNotification(title, body, priority) {
    const ntfyTopic = process.env.NTFY_TOPIC;
    if (ntfyTopic) {
        const ntfyPri = { low: "low", normal: "default", high: "high", urgent: "urgent" }[priority] || "default";
        try {
            await fetch(ntfyTopic, {
                method: "POST",
                headers: {
                    "Title": title,
                    "Priority": ntfyPri,
                    "Content-Type": "text/plain",
                },
                body: body || title,
            });
        } catch (err) {
            process.stderr.write(`orchestrator: ntfy send failed: ${err.message}\n`);
        }
    }

    const pushToken = process.env.PUSHOVER_TOKEN;
    const pushUser  = process.env.PUSHOVER_USER;
    if (pushToken && pushUser) {
        const priMap = { low: -1, normal: 0, high: 1, urgent: 2 };
        try {
            await fetch("https://api.pushover.net/1/messages.json", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    token: pushToken,
                    user:  pushUser,
                    title,
                    message: body || title,
                    priority: priMap[priority] ?? 0,
                }),
            });
        } catch (err) {
            process.stderr.write(`orchestrator: pushover send failed: ${err.message}\n`);
        }
    }
}

/**
 * Check rules for a given event and fire matching notifications.
 * @param {string} event  - uppercase event name e.g. "DISPATCH"
 * @param {object} ctx    - context variables for condition matching and template interpolation
 */
async function fireNotifications(event, ctx) {
    if (!_notifRules.length) return;
    const matching = _notifRules.filter(r =>
        r.enabled &&
        (r.event === event || r.event === "*") &&
        matchesCondition(r.condition, ctx)
    );
    for (const rule of matching) {
        const title = interpolate(rule.title || event, ctx);
        const body  = interpolate(rule.body, ctx);
        await sendNotification(title, body, rule.priority);
    }
}

/* ---------- check-workboard.js runner ---------- */

function runCheckWorkboard() {
    return new Promise((resolve, reject) => {
        const env = { ...process.env };
        if (credPath) env.GOOGLE_APPLICATION_CREDENTIALS = credPath;
        execFile("node", [path.join(SCRIPTS_DIR, "check-workboard.js")], { env, timeout: 30000 }, (err, stdout, stderr) => {
            if (err) return reject(new Error(stderr || err.message));
            try {
                resolve(JSON.parse(stdout.trim()));
            } catch {
                reject(new Error(`Invalid JSON from check-workboard: ${stdout.slice(0, 200)}`));
            }
        });
    });
}

/* ---------- update-workboard.js runner — claim task In Progress ---------- */

function claimTask(row, agentName) {
    return new Promise((resolve) => {
        const env = { ...process.env };
        if (credPath) env.GOOGLE_APPLICATION_CREDENTIALS = credPath;
        execFile(
            "node",
            [path.join(SCRIPTS_DIR, "update-workboard.js"), "claim", String(row), "--agent", agentName],
            { env, timeout: 15000 },
            (err, stdout, stderr) => {
                if (err) {
                    process.stderr.write(`orchestrator: claim failed for row ${row}: ${stderr || err.message}\n`);
                }
                resolve(); // non-fatal — proceed with dispatch even if claim fails
            }
        );
    });
}

/* ---------- Interruptible sleep + HTTP wake endpoint ---------- */

const WAKE_PORT = parseInt(process.env.ORCHESTRATOR_WAKE_PORT || "9111", 10);
let _wakeResolve = null; // resolve fn for the currently-sleeping promise

/**
 * Sleep for `ms` milliseconds OR until POST /wake is received.
 * Returns { interrupted: boolean, reason?: string }.
 */
function sleep(ms) {
    return new Promise(resolve => {
        const timer = setTimeout(() => {
            _wakeResolve = null;
            resolve({ interrupted: false });
        }, ms);
        _wakeResolve = (reason) => {
            clearTimeout(timer);
            _wakeResolve = null;
            resolve({ interrupted: true, reason });
        };
    });
}

// Tiny HTTP server: POST /wake → interrupt the current sleep
const wakeServer = createServer((req, res) => {
    // Only allow POST /wake
    if (req.method === "POST" && req.url === "/wake") {
        let body = "";
        req.on("data", chunk => { body += chunk; });
        req.on("end", () => {
            const reason = body.trim() || "external interrupt";
            if (_wakeResolve) {
                _wakeResolve(reason);
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: true, status: "woke" }));
            } else {
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: true, status: "not-sleeping" }));
            }
        });
    } else if (req.method === "GET" && req.url === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, sleeping: !!_wakeResolve }));
    } else {
        res.writeHead(404);
        res.end();
    }
});
wakeServer.listen(WAKE_PORT, "0.0.0.0", () => {
    process.stderr.write(`orchestrator: wake endpoint listening on :${WAKE_PORT}\n`);
});

/* ---------- ISO timestamp ---------- */

function iso() {
    return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

/* ---------- MCP Server ---------- */

const server = new Server(
    { name: "orchestrator", version: "1.0.0" },
    { capabilities: { tools: {} } }
);

const TOOLS = [
    {
        name: "orchestrator_boot",
        description: "Initialize the orchestrator session. Creates the log directory and returns a session ID and log path. Call this ONCE at the start. Pass rulesSheetId to enable phone notifications.",
        inputSchema: {
            type: "object",
            properties: {
                rulesSheetId: {
                    type: "string",
                    description: "Optional Google Sheets ID of a notification rules sheet. Columns: Event, Condition, Title, Body, Priority, Enabled. Omit to disable notifications.",
                },
            },
        },
    },
    {
        name: "orchestrator_cycle",
        description: "Run one orchestrator cycle: sleep → poll workboard → route task → return action. The sleep blocks for the specified duration. Returns a JSON action the agent MUST act on. If action is DISPATCH, the agent MUST call runSubagent with the returned agentName and prompt.",
        inputSchema: {
            type: "object",
            properties: {
                sessionId: {
                    type: "string",
                    description: "The session ID from orchestrator_boot.",
                },
                sleepSeconds: {
                    type: "number",
                    description: "Seconds to sleep before polling. Use 5 for the first cycle, 60 for subsequent cycles.",
                },
            },
            required: ["sessionId", "sleepSeconds"],
        },
    },

];

server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    if (name === "orchestrator_boot") {
        mkdirSync(LOG_DIR, { recursive: true });
        const ts = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
        const sessionId = `session-${ts}`;
        const logPath = `${LOG_DIR}/${sessionId}.log`;
        // Load notification rules if a sheet was provided
        if (args.rulesSheetId) {
            _rulesSheetId = args.rulesSheetId;
            _rulesLastFetched = 0;
            await fetchRulesSheet(_rulesSheetId);
        }
        appendFileSync(logPath, `[${iso()}] ORCHESTRATOR STARTED${args.rulesSheetId ? ` (rules: ${args.rulesSheetId})` : ""}\n`);
        _sessions.set(sessionId, { lastAction: null, lastAgentName: null });
        return {
            content: [{ type: "text", text: JSON.stringify({ sessionId, logPath, rulesLoaded: _notifRules.length }) }],
        };
    }

    if (name === "orchestrator_cycle") {
        const logPath = `${LOG_DIR}/${args.sessionId}.log`;
        const sleepMs = (args.sleepSeconds || 60) * 1000;

        // Automatically detect RETURNED: if previous cycle dispatched an agent,
        // calling cycle again means the agent returned from runSubagent.
        const sess = _sessions.get(args.sessionId) || {};
        if (sess.lastAction === "DISPATCH" && sess.lastAgentName) {
            appendFileSync(logPath, `[${iso()}] RETURNED: ${sess.lastAgentName}\n`);
            await fireNotifications("RETURNED", {
                agentName: sess.lastAgentName,
                sessionId: args.sessionId,
            });
            _sessions.set(args.sessionId, { lastAction: "RETURNED", lastAgentName: null });
        }

        // Refresh notification rules if stale
        await refreshRulesIfStale();

        // Step 1: Sleep (interruptible via POST :9111/wake)
        const sleepResult = await sleep(sleepMs);
        if (sleepResult.interrupted) {
            appendFileSync(logPath, `[${iso()}] WAKE: interrupted — ${sleepResult.reason}\n`);
            await fireNotifications("WAKE", { reason: sleepResult.reason, sessionId: args.sessionId });
        }

        // Step 2: Poll workboard
        let board;
        try {
            board = await runCheckWorkboard();
        } catch (err) {
            const msg = `POLL_FAILED: ${err.message}`;
            appendFileSync(logPath, `[${iso()}] ${msg}\n`);
            await fireNotifications("POLL_FAILED", { reason: err.message, sessionId: args.sessionId });
            return {
                content: [{ type: "text", text: JSON.stringify({ action: "POLL_FAILED", reason: err.message }) }],
            };
        }
        appendFileSync(logPath, `[${iso()}] POLL: ${JSON.stringify(board)}\n`);

        // Step 3: Route
        // Check inProgress first
        if (board.inProgress && board.inProgress.length > 0) {
            const titles = board.inProgress.map(t => t.task).join(", ");
            const reason = `inProgress has ${board.inProgress.length} task(s) — "${titles}"`;
            appendFileSync(logPath, `[${iso()}] WAIT: ${reason}\n`);
            await fireNotifications("WAIT", { reason, sessionId: args.sessionId });
            return {
                content: [{ type: "text", text: JSON.stringify({ action: "WAIT", reason }) }],
            };
        }

        // Check todo
        if (board.todo && board.todo.length > 0) {
            const task = board.todo[0]; // Already sorted by priority from check-workboard.js

            // Check for BLOCKED
            if (task.notes?.some(n => n.text.includes("BLOCKED"))) {
                const reason = `${task.task} — task has BLOCKED note`;
                appendFileSync(logPath, `[${iso()}] BLOCKED: ${reason}\n`);
                await fireNotifications("BLOCKED", { task: task.task, reason, sessionId: args.sessionId });
                return {
                    content: [{ type: "text", text: JSON.stringify({ action: "BLOCKED", reason, task: task.task }) }],
                };
            }

            // Route deterministically
            const routeResult = await routeTask(task);
            const prompt = buildPrompt(task, routeResult);

            appendFileSync(logPath, `[${iso()}] ROUTE: ${routeResult.agent} (${routeResult.method}) | ${task.task}\n`);
            await fireNotifications("DISPATCH", {
                agentName: routeResult.agent,
                taskTitle: task.task,
                routeMethod: routeResult.method,
                sessionId: args.sessionId,
            });
            // Claim "In Progress" on the workboard BEFORE returning — prevents re-dispatch
            await claimTask(task.row, routeResult.agent);
            appendFileSync(logPath, `[${iso()}] CLAIMED: row ${task.row} → In Progress (${routeResult.agent})\n`);
            _sessions.set(args.sessionId, { lastAction: "DISPATCH", lastAgentName: routeResult.agent });

            return {
                content: [{
                    type: "text",
                    text: JSON.stringify({
                        action: "DISPATCH",
                        agentName: routeResult.agent,
                        prompt,
                        taskTitle: task.task,
                        routeMethod: routeResult.method,
                    }),
                }],
            };
        }

        // Board is clear
        const reason = `board is clear — todo=0, qa=0`;
        appendFileSync(logPath, `[${iso()}] IDLE: ${reason}\n`);
        return {
            content: [{ type: "text", text: JSON.stringify({ action: "IDLE", reason }) }],
        };
    }

    throw new Error(`Unknown tool: ${name}`);
});

/* ---------- Start ---------- */

const transport = new StdioServerTransport();
await server.connect(transport);
