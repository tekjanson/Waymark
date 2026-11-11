#!/usr/bin/env node
/* ============================================================
   agy-agent-runner.mjs — Headless AGY CLI execution bridge
   Targeted at Gemini 3.8 Flash (gemini-3.8-flash-high).

   Runs Waymark tasks through the `agy` CLI using progressive
   disclosure skills and MCP tools (waymark, google-sheets).
   ============================================================ */

import { execFile, spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, realpathSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

/* ---------- Diagnostics ---------- */

const AGY_LOG_DIR = process.env.WAYMARK_AGENT_LOG_DIR || path.join(ROOT, 'agent-logs', 'agy-tasks');

/** Read the Google identity (account email) a token file represents. */
function identityForToken(tokenPath) {
  try {
    if (tokenPath && existsSync(tokenPath)) {
      const tok = JSON.parse(readFileSync(tokenPath, 'utf8'));
      return String(tok.account_email || tok.email || '').trim().toLowerCase();
    }
  } catch { /* ignore */ }
  return '';
}

export { identityForToken };

/**
 * Canonical on-disk path for a collaborator's per-account OAuth token.
 *
 * THE single source of truth for this filename. Every writer and reader of a
 * per-account token MUST route through here — a divergent normalization scheme
 * is exactly what caused the agent to "lose" a requester's token and silently
 * fall back to the host account, creating Waymarks in the wrong Drive.
 *
 * Normalization: lowercase, then replace any char outside [a-z0-9@._-] with '_'
 * (so '@' and '.' are preserved — matching legacy files for ordinary emails —
 * while '+' and other separators map deterministically on both sides).
 * @param {string} email — the requester's email address
 * @param {string} gcloudDir — directory holding the token files
 * @returns {string} absolute token path, or '' when `email` is not an address
 */
export function perAccountTokenPath(email, gcloudDir) {
  const clean = String(email || '').trim().toLowerCase();
  if (!clean.includes('@')) return '';
  const safe = clean.replace(/[^a-z0-9@._-]/g, '_');
  return path.join(gcloudDir, `waymark-oauth-token-${safe}.json`);
}

/** Persist a full diagnostic record of one agy task (success or failure). */
function writeTaskLog(record) {
  try {
    mkdirSync(AGY_LOG_DIR, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const file = path.join(AGY_LOG_DIR, `agy-${ts}.log`);
    const body = [
      `=== AGY TASK ${record.outcome} @ ${new Date().toISOString()} ===`,
      `requester/actingAs : ${record.actingAs || 'UNKNOWN'}`,
      `tokenPath          : ${record.tokenPath || 'none'}`,
      `model              : ${record.model || ''}`,
      `durationMs         : ${record.durationMs ?? ''}`,
      `error              : ${record.error || ''}`,
      `--- prompt ---`,
      String(record.prompt || '').slice(0, 4000),
      `--- stdout ---`,
      String(record.stdout || ''),
      `--- stderr ---`,
      String(record.stderr || ''),
      '',
    ].join('\n');
    writeFileSync(file, body, { mode: 0o600 });
    return file;
  } catch {
    return '';
  }
}

/** Last N non-empty lines of a stream — for surfacing a real reason to the user. */
function tailLines(text, n = 8) {
  return String(text || '')
    .split('\n')
    .map(l => l.trimEnd())
    .filter(Boolean)
    .slice(-n)
    .join('\n');
}

const DEFAULT_MODEL = process.env.AGY_MODEL || 'gemini-3.8-flash-high';
const DEFAULT_TIMEOUT_MS = parseInt(process.env.AGY_TIMEOUT_MS || '180000', 10);
const DEFAULT_CODE_TIMEOUT_MS = parseInt(process.env.WAYMARK_AGY_CODE_TIMEOUT_MS || '2700000', 10); // 45 minutes

/**
 * Resolve the `agy` CLI binary across Linux, macOS, and Windows.
 * Prefers native `agy` / `agy.exe` over `.cmd` wrappers so `execFile` runs with `shell: false`.
 * @param {string} [platform]
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{ bin: string, useShell: boolean }}
 */
export function resolveAgyBinary(platform = process.platform, env = process.env) {
  if (env.AGY_BIN) {
    const isCmd = /\.(cmd|bat)$/i.test(env.AGY_BIN);
    return { bin: env.AGY_BIN, useShell: platform === 'win32' && isCmd };
  }

  const isWin = platform === 'win32';
  const sep = isWin ? ';' : ':';
  const home = env.USERPROFILE || env.HOME || os.homedir();
  const pathDirs = (env.PATH || env.Path || '').split(sep).filter(Boolean);

  if (isWin) {
    const winExtra = [
      path.win32.join(home, '.local', 'bin'),
      env.LOCALAPPDATA ? path.win32.join(env.LOCALAPPDATA, 'Programs', 'antigravity') : '',
      env.LOCALAPPDATA ? path.win32.join(env.LOCALAPPDATA, 'antigravity', 'bin') : '',
      env.LOCALAPPDATA ? path.win32.join(env.LOCALAPPDATA, 'antigravity') : '',
      env.APPDATA ? path.win32.join(env.APPDATA, 'npm') : '',
    ].filter(Boolean);
    const searchDirs = [...pathDirs, ...winExtra];
    for (const dir of searchDirs) {
      const exeCandidate = path.join(dir, 'agy.exe');
      if (existsSync(exeCandidate)) return { bin: exeCandidate, useShell: false };
    }
    for (const dir of searchDirs) {
      for (const ext of ['agy.cmd', 'agy.bat']) {
        const cmdCandidate = path.join(dir, ext);
        if (existsSync(cmdCandidate)) return { bin: cmdCandidate, useShell: true };
      }
    }
    return { bin: 'agy.exe', useShell: false };
  }

  const posixExtra = [
    path.join(home, '.local', 'bin'),
    '/usr/local/bin',
    '/opt/homebrew/bin',
  ];
  for (const dir of [...pathDirs, ...posixExtra]) {
    const candidate = path.join(dir, 'agy');
    if (existsSync(candidate)) return { bin: candidate, useShell: false };
  }
  return { bin: 'agy', useShell: false };
}

/**
 * Extract Google Spreadsheet IDs from text.
 * @param {string} text
 * @returns {string|null}
 */
export function extractSpreadsheetId(text) {
  if (!text) return null;
  // Match standard sheets/d/ID or #/sheet/ID
  const urlMatch = text.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]{25,})/);
  if (urlMatch) return urlMatch[1];
  const hashMatch = text.match(/#\/(?:sheet|public)\/([a-zA-Z0-9_-]{25,})/);
  if (hashMatch) return hashMatch[1];
  // Match json property "spreadsheetId": "..."
  const jsonMatch = text.match(/"spreadsheetId":\s*"([a-zA-Z0-9_-]{25,})"/);
  if (jsonMatch) return jsonMatch[1];
  return null;
}

/**
 * Extract Google Doc IDs from text.
 * @param {string} text
 * @returns {string|null}
 */
export function extractDocId(text) {
  if (!text) return null;
  const docMatch = text.match(/\/document\/d\/([a-zA-Z0-9_-]{25,})/);
  if (docMatch) return docMatch[1];
  const jsonMatch = text.match(/"documentId":\s*"([a-zA-Z0-9_-]{25,})"/);
  if (jsonMatch) return jsonMatch[1];
  return null;
}

/**
 * Extract all created/modified file references and optional titles from text.
 * @param {string} text
 * @returns {{ sheetId: string|null, docId: string|null, sheetTitle: string|null, docTitle: string|null }}
 */
export function extractFileReferences(text) {
  const sheetId = extractSpreadsheetId(text);
  const docId = extractDocId(text);
  let sheetTitle = null;
  let docTitle = null;

  if (text) {
    const mdSheet = text.match(/\[([^\]]+)\]\((?:#\/(?:sheet|public)\/|https?:\/\/[^\s)]*\/spreadsheets\/d\/)[a-zA-Z0-9_-]{25,}/);
    if (mdSheet && mdSheet[1]) sheetTitle = mdSheet[1].trim();

    const mdDoc = text.match(/\[([^\]]+)\]\(https?:\/\/[^\s)]*\/document\/d\/[a-zA-Z0-9_-]{25,}/);
    if (mdDoc && mdDoc[1]) docTitle = mdDoc[1].trim();

    if (!sheetTitle && !docTitle) {
      const jsonTitle = text.match(/"title":\s*"([^"]+)"/);
      if (jsonTitle && jsonTitle[1]) {
        if (sheetId) sheetTitle = jsonTitle[1].trim();
        if (docId) docTitle = jsonTitle[1].trim();
      }
    }
  }

  return {
    sheetId,
    docId,
    sheetTitle,
    docTitle,
  };
}

/**
 * Extract GitHub Pull Request URL and branch references from text.
 * @param {string} text
 * @returns {{ prUrl: string|null, prNumber: string|null, branch: string|null }}
 */
export function extractPrReferences(text) {
  if (!text) return { prUrl: null, prNumber: null, branch: null };
  const prMatch = text.match(/https:\/\/github\.com\/[^\s)]+\/pull\/(\d+)/i);
  const branchMatch = text.match(/\b(?:branch|checkout -b)\s+([a-zA-Z0-9_\-\.\/]+)/i);
  return {
    prUrl: prMatch ? prMatch[0] : null,
    prNumber: prMatch ? prMatch[1] : null,
    branch: branchMatch ? branchMatch[1] : null,
  };
}

/**
 * Build the prompt delivered to agy.
 */
export function buildAgyPrompt({ task, templateKey, sheetId, context = '', shareWith = [], isCodeTask = false }) {
  const parts = [];
  const validShareWith = (Array.isArray(shareWith) ? shareWith : [])
    .map(e => String(e || '').trim().toLowerCase())
    .filter(e => e && e.includes('@') && !e.endsWith('.internal') && !e.endsWith('.local'));

  const detectedCodeTask = Boolean(isCodeTask) ||
    /\b(pull\s*request|pr)\b/i.test(task) ||
    /\b(branch|checkout|commit|merge\s*request)\b/i.test(task) ||
    /\b(in\s+the\s+(?:waymark\s+)?repo|codebase|repository|waymark\s+branch)\b/i.test(task) ||
    /\b(put\s+up\s+(?:a\s+)?(?:new\s+)?(?:waymark\s+)?branch|put\s+up\s+for\s+pr|make\s+(?:a\s+)?pr)\b/i.test(task);

  if (detectedCodeTask) {
    parts.push(`You are Waymark AI, an autonomous software engineer running directly on bare metal on the Waymark repository at '${ROOT}'.`);
    parts.push(`You have full execution and tool access on this machine (file reading/writing, terminal commands, git, gh CLI, npm, node).`);

    if (context) {
      parts.push(`Conversation context:\n${context}`);
    }

    parts.push(`\nUser Request: ${task}`);
    parts.push(`\nEngineering Instructions:
1. Scope Discipline & Anti-Rabbit Hole Rules:
   - Stay strictly focused on the user's specific request and minimum necessary files.
   - Do NOT run full-repo test suites (e.g. \`npx playwright test\` or whole-repo audits) — doing so encounters unrelated pre-existing test failures and stalls execution.
   - Do NOT investigate, fix, or debug pre-existing failures or warnings in unrelated modules.
   - Only perform fast syntax checks (e.g. \`node --check <file>\`) or run a targeted test that directly tests the code you modified.
   - If you encounter an unrelated test failure or warning, ignore it and do NOT let it block you. Note it in the PR description under 'Notes' if relevant.
   - As soon as your edits are complete and pass syntax checks, proceed directly to commit, push, and open the PR.
2. Branch & Implement:
   - Check out a new descriptive feature branch: \`git checkout -b <branch-name>\` (e.g. \`feature/<descriptive-name>\`).
   - Implement the requested changes directly in the relevant files.
   - Stage and commit changes promptly: \`git commit -am "<descriptive message>"\`.
3. Push & Create Pull Request:
   - Push the branch to GitHub: \`git push -u origin <branch-name>\`.
   - Open a Pull Request non-interactively using GitHub CLI:
     \`gh pr create --base main --head <branch-name> --title "<Clear Title>" --body "<Detailed description of changes>"\`
   - CRITICAL: Never merge the PR; only create it and submit it for review.
4. Summary:
   - In your final response, provide:
     - Branch name: \`<branch-name>\`
     - Pull Request link: \`https://github.com/.../pull/...\`
     - A concise summary of what was implemented.`);

    return parts.join('\n\n');
  }

  parts.push(`You are Waymark AI, an autonomous data assistant.`);
  if (templateKey) {
    parts.push(`You are operating in the domain of the '${templateKey}' template. Use the 'waymark-${templateKey}' skill if needed.`);
  } else {
    parts.push(`Use the 'waymark-orchestrator' skill to select the appropriate Waymark template and actions.`);
  }

  if (sheetId) {
    parts.push(`Target Spreadsheet ID: ${sheetId}`);
  }

  if (context) {
    parts.push(`Conversation context:\n${context}`);
  }

  if (validShareWith.length > 0) {
    parts.push(`Household / Collaborator Share List: ${validShareWith.join(', ')} (pass shareWith: ${JSON.stringify(validShareWith)} when creating sheets or docs so the requester and family have edit access).`);
  }

  parts.push(`\nUser Request: ${task}`);
  parts.push(`\nInstructions:
1. Use the Waymark MCP tools:
   - Discovering files: call waymark_list_files({ query?, type? }) to find existing sheets or docs.
   - Understanding structure (the same template model the Waymark app uses): call waymark_list_templates() and waymark_detect_template({ headers }) to reason about a sheet's template and column roles. waymark_get_sheet returns rows keyed by column role — prefer it when reading.
   - Creating new sheets: call waymark_create_sheet({ templateKey, title, seedRows?, shareWith? })
   - Reading sheets: call waymark_get_sheet({ spreadsheetId, sheetTitle? })
   - Modifying rows: call waymark_update_entry({ spreadsheetId, rowIndex, updates }) using 1-based rowIndex (_rowIndex >= 1)
   - Appending rows: call waymark_add_entry({ spreadsheetId, entry })
   - Searching rows: call waymark_search_entries({ spreadsheetId, query, column? })
   - Document operations: call waymark_create_doc, waymark_get_doc, waymark_append_doc
2. Optional — build synthetic understanding with the knowledge graph, ONLY when the task clearly involves connecting or cross-referencing multiple existing Waymarks, and never in a way that blocks, delays, or risks failing the core request:
   - You MAY call waymark_get_links({ sheetId? }) to see how existing Waymarks relate when that context genuinely helps.
   - After creating data that clearly relates to another existing Waymark, you MAY record it with waymark_link_entries(...). Skip all graph steps for simple, standalone requests (e.g. "add a recipe", "log an expense").
3. When creating a new sheet, output the viewer link: [Sheet Title](#/sheet/<spreadsheetId>)
4. When creating or linking a doc, output the doc link: [Doc Title](https://docs.google.com/document/d/<documentId>/edit)
5. If the user's request is an engineering task (e.g. modifying Waymark code, creating a branch, or opening a PR), switch to engineering mode: check out a git branch, modify the files, commit, push, and open a PR with gh pr create.
6. Be fast and decisive: plan the whole task first, then use the fewest tool calls needed. Avoid redundant reads — reuse data you already fetched and batch related writes. Do not re-read a sheet you just wrote unless verification is essential.
7. Provide a friendly, concise summary of what you did.`);

  return parts.join('\n\n');
}

function killChildProcessTree(child) {
  if (!child || !child.pid) return;
  if (process.platform === 'win32') {
    execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {});
    return;
  }
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    try { child.kill('SIGTERM'); } catch {}
  }
  setTimeout(() => {
    try { process.kill(-child.pid, 'SIGKILL'); } catch {
      try { child.kill('SIGKILL'); } catch {}
    }
  }, 1500).unref?.();
}

function spawnSafe(command, args, { cwd, timeoutMs, env, maxBuffer = 10 * 1024 * 1024 }) {
  return new Promise((resolve, reject) => {
    const isWin = process.platform === 'win32';
    const child = spawn(command, args, {
      cwd,
      env,
      shell: false,
      windowsHide: true,
      detached: !isWin,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      killChildProcessTree(child);
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      if (stdout.length < maxBuffer) stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk) => {
      if (stderr.length < maxBuffer) stderr += chunk.toString('utf8');
    });

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (timedOut) {
        const err = new Error(`Timed out after ${timeoutMs}ms`);
        err.killed = true;
        err.stderr = stderr;
        err.stdout = stdout;
        reject(err);
        return;
      }
      if (code !== 0) {
        const err = new Error(stderr.trim() || `agy exited with code ${code}`);
        err.code = code;
        err.stderr = stderr;
        err.stdout = stdout;
        reject(err);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

/**
 * Run a prompt through agy safely without shell command injection.
 * @param {object} opts
 * @param {string} opts.task
 * @param {string} [opts.templateKey]
 * @param {string} [opts.sheetId]
 * @param {string} [opts.context]
 * @param {string} [opts.model]
 * @param {number} [opts.timeoutMs]
 * @param {string} [opts.cwd]
 * @returns {Promise<{ ok: boolean, output: string, sheetId?: string, createdNewSheet?: boolean, durationMs: number, error?: string }>}
 */
/**
 * Resolve which OAuth token a Waymark task should run under.
 *
 * Critical for SHARED agents: when a guest (e.g. a spouse) drives the owner's
 * agent, the WaysideOrchestrator records the guest as the "active requester"
 * (waymark-active-requester.json). The agent must act as that requester so the
 * Waymarks it creates land in — and stay usable by — the person who asked for
 * them. Previously this helper's logic was skipped and the owner's default
 * token was always forced onto the child, so guest requests silently ran as the
 * owner and produced sheets the requester could not use.
 *
 * Precedence: explicit caller override → an already-exported env var → a fresh
 * active-requester pointer → the owner's default token.
 * @param {{ tokenPath?: string|null, homeDir?: string, env?: NodeJS.ProcessEnv }} [opts]
 * @returns {string} absolute token path, or '' when none is available
 */
export function resolveOAuthTokenPath({ tokenPath = null, homeDir = os.homedir(), env = process.env } = {}) {
  const gcloudDir = path.join(homeDir, '.config', 'gcloud');
  const defaultOAuth = path.join(gcloudDir, 'waymark-oauth-token.json');
  if (tokenPath && existsSync(tokenPath)) return tokenPath;
  if (env.WAYMARK_OAUTH_TOKEN_PATH) return env.WAYMARK_OAUTH_TOKEN_PATH;
  try {
    const activePath = path.join(gcloudDir, 'waymark-active-requester.json');
    if (existsSync(activePath)) {
      const meta = JSON.parse(readFileSync(activePath, 'utf8'));
      if (meta?.tokenPath && existsSync(meta.tokenPath)
          && Date.now() - Number(meta.updatedAt || 0) < 10 * 60 * 1000) {
        return meta.tokenPath;
      }
    }
  } catch { /* fall through to default */ }
  return existsSync(defaultOAuth) ? defaultOAuth : '';
}

export async function runAgyTask({
  task,
  templateKey = null,
  sheetId = null,
  context = '',
  shareWith = [],
  tokenPath = null,
  expectedEmail = '',
  isCodeTask = false,
  model = DEFAULT_MODEL,
  timeoutMs = null,
  cwd = ROOT,
}) {
  const effectiveIsCodeTask = Boolean(isCodeTask) ||
    /\b(pull\s*request|pr)\b/i.test(task) ||
    /\b(branch|checkout|commit|merge\s*request)\b/i.test(task) ||
    /\b(in\s+the\s+(?:waymark\s+)?repo|codebase|repository|waymark\s+branch)\b/i.test(task) ||
    /\b(put\s+up\s+(?:a\s+)?(?:new\s+)?(?:waymark\s+)?branch|put\s+up\s+for\s+pr|make\s+(?:a\s+)?pr)\b/i.test(task);

  const effectiveTimeoutMs = timeoutMs || (effectiveIsCodeTask ? DEFAULT_CODE_TIMEOUT_MS : DEFAULT_TIMEOUT_MS);
  const prompt = buildAgyPrompt({ task, templateKey, sheetId, context, shareWith, isCodeTask: effectiveIsCodeTask });
  const start = Date.now();
  const { bin: agyBin, useShell } = resolveAgyBinary();

  const homeDir = os.homedir();
  const defaultSa = path.join(homeDir, '.config', 'gcloud', 'waymark-service-account-key.json');
  const childEnv = { ...process.env };
  if (!childEnv.GOOGLE_APPLICATION_CREDENTIALS && existsSync(defaultSa)) {
    childEnv.GOOGLE_APPLICATION_CREDENTIALS = defaultSa;
  }
  // Run as the actual requester (the guest driving a shared agent), not the
  // agent owner. Setting this explicitly makes every MCP child deterministic.
  const resolvedOAuth = resolveOAuthTokenPath({ tokenPath, homeDir, env: process.env });
  if (resolvedOAuth) {
    childEnv.WAYMARK_OAUTH_TOKEN_PATH = resolvedOAuth;
  }
  if (Array.isArray(shareWith) && shareWith.length > 0) {
    childEnv.WAYMARK_AUTO_SHARE_EMAILS = shareWith.join(',');
  }

  // Log exactly which Google identity the agent will act as. For a shared agent
  // this MUST be the requester (e.g. the collaborator), not the host owner —
  // otherwise Waymarks are created in the wrong Drive. Surfaced in diagnostics.
  const actingAs = identityForToken(resolvedOAuth);
  process.stderr.write(`[agy] task start — acting as: ${actingAs || 'UNKNOWN'} | token: ${resolvedOAuth || 'none'} | template: ${templateKey || 'auto'} | codeTask: ${effectiveIsCodeTask}\n`);

  // Final safety net: never act under the wrong Google account for Drive tasks.
  // Code tasks operate on the local git repository and GitHub CLI, so they do
  // not require a Drive requester token.
  const wantEmail = String(expectedEmail || '').trim().toLowerCase();
  if (!effectiveIsCodeTask && wantEmail && actingAs && actingAs !== wantEmail) {
    const durationMs = Date.now() - start;
    const errorMsg = `Identity mismatch: resolved OAuth token acts as '${actingAs}' but the requester is '${wantEmail}'. Refusing to run so Waymarks never land in the wrong account.`;
    const logFile = writeTaskLog({
      outcome: 'IDENTITY_MISMATCH', actingAs, tokenPath: resolvedOAuth, model,
      durationMs, error: errorMsg, prompt,
    });
    process.stderr.write(`[agy] ❌ ${errorMsg} — log: ${logFile || 'n/a'}\n`);
    return { ok: false, output: '', error: errorMsg, actingAs, durationMs, logFile, identityMismatch: true };
  }
  if (!effectiveIsCodeTask && wantEmail && !actingAs) {
    const durationMs = Date.now() - start;
    const errorMsg = `Cannot act as '${wantEmail}': no usable OAuth token was resolved. Refusing to fall back to another account.`;
    const logFile = writeTaskLog({
      outcome: 'NO_REQUESTER_TOKEN', actingAs: '', tokenPath: resolvedOAuth, model,
      durationMs, error: errorMsg, prompt,
    });
    process.stderr.write(`[agy] ❌ ${errorMsg} — log: ${logFile || 'n/a'}\n`);
    return { ok: false, output: '', error: errorMsg, actingAs: '', durationMs, logFile, identityMismatch: true };
  }

  // On Windows when agy resolves to a .cmd/.bat shim, invoke via powershell.exe with shell: false
  // and pass arguments via environment variables so untrusted prompts can never inject cmd.exe metacharacters.
  let execCmd = agyBin;
  let execArgs = [
    '--model', model,
    '--dangerously-skip-permissions',
    '-p', prompt,
  ];
  if (useShell && process.platform === 'win32') {
    execCmd = 'powershell.exe';
    execArgs = [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      '& $env:WAYMARK_AGY_BIN --model $env:WAYMARK_AGY_MODEL --dangerously-skip-permissions -p $env:WAYMARK_AGY_PROMPT; exit $LASTEXITCODE',
    ];
    childEnv.WAYMARK_AGY_BIN = agyBin;
    childEnv.WAYMARK_AGY_MODEL = model;
    childEnv.WAYMARK_AGY_PROMPT = prompt;
  }

  try {
    const { stdout, stderr } = await spawnSafe(execCmd, execArgs, {
      cwd,
      timeoutMs: effectiveTimeoutMs,
      env: childEnv,
    });

    const output = (stdout || '').trim();
    const refs = extractFileReferences(output);
    const prRefs = extractPrReferences(output);
    const detectedSheetId = refs.sheetId || sheetId;
    const createdNewSheet = Boolean(refs.sheetId && refs.sheetId !== sheetId);
    const detectedDocId = refs.docId;
    const durationMs = Date.now() - start;

    const logFile = writeTaskLog({
      outcome: 'OK', actingAs, tokenPath: resolvedOAuth, model, durationMs,
      prompt, stdout, stderr,
    });
    process.stderr.write(`[agy] task OK in ${durationMs}ms (acting as ${actingAs || 'UNKNOWN'}) — log: ${logFile || 'n/a'}\n`);

    return {
      ok: true,
      output,
      sheetId: detectedSheetId,
      createdNewSheet,
      sheetTitle: refs.sheetTitle,
      docId: detectedDocId,
      docTitle: refs.docTitle,
      prUrl: prRefs.prUrl,
      prNumber: prRefs.prNumber,
      branch: prRefs.branch,
      templateKey,
      actingAs,
      durationMs,
      logFile,
    };
  } catch (err) {
    const durationMs = Date.now() - start;
    const outTail = tailLines(err.stdout);
    const errTail = tailLines(err.stderr);
    const reason = outTail || errTail || '(no output captured — the agent produced nothing)';
    const errorMsg = err.killed
      ? `Timed out after ${effectiveTimeoutMs}ms while acting as ${actingAs || 'UNKNOWN'}. Last activity:\n${reason}`
      : (errTail || err.message || 'Unknown agy execution error');

    const logFile = writeTaskLog({
      outcome: err.killed ? 'TIMEOUT' : 'ERROR',
      actingAs, tokenPath: resolvedOAuth, model, durationMs,
      error: errorMsg, prompt, stdout: err.stdout, stderr: err.stderr,
    });
    process.stderr.write(`[agy] task ${err.killed ? 'TIMEOUT' : 'ERROR'} in ${durationMs}ms (acting as ${actingAs || 'UNKNOWN'}) — log: ${logFile || 'n/a'}\n${reason}\n`);

    return {
      ok: false,
      output: '',
      error: errorMsg,
      actingAs,
      durationMs,
      logFile,
    };
  }
}

// ── CLI Execution ──────────────────────────────────────────────────────
function isMainModule(metaUrl) {
  if (!process.argv[1]) return false;
  try {
    const a = realpathSync(fileURLToPath(metaUrl));
    const b = realpathSync(path.resolve(process.argv[1]));
    return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
  } catch {
    const a = path.resolve(fileURLToPath(metaUrl));
    const b = path.resolve(process.argv[1]);
    return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
  }
}

if (isMainModule(import.meta.url)) {
  const args = process.argv.slice(2);
  let task = '';
  let templateKey = null;
  let sheetId = null;

  for (let i = 0; i < args.length; i++) {
    if ((args[i] === '--task' || args[i] === '-m' || args[i] === '--message' || args[i] === '-p' || args[i] === '--prompt') && args[i + 1]) {
      task = args[++i];
    } else if (args[i] === '--template' && args[i + 1]) {
      templateKey = args[++i];
    } else if (args[i] === '--sheet' && args[i + 1]) {
      sheetId = args[++i];
    } else if (!task && !args[i].startsWith('-')) {
      task = args[i];
    }
  }

  if (!task) {
    console.log('Usage: node scripts/agy-agent-runner.mjs [--template <key>] [--sheet <id>] --task "<prompt>"');
    process.exit(1);
  }

  console.log(`Running AGY Task (model: ${DEFAULT_MODEL})...`);
  runAgyTask({ task, templateKey, sheetId }).then(res => {
    if (res.ok) {
      console.log(`\n--- AGY Response (${res.durationMs}ms) ---\n`);
      console.log(res.output);
      if (res.sheetId) console.log(`\nDetected Sheet ID: ${res.sheetId}`);
    } else {
      console.error(`\n--- AGY Failed (${res.durationMs}ms) ---\n`, res.error);
      process.exit(1);
    }
  });
}
